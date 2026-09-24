import { describe, expect, it } from 'vitest';
import {
  formatLocalSeedTarget,
  localSeedHelp,
  LocalSeedConfigError,
  parseLocalSeedConfig,
} from '../src/local-seed/config.js';

const SAFE_ENV = {
  NODE_ENV: 'test',
  IMEAL_LOCAL_SEED: '1',
  IMEAL_LOCAL_SEED_CONFIRM: 'I_UNDERSTAND_LOCAL_ONLY',
  IMEAL_LOCAL_SEED_BASE_EMAIL: 'seed@example.test',
  DATABASE_URL:
    'postgresql://postgres:postgres@localhost:5432/imeal?schema=test_seed',
};

describe('local seed safety configuration', () => {
  it('requires every write-path safety value and accepts only local hosts', () => {
    const config = parseLocalSeedConfig([], SAFE_ENV);

    expect(config.target.host).toBe('localhost');
    expect(config.weekStart).toBe('2026-09-28');
    expect(config.serveDate).toBe('2026-09-28');
    expect(config.baseEmail).toBe('seed@example.test');
    expect(config.target.nodeEnv).toBe('test');
    expect(config.target.database).toBe('imeal');
    expect(config.target.schema).toBe('test_seed');
    expect(config.dryRun).toBe(false);
  });
  it('defaults serve date to an explicitly selected week start', () => {
    const config = parseLocalSeedConfig(
      ['--week-start', '2026-10-05'],
      SAFE_ENV,
    );

    expect(config.weekStart).toBe('2026-10-05');
    expect(config.serveDate).toBe('2026-10-05');
  });
  it('uses the selected week from the environment when serve date is omitted', () => {
    const config = parseLocalSeedConfig([], {
      ...SAFE_ENV,
      IMEAL_LOCAL_SEED_WEEK_START: '2026-10-05',
    });

    expect(config.weekStart).toBe('2026-10-05');
    expect(config.serveDate).toBe('2026-10-05');
  });

  it('accepts explicit flags and fixed-range date values', () => {
    const config = parseLocalSeedConfig(
      [
        '--base-email',
        ' Flag@Example.test ',
        '--week-start',
        '2026-09-28',
        '--serve-date',
        '2026-10-02',
        '--dry-run',
      ],
      { ...SAFE_ENV, IMEAL_LOCAL_SEED_BASE_EMAIL: ' Flag@Example.test ' },
    );

    expect(config.baseEmail).toBe('flag@example.test');
    expect(config.weekStart).toBe('2026-09-28');
    expect(config.serveDate).toBe('2026-10-02');
    expect(config.dryRun).toBe(true);
  });

  it('rejects production, remote, missing-confirmation, and production-marked targets', () => {
    expect(() => parseLocalSeedConfig([], { NODE_ENV: 'production' })).toThrow(
      'INVALID_ENVIRONMENT',
    );
    expect(() =>
      parseLocalSeedConfig([], {
        NODE_ENV: 'test',
        IMEAL_LOCAL_SEED: '1',
        IMEAL_LOCAL_SEED_CONFIRM: 'I_UNDERSTAND_LOCAL_ONLY',
        IMEAL_LOCAL_SEED_BASE_EMAIL: 'seed@example.test',
        DATABASE_URL: 'postgresql://u:p@db.example.test/imeal',
      }),
    ).toThrow('REMOTE_DATABASE');
    expect(() =>
      parseLocalSeedConfig([], {
        NODE_ENV: 'test',
        IMEAL_LOCAL_SEED: '1',
        IMEAL_LOCAL_SEED_BASE_EMAIL: 'seed@example.test',
        DATABASE_URL: 'postgresql://u:p@localhost/imeal',
      }),
    ).toThrow('INVALID_ENVIRONMENT');
    expect(() =>
      parseLocalSeedConfig([], {
        NODE_ENV: 'test',
        IMEAL_LOCAL_SEED: '1',
        IMEAL_LOCAL_SEED_CONFIRM: 'I_UNDERSTAND_LOCAL_ONLY',
        IMEAL_LOCAL_SEED_BASE_EMAIL: 'seed@example.test',
        DATABASE_URL: 'postgresql://u:p@localhost/imeal_production',
      }),
    ).toThrow('PRODUCTION_MARKER');
  });

  it('rejects production values in explicit deployment environment markers', () => {
    for (const variable of ['APP_ENV', 'RUNTIME_ENV', 'DEPLOYMENT_ENV'] as const) {
      expect(() =>
        parseLocalSeedConfig([], {
          ...SAFE_ENV,
          [variable]: 'PrOdUcTiOn',
        }),
      ).toThrow('INVALID_ENVIRONMENT');
    }
  });

  it('rejects production, prod, and live markers in database and schema', () => {
    for (const marker of ['production', 'prod', 'live']) {
      expect(() =>
        parseLocalSeedConfig([], {
          ...SAFE_ENV,
          DATABASE_URL: `postgresql://u:p@localhost/imeal_${marker}`,
        }),
      ).toThrow('PRODUCTION_MARKER');
      expect(() =>
        parseLocalSeedConfig([], {
          ...SAFE_ENV,
          DATABASE_URL: `postgresql://u:p@localhost/imeal?schema=test_${marker}`,
        }),
      ).toThrow('PRODUCTION_MARKER');
    }
  });

  it('rejects inherited host names and repeated schema markers', () => {
    for (const host of ['constructor', '__proto__']) {
      expect(() =>
        parseLocalSeedConfig([], {
          ...SAFE_ENV,
          DATABASE_URL: `postgresql://u:p@${host}/imeal`,
        }),
      ).toThrow('REMOTE_DATABASE');
    }

    expect(() =>
      parseLocalSeedConfig([], {
        ...SAFE_ENV,
        DATABASE_URL: 'postgresql://u:p@localhost/imeal?schema=public&schema=live',
      }),
    ).toThrow('PRODUCTION_MARKER');
  });

  it('reports typed stable errors for invalid dates and conflicting inputs', () => {
    expect(() =>
      parseLocalSeedConfig(['--week-start', '2026-09-29'], SAFE_ENV),
    ).toThrowError(LocalSeedConfigError);
    try {
      parseLocalSeedConfig(['--week-start', '2026-09-29'], SAFE_ENV);
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_DATE' });
    }

    expect(() =>
      parseLocalSeedConfig(
        ['--base-email', 'other@example.test'],
        SAFE_ENV,
      ),
    ).toThrow('CONFLICTING_INPUT');
  });

  it('formats a redacted local target summary and exposes safe help', () => {
    const config = parseLocalSeedConfig([], {
      ...SAFE_ENV,
      DATABASE_URL:
        'postgresql://postgres:super-secret@localhost:5432/imeal?schema=test_seed&sslmode=require',
    });
    const summary = formatLocalSeedTarget(config);

    expect(summary).toContain('test');
    expect(summary).toContain('localhost');
    expect(summary).toContain('imeal');
    expect(summary).toContain('2026-09-28');
    expect(summary).not.toContain('super-secret');
    expect(summary).not.toContain('sslmode=require');
    expect(summary).not.toContain('I_UNDERSTAND_LOCAL_ONLY');

    const help = localSeedHelp();
    expect(help).toContain('IMEAL_LOCAL_SEED_CONFIRM');
    expect(help).toContain('--dry-run');
  });
});
