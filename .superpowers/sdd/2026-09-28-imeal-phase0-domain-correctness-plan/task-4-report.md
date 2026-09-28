# Task 4 implementation report

## Status

DONE_WITH_CONCERNS

## Changed files

- `apps/api/src/pickup/pickup.service.ts`
  - Added one complete registration snapshot predicate covering owner, employee, location, effective-date, snapshot-time, menu revision, and verified menu-name requirements.
  - Added immutable menu-revision content matching for pickup options, intent resolution, and confirmation; nullable description/image values are accepted only when they match the immutable revision row.
  - Extended own/delegated projections and locked registration contexts with complete snapshot fields; incomplete or ambiguous legacy rows fail closed without current-value fallback.
  - Enforced one snapshot `serviceLocationId` for an intent and retained current location data only for serving-time GPS verification.
  - Made serving readiness return the current menu revision and MealDay service boundaries; confirmation rechecks the current revision after registration locks.
  - Copied registration owner/menu/location, pickup session, delegation, and verification snapshots into `MealServing`; removed location/menu fallbacks and duplicate registration `SERVED` writes.
  - Preserved the existing routes, request schemas, exact sorted intent, QR/session/window/GPS behavior, lock order, post-commit event timing, and caller/key/body-hash idempotency.
- `apps/api/src/pickup/pickup.service.spec.ts`
  - Added behavior coverage for incomplete legacy snapshots, nullable menu content semantics, stale snapshots/current menu revisions, shared snapshot locations, serving snapshot copying, active registration projection, idempotency, stale batch rollback, race/conflict paths, and post-commit events.
  - Updated serving fixtures for immutable menu-revision and MealDay boundary requirements.

## Decisions

- A registration is pickup-eligible only when every non-content snapshot field is present and non-empty, `menuRevisionId`/`menuNameSnapshot` are present, and all menu snapshot values exactly equal the immutable revision row. Description/image remain nullable by design.
- Delegated owner display uses the registration's immutable `ownerNameSnapshot`; owner email is captured from the locked owner account because Registration has no owner-email snapshot column.
- Confirmation reads the current MealDay readiness/menu revision after locking registrations, so a stale immutable registration revision rejects the whole transaction before delegation or serving writes.
- New serving writes leave registration status unchanged (`ACTIVE` plus `mealServing` is the canonical served projection).
- Existing untracked user-owned planning/design documents were not staged or modified.

## Verification commands and results

- `yarn workspace @imeal/api exec vitest run src/pickup/pickup.service.spec.ts`: passed — 1 file, 48 tests passed.
- `yarn workspace @imeal/api exec vitest run test/pickup.e2e-spec.ts`: could not discover e2e tests under the default Vitest configuration (exit 1; default include is `**/*.spec.ts`).
- `yarn workspace @imeal/api exec vitest run --config ./vitest.config.e2e.ts test/pickup.e2e-spec.ts`: reached the e2e setup but failed before tests because `DATABASE_URL` is not set in the environment or `packages/domain/.env.test`.
- `yarn workspace @imeal/api exec tsc --noEmit --pretty false`: reports the three pre-existing `apps/api/src/admin/penalties/penalties.service.ts` contract-consumer errors for missing nullable `registrationId` and `mealDate`; no pickup-service TypeScript errors were reported.
- `git diff --check`: passed with no whitespace errors before commit.

## Concerns

- API-wide TypeScript checking remains red in the pre-existing penalties response mapping from the upstream contract extension; that file is outside Task 4 scope and was not changed.
- Pickup e2e verification requires a configured test PostgreSQL `DATABASE_URL`; the configured suite could not start without it.
- The repository retains three pre-existing untracked planning/design documents; they are not part of the Task 4 commit.

## Commit

`6051fdf8804063acb423b0c5b1ebd8afc9cf4334` (`fix(api): enforce pickup snapshots and serving history`)

## Review-fix report

### Findings addressed

- `assertServingReadyInTransaction` now filters out nullable legacy `DailyMenuRevision.revision` rows and selects the canonical verified revision with deterministic `revision DESC, id DESC` ordering. Existing MealDay readiness, enabled-menu, service-boundary, serving-window, and meal-date checks remain enforced.
- Added a behavior test with a later-created legacy revision and an earlier verified revision; the serving readiness result uses the verified revision.
- Added a consumer-facing pickup route test using the real `PickupService.getPickupOptions` path with a database fixture that returns an incomplete registration snapshot; `GET /api/me/pickup-options` returns an empty eligible set instead of accepting the legacy row. Existing unit coverage continues to exercise all-or-nothing serving, idempotency replay/conflict, serving snapshot copy, stale snapshot rejection, and post-commit timing.

### Review-fix verification

- `yarn workspace @imeal/api exec vitest run src/pickup/pickup.service.spec.ts`: passed — 1 file, 49 tests passed.
- `yarn workspace @imeal/api exec vitest run test/pickup.e2e-spec.ts`: blocked by the default Vitest include (`**/*.spec.ts`), which discovers no e2e files.
- `yarn workspace @imeal/api exec vitest run --config ./vitest.config.e2e.ts test/pickup.e2e-spec.ts`: blocked before test execution because `DATABASE_URL` is not set in the environment or `packages/domain/.env.test`.
- `yarn workspace @imeal/api exec tsc --noEmit --pretty false`: still reports only the three pre-existing `apps/api/src/admin/penalties/penalties.service.ts` errors for missing nullable `registrationId` and `mealDate`; no pickup-service errors were reported.
- `git diff --check`: passed with no whitespace errors.

### Review-fix concerns

- Consumer-facing route coverage is present but the configured PostgreSQL-backed e2e harness could not execute in this environment because `DATABASE_URL` is unavailable; no runtime e2e result is claimed.
- API-wide TypeScript remains red only in the upstream/out-of-scope penalties mapping.

### Review-fix commit

`808f71f8d9cd31a7a5d172811358563642dd71cc` (`fix(api): canonicalize pickup menu revision checks`)
