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
- `apps/api/src/app.module.ts`, `apps/api/src/common/api-exception.filter.ts`
  - Registered the canonical HTTP error mapper globally and preserved request ID header/body behavior.
- `packages/contracts/src/v1/kitchen.ts`, `packages/contracts/test/contracts.test.ts`
  - Added nullable legacy-aware serving-log location/menu snapshot response fields and contract coverage.
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

## Review fix round 1

- F1: Added the canonical `ApiExceptionFilter` as the app-level Nest `APP_FILTER`. It maps `InternalServerErrorException` to `{ error: { code: 'INTERNAL_SERVER_ERROR', message }, requestId }` and returns `X-Request-Id`, preserving valid UUID request IDs.
- F2: Extended the serving-log response contract with nullable legacy-aware location/menu snapshot fields and mapped them from `MealServing` first, falling back only to immutable registration snapshots. Unit and route fixtures assert canonical snapshot values win over registration/current values.
- F3: Strengthened the registration query assertion to cover the complete operational-status and `CANCELLED + mealServing` predicates, includes, and ordering. Added consumer-visible dashboard mismatch-envelope and authentication/permission-guard route tests.

## Review-fix verification evidence
- `yarn workspace @imeal/api exec vitest run src/kitchen/kitchen-dashboard.service.spec.ts`
  - PASS: 1 test file, 12 tests.
- `yarn workspace @imeal/contracts build`
  - PASS; refreshed ignored local contract dist used by API tests.
- `yarn workspace @imeal/contracts exec vitest run test/contracts.test.ts`
  - PASS: 1 test file, 37 tests, including canonical serving-log snapshot fields.
- `yarn workspace @imeal/api exec vitest run --config ./vitest.dashboard.config.ts test/kitchen-dashboard.e2e-spec.ts`
  - PASS: 1 test file, 7 tests. This temporary no-DB config exercised the actual Nest app module, global exception mapper, request ID header/body, route mismatch response, aliases, and auth guard; the temporary config was removed.
- `yarn workspace @imeal/api exec vitest run --config ./vitest.config.e2e.ts test/kitchen-dashboard.e2e-spec.ts`
  - BLOCKED before tests by the repository setup because `DATABASE_URL` is not set in the environment or `packages/domain/.env.test`; no disposable PostgreSQL was available.
- `yarn workspace @imeal/api exec tsc --noEmit`
  - Existing unrelated Task 2 failures remain only in `apps/api/src/admin/penalties/penalties.service.ts` for missing `registrationId` and `mealDate`; no Task 5 mapper/dashboard errors were reported.
- `git diff --check`
  - PASS for the Task 5 changes; the director-owned `progress.md` has an unrelated concurrent ledger update and was not modified by this task.

## Exact commits
- Base implementation: `a29b726111b8155691c05cf390787bb820bf5b70` (`feat(api): project canonical kitchen dashboard states`)
- Review fixes: `0941f30f9bc4404711c74656fea4cf562e41d6d3` (`fix(api): close Task 5 dashboard review findings`)
