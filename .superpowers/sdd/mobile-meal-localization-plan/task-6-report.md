# Task 6 — Mobile localization/font/error foundation report

## Status

Complete for the current mobile foundation. The mobile app now has a singleton flat-key Vietnamese/English catalog, persisted language state, static Be Vietnam Pro font bootstrap, and typed API error propagation without changing calendar mutation semantics or discarding successful HTTP-200 per-date failures.

## Behavior delivered

- Added the exact direct dependencies `i18n-js@4.5.3`, `expo-font@~12.0.10`, and `@expo-google-fonts/be-vietnam-pro@0.4.1`; no `expo-localization` dependency was added.
- Added flat `vi`/`en` dictionaries with compile-time key parity, Vietnamese default locale, disabled fallback, regional-locale normalization, interpolation, and flat-key plural selection.
- Added web `localStorage` and native `expo-secure-store` language persistence under `imeal.ui.language`; invalid values are deleted and treated as the Vietnamese default.
- Added `LanguageProvider`/`useLanguage` with synchronous locale/state updates, persistence after the update, restoration gating before navigation renders, and no language clearing during logout.
- Added the required root nesting `SafeAreaProvider → LanguageProvider → SessionProvider → NoticeProvider → NavigationContainer` and a no-partial-app font gate. The four static Be Vietnam Pro weights are loaded exactly through `useFonts`; font failure renders an inline system-font close/reopen message.
- Updated mobile typography to explicit static families (`regular`, `medium`, `semiBold`, `bold`, `fontMono`) and removed synthetic `fontWeight` declarations across the mobile UI styles.
- Added `MobileApiError` with the shared registration/pickup failure-code union, localized message-key mapping, preserved `cause`, transport/HTTP/JSON/shape error conversion, and localized operation fallbacks for unknown failures.
- Updated registration, serving, pickup, delegation, and kitchen adapters to retain typed response contracts and reject malformed responses as typed errors. Successful batch registration responses still return per-date failures for calendar code-based handling.
- Updated calendar, pickup, scanner, delegation, kitchen dashboard, and auth branches to use typed error codes/localized messages. Scanner expiry now branches on `PICKUP_SESSION_EXPIRED`, not raw server text.

## Focused test evidence

### RED

Foundation tests were first run before implementation and failed with missing i18n/storage/error modules. API behavior tests were then run against the pre-typed adapters and showed the expected four typed-contract failures while the HTTP-200 per-date behavior test passed.

### GREEN

```text
corepack yarn workspace @imeal/mobile exec vitest run src/i18n/translations.test.ts src/i18n/languageStorage.test.ts src/api/mobileApiError.test.ts src/api/registrationAPI.test.ts src/api/servingAPI.test.ts src/api/pickupAPI.test.ts src/api/requestWithTimeout.test.ts src/screens/employee/calendarRegistrationState.test.ts src/screens/employee/calendarGrid.test.ts
```

Passed: 9 test files, 21 tests.

### Scoped typecheck

```text
corepack yarn workspace @imeal/mobile exec tsc --noEmit --pretty false
```

Passed with no output.

## Files changed

- `apps/mobile/package.json`
- `yarn.lock`
- `apps/mobile/App.tsx`
- `apps/mobile/src/theme.ts`
- `apps/mobile/src/i18n/translations.ts`
- `apps/mobile/src/i18n/translations.test.ts`
- `apps/mobile/src/i18n/languageStorage.ts`
- `apps/mobile/src/i18n/languageStorage.test.ts`
- `apps/mobile/src/i18n/LanguageProvider.tsx`
- `apps/mobile/src/api/mobileApiError.ts`
- `apps/mobile/src/api/mobileApiError.test.ts`
- `apps/mobile/src/api/registrationAPI.ts`
- `apps/mobile/src/api/registrationAPI.test.ts`
- `apps/mobile/src/api/servingAPI.ts`
- `apps/mobile/src/api/servingAPI.test.ts`
- `apps/mobile/src/api/pickupAPI.ts`
- `apps/mobile/src/api/pickupAPI.test.ts`
- `apps/mobile/src/api/delegationAPI.ts`
- `apps/mobile/src/api/kitchenAPI.ts`
- `apps/mobile/src/auth/session.tsx`
- `apps/mobile/src/screens/employee/EmployeeCalendarScreen.tsx`
- `apps/mobile/src/screens/employee/EmployeeDashboardScreen.tsx`
- `apps/mobile/src/screens/employee/EmployeeProfileScreen.tsx`
- `apps/mobile/src/screens/delegation/DelegationScreen.tsx`
- `apps/mobile/src/screens/pickup/PickupIntentScreen.tsx`
- `apps/mobile/src/screens/kitchen/KitchenDashboardScreen.tsx`
- `apps/mobile/src/screens/kitchen/KitchenScannerScreen.tsx`
- `apps/mobile/src/ui/BrandMotion.tsx`
- `apps/mobile/src/ui/BrandNotice.tsx`
- `apps/mobile/src/ui/PrototypePrimitives.tsx`
- `apps/mobile/src/ui/PrototypeShell.tsx`

## Concerns

- Task 7 still needs to replace the remaining client-owned English screen/navigation/accessibility literals with catalog keys and add the language switcher/persistence-failure notice.
- No native/web runtime mount or visual smoke test was run; the brief explicitly defers runtime mount verification and prohibits project-wide validation for this task.
- Project-wide validation remains the main agent's responsibility.
