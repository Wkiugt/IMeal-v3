# Task 8 implementation report

## Status

DONE_WITH_CONCERNS

PostgreSQL was available through the local disposable database for the focused migration-backed suites. The repository-wide typecheck remains blocked by pre-existing/unrelated mobile workspace errors after the contract response-field changes from Task 2.

## Changed files

- `packages/domain/test/setup.ts`
  - Missing `DATABASE_URL` now marks PostgreSQL setup suites skipped instead of failing collection.
  - Existing schema-isolated migration/truncation lifecycle is retained; migration, cleanup, and truncation hooks have explicit long timeouts for disposable PostgreSQL runs.
- `packages/domain/test/concurrency.test.ts`
  - Updated serving assertions to use the canonical meal-serving projection rather than requiring a duplicated `SERVED` registration status.
  - Corrected legacy stale-batch fixtures to use distinct `(userId, mealDate)` identities.
  - Added real separate Prisma-client transaction proofs for complete-snapshot create uniqueness, cancel/reactivate version serialization, immutable menu/roster snapshot behavior and reactivation refresh, serving/no-show and serving/cancel races, concurrent worker penalty/outbox/notification/audit uniqueness, retry idempotency, and PAID/WAIVED preservation.
  - Added all-or-nothing and lock/constraint assertions against the migrated disposable schema.
- `apps/api/test/registrations.e2e-spec.ts`
  - Added per-date `REGISTRATION_FAILED` route behavior and rejection of client-supplied location/menu authority.
- `apps/api/test/pickup.e2e-spec.ts`
  - Added all pickup route aliases, stable `IDEMPOTENCY_CONFLICT` envelope, exact request authority, deterministic serving-window fixture time, and explicit session/permission route coverage.
- `apps/api/test/kitchen-dashboard.e2e-spec.ts`
  - Added generic `INTERNAL_SERVER_ERROR` mismatch envelope coverage through `/api/kitchen`, and deterministic SSE alias/heartbeat route evidence.

No production code, migration SQL, contracts, client realtime code, infrastructure, or `progress.md` was changed.

## Verification commands and observed results

All database commands below used a local disposable PostgreSQL URL supplied only in the shell environment:
`postgresql://postgres:postgres@localhost:5432/imeal?schema=public`

- `DATABASE_URL=... yarn workspace @imeal/core exec vitest run test/concurrency.test.ts`
  - **PASS** — 1 file, 17 tests passed.
- `DATABASE_URL=... yarn workspace @imeal/core exec vitest run test/emailOtpLocationServing.test.ts`
  - **PASS** — 1 file, 13 tests passed.
- `DATABASE_URL=... yarn workspace @imeal/core exec vitest run test/concurrency.test.ts test/emailOtpLocationServing.test.ts`
  - **PASS** — 2 files, 30 tests passed.
- `DATABASE_URL=... yarn workspace @imeal/api exec vitest run --config vitest.config.e2e.ts test/registrations.e2e-spec.ts`
  - **PASS** — 1 file, 12 tests passed.
- `DATABASE_URL=... yarn workspace @imeal/api exec vitest run --config vitest.config.e2e.ts test/pickup.e2e-spec.ts`
  - **PASS** — 1 file, 16 tests passed.
- `DATABASE_URL=... yarn workspace @imeal/api exec vitest run --config vitest.config.e2e.ts test/kitchen-dashboard.e2e-spec.ts`
  - **PASS** — 1 file, 14 tests passed.
- `DATABASE_URL=... yarn workspace @imeal/api exec vitest run --config vitest.config.e2e.ts test/registrations.e2e-spec.ts test/pickup.e2e-spec.ts test/kitchen-dashboard.e2e-spec.ts`
  - **PASS** — 3 files, 42 tests passed.
- `DATABASE_URL=... yarn workspace @imeal/worker exec vitest run --config vitest.config.e2e.ts test/no-show-worker.e2e-spec.ts`
  - **PASS** — 1 file, 3 migration-backed tests passed, including retry/unique outbox, concurrent serialization, and rollback/independent commit.
- `yarn test:unit`
  - **PASS** — domain 46/46, contracts 37/37, API 219/219, worker 56/56.
- `yarn workspace @imeal/core exec tsc --noEmit`
  - **PASS**.
- `yarn workspace @imeal/api exec tsc --noEmit`
  - **PASS**.
- `git diff --check`
  - **PASS** — no whitespace errors.
- `env -u DATABASE_URL yarn workspace @imeal/core exec vitest run test/concurrency.test.ts test/emailOtpLocationServing.test.ts`
  - **PASS** — 2 files, 30 tests skipped with the explicit missing-`DATABASE_URL` reason.
- `env -u DATABASE_URL yarn workspace @imeal/api exec vitest run --config vitest.config.e2e.ts test/registrations.e2e-spec.ts test/pickup.e2e-spec.ts test/kitchen-dashboard.e2e-spec.ts`
  - **PASS** — 3 files, 42 tests skipped with the explicit missing-`DATABASE_URL` reason.
- `yarn typecheck`
  - **BLOCKED** — unrelated existing mobile workspace errors: missing `expo-location`, an implicit-any callback, and stale `calendarRegistrationState.test.ts` fixtures missing required `menuRevisionId`. Targeted core/API typechecks passed above.

## Commit

- Implementation/tests/brief: `5d30e44ad14325f99482dfe817ec5215e2c85f39`
- This report is committed separately; its exact commit hash is returned with the implementation hash.
