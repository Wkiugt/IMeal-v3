# Task 3 Report — Pickup and kitchen meal-choice propagation

## Files

- `packages/contracts/src/v1/pickup.ts`
  - Added strict `PickupOptionSchema`, `PickupOptionsResponseSchema`, `ServingIntentItemSchema`, and `ResolveServingResponseSchema` with `mealChoice` on every pickup/intent item.
  - Session timestamps are validated as UTC `Z` instants and pickup dates use the canonical meal-date schema.
- `packages/contracts/src/v1/kitchen.ts`
  - Added `regularTotal` and `vegetarianTotal` counters.
  - Added `mealChoice` to registration-list and serving-log items.
  - Counter schema rejects totals that do not partition `totalRegistered`.
- `apps/api/src/pickup/pickup.service.ts`
  - Own and delegated pickup options select and return live persisted `mealChoice` values.
  - Pickup dates are serialized as canonical date keys; resolve responses are validated against the v1 response schema.
  - Resolve intent items copy `mealChoice` as a separate field.
  - Expired sessions now throw `{ code: 'PICKUP_SESSION_EXPIRED', message: 'Pickup session has expired' }` without changing QR, session, idempotency, locking, or confirmation flow.
- `apps/api/src/kitchen/kitchen-dashboard.service.ts`
  - Counters and regular/vegetarian partition are calculated from the same ACTIVE registration query, including served ACTIVE rows.
  - CANCELLED rows remain excluded; NO_SHOW rows remain isolated to the no-show list/count.
  - Choice is included in served, pending, all, no-show, and recent-log rows.
  - Final snapshots are parsed through `KitchenDashboardSnapshotSchema`.
- Focused service/contract tests and `apps/api/test/kitchen-dashboard.e2e-spec.ts` fixtures/assertions were updated for meal-choice transport and counters.

## Focused verification

- `corepack yarn workspace @imeal/contracts build` — passed.
- `corepack yarn workspace @imeal/contracts exec vitest run test/contracts.test.ts` — **22/22 passed**.
- `corepack yarn workspace @imeal/api exec tsc --noEmit --pretty false` — passed.
- `corepack yarn workspace @imeal/api exec vitest run src/pickup/pickup.service.spec.ts src/kitchen/kitchen-dashboard.service.spec.ts` — **25/25 passed**.
- RED checks were observed before implementation for missing pickup/kitchen schemas, missing pickup choice propagation, unstructured expiry, and missing counters; each corresponding focused suite passed after implementation.

## Concerns

- The focused e2e command could not collect tests because the environment lacked `DATABASE_URL` (`packages/domain/test/setup.ts` fails before test collection). No database-backed e2e evidence is available in this workspace.
- Contracts build output is ignored/generated; only contract source is committed.
- No mobile screens or snapshot columns were changed.
