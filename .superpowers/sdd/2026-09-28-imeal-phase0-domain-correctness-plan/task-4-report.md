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
