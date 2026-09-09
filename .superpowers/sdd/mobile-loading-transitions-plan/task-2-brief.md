# Task 2 — Apply screen-entry motion and auth/navigation integration

Consume the shared exports from `apps/mobile/src/ui/BrandMotion.tsx` created by the preceding task.

In `apps/mobile/src/ui/PrototypeShell.tsx`, add `animateEntrance?: boolean` to `PrototypeFrame` with default `true`, read `useIsFocused()`, and wrap the existing device container with `ScreenEntrance active={isFocused}` when enabled; when disabled, render the same container without that wrapper. Keep `SafeAreaView`, scroll behavior, bottom clearance, custom tab bar, and `unmountOnBlur: false` unchanged; the animation affects only opacity/vertical transform of the framed screen.

In `apps/mobile/App.tsx`, replace both inline auth-card `Utensils` badges with `BrandMark`, and replace the `AuthScreen` restore and `ProtectedRoute` gates with full `BrandLoader` instances labeled `Restoring your session…`. Wrap the `AuthScreen` `restoring`/`no-access`/`sign-in` branches in `StateTransition` so session restoration resolves into the correct card instead of switching abruptly. Remove the duplicate `loginMark` style and `ActivityIndicator`/`Utensils` imports.

Set `RootStack.Navigator` to `screenOptions={{ headerShown: false, animation: 'none' }}` and retain the existing `ProfileStack` `animation: 'none'`; `StateTransition`/`ScreenEntrance` are the sole route-content motion, avoiding a native transition running on top of the selected 200 ms fade/rise and keeping web/iOS/Android timing consistent. Auth redirects, deep links, route names, role-based tab registration, and history reset behavior remain unchanged.

Do not alter screen business logic. Use existing TypeScript/React Native conventions. Do not add dependencies. Skip formatters, linters, and project-wide test suites. Run the narrowest relevant TypeScript validation available and report exact command/output.
