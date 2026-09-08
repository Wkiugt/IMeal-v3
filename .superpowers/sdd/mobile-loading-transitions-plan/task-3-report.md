# Task 3 — Asynchronous Mobile Screens Report

## Scope

Updated only the six assigned mobile screen implementations:

- `apps/mobile/src/screens/employee/EmployeeDashboardScreen.tsx`
- `apps/mobile/src/screens/employee/EmployeeCalendarScreen.tsx`
- `apps/mobile/src/screens/pickup/PickupIntentScreen.tsx`
- `apps/mobile/src/screens/delegation/DelegationScreen.tsx`
- `apps/mobile/src/screens/kitchen/KitchenDashboardScreen.tsx`
- `apps/mobile/src/screens/kitchen/KitchenScannerScreen.tsx`

No dependency, `App.tsx`, `PrototypeShell.tsx`, or `BrandNotice.tsx` changes were made. Existing notice calls, refresh controls, QR timers/progress, calendar cutoff logic, kitchen serving logic, and scanner confirmation flow were retained.

## Employee Dashboard

### Changes

- Added request-specific `loading`, initialized to `true`, independently of the nullable registration result.
- Sets loading when the token-driven weekly registration request starts and clears it from guarded `finally` handling.
- Derives the status exactly as:
  - loading: `Loading…`, soft tone
  - registered: `Confirmed`, soft tone
  - not registered: `Not registered`, warning tone
  - unavailable: `Unavailable`, warning tone
- Replaced the previous spinner row with a compact `BrandLoader` labeled `Loading today’s registration…` inside a keyed `StateTransition`.
- Removed the `ActivityIndicator` import and obsolete loader styles.

### Lifecycle invariants

- A pending request cannot display `Confirmed`; confirmation is shown only for `todayRegistered === true` after loading completes.
- The effect-local mounted guard prevents completion, failure, and `finally` callbacks from updating state after token replacement or unmount.
- Loaded false and unavailable null remain distinguishable states.

## Employee Calendar

### Changes

- Added independent monotonic `monthRequestId` and `weekRequestId` refs.
- `loadMonth` captures both IDs before awaiting; the month response is guarded by the month ID and its explicit current-week phase keeps the pre-captured week ID.
- `refreshCurrentWeek` captures a new week ID and guards success, error, and notice emission.
- Month-effect cleanup invalidates both request domains; focus cleanup invalidates the week domain.
- Replaced the weekly `ActivityIndicator` with `BrandLoader` labeled `Loading meal calendar…`.
- Consolidated weekly loading/error/ready rendering under one `StateTransition` with precedence `loading`, then error only without a valid snapshot, then ready.
- Removed the obsolete loader style and `ActivityIndicator` import.

### Lifecycle invariants

- Only the current month request updates month registrations or clears month loading.
- Only the current week request calls `applyCurrentWeek`, changes current-week availability state, or emits current-week load notices.
- A later focus/cutoff refresh invalidates the week phase pre-captured by an older month load; the older load cannot reclaim week ownership after its month fetch resolves.
- Cleanup invalidation prevents responses from an obsolete month, focus period, or unmounted screen from writing.
- A later current-week refresh failure retains an existing valid `windowSnapshot`; the ready rows remain rendered while the error is recorded and noticed.
- Cutoff scheduling, optimistic registration changes, cutoff warnings, and the 180 ms toggle animation are unchanged.

## Pickup Intent

### Changes

- Added `loadError` and monotonic `optionsRequestId` state/ref ownership.
- `fetchOptions` clears its prior error, starts loading, and guards success, failure, notice emission, and `finally` by request ID.
- Focus cleanup increments the request ID so a prior-focus response cannot update the next focus period.
- Successful requests now leave initial loading through guarded `finally`; the previous success path could remain loading indefinitely.
- Added keyed loading/error/empty/ready transitions.
- Added `BrandLoader` labeled `Loading pickup options…`, a captured-error retry card, and a compact QR placeholder loader labeled `Generating QR code…`.
- Removed the `ActivityIndicator` import and obsolete loader style.

### Lifecycle invariants

- A stale options response, error, or `finally` cannot overwrite or stop a newer request.
- Error rendering uses the accepted request’s captured message and retains the existing `Pickup unavailable` notice.
- Retry starts a fresh owned request.
- QR generation cancellation, server TTL handling, refresh timeout, one-second countdown, and progress animation cleanup are unchanged.

## Delegations

### Changes

- Initialized loading to `true` and added `loadError`, `delegationRequestId`, and `activeTabRef`.
- Added `selectTab`, which updates the authoritative tab ref before React tab state.
- `loadDelegations(targetTab)` now captures an explicit target and request ID; all state writes and request completion are guarded by both current ID and current tab.
- The loading effect invalidates its request ID during cleanup.
- `handleAction` captures its starting tab and reloads only if that tab is still active after the mutation.
- Added a keyed loading/error/empty/list transition, `BrandLoader` labeled `Loading delegations…`, and a captured-error retry card.
- Removed the `ActivityIndicator` import and obsolete loader style.

### Lifecycle invariants

- Results for OUTGOING cannot render under INCOMING, or vice versa.
- Tab selection changes authority synchronously before React schedules the next render/effect.
- An action completed after a tab change cannot launch an old-tab reload or clear the new tab’s loading state.
- Accepted load failures preserve existing data, store the inline error before emitting `Delegations unavailable`, and expose retry.
- Action failures preserve data and continue to emit `Action failed`.

## Kitchen Dashboard

### Changes

- Added `loadError`, monotonic `dashboardRequestId`, and `currentSnapshot`.
- Every token-backed dashboard fetch marks loading and guards success, failure, notice emission, refresh completion, and loading completion by request ID.
- Accepted success stores `currentSnapshot` before React state and clears the load error.
- Accepted initial failure stores a load error and preserves the existing `Dashboard unavailable` notice; failures after a usable snapshot do not replace that snapshot with an error surface.
- Focused polling cleanup clears the interval and invalidates the active request.
- Added exactly one keyed loading/error/ready `StateTransition`, a `BrandLoader` labeled `Loading kitchen dashboard…`, and a retry card.
- Removed unused loading/icon imports and pre-existing unused profile/avatar remnants.

### Lifecycle invariants

- A stale poll, pull-to-refresh, or off-screen request cannot update the snapshot or clear the latest request’s loading/refresh state.
- Null snapshots never render the dashboard’s zero-value cards; they render only loading or the unavailable retry surface.
- A fetched snapshot stays visible during polling and pull-to-refresh.
- `Syncing…` appears only while the latest accepted request is active; `Auto-sync 5s` appears only in the non-null snapshot branch.
- Five-second polling, pull-to-refresh, serving-signal toggle behavior, and dashboard filtering remain intact.

## Kitchen Scanner

### Changes

- Replaced the camera permission spinner with `BrandLoader` labeled `Preparing camera…`.
- Consolidated permission-loading, permission-denied, and scanner-ready branches under one outer `StateTransition` with the required state keys and `flex: 1`.
- Disabled `PrototypeFrame` entrance animation in denied and ready branches so the outer transition is the sole entrance owner.
- Removed the `ActivityIndicator` import.

### Lifecycle invariants

- Permission transitions animate as one mutually exclusive state surface.
- Camera rendering remains focus-gated and suppressed while a serving intent is open.
- QR resolve/confirm copy and state, serving confirmation modal, server-expiry countdown, reduced-motion scan line behavior, and scan reset behavior are unchanged.

## Verification

No focused mobile screen test harness exists under `apps/mobile`; per the assignment, no permanent test scaffolding was added.

Command:

```text
corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json
```

Output:

```text
(no output)
```

Result: exit code 0, completed in 2.90 seconds.

Additional patch integrity command:

```text
git diff --check -- apps/mobile/src/screens/employee/EmployeeDashboardScreen.tsx apps/mobile/src/screens/employee/EmployeeCalendarScreen.tsx apps/mobile/src/screens/pickup/PickupIntentScreen.tsx apps/mobile/src/screens/delegation/DelegationScreen.tsx apps/mobile/src/screens/kitchen/KitchenDashboardScreen.tsx apps/mobile/src/screens/kitchen/KitchenScannerScreen.tsx
```

Output:

```text
(no output)
```

Result: exit code 0.

## Concerns

- The repository has no focused React Native screen harness, so reordered-response and focus-transition behavior was not runtime-driven in this slice; verification is limited to the scoped mobile TypeScript compilation and source-level lifecycle guards.
- Native camera permission, QR scanning, polling, pull-to-refresh, and animation visuals require the Expo/device runtime and backend prerequisites described by the parent plan; they were not available as a narrow automated screen check here.
- The worktree contained unrelated modified/untracked files before this task. They were left untouched and are excluded from this task’s commit.
