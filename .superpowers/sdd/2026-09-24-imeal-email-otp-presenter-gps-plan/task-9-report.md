# Task 9 Report — mobile OTP, presenter GPS, exact pickup intent, and recovery

## Status

DONE_WITH_RUNTIME_LIMITATION — Task 9 mobile implementation is complete. Deterministic mobile unit tests, TypeScript, Expo web export, repository lint, build, and diff checks passed. A physical Expo iOS/Android runtime was not available in this workspace, so native permission prompts and device GPS hardware were not exercised.

## Scope implemented

- Added `authAPI` strict OTP request/verify/logout wrappers and authenticated `/auth/me` session bootstrap. OTP request responses are parsed as the non-enumerating `{ accepted: true, retryAfterSeconds? }` contract; cleartext OTP/session values are never logged or rendered.
- Replaced mobile local username/password sign-in with `EmailOtpScreen` and opaque session persistence through `SessionProvider`/Expo SecureStore (web local storage only for the web target). Verification bootstraps the server-resolved profile before navigation.
- Added `locationAPI` foreground Expo Location capture. It requests permission just in time, waits for one schema-validated high-accuracy fix, and removes the watch on evidence, error, blur, cancellation, completion, or unmount. No background watcher or owner GPS path exists.
- Updated `pickupAPI` with strict response parsing and exact authenticated wrappers:
  - `generateQr(token, { registrationIds, presenterEvidence })` sorts and validates explicit IDs.
  - `resolvePickup(token, { qr })` sends only the QR payload.
  - `confirmPickup(token, { pickupSessionId, idempotencyKey })` sends only session/idempotency fields and validates the all-or-nothing result.
- Updated `PickupIntentScreen` to auto-select only one eligible option; multiple options start unselected and require explicit selection. It sorts IDs, clears QR on selection/eligibility/focus/evidence changes, captures fresh presenter evidence before initial generation and every refresh, and stops collection on blur/cancel/completion/unmount.
- GPS unavailable/denied/stale/inaccurate failures expose only Retry (on the QR failure state) and Refresh options; there is no manual bypass, alternate site, or silent item substitution. Delegated items still collect only the authenticated presenter’s evidence.
- Updated `KitchenScannerScreen` to use QR-only resolve and session/idempotency-only confirm. Kitchen never sends GPS/evidence. Confirmation reuses a generated idempotency key for exact retries.
- Added Vietnamese/English OTP privacy, foreground GPS purpose/retention, selection, and safe recovery copy. Added Expo Location `~17.0.1` and its foreground permission configuration; no operational location data was added.
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
- `apps/mobile/package.json`
- `apps/mobile/src/api/authAPI.ts`
- `apps/mobile/src/api/authAPI.test.ts`
- `apps/mobile/src/api/locationAPI.ts`
- `apps/mobile/src/api/mobileApiError.ts`
- `apps/mobile/src/api/pickupAPI.ts`
- `apps/mobile/src/api/pickupAPI.test.ts`
- `apps/mobile/src/auth/session.tsx`
- `apps/mobile/src/i18n/translations.ts`
- `apps/mobile/src/screens/auth/EmailOtpScreen.tsx`
- `apps/mobile/src/screens/kitchen/KitchenScannerScreen.tsx`
- `apps/mobile/src/screens/pickup/PickupIntentScreen.tsx`
- `apps/mobile/src/screens/pickup/PickupIntentScreen.test.tsx`
- `apps/mobile/src/screens/pickup/pickupIntentRules.ts`
- `yarn.lock`

No Admin Web Task 10, docs Task 11, or fabricated operational location/roster data was added.
