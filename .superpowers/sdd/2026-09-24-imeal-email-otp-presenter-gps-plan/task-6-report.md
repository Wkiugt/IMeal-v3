# Task 6 Report — four-location configuration, roster import, and registration snapshots

## Status

DONE_WITH_CONCERN — Task 6 implementation and review fixes are complete. Reachable API/static verification is green. Live domain/database verification is blocked because PostgreSQL at `localhost:6432` is unavailable in this workspace.

## Scope implemented

- Added `LocationsService` with server-only effective active location/policy resolution, effective-dated configuration writes, positive/integer policy thresholds, structured validation 400s, policy ownership checks, haversine geofence evaluation, freshness/accuracy/bounds checks, and safe GPS results. Retry failures expose only canonical safe codes and `RETRY`/`REFRESH`; no raw coordinates or distance are returned.
- Added `LocationsModule` and authorized location configuration endpoints under `v1/admin/locations` and `admin/locations`, protected by `SessionGuard`, `PermissionsGuard`, and explicit `location.manage` permission.
- Added atomic roster preview/commit service and endpoints under `v1/admin/roster` and `admin/roster`, protected by explicit `roster.manage` permission. Preview normalizes NFKC/lowercase email, uppercase employee code/capability/location code, validates strict approved fields/date ranges, rejects unknown locations, true duplicate employee-code conflicts, and inactive capability assignments before commit. Batch and all preview rows stage in one transaction.
- Roster commit uses one Prisma transaction for all assignment/row/audit writes, persists batch and row `auditEventId` values, is idempotent for already accepted batches and exact normalized assignment replays, deactivates a prior assignment only inside the same transaction, and rolls back all writes if a later row fails. No seed rows or fabricated location/employee data were added.
- Added allowlist administration endpoints under `v1/admin/allowlist` and `admin/allowlist` with explicit `allowlist.manage` permission. The controller trims and validates email syntax before persistence; it exposes no admin-role grant/revoke path. Audit details hash email addresses rather than logging full email content.
- Wired the new module into `AppModule`.
- Updated domain `RegistrationService.registerMeal` to resolve an effective active assignment by server-side user ID/normalized email and meal-date range, including the related location's active/effective predicate, then persist immutable service-location/assignment/name/address/effective-date snapshots on create. Re-activating an existing registration only fills a missing snapshot; later assignment changes cannot rewrite an existing snapshot. Added focused query-predicate and snapshot-shape domain assertions.

## TDD and verification

### RED

- `corepack yarn workspace @imeal/api exec vitest run src/admin/locations/locations.service.spec.ts src/admin/roster/roster-import.service.spec.ts` initially failed because the new location/roster modules did not exist (`Cannot find module`).
- The new domain snapshot test was added before the domain implementation. The normal domain test setup could not reach assertions because `DATABASE_URL` was absent; with the configured endpoint supplied it failed before tests with `ECONNREFUSED ::1:6432` / `127.0.0.1:6432`.

### GREEN / static verification

- `corepack yarn workspace @imeal/api exec vitest run src/admin/roster/roster-import.service.spec.ts src/admin/locations/locations.service.spec.ts src/admin/allowlist/allowlist.controller.spec.ts` — **3 files, 14 tests passed**.
- `corepack yarn workspace @imeal/api exec vitest run` — **20 files, 148 tests passed**.
- `corepack yarn workspace @imeal/api exec tsc --noEmit` — passed.
- `corepack yarn workspace @imeal/core exec tsc --noEmit` — passed.
- `corepack yarn workspace @imeal/api lint` — exited 0; only pre-existing warnings remain in unrelated files (`test-controller`, registrations/delegations specs, common pipe, notifications service).
- `git diff --check` — passed; Git emitted only expected Windows LF/CRLF notices.

## Database blocker

The domain test suite cannot run its DB-backed setup. Without an injected URL it fails at `packages/domain/test/setup.ts` with `DATABASE_URL is not set in environment or .env.test`; when run against the configured `postgresql://postgres:postgres@localhost:6432/imeal` endpoint, PostgreSQL connection attempts fail with `ECONNREFUSED ::1:6432` and `ECONNREFUSED 127.0.0.1:6432`. No live migration/transaction/registration snapshot assertion is claimed.

## Files changed

- `apps/api/src/app.module.ts`
- `apps/api/src/locations/locations.service.ts`
- `apps/api/src/locations/locations.module.ts`
- `apps/api/src/admin/locations/locations.controller.ts`
- `apps/api/src/admin/locations/locations.service.spec.ts`
- `apps/api/src/admin/allowlist/allowlist.controller.ts`
- `apps/api/src/admin/allowlist/allowlist.controller.spec.ts`
- `apps/api/src/admin/roster/roster-import.service.ts`
- `apps/api/src/admin/roster/roster.controller.ts`
- `apps/api/src/admin/roster/roster-import.service.spec.ts`
- `packages/domain/src/RegistrationService.ts`
- `packages/domain/test/registration.test.ts`
- `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/task-6-brief.md`
- `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/task-6-report.md`
- `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/progress.md`

No Task 7 QR/pickup, Task 8 confirmation, Task 9/10 mobile/Admin Web UI, or Task 11 documentation work was added. No migration or operational seed data was added.

## Commit

- `0e87b57` — `feat(admin): add approved locations roster imports and snapshots`
- Review package input: `0e87b57` (parent baseline `9ac7a1e`).
- Scoped review package: `review-9ac7a1e..0e87b57.diff`.
