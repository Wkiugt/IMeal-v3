# Task 9 report — rollout gates and canonical documentation

## Status

`NOT COMPLETE / NO-GO`

The expand → clean local preflight → exact backfill → post-backfill validation
sequence passed on a disposable local PostgreSQL schema, but no independent
approval or audit record was evidenced. This is implementation evidence only,
not Workstream A closure or a staging/production approval. The existing local
public schema remains dirty and was not backfilled or constraint-validated.
Fresh Step 2 execution at HEAD `75a9d719deb511503dfc55a11b52a81ab6d049a6`
is **GREEN on disposable local targets** for expand, clean preflight, twice-run
backfill, post-backfill preflight and constraint validation. The release gate is
**CONDITIONAL / NO-GO** because no approved staging/representative target,
independent approval, backup/restore rehearsal or production evidence exists.

## Changed files

- `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/preflight.sql`
- `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/backfill.sql`
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
- Fresh Step 2 disposable schema `phase0_step2_20260928131738` was created
  in the local Docker PostgreSQL database. The public schema was not used for
  any write, backfill or validation.
- Fresh classification schema
  `phase0_step2_classification_20260928131738` contained only synthetic
  invalid-location and stale-menu rows for preflight classification; no
  backfill or validation was run there.
- No independent approval/audit reference, controlled external artifact or
  checksum was observed for this local run; none is claimed.

## Rollout gate commands and observed results

### 1. Expand-only migration

```text
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/imeal?schema=phase0_step2_20260928131738' yarn workspace @imeal/core exec prisma migrate deploy
```

**PASS.** All eight checked-in migrations applied, including
`20260928000000_phase0_domain_correctness`.

```text
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/imeal?schema=phase0_step2_20260928131738' yarn workspace @imeal/core exec prisma generate
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/imeal?schema=phase0_step2_20260928131738' yarn workspace @imeal/core exec prisma validate
```

**PASS.** Prisma Client v5.22.0 generated and schema validation passed.

Post-expand inspection on the asserted target schema returned zero rows for
`registrations`, `daily_menu_revisions`, `meal_days`, `meal_servings` and
`penalties`; no operational row was inserted by expansion.


### 2. Read-only preflight (approval not evidenced)

Disposable command (containerized equivalent because host `psql` is absent):

```text
docker exec develop-db-1 psql -U postgres -d imeal -v ON_ERROR_STOP=1 -P pager=off -c "SET search_path TO phase0_step2_20260928131738; DO \$assert\$ BEGIN IF current_schema() <> 'phase0_step2_20260928131738' THEN RAISE EXCEPTION 'target schema mismatch'; END IF; END \$assert\$;" -f /tmp/phase0-step2-preflight.sql
```

**PRECHECK CLEAN; INDEPENDENT APPROVAL NOT EVIDENCED.** The first result set
contained the seven required checks, all with `affected_count=0` and
`sample_ids={}`:

- `registration_snapshot_incomplete`
- `registration_serving_mismatch`
- `roster_assignment_ambiguous`
- `menu_revision_incomplete`
- `penalty_registration_mapping_ambiguous`
- `penalty_registration_duplicate_candidate`
- `future_active_snapshot_incomplete`

The second result set had `ACTIVE=0`, `CANCELLED=0`, `SERVED=0` and
`NO_SHOW=0`. A clean disposable preflight is a prerequisite, not an approval
record.

The checks use one explicit operational scope: a registration is operational
when `status <> 'CANCELLED' OR meal_date >= current business date in
Asia/Ho_Chi_Minh`; only `CANCELLED` rows before that business date are legacy
history permitted to retain nullable snapshots. `registration_serving_mismatch`
is evaluated for every status and always blocks. The roster check requires
exactly one active, date-effective assignment and exactly one active,
date-effective location.

Previously observed local `public` evidence (not rerun or modified during fresh
Step 2) remains **NO-GO**:
`registration_snapshot_incomplete=132`,
`roster_assignment_ambiguous=6`,
`menu_revision_incomplete=132`,
`future_active_snapshot_incomplete=40`, and
`registration_serving_mismatch=0`,
`penalty_registration_mapping_ambiguous=0`,
`penalty_registration_duplicate_candidate=0`. Status counts were
`ACTIVE=66`, `CANCELLED=16`, `SERVED=40`, `NO_SHOW=10`. No backfill or
constraint validation was run against that dirty schema.

Representative invalid-location and stale-menu classification fixture:

```text
docker exec develop-db-1 psql -U postgres -d imeal -v ON_ERROR_STOP=1 -P pager=off -c "SET search_path TO phase0_step2_classification_20260928131738; DO \$assert\$ BEGIN IF current_schema() <> 'phase0_step2_classification_20260928131738' THEN RAISE EXCEPTION 'target schema mismatch'; END IF; END \$assert\$;" -f /tmp/phase0-step2-preflight.sql
```

The classification run returned
`roster_assignment_ambiguous=1` with sample
`{registration-step2-invalid-location}` and
`future_active_snapshot_incomplete=1` with sample
`{registration-step2-stale-menu}`. The other five named checks were zero;
`menu_revision_incomplete=0` confirms the stale-menu mismatch was classified
by the future ACTIVE snapshot check rather than as an invalid revision. Status
counts were `ACTIVE=2` and all other statuses zero. Because named checks were
nonzero, no backfill or validation was run on this fixture.

### 3. Exact backfill following clean local preflight (approval not evidenced)

```text
docker exec develop-db-1 psql -U postgres -d imeal -v ON_ERROR_STOP=1 -P pager=off -c "SET search_path TO phase0_step2_20260928131738; DO \$assert\$ BEGIN IF current_schema() <> 'phase0_step2_20260928131738' THEN RAISE EXCEPTION 'target schema mismatch'; END IF; END \$assert\$;" -f /tmp/phase0-step2-backfill.sql
```

**LOCAL IDEMPOTENCE OBSERVED; NOT AN APPROVAL.** The first run returned
`UPDATE 0`, `DO`, `UPDATE 0`, `UPDATE 0`, `COMMIT`; the immediate second run
returned the same result. No operational row was inserted, merged, deleted or
fabricated. This local write sequence must not be promoted to staging without
the independent approval record and target backup gate.

### 4. Post-backfill validation

The disposable preflight was rerun and returned all seven checks and all four
status counts at zero.

```text
docker exec develop-db-1 psql -U postgres -d imeal -v ON_ERROR_STOP=1 -P pager=off -c "SET search_path TO phase0_step2_20260928131738; DO \$assert\$ BEGIN IF current_schema() <> 'phase0_step2_20260928131738' THEN RAISE EXCEPTION 'target schema mismatch'; END IF; END \$assert\$; ALTER TABLE registrations VALIDATE CONSTRAINT registration_lifecycle_snapshot_complete; ALTER TABLE registrations VALIDATE CONSTRAINT registration_serving_consistency; SELECT conname, convalidated FROM pg_constraint WHERE connamespace='phase0_step2_20260928131738'::regnamespace AND conname IN ('registration_lifecycle_snapshot_complete','registration_serving_consistency') ORDER BY conname;"
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
- Dirty local public data has unresolved snapshot, roster/effective-location
  and future ACTIVE gaps. It requires approved exact remediation/quarantine
  before any backfill or constraint validation.
- No independent approval/audit record, named staging rollback authority,
  controlled external artifact or checksum was evidenced for this local run.
  A zero-row preflight is not approval.
- If post-backfill preflight, constraint validation or verification fails,
  cutover remains blocked; quarantine/remediate exact rows or restore the
  approved backup under the target's named rollback authority and decision
  window. Retain the additive schema for staging diagnosis or discard a
  disposable schema after evidence capture; do not claim a down migration.
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
- Rollout scope is `status <> 'CANCELLED' OR meal_date >= current business
  date in Asia/Ho_Chi_Minh`; only earlier cancelled rows are legacy history
  allowed nullable snapshots. Serving mismatches are checked for every status.
  Roster resolution requires one active, date-effective assignment and location.
- Cutover order is expand → target-safe preflight → independent approval record
  → exact backfill → post-backfill preflight → constraint validation →
  focused/full verification → application cutover. Abort on nonzero operational
  checks, ambiguity/effective-location failure, invalid revision, duplicate
  candidate, migration failure or failed verification. Approval is not inferred
  from clean local output.
- Post-backfill failure keeps cutover blocked and requires quarantine/remediation
  or approved-backup restore under named authority/decision window; no
  destructive down migration or Firebase rollback is claimed.
- Required runtime environment and secret names remain references to
  `docs/02-technical-requirements.md §8.2` and `.env.example`; no secret values
  were documented. Backup/restore remains a required release gate, not an
  observed result.

## Final branch-review remediation evidence

The following blocker fixes were applied after the review while preserving the
rollout gate decision above:

- Future `ACTIVE` preflight validates required text as non-blank after
  trimming but compares `menu_name_snapshot` exactly to the verified stored
  revision name. Backfill preserves that exact stored value for every
  verified revision and repairs only exact mismatches; pickup and API
  registration resolution use the same representation and fail closed for
  blank or mismatched legacy rows.
- The migration-backed whitespace revision coverage now exercises preflight
  classification, exact-value backfill/idempotence, API registration
  resolution, and pickup eligibility without silently trimming the immutable
  revision.
- Weekly-menu publish locks the parent row before re-reading the complete
  graph, so concurrent revision commits cannot be published from a stale
  read.
- Account disable now locks all eligible registration rows in deterministic
  `(meal_date, id)` order before locking the user row. It retains the
  canonical cancellation transition, cutoff bypass, delegation revocation,
  audit rows, deterministic notifications, actor metadata, and outbox writes.
  Real pickup/account-disable cross-transaction barrier scenarios cover both
  pickup-first and disable-first registration lock ownership, no-deadlock
  completion, and the corresponding winner/rollback side effects.
- Account-disable coverage also proves a future registration is cancelled
  after the 14:00 VN cutoff while ordinary cancellation rejects at that
  same time. Incomplete historical fixture writes remain isolated in a
  test-only helper outside the `@imeal/core` runtime source surface.
- Product and UI/backend documentation uses `PICKUP_INTENT_CONFLICT` and
  states that failed serving/delegation/request-claim transactions roll back.
  Served dashboard fields are documented as the client projection rather than
  immutable server-side snapshot storage.

Fresh verification for this follow-up:

```text
yarn workspace @imeal/api exec vitest run src/registrations/registrations.service.spec.ts src/pickup/pickup.service.spec.ts src/admin/weekly-menus/weekly-menus.service.spec.ts
PASS — 3 files, 81 tests

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/imeal yarn workspace @imeal/core exec vitest run --config ./vitest.config.ts test/registration.test.ts test/concurrency.test.ts test/emailOtpLocationServing.test.ts
BLOCKED — local PostgreSQL refused connections on ::1:5432 and 127.0.0.1:5432; 42 tests skipped and setup/teardown failed to connect

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/imeal yarn workspace @imeal/api exec vitest run --config ./vitest.config.e2e.ts test/production-concurrency.e2e-spec.ts
BLOCKED — setup failed with ECONNREFUSED on ::1:5432 and 127.0.0.1:5432; all 12 tests skipped and the afterAll cleanup hook timed out at 120 seconds

yarn workspace @imeal/api exec tsc --noEmit -p tsconfig.json && yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json
PASS
```

These are disposable local-database and focused verification results only.
They do not provide the unavailable staging target, independent approval,
backup/restore rehearsal, or other Task 9 release gates. Task 9 therefore
remains `NOT COMPLETE / NO-GO`.
