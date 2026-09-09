# Supplemental verification fix — root safe-area provider

Runtime reproduction on the current Expo web build: navigating from the authenticated employee dashboard to `/pickup` renders a blank page and emits `Error: No safe area value available. Make sure you are rendering <SafeAreaProvider> at the top of your app.` The existing `PrototypeFrame` and global BrandNotice overlay both import `SafeAreaView` from `react-native-safe-area-context`, while `App.tsx` has no provider.

Add the existing `SafeAreaProvider` to `apps/mobile/App.tsx` as the smallest root-cause fix. Keep it above the existing `SessionProvider`/`NoticeProvider`/`NavigationContainer` hierarchy, preserving NoticeProvider above NavigationContainer and all existing route/auth/navigation behavior. Do not change screen logic or motion behavior. Use the installed `react-native-safe-area-context` dependency; do not add dependencies.

After implementation, run `corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json` and perform an Expo web smoke check that authenticated Dashboard → Calendar → Ticket renders without the missing-safe-area error. Write exact commands/output and runtime observations to `.superpowers/sdd/mobile-loading-transitions-plan/task-5-report.md`. Skip formatters, linters, and project-wide test suites.
