# Task 7 Report — exact QR intent, presenter GPS, and location-aware resolve

## Status

DONE_WITH_CONCERN — Task 7 implementation and reachable API/static verification are complete. The database-backed pickup e2e suite is blocked before test discovery because this workspace has no `DATABASE_URL`/`.env.test` PostgreSQL configuration; no live database coverage is claimed.

## Scope implemented

- `PickupService.generateQr` now requires an explicit non-empty registration set and presenter evidence on every call. Registration IDs are trimmed, duplicate-checked, and sorted before signing; stale/ineligible selected items are rejected without substitution.
- Presenter GPS is evaluated through `LocationsService` against the server-resolved registration snapshot location. GPS failures expose only `GPS_RETRY_REQUIRED` plus `RETRY`/`REFRESH`; a QR is not returned and no raw coordinates are persisted.
- QR payloads include `imeal:v2`, presenter user ID, Vietnam business date, exact sorted registration set, five-second expiry, nonce, and HMAC signature. Verification preserves the exact set and rejects malformed, stale, wrong-date, bad-signature, duplicate, or changed intents with safe codes. The two-second clock-skew allowance remains enforced.
- Valid presenter verification is persisted as a safe `ServingVerification` record keyed by QR hash, retaining presenter, location, policy ID, result, timestamp, accuracy, safe result code, and retention expiry only.
- `resolvePickup` accepts only strict `{ qr }` plus an authenticated `AuthenticatedUser` actor. It requires current `kitchen.serve`, accepts no Kitchen GPS, rechecks current exact eligibility/delegation relationship, registration location snapshot, effective server location/policy, stored evidence freshness/accuracy/policy identity, and QR replay state.
- Resolved sessions persist the exact sorted set, presenter, meal date, QR hash, nonce, server location, serving-verification ID, and a 30-second expiry. QR replay/conflict, stale state, mismatched evidence, and missing context are rejected without replacement.
- Confirm transport is now strict session-only (`pickupSessionId` + `idempotencyKey`); direct service calls reject arbitrary subset/expansion fields with `PICKUP_INTENT_CONFLICT` while preserving the existing confirmation transaction for Task 8 to complete later.
- Controllers use the existing `SessionGuard`, permission guard, `ZodValidationPipe`, and shared v1 contracts. `PickupModule` imports `LocationsModule` for server-side resolution. No operational location data or migration/seed rows were added.

## TDD / verification

### RED

- Added Task 7 service tests before the implementation and observed the expected failures for zero intent, missing presenter evidence, stale exact set, Kitchen-actor resolve, and changed confirm intent.
- Added a policy-change regression test and observed it fail with session creation attempted before policy identity was checked; the policy identity revalidation then made it pass.

### GREEN / reachable checks

- `corepack yarn workspace @imeal/api exec vitest run src/pickup/pickup.service.spec.ts` — **25 tests passed**.
- `corepack yarn workspace @imeal/api exec vitest run` — **20 files, 153 tests passed**.
- `corepack yarn workspace @imeal/api exec tsc --noEmit` — passed.
- `corepack yarn workspace @imeal/api lint` — exited 0; only pre-existing warnings remain in unrelated files.
- `git diff --check` — passed.

### Database/e2e limit

- `corepack yarn workspace @imeal/api exec vitest run --config ./vitest.config.e2e.ts test/pickup.e2e-spec.ts` — blocked before tests by `packages/domain/test/setup.ts`: `DATABASE_URL is not set in environment or .env.test`.
- No PostgreSQL migration, pickup transaction, QR replay uniqueness, or live HTTP authorization assertion is claimed. The updated `apps/api/test/pickup.e2e-spec.ts` is typechecked and ready for a configured database run.

## Files changed

- `apps/api/src/pickup/pickup.service.ts`
- `apps/api/src/pickup/pickup.service.spec.ts`
- `apps/api/src/pickup/pickup.controller.ts`
- `apps/api/src/pickup/internal-pickup.controller.ts`
- `apps/api/src/pickup/pickup.module.ts`
- `apps/api/test/pickup.e2e-spec.ts`
- `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/task-7-brief.md`
- `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/task-7-report.md`
- `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/progress.md`

No Task 8 audit/transaction redesign, mobile Task 9, Admin Web Task 10, or docs Task 11 work was added. No operational location seed data was added.

## Commit / review package

- Commit: `9fc188e` — `feat(pickup): enforce exact intent and presenter gps at qr generation`.
- Review package: `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/review-0e87b57..9fc188e.diff`.
