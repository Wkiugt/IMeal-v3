# Task 9 report — rollout gates and canonical documentation

## Status

`DONE_WITH_CONCERNS`

The expand → read-only preflight approval → exact backfill → post-backfill
validation sequence passed on a disposable local PostgreSQL schema. No staging
or production rollout was attempted. The existing local public schema remains
dirty and was not backfilled or constraint-validated.

## Changed files

- `.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-9-brief.md`
- `.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-9-report.md`
- `docs/05-backend-structure.md`
- `docs/03-product-flows.md`
- `docs/06-execution-plan.md`
- `docs/README.md`
- `docs/imeal-production-readiness-assessment.md`

`.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/progress.md`
was not modified. No source, client realtime, infrastructure, P1 or product
behavior files were modified.

## Safety and environment

- Initial shell check: `DATABASE_URL=missing`; local Docker PostgreSQL was
  available through `develop-db-1`. All database evidence below used an
  explicitly supplied disposable local URL/schema, not a production or staging
  credential.
- Host `psql` was unavailable. The SQL files were copied into the local
  PostgreSQL container and run with `docker exec ... psql`; this is recorded in
  the docs rather than presented as staging evidence.
- A disposable schema named `phase0_task9_20260928153435` was created in the
  local database. The existing public schema was left untouched by backfill and
  validation.

## Rollout gate commands and observed results

### 1. Expand-only migration

```text
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/imeal?schema=phase0_task9_20260928153435' yarn workspace @imeal/core exec prisma migrate deploy
```

**PASS.** All eight checked-in migrations applied, including
`20260928000000_phase0_domain_correctness`.

```text
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/imeal?schema=phase0_task9_20260928153435' yarn workspace @imeal/core exec prisma generate
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/imeal?schema=phase0_task9_20260928153435' yarn workspace @imeal/core exec prisma validate
```

**PASS.** Prisma Client v5.22.0 generated and schema validation passed.

Post-expand inspection found the expected 27 lifecycle/menu/serving/penalty
columns, four named indexes and four named foreign-key/check constraints. Row
counts were zero for `registrations`, `daily_menu_revisions`, `meal_days`,
`meal_servings` and `penalties`; no operational row was inserted by expansion.

### 2. Read-only preflight and approval gate

Disposable command (containerized equivalent because host `psql` is absent):

```text
docker exec develop-db-1 sh -c "psql -U postgres -d imeal -v ON_ERROR_STOP=1 -P pager=off -c 'SET search_path TO phase0_task9_20260928153435' -f /tmp/phase0-preflight-task9.sql"
```

**PASS / APPROVED FOR DISPOSABLE BACKFILL.** The first result set contained the
seven required checks, all with `affected_count=0` and `sample_ids={}`:

- `registration_snapshot_incomplete`
- `registration_serving_mismatch`
- `roster_assignment_ambiguous`
- `menu_revision_incomplete`
- `penalty_registration_mapping_ambiguous`
- `penalty_registration_duplicate_candidate`
- `future_active_snapshot_incomplete`

The second result set had `ACTIVE=0`, `CANCELLED=0`, `SERVED=0` and
`NO_SHOW=0`.

The same read-only preflight against the existing local `public` schema was
**NOT APPROVED / NO-GO**: `registration_snapshot_incomplete=116`,
`roster_assignment_ambiguous=6`, `menu_revision_incomplete=132`,
`future_active_snapshot_incomplete=40`, and `registration_serving_mismatch=0`,
`penalty_registration_mapping_ambiguous=0`,
`penalty_registration_duplicate_candidate=0`. Status counts were
`ACTIVE=66`, `CANCELLED=16`, `SERVED=40`, `NO_SHOW=10`. No backfill or
constraint validation was run against that dirty schema.

### 3. Exact backfill after approval

```text
docker exec develop-db-1 sh -c "psql -U postgres -d imeal -v ON_ERROR_STOP=1 -P pager=off -c 'SET search_path TO phase0_task9_20260928153435' -f /tmp/phase0-backfill-task9.sql"
```

**PASS.** First run returned `UPDATE 0`, `DO`, `UPDATE 0`, `UPDATE 0`,
`COMMIT`. An immediate second run returned the same result, proving the script
was repeatable on the disposable schema. No operational row was inserted,
merged, deleted or fabricated.

### 4. Post-backfill validation

The disposable preflight was rerun and returned all seven checks and all four
status counts at zero.

```text
docker exec develop-db-1 psql -U postgres -d imeal -v ON_ERROR_STOP=1 -P pager=off -c "SET search_path TO phase0_task9_20260928153435; ALTER TABLE registrations VALIDATE CONSTRAINT registration_lifecycle_snapshot_complete; ALTER TABLE registrations VALIDATE CONSTRAINT registration_serving_consistency; SELECT conname, convalidated FROM pg_constraint WHERE connamespace='phase0_task9_20260928153435'::regnamespace AND conname IN ('registration_lifecycle_snapshot_complete','registration_serving_consistency') ORDER BY conname;"
```

**PASS.** Both `ALTER TABLE ... VALIDATE CONSTRAINT` statements passed and
both rows returned `convalidated=t`.

## Focused and full verification

| Command | Observed result |
| --- | --- |
| `yarn workspace @imeal/contracts exec vitest run` | **PASS** — 1 file, 37 tests |
| `DATABASE_URL=<disposable-local-url> yarn workspace @imeal/core exec vitest run test/concurrency.test.ts test/emailOtpLocationServing.test.ts` | **PASS** — 2 files, 29 tests |
| `yarn workspace @imeal/api exec vitest run` | **PASS** — 20 files, 219 tests |
| `yarn workspace @imeal/worker exec vitest run` | **PASS** — 6 files, 56 tests |
| `DATABASE_URL=<disposable-local-url> yarn workspace @imeal/api exec vitest run --config ./vitest.config.e2e.ts` | **PASS** — 9 files, 76 tests |
| `DATABASE_URL=<disposable-local-url> yarn workspace @imeal/worker exec vitest run --config ./vitest.config.e2e.ts` | **PASS** — 2 files, 6 tests |
| `DATABASE_URL=<disposable-local-url> yarn workspace @imeal/core exec vitest run` | **FAIL** — 2 files, 93 tests; 88 passed and 5 failed. One concurrency assertion received `Not eligible to serve` instead of `Already served`; four local-seed DB tests received `LocalSeedWriteError (UNKNOWN)` where their expectations were seed success/P2003. |
| `yarn typecheck` | **BLOCKED** — mobile cannot resolve `expo-location`; `nextLocation` has implicit `any`; mobile calendar fixtures omit required `menuRevisionId`. |

The API invariant tests intentionally emitted internal logger lines while
asserting generic public errors; the suites passed. The full domain failures
were recorded, not suppressed or reclassified as rollout approval.

## Unavailable gates / blockers

- No staging target or staging `DATABASE_URL` was available. No staging
  preflight, backup/restore rehearsal, provider/secret provisioning, native
  device/UAT, or production deployment was claimed.
- The ambient shell lacked `DATABASE_URL`; the explicit local disposable URL
  was used only for this evidence run.
- Dirty local public data has unresolved snapshot, roster and future ACTIVE
  gaps. It requires approved exact remediation/quarantine before any backfill or
  constraint validation.
- Full domain verification and repository mobile typecheck remain open as
  shown above.
- Existing infrastructure/security, backup/restore, observability, retention,
  identity provisioning, client realtime and other P1/P0 gates remain outside
  this task and are not marked complete.

## Documentation decisions recorded

- Physical expand fields are nullable for legacy compatibility; new lifecycle
  rows are governed by `registration_lifecycle_snapshot_complete` and exact
  server-resolved menu/owner/location snapshots.
- `RegistrationStatus.SERVED` remains readable for compatibility, while valid
  `meal_servings` is the serving authority and `ACTIVE + mealServing` is the
  canonical served projection.
- `Penalty.registrationId` is the unique no-show identity; the worker locks the
  registration first and preserves `PAID`/`WAIVED` on retry.
- Cutover order is expand → preflight approval → exact backfill → post-backfill
  preflight → constraint validation → focused/full verification → application
  cutover. Abort on nonzero operational checks, ambiguity, invalid revision,
  duplicate candidate, migration failure or failed verification.
- Required runtime environment and secret names remain references to
  `docs/02-technical-requirements.md §8.2` and `.env.example`; no secret values
  were documented. Backup/restore remains a required release gate, not an
  observed result.
