# Task 7 report — publish only committed dashboard events

## Status

DONE_WITH_CONCERNS

The implementation and review-evidence fixes are complete. PostgreSQL-backed suites were not executable in this workstation because `DATABASE_URL` is unavailable; the exact blocked/skipped commands are recorded below.

## Commits

- `1bb23c6fac30f7d69ec0490a129cade2148b0c29` — `feat: publish committed kitchen dashboard events`
  - Added the Task 7 brief, typed dashboard event kinds, stable serving event payload/ID behavior, post-commit registration lifecycle emission, and focused timing/outbox tests.
- `3c492977f0a671b030b33f15c387cf2b7d24bffb` — `fix: preserve registration transaction loop exit`
  - Restored the existing transaction-loop `break` after post-commit lifecycle emission so a successful registration transaction is not retried indefinitely.
- `4fa76bae750e1f40df7211812daede7ad97a488b` — `docs: record task 7 event evidence`
  - Recorded the initial Task 7 behavior and verification evidence.
- `e4fed25c180ab85850ad92648c8cb23caa7acad0` — `test: close task 7 realtime evidence gaps`
  - Added migration-backed outbox assertions for event identity, payload, dedupe, concurrent serialization, and rollback/independent commit behavior.
  - Added route-level permission-denial and SSE alias/serialization/filtering/heartbeat evidence, plus a focused heartbeat contract test.

## Changed files

- `.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-7-brief.md`
- `.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-7-report.md`
- `apps/api/src/kitchen/kitchen-events.service.ts`
- `apps/api/src/kitchen/kitchen-dashboard.service.spec.ts`
- `apps/api/test/kitchen-dashboard.e2e-spec.ts`
- `apps/api/src/pickup/pickup.service.ts`
- `apps/api/src/pickup/pickup.service.spec.ts`
- `apps/api/src/registrations/registrations.service.ts`
- `apps/api/src/registrations/registrations.service.spec.ts`
- `apps/api/src/registrations/registrations.module.ts`
- `apps/worker/src/no-show-worker.service.spec.ts`
- `apps/worker/test/no-show-worker.e2e-spec.ts`

## Implemented behavior

- `KitchenRealtimeEventType` includes `NO_SHOW_RECONCILED` and `REGISTRATION_CHANGED`; event payloads remain `unknown` while preserving the existing SSE envelope, routes, and bounded event-ID deduplication.
- Serving confirmation emits only after the successful `$transaction` result. The event ID is stable as `serving:${sortedServingIds.join(',')}` and the payload contains only `servedCount` and sorted `servingIds`; meal date and request ID remain in the event envelope. QR/session/GPS/employee-sensitive values are not emitted.
- Registration cancellation and reactivation return their committed lifecycle audit ID from the transaction and emit `REGISTRATION_CHANGED` only afterward with `registration:${auditId}`. Lifecycle event payloads contain only registration ID and resulting status. Transaction rollback/failure produces no event, and an in-memory event publication failure does not undo the committed transaction.
- No-show remains transactional: the worker writes `NO_SHOW_RECONCILED` to `OutboxEvent` in the same transaction as registration, penalty, audit, and notification changes, using `kitchen:no-show:${registrationId}` dedupe. Migration-backed assertions verify committed event identity/payload, stable retry identity, concurrent serialization, and rollback/independent commit behavior. The worker does not import or call the API `KitchenEventsService`.
- The existing SSE routes and aliases remain unchanged. Route-level tests now exercise actual authentication/permission guards, SSE serialization, meal-date filtering, heartbeat frames, and the `/api/kitchen` alias.

## Verification evidence

- `yarn workspace @imeal/api exec vitest run src/kitchen/kitchen-dashboard.service.spec.ts src/pickup/pickup.service.spec.ts src/registrations/registrations.service.spec.ts` — PASS, 3 files / 89 tests.
- `yarn workspace @imeal/worker exec vitest run src/no-show-worker.service.spec.ts` — PASS, 1 file / 14 tests.
- `yarn workspace @imeal/api exec tsc --noEmit` — PASS.
- `yarn workspace @imeal/worker exec tsc --noEmit` — PASS.
- `git diff --check` — PASS.
- `yarn workspace @imeal/worker exec vitest run --config vitest.config.e2e.ts test/no-show-worker.e2e-spec.ts` — 1 file / 3 tests skipped because `DATABASE_URL` is unavailable; no PostgreSQL assertions were fabricated.
- `yarn workspace @imeal/api exec vitest run --config vitest.config.e2e.ts test/kitchen-dashboard.e2e-spec.ts` — BLOCKED before test collection by `Error: DATABASE_URL is not set in environment or .env.test` from `packages/domain/test/setup.ts`; route-level assertions are present but could not execute without the required database.

The expected invariant/rollback tests log redacted test failure messages through Nest's logger while asserting those failures; the suites still pass.

## Concerns / blockers

- The migration-backed worker and API route e2e evidence requires a PostgreSQL `DATABASE_URL` and was not runnable in this workstation. Re-run the two configured e2e commands above in the database-enabled environment before treating the evidence as fully green.
- No Task 7-specific PostgreSQL publisher/bridge or client realtime infrastructure was added; those remain explicitly out of scope.
- User-owned untracked plan/spec/readiness files remain untouched. `.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/progress.md` was not modified by this task.
