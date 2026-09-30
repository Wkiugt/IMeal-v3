# Staging Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax and each task ends with a focused commit.

**Goal:** Build the target-safe staging qualification workflow, recovery evidence, smoke/evidence bundle, CI/release gates, staging integration checks and operator runbook defined by `docs/superpowers/specs/2026-09-28-staging-readiness-design.md`, consuming the shared runtime hardening outputs from `docs/superpowers/plans/2026-09-28-production-hardening-plan.md`.

**Architecture:** Add a small Node 20 operational CLI under `scripts/staging` that validates an allowlisted target, executes the existing Phase 0 SQL through a read-only/schema-safe `psql` wrapper, verifies independent approval hashes, runs transactional backfill and named constraint validation, and writes immutable redacted evidence. Add isolated staging Compose/Caddy configuration, backup/restore and smoke commands, then wire those interfaces into CI and an operator runbook. Consume the production-hardening plan's API/worker health, request-ID, logging, metrics and lifecycle contracts; staging work adds only integration/configuration tests and alert-rule wiring, never shared runtime reimplementation.

**Tech Stack:** Node.js 20 built-ins (`node:fs/promises`, `node:crypto`, `node:child_process`, `node:test`), Bash/`psql`/`pg_dump`/`pg_restore`, Docker Compose v2, Caddy, Yarn 4.18.0, Prisma 5.22, PostgreSQL 15, GitHub Actions, existing NestJS API/worker, Expo/Vite clients, JSON evidence artifacts.

**Spec:** `docs/superpowers/specs/2026-09-28-staging-readiness-design.md`
**Execution order:** Execute `docs/superpowers/plans/2026-09-28-production-hardening-plan.md` first. Its shared observability, API/worker health, request-context, lifecycle and logging outputs are prerequisites; execute this plan's staging integration/alert-wiring task only after those outputs are merged and its focused checks pass.

## Global Constraints

- Staging MUST use a distinct PostgreSQL database/credentials, private object-storage bucket, separate OTP provider credentials, isolated network, owned HTTPS hostname, and separate secret namespace.
- Only the reverse proxy is internet-facing; PostgreSQL, PgBouncer, MinIO API/console, worker and internal admin ports MUST NOT be public.
- Server processes run with `NODE_ENV=production`, `AUTH_MODE=otp`, `REQUIRE_AUTH=true`; `REQUIRE_AUTH=false` is allowed only for the exact test pair `NODE_ENV=test` and `REQUIRE_AUTH=false`.
- Business time remains `Asia/Ho_Chi_Minh`; timestamps are UTC instants; serving is 10:30–13:30, no-show processing is 13:45, QR TTL is 5 seconds, skew is 2 seconds and pickup sessions are 30 seconds.
- `prisma migrate deploy` is expansion only. Phase 0 preflight, approval, backfill and named constraint validation remain separate, target-safe gates.
- Never fabricate locations, employees, roster assignments, coordinates, menu history, secrets, OTP codes or production data. Local seed remains local/dev/test/UAT only.
- Any target mismatch, nonzero preflight, missing backup/approval, unexpected row count, failed validation/smoke, public internal port, mutable image or missing rollback authority MUST abort.
- No destructive down migration and no Firebase migration, dual-write, reconciliation or rollback path.
- Evidence is redacted, immutable/access-controlled, checksumed and contains no secret, bearer/session token, OTP code, provider payload, raw GPS or unredacted PII.
- The production-hardening plan owns shared API/worker runtime, request context, health, logging, lifecycle and observability packages. This staging plan MUST consume those outputs and MUST NOT modify or reimplement them.
- Every implementation task uses TDD, runs its focused command before commit, and commits only its listed files.

---

## File and interface map

### New operational files

- `scripts/staging/staging-lib.mjs` — shared argument parsing, target/schema validation, safe `psql` execution, hashing, redaction and atomic evidence writing.
- `scripts/staging/staging-lib.test.mjs` — unit tests for safety and serialization without a database.
- `scripts/staging/phase0-preflight.mjs` — target fingerprint plus read-only execution/parsing of the checked-in `preflight.sql`.
- `scripts/staging/phase0-preflight.test.mjs` — clean/dirty/mismatch preflight fixtures.
- `scripts/staging/phase0-backfill.mjs` — approval/hash verification and controlled execution of `backfill.sql`.
- `scripts/staging/phase0-backfill.test.mjs` — approval, target and command-abort tests.
- `scripts/staging/phase0-validate.mjs` — post-preflight and named constraint validation.
- `scripts/staging/phase0-validate.test.mjs` — validation parsing and fail-closed tests.
- `scripts/staging/backup-staging.mjs` — encrypted/checksumed PostgreSQL and object-storage backup manifest.
- `scripts/staging/restore-rehearsal.mjs` — isolated restore, checksum verification and readiness handoff.
- `scripts/staging/backup-restore.test.mjs` — dry-run command, path and redaction tests.
- `scripts/staging/evidence.mjs` — evidence manifest, required-artifact and checksum verification.
- `scripts/staging/evidence.test.mjs` — manifest completeness and immutable artifact tests.
- `scripts/staging/smoke-staging.mjs` — public readiness, Admin Web, request ID, authenticated profile and report checks.
- `scripts/staging/smoke-staging.test.mjs` — mocked fetch pass/fail/retry and redaction tests.
- `scripts/staging/compose-config.test.mjs` — rendered staging Compose security/build assertions.
- `scripts/staging/runtime-integration.mjs` — staging-only checks against hardening-owned health/request-ID/metrics contracts.
- `scripts/staging/runtime-integration.test.mjs` — mocked health/readiness/metrics integration tests.
- `scripts/staging/alert-rules.test.mjs` — alert-rule metric/threshold/ownership checks.
- `scripts/staging/release-manifest.mjs` — immutable release manifest generation.
- `scripts/staging/release-manifest.test.mjs` — release manifest validation tests.
- `scripts/staging/runbook-links.test.mjs` — runbook command and forbidden-production-instruction checks.

### New staging/release files

- `docker-compose.staging.yml` — production-like staging override: explicit Admin Dockerfile/image, private network, no internal published ports, secret references and private bucket setup.
- `infra/staging/Caddyfile` — owned staging HTTPS site, HTTP redirect, API/Admin routes, safe health route, security headers and edge limits.
- `infra/staging/alert-rules.yml` — API/worker/OTP/DB/storage/backup/security alert conditions from the approved design.
- `.github/workflows/staging-readiness.yml` — immutable install, static checks, disposable DB, image/security evidence, staging smoke and protected approval gates.
- `docs/runbooks/staging-readiness.md` — operator runbook for environment provisioning, migration, backup/restore, smoke, evidence and abort/recovery.

### Runtime outputs consumed from production hardening

- `docs/superpowers/plans/2026-09-28-production-hardening-plan.md` — prerequisite implementation plan; execute it before this plan's staging integration task.
- `packages/observability/src/index.ts` — `resolveRequestId`, `StructuredLogger`, redaction-safe serialization and migration-evidence reader.
- `apps/api/src/common/request-context.ts`, `apps/api/src/health/health.controller.ts`, `apps/api/src/health/health.service.ts`, `apps/api/src/health/health.types.ts` — API request-ID and `/health/live` plus `/health/ready` contract.
- `apps/worker/src/health.controller.ts`, `apps/worker/src/health.service.ts` — worker liveness/readiness contract.
- `apps/api/src/common/request-id.interceptor.ts`, `apps/api/src/common/http-logging.interceptor.ts`, `apps/api/src/common/api-exception.filter.ts` — response correlation and safe error/log behavior.
- `apps/api/src/common/prisma.service.ts`, `apps/worker/src/common/prisma.service.ts`, and shutdown coordinators — lifecycle/readiness dependencies consumed by staging checks.

### Existing files consumed or updated by the plan

- `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/{preflight.sql,backfill.sql,migration.sql}` — execute unchanged and hash in evidence; do not modify.
- `docker-compose.yml:86-97,140-157,189-205,208-244` — preserve local behavior; staging override fixes its admin build, security and readiness differences.
- `apps/admin-web/Dockerfile:1-11`, `apps/mobile/app.config.ts:1-28`, `apps/mobile/src/api/apiConfig.ts:47-66` — release/build inputs.
- `.env.example:5-76`, `apps/api/src/config/environment.ts:79-147`, `apps/worker/src/otp-delivery-worker.service.ts:268-313` — environment names and validation contract.
- `package.json:12-18` — root commands and CI entrypoints.
- `README.md:399-481`, `docs/06-execution-plan.md:486-711`, `docs/imeal-production-readiness-assessment.md:203-307` — update observed operational commands/status only after implementation evidence exists.

---

## Task 1: Shared target safety and evidence primitives

**Files:**
- Create: `scripts/staging/staging-lib.mjs`
- Create: `scripts/staging/staging-lib.test.mjs`
- Modify: `package.json:12-18` (add `test:staging-tools`: `node --test scripts/staging/*.test.mjs`)

**Interfaces:**

```js
export function parseArgs(argv, schema): Record<string, string | boolean>;
export function requireSafeSchemaName(value: string): string;
export function redactDatabaseUrl(value: string): string;
export function assertTargetFingerprint(actual: TargetFingerprint, expected: TargetFingerprint): void;
export function sha256File(filePath: string): Promise<string>;
export function sha256Text(value: string): string;
export async function runPsql(options: {
  databaseUrl: string;
  schema: string;
  sqlFile?: string;
  sql?: string;
  readOnly: boolean;
  statementTimeoutSeconds: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number; argv: string[] }>;
export async function writeEvidence(filePath: string, payload: unknown): Promise<void>;
export function assertNoSecrets(value: unknown): void;
```

**Produces:** Every later wrapper receives a validated schema and target fingerprint, invokes `runPsql` without shell interpolation, and writes atomically redacted JSON evidence.

- [ ] **Step 1: Write failing safety tests.** Cover accepted `phase0_staging_20260928`, rejected spaces/quotes/semicolon/newline/empty schema, URL password redaction, deterministic SHA-256, `assertTargetFingerprint` mismatch errors, and `assertNoSecrets` rejecting keys containing `password`, `token`, `secret`, `apiKey`, `otp`.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireSafeSchemaName, redactDatabaseUrl } from './staging-lib.mjs';

test('accepts only simple approved schema identifiers', () => {
  assert.equal(requireSafeSchemaName('phase0_staging_20260928'), 'phase0_staging_20260928');
  assert.throws(() => requireSafeSchemaName('public; DROP SCHEMA public'));
  assert.throws(() => requireSafeSchemaName('phase0 staging'));
});

test('redacts credentials from database URLs', () => {
  assert.equal(
    redactDatabaseUrl('postgresql://admin:password@db.example/imeal'),
    'postgresql://<redacted>@db.example/imeal',
  );
});
```

- [ ] **Step 2: Run the focused test and verify failure.**

Run: `yarn test:staging-tools --test-name-pattern='schema|redact'`

Expected: FAIL because `scripts/staging/staging-lib.mjs` does not exist.

- [ ] **Step 3: Implement the minimal primitives.** Use `node:url` to redact URL credentials, `/^[A-Za-z_][A-Za-z0-9_]*$/` for schema validation, `crypto.createHash('sha256')`, `fs.rename` for atomic writes, and `spawn` with argument arrays for `psql`. The wrapper MUST set `PGOPTIONS`/SQL `search_path` only after validating the schema and MUST return the child exit code instead of throwing away diagnostics.

- [ ] **Step 4: Add command-injection and redaction tests.** Stub `child_process.spawn` and assert the schema is passed as a validated SQL identifier, `shell:false` is used, `TARGET_DATABASE_URL` never appears in `argv` evidence, and failed commands retain redacted stderr.

- [ ] **Step 5: Run all staging-tool tests.**

Run: `yarn test:staging-tools`

Expected: PASS with no database or network dependency.

- [ ] **Step 6: Commit the focused primitive.**

```bash
git add scripts/staging/staging-lib.mjs scripts/staging/staging-lib.test.mjs package.json
git commit -m "feat: add staging target safety primitives"
```

---

## Task 2: Target fingerprint and read-only Phase 0 preflight

**Files:**
- Create: `scripts/staging/phase0-preflight.mjs`
- Create: `scripts/staging/phase0-preflight.test.mjs`
- Create: `scripts/staging/fixtures/preflight-clean.txt`
- Create: `scripts/staging/fixtures/preflight-dirty.txt`
- Consume unchanged: `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/preflight.sql`

**Interfaces:**

```js
export async function fingerprintTarget({ databaseUrl, schema }): Promise<{
  database: string;
  schema: string;
  serverVersion: string;
  migrationRows: string[];
}>;
export function parsePreflightOutput(raw: string): {
  checks: Array<{ name: string; affectedCount: number; sampleIds: string[] }>;
  statusCounts: Array<{ status: string; count: number }>;
};
export function assertPreflightPass(report: ReturnType<typeof parsePreflightOutput>): void;
export async function runPreflight(options: {
  databaseUrl: string;
  schema: string;
  expectedTarget: { database: string; schema: string };
  releaseId: string;
  outputPath: string;
}): Promise<{
  releaseId: string;
  target: { database: string; schema: string };
  preflightSha256: string;
  result: 'PASS';
  checks: unknown[];
  statusCounts: unknown[];
}>;
```

**Produces:** `preflight-before.json` with target fingerprint, SQL hash, migration status, all named checks/status counts and a PASS/abort result. It must never execute `backfill.sql` or write application tables.

- [ ] **Step 1: Add clean and dirty parser fixtures/tests.** Assert all seven named checks and statuses parse from the clean fixture and that the dirty fixture identifies `future_active_snapshot_incomplete=1` and causes `assertPreflightPass` to throw with the exact check name.

- [ ] **Step 2: Run the parser tests and verify failure.**

Run: `node --test scripts/staging/phase0-preflight.test.mjs`

Expected: FAIL because parser and runner exports are absent.

- [ ] **Step 3: Implement fingerprint and parser.** Invoke `SELECT current_database(), current_schema(), version()` and the Prisma migration table through `runPsql`; execute `preflight.sql` with read-only transaction, `ON_ERROR_STOP=1`, bounded timeout and explicit search path. Store raw output only in a redacted artifact if policy allows; parse counts and bounded sample IDs.

- [ ] **Step 4: Implement the CLI contract.** Support exactly:

```bash
node scripts/staging/phase0-preflight.mjs \
  --database-url-env TARGET_DATABASE_URL \
  --schema phase0_staging_20260928 \
  --release-id imeal-20260928-001 \
  --expected-database imeal_staging \
  --output artifacts/imeal-20260928-001/staging/preflight-before.json
```

Refuse missing env, mismatched database/schema, invalid release ID, nonzero SQL exit code and any nonzero check. Write evidence only after all target assertions pass.

- [ ] **Step 5: Run unit tests and a disposable clean-schema smoke.**

Run:

```bash
node --test scripts/staging/phase0-preflight.test.mjs
yarn workspace @imeal/core exec prisma migrate deploy
node scripts/staging/phase0-preflight.mjs --database-url-env TARGET_DATABASE_URL --schema phase0_clean --release-id imeal-20260928-001 --expected-database imeal_staging --output artifacts/imeal-20260928-001/staging/preflight-before.json
```

Expected: parser tests PASS; disposable clean schema produces PASS and zero affected counts. A dirty fixture must abort before any backfill.

- [ ] **Step 6: Commit the preflight wrapper and fixtures.**

```bash
git add scripts/staging/phase0-preflight.mjs scripts/staging/phase0-preflight.test.mjs scripts/staging/fixtures/preflight-clean.txt scripts/staging/fixtures/preflight-dirty.txt
git commit -m "feat: add target-safe phase zero preflight"
```

---

## Task 3: Independent approval, exact backfill and named validation

**Files:**
- Create: `scripts/staging/phase0-backfill.mjs`
- Create: `scripts/staging/phase0-backfill.test.mjs`
- Create: `scripts/staging/phase0-validate.mjs`
- Create: `scripts/staging/phase0-validate.test.mjs`
- Create: `scripts/staging/fixtures/constraint-valid.txt`
- Consume unchanged: `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/backfill.sql`
- Consume unchanged: `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/migration.sql`

**Interfaces:**

```js
export function verifyApproval(input: {
  approval: ApprovalRecord;
  releaseId: string;
  target: { database: string; schema: string };
  preflightSha256: string;
  backupManifestSha256: string;
}): void;
export async function runBackfill(options: {
  databaseUrl: string;
  schema: string;
  approvalPath: string;
  preflightPath: string;
  releaseId: string;
  outputPath: string;
}): Promise<{ result: 'PASS'; approvalId: string; transaction: { startedAt: string; completedAt: string } }>;
export function parseConstraintValidation(raw: string): Array<{ name: string; validated: boolean }>;
export async function runValidation(options: {
  databaseUrl: string;
  schema: string;
  releaseId: string;
  preflightAfterOutputPath: string;
  outputPath: string;
}): Promise<{ result: 'PASS'; constraints: Array<{ name: string; validated: true }> }>;
```

`ApprovalRecord` is a JSON shape with `approvalId`, `releaseId`, `target`, `preflightSha256`, `backupManifestSha256`, `decision: 'APPROVED_FOR_EXACT_BACKFILL'`, `approver`, `rollbackAuthority` and `rollbackDecisionWindow`. The wrapper verifies but does not self-approve.

- [ ] **Step 1: Write approval/backfill/validation failing tests.** Cover missing approval, wrong decision, release mismatch, target mismatch, preflight hash mismatch, backup hash mismatch, failed SQL exit, dirty post-preflight, and one invalid named constraint. Assert the backfill command never spawns when verification fails.

- [ ] **Step 2: Run the focused tests and verify failure.**

Run: `node --test scripts/staging/phase0-backfill.test.mjs scripts/staging/phase0-validate.test.mjs`

Expected: FAIL because the wrappers and parsers are absent.

- [ ] **Step 3: Implement approval verification and transactional backfill.** Recompute both artifact hashes, re-fingerprint the target, require the exact approval decision, stop on any mismatch, set lock/statement timeouts, and invoke the unchanged `backfill.sql` through `runPsql`. Capture transaction timestamps and redacted update output. Do not generate an approval from the CLI.

- [ ] **Step 4: Implement post-preflight and named constraint validation.** Run the same preflight query after backfill and write `preflight-after.json`; refuse validation if any affected count/status mismatch is nonzero. Then execute schema-safe SQL that validates `registration_lifecycle_snapshot_complete` and `registration_serving_consistency`, and require `convalidated=true` for both.

- [ ] **Step 5: Run a disposable clean migration/backfill/validation sequence.**

Run:

```bash
DATABASE_URL="$TARGET_DATABASE_URL" yarn workspace @imeal/core exec prisma migrate deploy
node scripts/staging/phase0-preflight.mjs --database-url-env TARGET_DATABASE_URL --schema phase0_clean --release-id imeal-20260928-001 --expected-database imeal_staging --output artifacts/imeal-20260928-001/staging/preflight-before.json
node scripts/staging/phase0-backfill.mjs --database-url-env TARGET_DATABASE_URL --schema phase0_clean --approval artifacts/imeal-20260928-001/staging/approval.json --preflight artifacts/imeal-20260928-001/staging/preflight-before.json --release-id imeal-20260928-001 --output artifacts/imeal-20260928-001/staging/backfill-result.json
node scripts/staging/phase0-validate.mjs --database-url-env TARGET_DATABASE_URL --schema phase0_clean --release-id imeal-20260928-001 --preflight-after-output artifacts/imeal-20260928-001/staging/preflight-after.json --output artifacts/imeal-20260928-001/staging/constraint-validation.json
```

Expected: clean empty schema passes; dirty fixture refuses backfill; validation reports both named constraints true.

- [ ] **Step 6: Commit the approval/backfill/validation wrappers.**

```bash
git add scripts/staging/phase0-backfill.mjs scripts/staging/phase0-backfill.test.mjs scripts/staging/phase0-validate.mjs scripts/staging/phase0-validate.test.mjs scripts/staging/fixtures/constraint-valid.txt
git commit -m "feat: gate phase zero backfill and validation"
```

---

## Task 4: PostgreSQL/object-storage backup and restore rehearsal

**Files:**
- Create: `scripts/staging/backup-staging.mjs`
- Create: `scripts/staging/restore-rehearsal.mjs`
- Create: `scripts/staging/backup-restore.test.mjs`
- Create: `docs/runbooks/staging-readiness.md` (initial backup/restore sections)

**Interfaces:**

```js
export async function createBackup(options: {
  databaseUrl: string;
  schema: string;
  releaseId: string;
  outputDirectory: string;
  objectStorage: { endpoint: string; bucket: string; destination: string };
  encryptionRecipientEnv: string;
  commandRunner?: CommandRunner;
}): Promise<BackupManifest>;
export async function restoreRehearsal(options: {
  backupManifestPath: string;
  restoreDatabase: string;
  restoreBucket: string;
  outputPath: string;
  commandRunner?: CommandRunner;
}): Promise<RestoreReport>;
```

`BackupManifest` includes release/target fingerprint, UTC start/end, PostgreSQL dump checksum, object count/size/checksum summary, tool versions, encryption/storage reference and retention owner; it excludes credentials, OTPs and PII. `RestoreReport` includes measured RPO/RTO, row/object counts, checksum results, readiness/smoke result and failure reason.

- [ ] **Step 1: Write failing dry-run and redaction tests.** Stub command execution and assert `pg_dump --format=custom --no-owner --no-privileges`, checksum generation, object-storage copy, encryption/storage references and `pg_restore --exit-on-error` are requested. Assert database URLs and secret-like values do not occur in manifest/report output.

- [ ] **Step 2: Run focused tests and verify failure.**

Run: `node --test scripts/staging/backup-restore.test.mjs`

Expected: FAIL because backup/restore wrappers are absent.

- [ ] **Step 3: Implement backup wrapper.** Refuse production host/database names, require a separate destination and `AGE_RECIPIENT`-style encryption recipient from the named environment variable, create a consistent custom-format dump, encrypt the dump before external storage, checksum the encrypted artifact, run the approved private-bucket object copy command, and atomically write `backup-manifest.json`. The default command runner uses `spawn` with `shell:false`; tests inject a runner.

- [ ] **Step 4: Implement restore wrapper.** Require a fresh isolated restore database/bucket, verify the manifest checksum before restore, run `createdb`/`pg_restore --exit-on-error`, restore object data, run migration status/readiness/smoke callbacks, measure timestamps and write `restore-rehearsal.json`. Never restore over the source target.

- [ ] **Step 5: Document operator procedure.** Add backup cadence, encryption/access owner, separate destination, checksum retention, restore isolation, RPO/RTO measurement, failure/abort rules and evidence paths to `docs/runbooks/staging-readiness.md`.

- [ ] **Step 6: Run tests and a disposable rehearsal.**

Run:

```bash
node --test scripts/staging/backup-restore.test.mjs
node scripts/staging/backup-staging.mjs --database-url-env TARGET_DATABASE_URL --schema phase0_clean --release-id imeal-20260928-001 --output artifacts/imeal-20260928-001/staging
node scripts/staging/restore-rehearsal.mjs --manifest artifacts/imeal-20260928-001/staging/backup-manifest.json --restore-database imeal_restore_20260928 --restore-bucket imeal-restore-20260928 --output artifacts/imeal-20260928-001/staging/restore-rehearsal.json
```

Expected: focused tests PASS; rehearsal either records PASS with measured RPO/RTO or aborts with a redacted actionable failure and no source mutation.

- [ ] **Step 7: Commit backup/recovery implementation and runbook section.**

```bash
git add scripts/staging/backup-staging.mjs scripts/staging/restore-rehearsal.mjs scripts/staging/backup-restore.test.mjs docs/runbooks/staging-readiness.md
git commit -m "feat: add staging backup restore rehearsal"
```

---

## Task 5: Evidence manifest and staging smoke checks

**Files:**
- Create: `scripts/staging/evidence.mjs`
- Create: `scripts/staging/evidence.test.mjs`
- Create: `scripts/staging/smoke-staging.mjs`
- Create: `scripts/staging/smoke-staging.test.mjs`
- Create: `README.md` additions in the deployment/release section only after observed commands are available.

**Interfaces:**

```js
export const REQUIRED_EVIDENCE = [
  'release-manifest.json', 'target-fingerprint.json', 'migration-status.txt',
  'preflight-before.json', 'backup-manifest.json', 'approval.json',
  'backfill-result.json', 'preflight-after.json', 'constraint-validation.json',
  'restore-rehearsal.json', 'smoke-infrastructure.json', 'smoke-auth-rbac.json',
  'smoke-business.json', 'smoke-mobile-admin.json', 'smoke-worker.json',
  'observability-alert-test.json', 'checksums.txt', 'signoff.json',
];
export async function createEvidenceManifest(options: {
  releaseId: string;
  target: { database: string; schema: string };
  artifactDirectory: string;
}): Promise<EvidenceManifest>;
export function assertEvidenceComplete(manifest: EvidenceManifest): void;
export async function runSmoke(options: {
  apiOrigin: string;
  adminOrigin: string;
  sessionToken?: string;
  fetchImpl?: typeof fetch;
  outputPath: string;
}): Promise<SmokeReport>;
```
CLI contracts:

```bash
node scripts/staging/evidence.mjs --release-id imeal-20260928-001 --target phase0_staging_20260928 --artifacts artifacts/imeal-20260928-001/staging
node scripts/staging/smoke-staging.mjs --api-origin "$STAGING_API_ORIGIN" --admin-origin "$STAGING_ADMIN_ORIGIN" --session-token-env STAGING_SMOKE_SESSION_TOKEN --output artifacts/imeal-20260928-001/staging/smoke-infrastructure.json
```

- [ ] **Step 1: Write failing evidence/smoke tests.** Assert a missing required artifact fails closed, checksums are deterministic, URLs are restricted to HTTPS except explicit local test mode, API readiness failure is reported, Admin `/health` is checked, `X-Request-Id` is required, and bearer token values never enter reports.

- [ ] **Step 2: Run focused tests and verify failure.**

Run: `node --test scripts/staging/evidence.test.mjs scripts/staging/smoke-staging.test.mjs`

Expected: FAIL because evidence/smoke modules are absent.

- [ ] **Step 3: Implement evidence manifest.** Hash each artifact, record release/commit/image/migration references, retain failed artifacts rather than overwriting them, and reject mutable image tags or missing rollback artifact. Write `checksums.txt` and `signoff.json` only through explicit operator commands.

- [ ] **Step 4: Implement layered smoke runner.** Use Node 20 `fetch` with abort timeouts. Check API `/health/live` and `/health/ready`, Admin Web `/health`, HTTPS/redirect behavior, request ID response, optional authenticated `/auth/me`, safe error envelope and no secret leakage. Keep business workflow checks in existing API/domain/worker e2e suites and record their command/results in `smoke-business.json` rather than faking workflow success in a network probe.

- [ ] **Step 5: Run unit tests and a local mock smoke.**

Run: `node --test scripts/staging/evidence.test.mjs scripts/staging/smoke-staging.test.mjs`

Expected: PASS, including failure-path assertions and redaction checks.

- [ ] **Step 6: Add the exact staged smoke command to the runbook.**

```bash
node scripts/staging/smoke-staging.mjs \
  --api-origin "$STAGING_API_ORIGIN" \
  --admin-origin "$STAGING_ADMIN_ORIGIN" \
  --session-token-env STAGING_SMOKE_SESSION_TOKEN \
  --output artifacts/imeal-20260928-001/staging/smoke-infrastructure.json
```

- [ ] **Step 7: Commit evidence/smoke tooling.**

```bash
git add scripts/staging/evidence.mjs scripts/staging/evidence.test.mjs scripts/staging/smoke-staging.mjs scripts/staging/smoke-staging.test.mjs
git commit -m "feat: add staging smoke and evidence bundle"
```

---

## Task 6: Production-like staging Compose and Caddy boundary

**Files:**
- Create: `docker-compose.staging.yml`
- Create: `infra/staging/Caddyfile`
- Create: `infra/staging/alert-rules.yml`
- Modify: `docker-compose.yml:208-211` to select `apps/admin-web/Dockerfile` explicitly for local/release builds.
- Test: `scripts/staging/compose-config.test.mjs` (create)

**Interfaces:**

```text
docker compose -f docker-compose.yml -f docker-compose.staging.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d migrate
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d api worker admin-web caddy
```

- [ ] **Step 1: Write config assertions.** Test the rendered staging config (with non-secret fixture env) to assert the base Compose Admin service selects `apps/admin-web/Dockerfile`, the staging override uses immutable image digests, database/PgBouncer/MinIO/worker ports are not published, `NODE_ENV=production`, `REQUIRE_AUTH=true`, and Caddy mounts `infra/staging/Caddyfile`.

- [ ] **Step 2: Run the config test and verify failure.**

Run: `node --test scripts/staging/compose-config.test.mjs`

Expected: FAIL until the staging override and Caddy file exist.

- [ ] **Step 3: Implement staging Compose override.** Use pinned image digests, private networks, explicit secret references, separate staging volumes/bucket, `minio-create-bucket` completion dependency for API/worker storage readiness, and no direct internal port publication. Keep the base Compose local defaults unchanged except for the explicit Admin Dockerfile path.

- [ ] **Step 4: Implement staging Caddy routes.** Configure owned staging hostname, HTTP-to-HTTPS redirect, API/auth/Admin routes, the hardening-owned `/health/live` and `/health/ready` paths, strict security headers and request-ID preservation. Enforce OTP/authenticated mutation rate limits through the approved upstream firewall/WAF or a pinned Caddy rate-limit module; do not add an unsupported directive to stock `caddy:2-alpine`. Do not expose MinIO storage anonymously.

- [ ] **Step 5: Render and inspect the config.**

Run:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml config --quiet
node --test scripts/staging/compose-config.test.mjs
```

Expected: both PASS; rendered output contains no secret values and no public internal ports.

- [ ] **Step 6: Commit staging boundary configuration.**

```bash
git add docker-compose.staging.yml infra/staging/Caddyfile infra/staging/alert-rules.yml scripts/staging/compose-config.test.mjs
git commit -m "feat: define hardened staging boundary"
```

---

## Task 7: Consume production hardening outputs in staging integration

**Dependency:** Execute `docs/superpowers/plans/2026-09-28-production-hardening-plan.md` first. This task starts only after its shared observability package, API/worker health endpoints, request-ID/logging behavior, Prisma lifecycle and shutdown/readiness outputs are merged and their focused tests pass. This task MUST NOT modify or reimplement any shared runtime file, runtime package, or business service owned by that plan.

**Files:**
- Create: `scripts/staging/runtime-integration.mjs`
- Create: `scripts/staging/runtime-integration.test.mjs`
- Create: `scripts/staging/alert-rules.test.mjs`
- Modify: `infra/staging/alert-rules.yml` to wire the exact metric/event names exported by the hardening outputs and the approved staging thresholds.
- Modify: `scripts/staging/compose-config.test.mjs` to assert the hardening-owned health paths and internal metrics boundary; do not alter runtime source.

**Interfaces:**

```js
export const HARDENING_RUNTIME_CONTRACT = {
  apiLivePath: '/health/live',
  apiReadyPath: '/health/ready',
  workerLivePath: '/health/live',
  workerReadyPath: '/health/ready',
  requestIdHeader: 'x-request-id',
  metricsPath: '/metrics',
};

export async function runRuntimeIntegration(options: {
  apiOrigin: string;
  workerOrigin: string;
  expectedRelease: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  api: { live: 200; ready: 200 | 503; requestId: string };
  worker: { live: 200; ready: 200 | 503 };
  metricsInternalOnly: boolean;
}>;

export function assertAlertRules(input: {
  rulesText: string;
  requiredMetrics: readonly string[];
}): void;
```

The integration helper consumes the hardening-owned `/health/live`, `/health/ready`, `x-request-id`, safe response and internal `/metrics` contracts. `workerOrigin` is an internal monitoring-network origin; Caddy never proxies the worker. It validates `imeal_http_requests_total`, request duration, `imeal_auth_attempts_total`, OTP delivery totals/retry/failure, `imeal_serving_confirm_total`, serving latency, `imeal_idempotency_conflicts_total`, worker run/lag, database/storage and backup-freshness signals from the design. It does not define runtime metric collectors, logger behavior, controllers, health services, request context, Prisma services or dependencies.

- [ ] **Step 1: Write failing staging integration and alert-rule tests.** Use mocked API/worker responses to assert the hardening paths, 200/503 readiness semantics, validated response request ID, safe response fields and public inability to reach `/metrics`. Assert alert rules reference the approved metric names and initial API-unavailable, API-error, API-latency, OTP-backlog, worker-stale, backup-freshness and security conditions.

- [ ] **Step 2: Run the focused tests and verify failure.**

Run:

```bash
node --test scripts/staging/runtime-integration.test.mjs scripts/staging/alert-rules.test.mjs
```

Expected: FAIL because the staging integration helper and alert-rule assertions are not yet present; do not run or modify production-hardening tests in this task.

- [ ] **Step 3: Implement only the staging integration helper.** Fetch the hardening-owned live/readiness endpoints with bounded timeouts, verify release-safe response bodies and request-ID behavior, probe the internal metrics boundary from the approved monitoring network, and return redacted evidence. Treat API/worker readiness 503 as a reported dependency failure, not as a reason to weaken the contract.

- [ ] **Step 4: Wire alert rules to hardening outputs.** Update only `infra/staging/alert-rules.yml` with the exact metric/event names and staging thresholds from the design. Keep labels bounded and avoid secrets, raw IDs, email, location, token and provider payload labels. Include an alert-delivery test route and owner/action metadata.

- [ ] **Step 5: Run focused integration/configuration checks.**

Run:

```bash
node --test scripts/staging/runtime-integration.test.mjs scripts/staging/alert-rules.test.mjs scripts/staging/compose-config.test.mjs
docker compose -f docker-compose.yml -f docker-compose.staging.yml config --quiet
```

Expected: PASS without modifying hardening-owned runtime files; public health behavior is safe, internal metrics remain private, and every required alert rule resolves to a hardening output.

- [ ] **Step 6: Commit only staging integration and alert wiring.**

```bash
git add scripts/staging/runtime-integration.mjs scripts/staging/runtime-integration.test.mjs scripts/staging/alert-rules.test.mjs scripts/staging/compose-config.test.mjs infra/staging/alert-rules.yml
git commit -m "test: integrate staging with production hardening"
```

---

## Task 8: CI, immutable release manifest and staging gates

**Files:**
- Create: `.github/workflows/staging-readiness.yml`
- Create: `scripts/staging/release-manifest.mjs`
- Create: `scripts/staging/release-manifest.test.mjs`
- Modify: `package.json:12-18` to add `staging:manifest` and `staging:smoke` scripts with direct Node entrypoints; retain the `test:staging-tools` script added in Task 1.

**Interfaces:**

```js
export async function createReleaseManifest({
  releaseId,
  commit,
  lockfilePath,
  imageDigests,
  migrationsDirectory,
  checkResults,
  rollbackArtifact,
}): Promise<ReleaseManifest>;
export function assertReleaseManifest(manifest: ReleaseManifest): void;
```

- [ ] **Step 1: Write failing release-manifest tests.** Assert manifest includes commit, lockfile SHA-256, ordered migration names, image digests, test statuses, SBOM reference and rollback artifact; reject dirty/mutable tags, missing checks and secret-like values.

- [ ] **Step 2: Run the focused test and verify failure.**

Run: `node --test scripts/staging/release-manifest.test.mjs`

Expected: FAIL because the manifest module is absent.

- [ ] **Step 3: Implement deterministic manifest generation.** Read `yarn.lock`, enumerate `packages/domain/prisma/migrations` lexicographically, accept only digest-pinned image references, hash checked-in scripts and write a redacted immutable manifest. Fail closed if the Git worktree is dirty or any required check is not `PASS`.

- [ ] **Step 4: Write CI workflow jobs.** The workflow must run Corepack/Yarn 4.18 immutable install; contracts/domain/API/worker/mobile/Admin typecheck; lint; `yarn test:unit`; disposable PostgreSQL migration/domain/API/worker DB checks; Prisma validate/generate; Compose config; Docker build; dependency/image/secret scan; SBOM; manifest generation; and protected staging deployment/smoke. Use artifact upload for reports and environment protection for approval. Do not put secrets in logs.

- [ ] **Step 5: Run manifest tests and inspect workflow syntax.**

Run:

```bash
node --test scripts/staging/release-manifest.test.mjs
docker compose -f docker-compose.yml -f docker-compose.staging.yml config --quiet
yarn staging:manifest --release-id imeal-20260928-001 --rollback-artifact imeal-20260927-004
```

Expected: tests PASS; manifest has immutable references; Compose renders successfully.

- [ ] **Step 6: Commit CI/release gates.**

```bash
git add .github/workflows/staging-readiness.yml scripts/staging/release-manifest.mjs scripts/staging/release-manifest.test.mjs package.json
git commit -m "ci: gate staging release evidence"
```

---

## Task 9: Complete operator runbook and canonical documentation

**Files:**
- Modify: `docs/runbooks/staging-readiness.md`
- Modify: `README.md:399-481` and `README.md:486-565`
- Modify: `docs/06-execution-plan.md:514-535,631-711`
- Modify: `docs/imeal-production-readiness-assessment.md:203-307,354-422`
- Modify: `docs/README.md:25-43` to add the runbook in the documented reading order.

**Interfaces:** The runbook must link exact commands and artifact names produced by Tasks 1–8; it must not introduce commands that do not exist.

- [ ] **Step 1: Write documentation acceptance checks.** Add a documentation test script `scripts/staging/runbook-links.test.mjs` that asserts every command path in the runbook exists and that forbidden production instructions (`REQUIRE_AUTH=false`, `seed:local`, `docker compose down -v`, Firebase rollback) are absent from the production sections.

- [ ] **Step 2: Run the link test and verify failure.**

Run: `node --test scripts/staging/runbook-links.test.mjs`

Expected: FAIL until the runbook and command references are complete.

- [ ] **Step 3: Write the runbook.** Include operator prerequisites/owners, secret manifest names, staging Compose invocation, target fingerprint, migration status, backup, preflight approval, backfill, post-validation, restore, smoke, alert test, evidence bundle, abort/rollback and sign-off procedures. Include the exact `phase0-*`, backup/restore, smoke and manifest commands.

- [ ] **Step 4: Update canonical docs with observed behavior only.** Replace the current “missing” operational commands/checklist items only after the corresponding implementation evidence exists. Keep the readiness assessment NO-GO until all external gates are actually approved; do not claim staging or production evidence from unit tests.

- [ ] **Step 5: Run documentation checks.**

Run:

```bash
node --test scripts/staging/runbook-links.test.mjs
yarn prettier --check docs/runbooks/staging-readiness.md README.md docs/README.md docs/06-execution-plan.md docs/imeal-production-readiness-assessment.md
```

Expected: PASS; docs contain no secret values, fabricated operational data or unsupported commands.

- [ ] **Step 6: Commit runbook/documentation updates.**

```bash
git add docs/runbooks/staging-readiness.md README.md docs/README.md docs/06-execution-plan.md docs/imeal-production-readiness-assessment.md scripts/staging/runbook-links.test.mjs
git commit -m "docs: publish staging readiness runbook"
```

---

## Task 10: Full disposable qualification and evidence sign-off

**Files:**
- Modify only generated external evidence under `artifacts/` outside source control; do not commit secrets or real operational data.
- Review: all `scripts/staging/*`, `docker-compose.staging.yml`, `infra/staging/*`, `.github/workflows/staging-readiness.yml`, the hardening-owned runtime outputs listed in the file map, and `docs/runbooks/staging-readiness.md`; do not modify hardening-owned files in this task.

**Interfaces:** The qualification command sequence is the integration contract:

```bash
corepack enable
corepack prepare yarn@4.18.0 --activate
yarn install --immutable
yarn typecheck
yarn lint
yarn build
yarn test:unit
yarn test:db

docker compose -f docker-compose.yml -f docker-compose.staging.yml config --quiet
node scripts/staging/backup-staging.mjs --database-url-env TARGET_DATABASE_URL --schema phase0_staging_20260928 --release-id imeal-20260928-001 --output artifacts/imeal-20260928-001/staging
node scripts/staging/phase0-preflight.mjs --database-url-env TARGET_DATABASE_URL --schema phase0_staging_20260928 --release-id imeal-20260928-001 --expected-database imeal_staging --output artifacts/imeal-20260928-001/staging/preflight-before.json
# Obtain independent approval.json from the data owner before continuing.
node scripts/staging/phase0-backfill.mjs --database-url-env TARGET_DATABASE_URL --schema phase0_staging_20260928 --approval artifacts/imeal-20260928-001/staging/approval.json --preflight artifacts/imeal-20260928-001/staging/preflight-before.json --release-id imeal-20260928-001 --output artifacts/imeal-20260928-001/staging/backfill-result.json
node scripts/staging/phase0-validate.mjs --database-url-env TARGET_DATABASE_URL --schema phase0_staging_20260928 --release-id imeal-20260928-001 --preflight-after-output artifacts/imeal-20260928-001/staging/preflight-after.json --output artifacts/imeal-20260928-001/staging/constraint-validation.json
node scripts/staging/smoke-staging.mjs --api-origin "$STAGING_API_ORIGIN" --admin-origin "$STAGING_ADMIN_ORIGIN" --session-token-env STAGING_SMOKE_SESSION_TOKEN --output artifacts/imeal-20260928-001/staging/smoke-infrastructure.json
node scripts/staging/restore-rehearsal.mjs --manifest artifacts/imeal-20260928-001/staging/backup-manifest.json --restore-database imeal_restore_20260928 --restore-bucket imeal-restore-20260928 --output artifacts/imeal-20260928-001/staging/restore-rehearsal.json
node scripts/staging/evidence.mjs --release-id imeal-20260928-001 --target phase0_staging_20260928 --artifacts artifacts/imeal-20260928-001/staging
```

- [ ] **Step 1: Run every focused staging-tool test.**

Run: `node --test scripts/staging/*.test.mjs`

Expected: PASS without production credentials.

- [ ] **Step 2: Run repository verification.**

Run:

```bash
yarn typecheck
yarn lint
yarn build
yarn test:unit
```

Expected: PASS; report pre-existing failures separately and do not mark staging ready on an unexplained failure.

- [ ] **Step 3: Run disposable migration and recovery qualification.** Use a newly created staging schema and approved synthetic/classified fixtures; capture every artifact. Confirm dirty fixtures abort before write, clean fixtures pass, rerun is idempotent, both named constraints validate, restore is isolated and application reads work after restore.

- [ ] **Step 4: Run external smoke/UAT.** From representative Android/iOS devices and Admin browser, test HTTPS, OTP/session lifecycle, RBAC, registration/cutoff, GPS/QR, two-device Kitchen serving, delegation, notifications, no-show/penalty, worker restart/retry, dashboard freshness, backup/restore and alert delivery. Record device/build/provider/network versions in redacted reports.

- [ ] **Step 5: Obtain independent sign-off.** The data owner signs preflight/backfill; DBA signs backup/restore/RPO/RTO; security signs network/secrets; QA/product signs native UAT; operations signs alerts/on-call/runbook; release owner signs immutable artifact and rollback compatibility. Write `signoff.json` only after all required evidence is complete.

- [ ] **Step 6: Commit only any final source/documentation changes.** Evidence artifacts remain in controlled external storage. If source changes were needed to correct a failed gate, create a new focused commit and repeat the affected qualification; never amend evidence to hide failure.

---

## Final verification checklist

Before declaring the implementation complete:

- [ ] Production hardening plan is complete and merged before this plan's Task 7 staging integration commit; its focused runtime tests pass.
- [ ] `node --test scripts/staging/runtime-integration.test.mjs scripts/staging/alert-rules.test.mjs scripts/staging/compose-config.test.mjs` passes without changing hardening-owned runtime files or packages.
- [ ] `node --test scripts/staging/*.test.mjs` passes.
- [ ] `yarn typecheck`, `yarn lint`, `yarn build` and `yarn test:unit` pass.
- [ ] `yarn test:db` passes only against an isolated disposable target.
- [ ] Staging Compose renders with no internal published ports, mutable tags, public bucket or placeholder production secrets.
- [ ] API and worker readiness distinguish liveness from dependency readiness and return safe status/HTTP codes.
- [ ] Preflight is read-only, target/schema-safe, bounded, redacted and aborts on every nonzero check.
- [ ] Backfill requires independent approval/hash/target verification, runs transactionally and is demonstrably repeatable.
- [ ] Post-preflight and both named constraints pass with `convalidated=true`.
- [ ] PostgreSQL and object-storage backup/restore rehearsal passes with checksum, measured RPO/RTO and application verification.
- [ ] Smoke reports cover infrastructure, auth/RBAC, business/mobile/Admin and worker/recovery paths.
- [ ] Central logs/metrics/alerts are redacted, correlated and tested; backup/job-lag/OTP/security alerts have owners.
- [ ] `infra/staging/alert-rules.yml` references only hardening-owned metric/event outputs with bounded labels and verified owner/action metadata.
- [ ] CI produces immutable image digests, SBOM, security scan, migration/test results, release manifest and rollback artifact.
- [ ] Runbook links resolve to implemented commands and canonical docs describe only observed evidence.
- [ ] Every external gate has a named owner, approval and retained evidence.

Staging status is **READY FOR PILOT REVIEW** only when all internal checks and external gates are PASS, no P0 remains, backup restore and alert delivery are observed, and the evidence bundle is complete and access-controlled. Otherwise retain **CONDITIONAL / NO-GO** with the failing gate and owner.
