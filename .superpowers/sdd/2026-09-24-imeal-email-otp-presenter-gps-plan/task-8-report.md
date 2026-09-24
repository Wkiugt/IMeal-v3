# Task 8 Report — atomic exact-session confirm, delegation races, idempotency, and immutable serving audit

## Status

DONE_WITH_CONCERN — Task 8 implementation and reachable API/static verification are complete. PostgreSQL-backed domain concurrency and pickup HTTP e2e suites are blocked before test discovery because this workspace has no `DATABASE_URL`/`.env.test` PostgreSQL configuration. No live database coverage is claimed.

## Scope implemented

- `PickupService.confirmPickup` now accepts only the exact `ConfirmPickupInput` session/idempotency body and the current `AuthenticatedUser` Kitchen actor. It requires an active actor with current `kitchen.serve` permission and does not accept Kitchen GPS or a client location.
- Confirmation claims `(callerUserId, idempotencyKey)` inside the transaction with a unique insert and row lock. The canonical session body hash is persisted. An exact successful retry returns the stored result snapshot; a changed body/session returns `IDEMPOTENCY_CONFLICT`.
- One transaction locks the PickupSession, exact sorted session registration IDs, all relevant delegations sorted by registration/id, and all participant account rows deterministically. It revalidates session expiry/consumption, exact intent arrays/hash/nonce plus QR-hash/verification linkage, meal date, serving window/readiness, current account activity/permission, registration status/date/location, delegation authority, current location/policy, presenter verification freshness/accuracy/retention, and duplicate serving state.
- The serving-ready setting is only a readiness signal: confirmation always loads the current daily menu/meal day, requires an enabled menu and current revision, and persists the returned `menuRevisionId` on each serving.
- Accepted delegations are transitioned to `COMPLETED` only inside the same transaction and only for the exact accepted delegation authorizing a `PROXY` receiver. Owner self pickup remains `SELF` without mutating unrelated accepted delegations or recording a delegation ID; delegate pickup remains owner-attributed with `PROXY`, presenter, and delegation snapshots. Revoke/serve transactions use the same registration-first lock order, so one committed delegation winner is authoritative.
- Every `MealServing`, registration status update, meal event, delegation completion, audit snapshot, idempotency result snapshot, and consumed session update is committed or rolled back together. Serving rows retain owner, presenter/receiver, Kitchen actor/permission context, location snapshots, meal/menu reference, request/session/intent/verification IDs/outcome, delegation ID, and served time. Audit details contain immutable server-resolved snapshots and no raw coordinates or QR payload.
- Realtime `SERVING_CONFIRMED` is emitted only after the transaction resolves, and not for an idempotent replay.
- Serving verification rows now retain the signed QR intent nonce; confirmation compares the session QR hash, intent hash, nonce, verification ID, and persisted verification nonce before any serving writes. The migration is additive and stores no QR payload or raw GPS.
- Added domain concurrency/rollback coverage, restored all pre-existing pickup confirmation tests, and added pickup regressions for exact idempotency, expired sessions, post-commit realtime, SELF delegation isolation, session linkage, menu invariants, menu revision snapshots, and strict-body transport. No mobile Task 9, Admin Task 10, or docs Task 11 production work was added.

## TDD / verification

### RED

- Added the idempotency-conflict regression first and ran it before the implementation. It failed because the prior confirm path returned an empty successful result for a changed body instead of `IDEMPOTENCY_CONFLICT`.
- The domain concurrency tests were added for the PostgreSQL transaction boundary but could not reach test discovery in this environment because the shared DB setup requires `DATABASE_URL`.

### GREEN / reachable checks

- `corepack yarn workspace @imeal/api exec vitest run src/pickup/pickup.service.spec.ts` — **41 tests passed**.
- `corepack yarn workspace @imeal/api exec vitest run` — **20 files, 169 tests passed**.
- `corepack yarn workspace @imeal/api exec tsc --noEmit -p tsconfig.json` — passed.
- `corepack yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json` — passed, including `test/concurrency.test.ts`.
- `corepack yarn typecheck` — passed.
- `corepack yarn workspace @imeal/api lint` — exited 0; only pre-existing warnings remain in unrelated files.
- `git diff --cached --check -- ':!.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/review-be5a37c..task8.diff'` — passed; the generated review patch is excluded because diff-format blank-line markers are reported as trailing whitespace.

### Database/e2e limit

- `corepack yarn workspace @imeal/api exec vitest run --config ./vitest.config.e2e.ts test/pickup.e2e-spec.ts` — blocked before tests by `packages/domain/test/setup.ts`: `DATABASE_URL is not set in environment or .env.test`.
- `corepack yarn workspace @imeal/core exec vitest run test/concurrency.test.ts` — blocked before tests by the same setup error.
- `corepack yarn workspace @imeal/core exec vitest run` — all four domain suites blocked before test discovery by the same setup error.
- No live PostgreSQL migration application, row-lock, unique-conflict, delegation-race, rollback, or live HTTP authorization assertion is claimed. Configure a reachable PostgreSQL `DATABASE_URL` (or `packages/domain/.env.test`) and rerun the two commands above before production approval.

## Files changed

- `apps/api/src/pickup/pickup.service.ts`
- `apps/api/src/pickup/pickup.service.spec.ts`
- `apps/api/test/pickup.e2e-spec.ts`
- `packages/domain/test/concurrency.test.ts`
- `packages/domain/prisma/schema.prisma`
- `packages/domain/prisma/migrations/20260924150000_bind_serving_verification_nonce/migration.sql`
- `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/task-8-brief.md`
- `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/task-8-report.md`
- `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/progress.md`

Added one additive `serving_verifications.intent_nonce` schema/migration field to bind the persisted presenter verification to the resolved signed QR nonce. No operational location seed data was added.

## Commit / review package

- Commit: final Task 8 implementation commit on this branch (`HEAD`).
- Review package: `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/review-be5a37c..task8.diff`, containing only the Task 8 implementation/tests and Task 8 brief/report/ledger updates relative to approved Task 7 `be5a37c`.
