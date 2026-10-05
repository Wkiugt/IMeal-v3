# Mobile Expo SDK 57 implementation and verification

Date: 2026-10-04

Scope: mobile manifest, shared lockfile mobile resolution, source/config compatibility, CI mobile smoke, and final dependency-security lock evidence. The final lock also contains two explicitly documented same-major security resolutions and the worker's official Nest 12.1.2 upload adapter patch. Native-device execution was not performed.

## Installed SDK 57 target

The mobile workspace is now aligned to Expo's SDK 57 bundled versions using Corepack Yarn `4.18.0`, `npx expo install --fix`, and the exact target supplied by the SDK 57 release metadata:

- `expo@~57.0.26`
- React `19.2.3`, React DOM `19.2.3`, React Native `0.86.3`
- `@expo/metro-runtime~57.0.16`
- `expo-blur~57.0.3`
- `expo-camera~57.0.6`
- `expo-constants~57.0.20`
- `expo-crypto~57.0.3`
- `expo-device~57.0.2`
- `expo-font~57.0.4`
- `expo-linking~57.0.11`
- `expo-location~57.0.20`
- `expo-notifications~57.0.21`
- `expo-secure-store~57.0.4`
- `expo-status-bar~57.0.1`
- `react-native-web^0.21.2`
- `react-native-screens~4.26.0`
- `react-native-safe-area-context~5.7.0`
- `react-native-svg15.15.4`
- `@types/react~19.2.4`
- TypeScript `~6.0.3`
- `react-test-renderer19.2.3` and `@types/react-test-renderer19.1.0`

React Navigation was upgraded together to the stable 7 line:

- `@react-navigation/native^7.5.0`
- `@react-navigation/bottom-tabs^7.20.0`
- `@react-navigation/native-stack^7.20.0`

The existing `@expo-google-fonts/be-vietnam-pro`, `i18n-js`, `lucide-react-native`, `react-native-qrcode-svg`, and `zod` dependencies were retained. No speculative third-party replacement was made.

## Source/config compatibility changes

### Metro monorepo configuration

`apps/mobile/metro.config.js` exports only `getDefaultConfig(__dirname)`, following Expo's SDK 52+ monorepo guidance. The built bundles below resolve `@imeal/contracts` after explicit `@imeal/core` and `@imeal/contracts` workspace builds.

### Expo config plugins

`apps/mobile/app.config.ts` retains the existing notifications, camera, and location plugins and now also declares the official `expo-font`, `expo-secure-store`, and `expo-status-bar` plugins. `npx expo config --type public` resolved SDK `57.0.0`, all six plugins, the configured camera/location permission strings, and the expected Android camera/location permissions.

### Notifications

`NotificationProvider` now supplies SDK 57's `shouldShowBanner`, `shouldShowList`, `shouldPlaySound`, and `shouldSetBadge` fields only. The SDK 51-only `shouldShowAlert` field was removed at the dependency cutover.

### React Navigation

`AppTabsNavigator` in `apps/mobile/App.tsx` previously set `unmountOnBlur: false`. React Navigation 7 no longer exposes that option; its default retains tab screens mounted, so removing the unsupported option preserves the existing lifecycle behavior. No screen-level null/render boundary or state-reset workaround was introduced.

### React Native 0.86 and React 19 typing/API fixes

- Replaced removed `StyleSheet.absoluteFillObject` usages with `StyleSheet.absoluteFill` or explicit absolute-edge styles in the camera, profile, app-shell, and controls surfaces.
- Updated `TextField` focus/blur handlers to use the installed `TextInputProps` handler types.
- Narrowed React 19 test-renderer element props through a named test prop shape; no `any`, suppression, `skipLibCheck`, or strictness weakening was added.
- Updated the LAN launcher tests' environment fixture type to make Expo's required `NODE_ENV` declaration optional for test-only partial environments.
- The obsolete React Native Screens v3 compatibility shim remains removed from `apps/mobile/index.js`.

## Verification evidence

All commands below were run from `apps/mobile` unless noted:

```text
Corepack Yarn: 4.18.0
Node: v24.18.1
Expo CLI: 57.0.27
Installed Expo package: 57.0.26
```

- `npx expo install --check`: `Dependencies are up to date`.
- `npx --yes expo-doctor@1.20.4`: `21/21 checks passed. No issues detected!`
- `npx expo config --type public`: SDK `57.0.0`, expected plugins and permissions resolved.
- `corepack yarn exec tsc --noEmit -p tsconfig.json`: passed.
- `corepack yarn test`: 28 test files passed, 158 tests passed (post-review cleanup; the pre-cleanup checkpoint recorded 160 tests).
- `corepack yarn workspace @imeal/core build`: passed.
- `corepack yarn workspace @imeal/contracts build`: passed.
- `corepack yarn install --immutable` from the repository root: completed under Yarn `4.18.0`; only existing peer-dependency warnings were reported.

The real cache-clearing Metro command was exercised:

```text
corepack yarn exec expo start --clear --localhost
```

After the core/contracts builds, Android, iOS, and web AppEntry bundles were fetched successfully from Metro. Each request completed with `curl --fail`; no source-marker assertion or permanent wiring test is used.

```text
android: 9,639,875 bytes
ios:     9,631,761 bytes
web:     7,586,814 bytes
```

The CI workflow now runs `npx expo install --check`, pinned `npx --yes expo-doctor@1.20.4`, explicit core/contracts builds, and this non-native Metro bundle smoke without mutating the immutable lockfile.

### Actual Expo Web runtime smoke

The unauthenticated web surface was exercised with a cleared Metro cache rather than only fetching a headless bundle:

```text
Command:
  corepack yarn workspace @imeal/mobile exec expo start --web --port 8087 --clear
Browser:
  installed Google Chrome headless, Chrome DevTools Protocol on 127.0.0.1:9222
Route/title:
  http://127.0.0.1:8087/auth / Auth
Screenshot:
  C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-expo-web-smoke-input.png
```

The reviewed screenshot is 24,432 bytes with SHA-256 `1939ff1710dd6aa80f236b5e479ff7dc4b616bdecfff41fb91ac6b7292de7b8b`.

The rendered DOM reached `readyState=complete` and showed the Vietnamese unauthenticated login surface: `Chào mừng`, work-email OTP explanation, an `input[type=email]` with `aria-label="Email"`, `Gửi mã`, and the expiry/no-sharing notice. A safe interaction focused the email field, set `smoke@example.invalid`, and dispatched only `input`/`change` events; the focused input and value were observed without submitting the form or requesting an OTP.

No runtime exceptions or console errors were observed. Development warnings were limited to React Native Web's deprecated `shadow*` style props, Expo Notifications' unsupported web push-token listener, and the native `useNativeDriver` fallback to a JS animation. This is web-runtime visual evidence only: no real credentials, OTP delivery/sign-in, authenticated session, native device, GPS, QR, or physical-device behavior was claimed.

## Final dependency-security lock

The root `package.json` documents only these exact vulnerable descriptor resolutions:

- `undici@npm:6.20.1` -> `6.28.1`, retained for `@nestjs/mau`'s exact dependency.
- `mysql2@npm:3.15.3` -> `3.23.1`, retained for Prisma 7.10.0's exact dependency.
- `deepmerge-ts@npm:7.1.5` -> `8.0.2`, validated against Prisma config consumers and the Prisma 7 CLI.
- `uuid@npm:^7.0.3` -> `11.1.1`, validated against Xcode 3.0.1's CommonJS `require('uuid').v4` usage.
- `tmp@npm:^0.0.33` -> `0.2.7`, validated through external-editor's temp create/read/unlink consumer smoke.

The worker uses official `@nestjs/platform-express^12.1.2`, whose peer range accepts the existing `@nestjs/common/core^12.0.1` and whose package metadata pins fixed `multer@2.4.0`. Contracts (43 tests), observability (76 tests), worker (175 tests), repository unit tests, mobile (158 tests), Expo Doctor (21/21), disposable-PostgreSQL Prisma validate/generate/migrate deploy/status, Xcode parse/write with UUID 11.1.1, and external-editor exact-input/temp-cleanup with tmp 0.2.7 all passed after the lock settled. `corepack yarn install --immutable` also passed.

The full `corepack yarn npm audit --all --recursive` was intentionally not green: only the two unfixed high advisories (`braces@3.0.3` and `node-forge@1.4.0`) plus deprecation findings remain. No audit finding was ignored or suppressed.

## Device acceptance boundary

The following physical-device QA remains required after native builds are available:

1. cold start
2. OTP login
3. session restore
4. notification permission + token
5. push
6. camera permission
7. QR scan
8. foreground location
9. GPS check-in
10. weekly registration
11. meal choice
12. self check-in
13. history
14. profile
15. inbox

No Android or iOS device execution claim is made. The verification above proves managed config, dependency alignment, TypeScript, tests, workspace resolution, and Metro graph bundling only.
