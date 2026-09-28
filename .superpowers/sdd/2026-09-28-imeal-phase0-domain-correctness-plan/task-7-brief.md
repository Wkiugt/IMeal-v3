## Task 7: Publish only committed dashboard events

**Files:**
- Modify: `apps/api/src/kitchen/kitchen-events.service.ts:6-94`
- Modify: `apps/api/src/pickup/pickup.service.ts:1634-1643`
- Modify: `apps/api/src/registrations/registrations.service.ts` cancellation/reactivation commit path
- Modify: `apps/worker/src/no-show-worker.service.ts` outbox write from Task 6
- Test: `apps/api/src/kitchen/kitchen-dashboard.service.spec.ts`, `apps/api/src/pickup/pickup.service.spec.ts`, `apps/worker/src/no-show-worker.service.spec.ts`

**Event interface:**

```ts
type KitchenRealtimeEventType =
  | 'SERVING_CONFIRMED'
  | 'KITCHEN_SIGNAL_CHANGED'
  | 'DASHBOARD_SNAPSHOT'
  | 'NO_SHOW_RECONCILED'
  | 'REGISTRATION_CHANGED'
  | 'HEARTBEAT';

type KitchenRealtimeEvent = {
  eventId: string;
  eventType: KitchenRealtimeEventType;
  mealDate: string;
  occurredAt: string;
  requestId?: string;
  payload: unknown;
};
```

- [ ] **Step 1: Add event-type and payload contract tests.**
  - `serving_confirmed_event_contains_projection_payload_after_commit`.
  - `no_show_outbox_has_stable_dedupe_key_and_registration_payload`.
  - `registration_changed_event_is_not_visible_when_registration_transaction_rolls_back`.
  - `duplicate_event_id_is_dropped_by_KitchenEventsService` (retain the existing bounded dedup set behavior).

- [ ] **Step 2: Keep serving emission after `$transaction`.**
  - Preserve the existing `confirmPickup` pattern: emit `SERVING_CONFIRMED` only after `transactionResult` resolves successfully.
  - Use stable event ID `serving:${sortedServingIds.join(',')}` where `sortedServingIds` is the ascending list of committed serving IDs, and include `mealDate`, request ID, served count, and serving IDs; do not include QR payloads, session tokens, raw GPS, or employee-sensitive data.

- [ ] **Step 3: Emit registration events only after lifecycle commit.**
  - Return the committed audit ID, event type, meal date, and registration ID from the cancellation/reactivation transaction.
  - Call `KitchenEventsService.emitEvent` after the transaction with stable event ID `registration:${auditId}`, never inside it; failure to emit must not roll back committed registration data.

- [ ] **Step 4: Persist worker no-show event in the business transaction.**
  - Keep `OutboxEvent` insertion inside the no-show transaction and use the stable dedupe key from Task 6; the outbox row ID is the event ID consumed by the publisher/API bridge.
  - Do not call the in-memory API `KitchenEventsService` from the worker process. No SSE, polling consumer, broker, reconnect, or client/UI infrastructure is added; the separate realtime workstream consumes the committed outbox row.

- [ ] **Step 5: Verify event timing.**
  - Run: `yarn workspace @imeal/api exec vitest run src/kitchen/kitchen-dashboard.service.spec.ts src/pickup/pickup.service.spec.ts`
  - Run: `yarn workspace @imeal/worker exec vitest run src/no-show-worker.service.spec.ts`
  - Expected: no event/outbox row represents a rolled-back transaction; successful serving/cancel/no-show produces one committed event identity; no realtime client code changes are present.
