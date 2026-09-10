# Task 1 implementation report

## Changed files

- `apps/mobile/src/ui/useMinimumVisibleLoading.ts`
  - Added `useMinimumVisibleLoading(loading, minimumMs = 450)`, which tracks false-to-true loading windows, holds the visible state for the remaining minimum duration, and clears pending timers on re-entry and unmount.
- `apps/mobile/src/ui/BrandMotion.tsx`
  - Added named `MOTION_DURATION_MS = 260` and applied it to `StateTransition` and `ScreenEntrance`; existing 8 px translate, opacity behavior, reduced-motion behavior, and 900 ms loader pulse remain unchanged.
- `apps/mobile/App.tsx`
  - Applied the minimum loading floor to session restoration and sign-in states.
  - Added full-screen `Signing in…` loader state and delayed auth redirect until the visible loading floor completes, including failed sign-in return to the form.
  - Updated both auth mark instances to the canonical `BrandMark` at `size={32}`, `containerSize={72}`.
- `apps/mobile/src/screens/employee/EmployeeDashboardScreen.tsx`
  - Applied the hook to the primary registration loader/status transition.
- `apps/mobile/src/screens/employee/EmployeeCalendarScreen.tsx`
  - Applied the hook to the combined initial calendar loading transition.
- `apps/mobile/src/screens/delegation/DelegationScreen.tsx`
  - Applied the hook only to the empty-data/initial loading state; mutation loading still follows real completion timing.
- `apps/mobile/src/screens/pickup/PickupIntentScreen.tsx`
  - Applied the hook to the initial options loader only. The hook import is at line 13; `visibleLoading` is declared directly after `optionsRequestId` at line 31. QR refresh loading remains action-timed.
- `apps/mobile/src/screens/kitchen/KitchenDashboardScreen.tsx`
  - Applied the hook to the initial snapshot loader; polling and refresh remain tied to their real operations.
- `apps/mobile/src/screens/kitchen/KitchenScannerScreen.tsx`
  - Applied the hook to camera-permission loading while preserving the denied/ready branches.

## Focused checks

- `corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json`
  - Passed with no output.
- `git diff --check -- <changed visual/auth files>`
  - Passed with no output.

## Self-review

- No backend work, retries, or artificial delay was introduced. The hook delays only presentation state and does not wrap or delay any fetch/mutation.
- Auth redirects are guarded by both actual `isSigningIn` and the hook's visible state, so token/profile updates cannot navigate away before the 450 ms floor.
- Reduced motion remains handled by existing `BrandMotion`/`useReducedMotion` logic; the minimum loading floor is independent of motion reduction.
- Existing user edits in `README.md`, `apps/mobile/package.json`, `docs/local-role-testing.md`, and `yarn.lock` were not touched.

## Concerns

- The mobile package has no configured unit-test runner or `react-test-renderer`; verification was limited to the focused package TypeScript check and changed-file whitespace check. Actual timing and visual transitions still warrant the planned Expo/Chromium verification.

## Post-review fixes

- Added `borderRadius: theme.radii.pill` to the shared `authMark` style used by both 72 px auth badges, making the login/no-access mark circular.
- Changed `ProtectedRoute`'s reset effect to gate on `visibleRestoring`, so direct AppTabs entry retains the restoration loader through the complete 450 ms presentation floor before redirecting to Auth.

### Covering check

- `corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json`
  - Passed with no output after both fixes.
