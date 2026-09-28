# Task 8 implementation report

## Status

DONE_WITH_CONCERNS

The six review findings are addressed in the Task 8 source and evidence changes. Local PostgreSQL was available through the disposable database URL below. Targeted core/API/worker typechecks pass. The repository-wide typecheck remains blocked by pre-existing mobile workspace errors unrelated to this Task 8 change.

## Changed files

- `packages/domain/src/RegistrationService.ts`
  - Removed new-write `status = 'SERVED'` updates from `serveMeal` and `batchServeMeals`. New serving persistence is `ACTIVE` plus `meal_servings`; legacy `SERVED` rows remain readable.
- `packages/domain/test/setup.ts`
  - PostgreSQL setup skips explicitly when `DATABASE_URL` is absent.
  - Truncation now fails the hook instead of logging and continuing.
  - Registered disposable Prisma clients are disconnected in `afterEach` and in fail-safe `afterAll`; disconnect failures are surfaced.
- `packages/domain/test/concurrency.test.ts`
  - Added the migrated persistence assertion for `ACTIVE + mealServing` and retained low-level row-lock/constraint checks.
  - Client cleanup now observes all disconnect failures.
- `apps/api/test/production-concurrency.e2e-spec.ts`
  - Added migration-backed production-path tests using separate real Prisma clients and actual `PickupService`, `RegistrationsService`, and dynamically loaded `NoShowWorkerService` entry points.
  - Covers serving-vs-no-show, serving-vs-cancel with an overlapped locked production cancellation transaction, production registration create/cancel/reactivate side effects, immutable served snapshots versus new reactivation resolution, concurrent duplicate confirmation, same-key replay, changed-body conflict, stale all-or-nothing rollback, and injected post-serving notification failure rollback.
- `apps/api/src/kitchen/kitchen-dashboard.service.ts`
  - Keeps invariant diagnostics in operator logs while returning the stable generic `Internal server error` message.
- `apps/api/src/kitchen/kitchen-dashboard.service.spec.ts`
  - Updated unit expectations for the generic public message.
- `apps/api/test/kitchen-dashboard.e2e-spec.ts`
  - Keeps fake/controller envelope tests separate from persistence tests.
  - Adds migrated-schema endpoint evidence for `SERVED` without serving, `NO_SHOW` with serving, and `CANCELLED` with serving. The test temporarily disables only the migrated invariant trigger/constraint to seed impossible corruption, restores them in `finally`, and asserts the endpoint returns no counters.
- `apps/worker/test/no-show-worker.e2e-spec.ts`
  - Adds actual worker retry coverage for PAID and WAIVED penalties, asserting no duplicate audit, notification, or outbox side effects.

No Task 9/P1 infrastructure, client realtime, or migration production changes were added. `progress.md` was not edited by this task.

## Verification commands and observed results

All PostgreSQL commands below used the local disposable URL supplied only in the shell environment:
`postgresql://postgres:postgres@localhost:5432/imeal?schema=public`

- `DATABASE_URL=... yarn workspace @imeal/core exec vitest run test/concurrency.test.ts test/emailOtpLocationServing.test.ts`
  - **PASS** — 2 files, 30 tests passed.
- `DATABASE_URL=... yarn workspace @imeal/api exec vitest run --config vitest.config.e2e.ts test/registrations.e2e-spec.ts test/pickup.e2e-spec.ts test/kitchen-dashboard.e2e-spec.ts test/production-concurrency.e2e-spec.ts`
  - **PASS** — 4 files, 51 tests passed, including the production-path suite.
- `DATABASE_URL=... yarn workspace @imeal/worker exec vitest run --config vitest.config.e2e.ts test/no-show-worker.e2e-spec.ts`
  - **PASS** — 1 file, 5 migration-backed tests passed, including PAID/WAIVED retry coverage, concurrent serialization, and rollback/independent commit.
- `yarn test:unit`
  - **PASS** — domain 46/46, contracts 37/37, API 219/219, worker 56/56.
- `yarn workspace @imeal/core exec tsc --noEmit`
  - **PASS**.
- `yarn workspace @imeal/api exec tsc --noEmit`
  - **PASS**.
- `yarn workspace @imeal/worker exec tsc --noEmit`
  - **PASS**.
- `git diff --check`
  - **PASS** — no whitespace errors.
- `env -u DATABASE_URL yarn workspace @imeal/core exec vitest run test/concurrency.test.ts test/emailOtpLocationServing.test.ts`
  - **PASS** — 2 files, 30 tests skipped with the explicit missing-`DATABASE_URL` reason.
- `env -u DATABASE_URL yarn workspace @imeal/api exec vitest run --config vitest.config.e2e.ts test/registrations.e2e-spec.ts test/pickup.e2e-spec.ts test/kitchen-dashboard.e2e-spec.ts test/production-concurrency.e2e-spec.ts`
  - **PASS** — 4 files, 51 tests skipped with the explicit missing-`DATABASE_URL` reason.
- `yarn typecheck`
  - **BLOCKED** — existing mobile workspace errors: missing `expo-location`, an implicit-any `nextLocation` callback, and stale `calendarRegistrationState.test.ts` fixtures missing required `menuRevisionId`. No mobile/unrelated files were changed.

## Commits

- Source/tests/brief commit: `73978ca` (`test: close Task 8 production path evidence gaps`)
- Final report commit: returned in the completion response because the report commit hash cannot be embedded into its own Git object without changing that hash.
