# Task 5 report — canonical Kitchen dashboard projection

## Status
DONE_WITH_CONCERNS

## Changed files
- `apps/api/src/kitchen/kitchen-dashboard.service.ts`
  - Replaced ACTIVE-only plus separate no-show reads with one deterministic registration query over operational statuses and cancelled rows carrying a serving for invariant detection.
  - Derives `PENDING`, `SERVED`, and `NO_SHOW` from registration status plus `mealServing`; keeps `ACTIVE + mealServing` and legacy `SERVED + mealServing` visible.
  - Validates forbidden `SERVED`-without-serving, `NO_SHOW`-with-serving, and `CANCELLED`-with-serving combinations before filtering disabled accounts/cancelled rows.
  - Uses `InternalServerErrorException('Kitchen dashboard state invariant violated')` and logs only the internal registration identifier.
  - Computes counters and all lists from the same filtered projection, including `state`/`isServed` invariant and deterministic order; recent logs prefer serving owner snapshots with legacy fallbacks.
- `apps/api/src/kitchen/kitchen-dashboard.service.spec.ts`
  - Added permanent behavior coverage for served retention, no-show membership, cancelled/disabled exclusion, state/`isServed` consistency, invariant failures, serving snapshot logs, one-query shape, and counter boundaries.
- `apps/api/test/kitchen-dashboard.e2e-spec.ts`
  - Updated route fixture and assertions for required dashboard state fields.
- `.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-5-brief.md`
  - Task requirements and acceptance criteria.

## Verification evidence
- `yarn workspace @imeal/api exec vitest run src/kitchen/kitchen-dashboard.service.spec.ts`
  - PASS: 1 test file, 12 tests.
  - Expected invariant tests emitted redacted/internal registration IDs through the Nest logger; public exception message remained exact and non-sensitive.
- `git diff --check`
  - PASS.
- `yarn workspace @imeal/api exec vitest run test/kitchen-dashboard.e2e-spec.ts`
  - Could not discover the e2e file under the unit Vitest config (`No test files found`); the API package script/config separates `*.e2e-spec.ts`.
- `yarn workspace @imeal/api exec vitest run --config ./vitest.config.e2e.ts test/kitchen-dashboard.e2e-spec.ts`
  - BLOCKED before tests: repository e2e setup requires `DATABASE_URL` in environment or `packages/domain/.env.test`.
- `yarn workspace @imeal/api exec tsc --noEmit`
  - Existing unrelated Task 2 contract fallout remains in `apps/api/src/admin/penalties/penalties.service.ts` (missing new `registrationId` and `mealDate` response fields at lines 97, 137, 213). No dashboard service/type errors were reported.

## Concerns
- Full route/e2e verification needs a configured disposable PostgreSQL `DATABASE_URL`.
- API-wide typecheck remains red from pre-existing Task 2 penalty contract mapping and is outside Task 5 scope.

## Exact source commit
`a29b726111b8155691c05cf390787bb820bf5b70` (`feat(api): project canonical kitchen dashboard states`)
