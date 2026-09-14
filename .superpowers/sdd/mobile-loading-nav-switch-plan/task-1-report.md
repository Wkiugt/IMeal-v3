# Task 1 Report: One-shot initial loading gate and auth restore integration

## Implementation

- Added `apps/mobile/src/ui/useInitialLoadingGate.ts` with the exact exported signature:
  `useInitialLoadingGate(loading: boolean, failed?: boolean, minimumMs?: number): boolean`.
- The hook defaults `failed` to `false` and `minimumMs` to `2_000`. It arms only when the initial render is loading, records the arm timestamp, keeps a fast successful load visible through the minimum, and leaves a slow request visible until it finishes.
- Initial failure bypasses the timer. A successful or failed initial cycle latches completion so subsequent loading cycles do not re-arm the gate. Timer cleanup runs on dependency changes and unmount; each timer callback is also guarded by its effect cleanup so stale callbacks cannot update state.
- Updated `apps/mobile/App.tsx`:
  - `AuthScreen` now uses `useInitialLoadingGate(isRestoring, Boolean(authError))`.
  - Login submission still uses the unchanged `useMinimumVisibleLoading(isSigningIn)` action-level gate.
  - `ProtectedRoute` now uses the initial gate for restore, treats `!isRestoring && !token` as an immediate no-session recovery, resets to `Auth`, and returns no protected content while that reset occurs.
  - Valid restored sessions remain behind the initial gate; no second minimum delay was added.
- `apps/mobile/src/ui/useMinimumVisibleLoading.ts` was not modified; its 450 ms default remains intact.

## TDD and test setup

The existing mobile setup contains Vitest tests running in a Node environment, but no React hook/component harness (`react-test-renderer`, Testing Library, or DOM test environment) is installed. A focused behavioral hook test therefore could not exercise mount, rerender, effects, and timer cleanup without adding a new test dependency outside the brief. No implementation-text or style assertion was added.

Consequently, there was no valid RED/GREEN hook-test command to run. The existing mobile suite was used as the available regression check after implementation.

## Verification evidence

- TypeScript RED/GREEN-equivalent production verification (after implementation):
  `corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json`
  - Exit code: 0
  - Output: none
- Required mobile test command:
  `corepack yarn workspace @imeal/mobile test`
  - Exit code: 0
  - `Test Files 1 passed (1)`
  - `Tests 1 passed (1)`
- Changed tracked files passed `git diff --check` with no output before commit.

## Self-review

- The action-level hook import and call remain separate from restore gating, preserving real-time sign-in behavior.
- Restore errors bypass the minimum immediately in `AuthScreen`; no auth error is routed through the action-level timer.
- Protected deep links do not remain on a restore loader once the session has definitively ended without a token.
- The hook's one-shot refs are stable across rerenders, and cleanup uses both timer cancellation and an effect-local active flag. The callback checks the active flag before touching the timer ref, preventing an already-queued stale callback from clearing a newer timer handle.
- No domain, cutoff, QR, mutation, refresh, or other screen timing behavior was changed.

## Commit

`61deae9 feat(mobile): gate initial loading and auth restore`

## Concerns

Focused hook behavior is not covered by an automated component test because the current mobile test setup lacks a React hook renderer. Runtime Expo verification and broader workspace validation remain with the integration owner.
