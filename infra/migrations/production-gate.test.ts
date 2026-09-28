import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const gatePath = resolve(root, 'infra/migrations/production-gate.sh');
const baseEnvironment = {
  ...process.env,
  MIGRATION_DATABASE_URL:
    'postgresql://gate_user:gate_password@db:5432/imeal?schema=public',
  MIGRATION_TARGET_SCHEMA: 'public',
  MIGRATION_TARGET_IDENTITY: 'staging-schema',
  MIGRATION_APPROVAL_ID: 'approval-1',
  RELEASE_VERSION: 'release-1',
  MIGRATION_EVIDENCE_PATH: '',
};

function createHarness(overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'imeal-gate-test-'));
  const binDirectory = join(directory, 'bin');
  const sqlDirectory = join(directory, 'sql');
  const markerPath = join(directory, 'migration-gate.json');
  const logPath = join(directory, 'commands.log');
  mkdirSync(binDirectory, { recursive: true });
  mkdirSync(sqlDirectory, { recursive: true });
  writeFileSync(join(sqlDirectory, 'preflight.sql'), 'SELECT 1;\n');
  writeFileSync(join(sqlDirectory, 'backfill.sql'), 'SELECT 1;\n');
  writeFileSync(
    join(binDirectory, 'psql'),
    `#!/bin/sh
phase=
url=
for argument in "$@"; do
  case "$argument" in
    postgresql://*|postgres://*) url="$argument" ;;
    gate_phase=*) phase="\${argument#gate_phase=}" ;;
  esac
done
case "$url" in
  *schema=*) exit 18 ;;
esac
printf 'psql:%s\\n' "$phase" >> "$GATE_TEST_LOG"
cat >/dev/null
if [ "\${FAIL_PHASE:-}" = "$phase" ]; then exit 17; fi
if [ "$phase" = "preflight" ]; then
  printf 'registration_snapshot_incomplete|0|{}\\n'
  printf 'registration_serving_mismatch|0|{}\\n'
  printf 'roster_assignment_ambiguous|0|{}\\n'
  printf 'menu_revision_incomplete|0|{}\\n'
  printf 'penalty_registration_mapping_ambiguous|0|{}\\n'
  printf 'penalty_registration_duplicate_candidate|0|{}\\n'
  printf 'future_active_snapshot_incomplete|0|{}\\n'
fi
`,
  );
  writeFileSync(
    join(binDirectory, 'yarn'),
    `#!/bin/sh
printf 'yarn:migrate\\n' >> "$GATE_TEST_LOG"
if [ "\${FAIL_PHASE:-}" = "migrate" ]; then exit 17; fi
`,
  );
  chmodSync(join(binDirectory, 'psql'), 0o755);
  chmodSync(join(binDirectory, 'yarn'), 0o755);
  const environment = {
    ...baseEnvironment,
    ...overrides,
    MIGRATION_EVIDENCE_PATH: markerPath.replace(/\\/g, '/'),
    MIGRATION_SQL_DIR: sqlDirectory.replace(/\\/g, '/'),
    GATE_WORKDIR: root,
    GATE_LOG_DIR: join(directory, 'logs').replace(/\\/g, '/'),
    GATE_TEST_LOG: logPath,
    PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ''}`,
  };
  return { directory, markerPath, logPath, environment };
}

function runGate(environment: NodeJS.ProcessEnv) {
  return spawnSync('sh', [gatePath], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
  });
}

describe('production migration gate command contract', () => {
  it('fails before backfill when approval is missing', () => {
    const harness = createHarness({ MIGRATION_APPROVAL_ID: '' });
    try {
      const result = runGate(harness.environment);
      expect(result.status).not.toBe(0);
      expect(existsSync(harness.markerPath)).toBe(false);
      if (existsSync(harness.logPath)) {
        expect(readFileSync(harness.logPath, 'utf8')).not.toContain('yarn:migrate');
      }
    } finally {
      rmSync(harness.directory, { recursive: true, force: true });
    }
  });
  it('rejects a database URL whose schema does not match the target', () => {
    const harness = createHarness({
      MIGRATION_DATABASE_URL:
        'postgresql://gate_user:gate_password@db:5432/imeal?schema=private',
    });
    try {
      const result = runGate(harness.environment);
      expect(result.status).not.toBe(0);
      expect(existsSync(harness.markerPath)).toBe(false);
      expect(existsSync(harness.logPath)).toBe(false);
    } finally {
      rmSync(harness.directory, { recursive: true, force: true });
    }
  });

  it('fails closed when the target session assertion fails', () => {
    const harness = createHarness({ FAIL_PHASE: 'target-assert' });
    try {
      const result = runGate(harness.environment);
      expect(result.status).not.toBe(0);
      expect(existsSync(harness.markerPath)).toBe(false);
    } finally {
      rmSync(harness.directory, { recursive: true, force: true });
    }
  });

  it('fails closed on a non-zero preflight without writing evidence', () => {
    const harness = createHarness({ FAIL_PHASE: 'preflight' });
    try {
      const result = runGate(harness.environment);
      expect(result.status).not.toBe(0);
      expect(existsSync(harness.markerPath)).toBe(false);
    } finally {
      rmSync(harness.directory, { recursive: true, force: true });
    }
  });

  it('reruns the approved backfill and keeps one read-only marker', () => {
    const harness = createHarness();
    try {
      const first = runGate(harness.environment);
      const second = runGate(harness.environment);
      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      const marker = JSON.parse(readFileSync(harness.markerPath, 'utf8')) as Record<string, string>;
      expect(marker).toMatchObject({
        release: 'release-1',
        migration: '20260928000000_phase0_domain_correctness',
        targetSchema: 'staging-schema',
        approvalId: 'approval-1',
      });
      expect(statSync(harness.markerPath).mode & 0o777).toBe(0o444);
      expect(readFileSync(harness.logPath, 'utf8').match(/yarn:migrate/g)).toHaveLength(2);
    } finally {
      rmSync(harness.directory, { recursive: true, force: true });
    }
  });

  it('does not write evidence when post-validation fails', () => {
    const harness = createHarness({ FAIL_PHASE: 'post-validation' });
    try {
      const result = runGate(harness.environment);
      expect(result.status).not.toBe(0);
      expect(existsSync(harness.markerPath)).toBe(false);
    } finally {
      rmSync(harness.directory, { recursive: true, force: true });
    }
  });
});
