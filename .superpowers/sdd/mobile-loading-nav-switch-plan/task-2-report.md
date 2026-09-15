# Task 2 Report: Initial Data Loading Gates

## Scope

Migrated the six requested initial-data/permission screens in `apps/mobile` to the reviewed `useInitialLoadingGate(loading, failed?, minimumMs?)` hook. `EmployeeProfileScreen` was intentionally left unchanged.

## Screen changes

- **EmployeeDashboardScreen**
  - Replaced the action-level minimum loader with a one-shot gate around the full dashboard content.
  - The gate uses the initial week request's `loading` state and fails open immediately when `!loading && todayRegistered === null`.
  - Preserved the `Loading today’s registration…` label; successful content is revealed only after the initial gate, and failed restore reveals the existing dashboard with `Unavailable`.
  - Kept profile, ticket, calendar navigation, and registration API behavior unchanged.

- **EmployeeCalendarScreen**
  - Gates the aggregate `monthLoading || weekLoading` state and bypasses on `availabilityError` when no `windowSnapshot` exists.
  - Uses `showLoading = initialGate || loading` and now places the header, month calendar, legend, weekly heading, and weekly rows behind the same `StateTransition`, preventing partial initial data from flashing.
  - Preserved month/week request IDs, aggregate loading flags, focus/cutoff refresh behavior, registration mutation handling, and existing `Loading meal calendar…` label.
  - Did not alter weekly switch pending ownership or animation behavior.

- **PickupIntentScreen**
  - Gates the first `fetchOptions()` request and bypasses on `loadError`.
  - Uses `showLoading = initialGate || (loading && options.length === 0)`, allowing focus refreshes with existing options to retain the content surface.
  - Kept the options request ID, QR generation/refresh loop, 5-second TTL, countdown, `progressAnim`, and selection behavior outside the initial gate.
  - Preserved `Loading pickup options…` and all existing error/retry surfaces.

- **DelegationScreen**
  - Gates the initial `loading` state and bypasses immediately for an empty-list load error.
  - Uses `showLoading = initialGate || loading`; the gate latches after the first success, including an empty result, so tab changes and accept/decline/revoke actions use real request timing only.
  - Preserved delegation request IDs, active-tab guards, action behavior, notices, and loader label.

- **KitchenDashboardScreen**
  - Preserved `initialLoading = snapshot === null && loading` and added the requested empty-snapshot error bypass.
  - Renders through `initialGate || initialLoading`; polling and pull refreshes with an existing snapshot do not hide the snapshot or re-arm the gate.
  - Preserved the 5-second poll, refresh control, serving toggle, dashboard request ID, and `Loading kitchen dashboard…` label.

- **KitchenScannerScreen**
  - Gates only unresolved camera permission (`!permission`) and treats a resolved non-granted permission as an immediate failure/recovery state.
  - Resolve/confirm serving, expiry countdown, scanner state, and modal behavior remain outside the permission gate.
  - Preserved `Preparing camera…`, permission recovery action, camera rendering, and serving API behavior.

## Verification

- `corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json` — passed.
- `corepack yarn workspace @imeal/mobile exec vitest run src/api/requestWithTimeout.test.ts` — passed (1 file, 1 test).
- `corepack yarn workspace @imeal/mobile test` — passed (1 file, 1 test).

The mobile repository has no React Native screen/component test harness, so no implementation-text or style-based tests were added. Runtime Expo/device visual verification was not available in this focused implementation checkout; the main integration pass should perform the plan's actual-surface loading, refresh, permission, and polling checks.
