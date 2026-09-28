# Task 7 report — publish only committed dashboard events

## Status

DONE

## Commits

- `1bb23c6` — `feat: publish committed kitchen dashboard events`
  - Added the Task 7 brief, typed dashboard event kinds, stable serving event payload/ID behavior, post-commit registration lifecycle emission, and focused timing/outbox tests.
- `3c49297` — `fix: preserve registration transaction loop exit`
  - Restored the existing transaction-loop `break` after post-commit lifecycle emission. This prevents a successful registration transaction from being retried indefinitely.

## Changed files

- `.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-7-brief.md`
- `apps/api/src/kitchen/kitchen-events.service.ts`
- `apps/api/src/kitchen/kitchen-dashboard.service.spec.ts`
- `apps/api/src/pickup/pickup.service.ts`
- `apps/api/src/pickup/pickup.service.spec.ts`
- `apps/api/src/registrations/registrations.service.ts`
- `apps/api/src/registrations/registrations.service.spec.ts`
- `apps/api/src/registrations/registrations.module.ts`
- `apps/worker/src/no-show-worker.service.spec.ts`

## Implemented behavior

- `KitchenRealtimeEventType` now includes `NO_SHOW_RECONCILED` and `REGISTRATION_CHANGED`; event payloads are typed as `unknown` while preserving the existing SSE envelope, routes, and bounded event-ID deduplication.
- Serving confirmation emits only after the successful `$transaction` result. The event ID is stable as `serving:${sortedServingIds.join(',')}` and the payload contains only `servedCount` and sorted `servingIds`; meal date and request ID remain in the event envelope. QR/session/GPS/employee-sensitive values are not emitted.
- Registration cancellation and reactivation return their committed lifecycle audit ID from the transaction and emit `REGISTRATION_CHANGED` only afterward with `registration:${auditId}`. Lifecycle event payloads contain only registration ID and resulting status. Transaction rollback/failure produces no event, and an in-memory event publication failure does not undo the committed transaction.
- No-show remains transactional: the worker writes `NO_SHOW_RECONCILED` to `OutboxEvent` in the same transaction as registration, penalty, audit, and notification changes, using `kitchen:no-show:${registrationId}` dedupe. Retry tests verify one dashboard outbox identity and stable registration payload. The worker does not import or call the API `KitchenEventsService`.

## Verification evidence

- `yarn workspace @imeal/api exec vitest run src/kitchen/kitchen-dashboard.service.spec.ts src/pickup/pickup.service.spec.ts src/registrations/registrations.service.spec.ts` — PASS, 3 files / 88 tests.
- `yarn workspace @imeal/worker exec vitest run src/no-show-worker.service.spec.ts` — PASS, 1 file / 14 tests.
- `yarn workspace @imeal/api exec tsc --noEmit` — PASS.
- `yarn workspace @imeal/worker exec tsc --noEmit` — PASS.
- `git diff --check` — PASS.

The expected invariant/rollback tests log redacted test failure messages through Nest's logger while asserting those failures; the suites still pass.

## Concerns / blockers

- No Task 7-specific PostgreSQL publisher/bridge or client realtime infrastructure was added; those remain explicitly out of scope. No PostgreSQL-backed Task 8 race proof was run here.
- The user-owned untracked plan/spec/readiness files remain untouched. `progress.md` was not modified.
