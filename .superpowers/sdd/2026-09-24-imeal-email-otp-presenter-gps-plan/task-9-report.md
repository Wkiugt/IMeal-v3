# Task 9 Report — mobile OTP, presenter GPS, exact pickup intent, and recovery

## Status

DONE_WITH_RUNTIME_LIMITATION — Task 9 mobile implementation and review-fix round are complete. Deterministic mobile unit tests, TypeScript, Expo web export, repository lint, build, and diff checks passed. A physical Expo iOS/Android runtime was not available in this workspace, so native permission prompts and device GPS hardware were not exercised.

## Scope implemented

- Added `authAPI` strict OTP request/verify/logout wrappers and authenticated `/auth/me` session bootstrap. OTP request responses are parsed as the non-enumerating `{ accepted: true, retryAfterSeconds? }` contract; cleartext OTP/session values are never logged or rendered, and the OTP TextField uses `secureTextEntry`.
- Replaced mobile local username/password sign-in with `EmailOtpScreen` and opaque session persistence through `SessionProvider`/Expo SecureStore (web local storage only for the web target). Verification bootstraps the server-resolved profile before navigation.
- Added `locationAPI` foreground Expo Location capture. It requests permission just in time, waits for one schema-validated high-accuracy fix, removes the watch on evidence/error, and rejects pending captures with a cancellation error on blur, cancellation, or unmount. UI cancellation is quiet.
- Updated `pickupAPI` with strict response parsing and exact authenticated wrappers:
  - `generateQr(token, { registrationIds, presenterEvidence })` sorts and validates explicit IDs.
  - `resolvePickup(token, { qr })` sends only the QR payload.
- `confirmPickup(token, { pickupSessionId, idempotencyKey })` sends only session/idempotency fields and validates the all-or-nothing result (`servedCount === servings.length`).
- Generate-QR responses are strict-checked for canonical sorted unique registration IDs matching the requested exact set before a QR is exposed.
- Updated `PickupIntentScreen` to auto-select only one eligible option on initial load; multiple options start unselected and require explicit selection. It sorts IDs, clears QR on selection/eligibility/focus and synchronously before every fresh evidence capture, uses generation/identity-safe capture cleanup, recovers loading state when selection becomes empty, and stops collection on blur/cancel/completion/unmount.
- GPS unavailable/denied/stale/inaccurate failures expose only Retry (on the QR failure state) and Refresh options; there is no manual bypass, alternate site, or silent item substitution. Delegated items still collect only the authenticated presenter’s evidence.
- Updated `KitchenScannerScreen` to use QR-only resolve and session/idempotency-only confirm. Kitchen never sends GPS/evidence. Confirmation preserves the resolved session and idempotency key after response loss and retries the identical request; only explicit new scan or completed serving resets them.
- Updated SessionProvider storage boundaries so SecureStore/localStorage read, write, and delete failures cannot strand restoration or mask auth errors. Restored authenticated profiles with no mobile role now receive the no-access/logout branch.
- Updated Vietnamese/English OTP privacy, foreground GPS purpose/retention, selection, and safe recovery copy. Added Expo Location `~17.0.1` with foreground-only permission configuration (`locationWhenInUsePermission`); no operational location data was added.
- Added Task 9 brief and ledger entries. No Admin Web Task 10 or docs Task 11 production changes were made.

## TDD / verification

### RED

- Added exact pickup transport and intent-rule tests before implementation. The initial run failed because `generateQr` still accepted a bare ID array, `resolvePickup`/`confirmPickup` did not exist, malformed QR responses were accepted, and the new auth/screen modules were absent.

### GREEN

- `corepack yarn workspace @imeal/mobile exec vitest run src/api/pickupAPI.test.ts src/api/authAPI.test.ts src/screens/pickup/PickupIntentScreen.test.tsx` — **3 files, 14 tests passed**.
- `corepack yarn workspace @imeal/mobile test` — **20 files, 72 tests passed**.
- `corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json` — passed.
- `corepack yarn workspace @imeal/mobile exec expo export --platform web` — passed; Metro bundled the mobile app and exported the web bundle. This validates the JS/config path, not native GPS hardware.
- `corepack yarn lint` — passed with the repository’s existing API warnings (9 warnings, 0 errors); no mobile lint script is defined in the mobile package.
- `corepack yarn build` — passed for the repository’s configured build workspaces. Mobile has no Turbo `build` script, so the Expo web export is the mobile build smoke check.
- `git diff --check` — passed; only Git’s existing LF/CRLF conversion warnings were reported.
- Task 9 files were formatted with Prettier.

## Runtime limitation

No physical/native Expo runtime was available for this session. Native permission prompt behavior, GPS hardware accuracy, and Android/iOS config-plugin installation should be exercised on a device/emulator before release. The implementation uses deterministic `watchPositionAsync`/permission boundaries and strict contract parsing so those boundaries can be mocked in a native test harness; no fallback or fabricated location data was introduced.

## Files changed

- `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/task-9-brief.md`
- `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/task-9-report.md`
- `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/progress.md`
- `apps/mobile/App.tsx`
- `apps/mobile/app.config.ts`
- `apps/mobile/src/app.config.test.ts`
- `apps/mobile/package.json`
- `apps/mobile/src/api/authAPI.ts`
- `apps/mobile/src/api/authAPI.test.ts`
- `apps/mobile/src/api/locationAPI.ts`
- `apps/mobile/src/api/locationAPI.test.ts`
- `apps/mobile/src/api/mobileApiError.ts`
- `apps/mobile/src/api/pickupAPI.ts`
- `apps/mobile/src/api/pickupAPI.test.ts`
- `apps/mobile/src/auth/sessionStorage.ts`
- `apps/mobile/src/auth/sessionStorage.test.ts`
- `apps/mobile/src/auth/session.tsx`
- `apps/mobile/src/i18n/translations.ts`
- `apps/mobile/src/screens/auth/EmailOtpScreen.tsx`
- `apps/mobile/src/screens/auth/EmailOtpScreen.test.tsx`
- `apps/mobile/src/screens/auth/otpInputRules.ts`
- `apps/mobile/src/screens/kitchen/KitchenScannerScreen.tsx`
- `apps/mobile/src/screens/kitchen/kitchenScannerRules.ts`
- `apps/mobile/src/screens/kitchen/kitchenScannerRules.test.ts`
- `apps/mobile/src/screens/pickup/PickupIntentScreen.tsx`
- `apps/mobile/src/screens/pickup/PickupIntentScreen.test.tsx`
- `apps/mobile/src/screens/pickup/pickupIntentRules.ts`
- `yarn.lock`

No Admin Web Task 10, docs Task 11, or fabricated operational location/roster data was added.

## Review fix round

- Kitchen confirmation now keeps the resolved `pickupSessionId` and generated `idempotencyKey` through response loss and retry, while explicit cancel/new scan and completed serving remain the only reset paths.
- Presenter QR generation now invalidates the visible QR synchronously before every fresh evidence capture; stale generations cannot stop a newer foreground watcher, cancellation rejects pending capture promises quietly, and an invalidated selection cannot silently substitute a new sole option.
- Strict client parsing rejects non-canonical/mismatched QR registration IDs and any confirmation where `servedCount !== servings.length`.
- Auth restoration catches SecureStore/localStorage read/write/delete failures, always exits `isRestoring`, and surfaces a safe auth error; roleless authenticated profiles retain the no-access/logout branch.
- OTP input masking and foreground-only Expo location permission configuration are asserted by deterministic tests.
- Focused review-fix run — **7 files, 26 tests passed**.
- Full mobile run — **25 files, 87 tests passed**.
- Mobile TypeScript, Expo web export, root lint (9 existing API warnings, 0 errors), configured root build (4 successful tasks), and diff-check passed. Native GPS/permission runtime remains unavailable in this workspace.

## Review fix round 2

- Kitchen Scanner now disables Cancel/Scan Again while confirmation is in flight and guards resolve/confirm continuations with a scan-operation generation. A stale response/rejection after cancel, navigation, or a newer scan cannot clear newer state, feedback, loading, or idempotency data.
- Focused race-fix run — **7 files, 28 tests passed**.
- Full mobile run — **25 files, 89 tests passed**.
- Mobile TypeScript passed; prior Expo web export, root lint/build, and committed-range diff-check remain green. Native GPS/permission runtime remains unavailable in this workspace.
