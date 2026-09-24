import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { LocalSeedConfigError, parseLocalSeedConfig } from '../src/local-seed/config.js';
import { buildLocalSeedPlan } from '../src/local-seed/plan.js';
import type { LocalSeedCliDeps } from '../src/local-seed/index.js';
import { runLocalSeed } from '../src/local-seed/index.js';

const VALID_ENV = {
  NODE_ENV: 'test',
  IMEAL_LOCAL_SEED: '1',
  IMEAL_LOCAL_SEED_CONFIRM: 'I_UNDERSTAND_LOCAL_ONLY',
  IMEAL_LOCAL_SEED_BASE_EMAIL: 'seed@example.test',
  DATABASE_URL:
    'postgresql://postgres:super-secret@localhost:5432/imeal?schema=test_seed',
};
const VALID_ARGS = ['--base-email', 'seed@example.test'];
const EXPECTED_COUNT_LABELS = [
  'users=50',
  'userRoles=56',
  'locations=4',
  'locationPolicies=4',
  'assignments=50',
  'allowlists=50',
  'weeklyMenus=1',
  'dailyMenus=7',
  'mealDays=7',
  'menuRevisions=7',
  'registrations=126',
  'pendingDelegations=4',
  'acceptedDelegations=4',
  'completedDelegations=8',
  'penalties=10',
  'servingVerifications=40',
  'pickupSessions=40',
  'servingConfirmRequests=40',
  'mealServings=40',
  'mealEvents=40',
  'appSettings=1',
] as const;

function makeDeps(overrides: Partial<LocalSeedCliDeps> = {}): LocalSeedCliDeps {
  return {
    createPrisma: () => {
      throw new Error('unexpected Prisma construction');
    },
    writePlan: async () => {
      throw new Error('unexpected database write');
    },
    ...overrides,
  };
}

describe('local seed CLI', () => {
  it('prints help and never creates Prisma without environment configuration', async () => {
    const createPrisma = vi.fn(() => {
      throw new Error('must not create Prisma');
    });

    const result = await runLocalSeed(['--help'], {}, { createPrisma });

    expect(result.kind).toBe('help');
    expect(createPrisma).not.toHaveBeenCalled();
    expect(result.kind === 'help' && result.text).toContain('IMEAL_LOCAL_SEED_CONFIRM');
  });

  it('builds a valid dry-run plan without creating Prisma or writing', async () => {
    const createPrisma = vi.fn(() => {
      throw new Error('must not create Prisma');
    });
    const writePlan = vi.fn();

    const result = await runLocalSeed(
      ['--base-email', 'seed@example.test', '--dry-run'],
      VALID_ENV,
      { createPrisma, writePlan },
    );

    expect(result.kind).toBe('dry-run');
    expect(result.kind === 'dry-run' && result.plan.users).toHaveLength(50);
    expect(createPrisma).not.toHaveBeenCalled();
    expect(writePlan).not.toHaveBeenCalled();
    for (const countLabel of EXPECTED_COUNT_LABELS) {
      expect(result.kind === 'dry-run' && result.summary).toContain(countLabel);
    }
    expect(result.kind === 'dry-run' && result.summary).toContain('LOCAL/TEST ONLY');
    expect(result.kind === 'dry-run' && result.summary).not.toContain('super-secret');
    expect(result.kind === 'dry-run' && result.summary).not.toContain(
      'I_UNDERSTAND_LOCAL_ONLY',
    );
  });
  it('returns a written result and disconnects the owned client', async () => {
    const disconnect = vi.fn(async () => undefined);
    const fakePrisma = { $disconnect: disconnect } as unknown as PrismaClient;
    const config = parseLocalSeedConfig(VALID_ARGS, VALID_ENV);
    const plan = buildLocalSeedPlan(config);
    const createPrisma = vi.fn(() => fakePrisma);
    const writePlan = vi.fn(async () => ({
      created: 1,
      updated: 0,
      unchanged: 0,
      counts: plan.counts,
    }));

    const result = await runLocalSeed(VALID_ARGS, VALID_ENV, {
      createPrisma,
      writePlan,
    });

    expect(result.kind).toBe('written');
    expect(createPrisma).toHaveBeenCalledWith(VALID_ENV.DATABASE_URL);
    expect(writePlan).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(result.kind === 'written' && result.summary).toContain('LOCAL/TEST ONLY');
    expect(result.kind === 'written' && result.summary).not.toContain('super-secret');
    expect(result.kind === 'written' && result.summary).not.toContain(
      'I_UNDERSTAND_LOCAL_ONLY',
    );
  });

  it('rejects the removed database URL flag', () => {
    const args = ['--base-email', 'seed@example.test', '--database-url', VALID_ENV.DATABASE_URL];

    expect(() => parseLocalSeedConfig(args, VALID_ENV)).toThrowError(LocalSeedConfigError);
    try {
      parseLocalSeedConfig(args, VALID_ENV);
    } catch (error) {
      expect(error).toMatchObject({ code: 'MISSING_ARGUMENT' });
    }
  });

  it('rejects missing DATABASE_URL before creating Prisma or writing', async () => {
    const createPrisma = vi.fn(() => {
      throw new Error('must not create Prisma');
    });
    const writePlan = vi.fn();

    await expect(
      runLocalSeed(
        ['--base-email', 'seed@example.test', '--dry-run'],
        { ...VALID_ENV, DATABASE_URL: undefined },
        { createPrisma, writePlan },
      ),
    ).rejects.toMatchObject({ name: 'LocalSeedConfigError', code: 'MISSING_ARGUMENT' });
    expect(createPrisma).not.toHaveBeenCalled();
    expect(writePlan).not.toHaveBeenCalled();
  });

  it('disconnects the owned client when writing fails', async () => {
    const disconnect = vi.fn(async () => undefined);
    const fakePrisma = { $disconnect: disconnect } as unknown as PrismaClient;
    const writeError = new Error('write failed');

    await expect(
      runLocalSeed(VALID_ARGS, VALID_ENV, {
        createPrisma: () => fakePrisma,
        writePlan: async () => {
          throw writeError;
        },
      }),
    ).rejects.toBe(writeError);

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('returns a typed config error before creating Prisma for unsafe environments', async () => {
    const createPrisma = vi.fn(() => {
      throw new Error('must not create Prisma');
    });

    await expect(
      runLocalSeed(VALID_ARGS, { ...VALID_ENV, NODE_ENV: 'production' }, { createPrisma }),
    ).rejects.toBeInstanceOf(LocalSeedConfigError);
    expect(createPrisma).not.toHaveBeenCalled();
  });

  it('keeps config errors stable and redacted', async () => {
    const result = await runLocalSeed(
      ['--base-email', 'seed@example.test', '--week-start', '2026-09-29', '--dry-run'],
      VALID_ENV,
      makeDeps(),
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({ name: 'LocalSeedConfigError', code: 'INVALID_DATE' });
    expect(String(result)).not.toContain('super-secret');
    expect(String(result)).not.toContain('I_UNDERSTAND_LOCAL_ONLY');
  });
});
