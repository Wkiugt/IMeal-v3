# Mobile release

Operator notes for Expo/EAS builds of `apps/mobile`. This repository change
does not provision an EAS project, signing keys, or a store listing, and it
does not record a signed store build.

## Identifiers

- Android package and iOS bundle identifier: `vn.iec.imeal`.
- URL scheme: `imeal` for development and production. Do not add a second scheme.
- Marketing version: `1.0.0` until a release intentionally changes it in
  `apps/mobile/app.config.ts`. Do not bump it only to look newer.
- Android `versionCode`: `major * 10000 + minor * 100 + patch`
  (`1.0.0` → `10000`). Minor and patch must be `0`–`99` so codes stay unique.
  The result is never `0`. Override with `IMEAL_ANDROID_VERSION_CODE`, a
  positive integer.
- iOS `buildNumber`: the app version string, or `IMEAL_IOS_BUILD_NUMBER`.
- `apps/mobile/eas.json` sets `cli.appVersionSource` to `local` and
  `autoIncrement` to `false`. EAS uses these explicit values and does not
  increment them remotely.

## Environment variables

Set release values in the EAS environment for the profile. Do not commit them,
and do not put `EXPO_PUBLIC_API_URL` in `eas.json`.

Production config evaluation fails closed when `EAS_BUILD_PROFILE=production`
or `IMEAL_MOBILE_RELEASE=production` unless both of these are set:

- `EXPO_PUBLIC_EAS_PROJECT_ID`: the EAS project id provisioned in Expo. This
  document does not contain a real project id.
- `EXPO_PUBLIC_API_URL`: a public HTTPS API base ending in `/api`. The mobile
  client uses that value as `API_BASE` and appends paths such as
  `/me/check-in`. The API serves those routes under `/api`. Trailing slashes
  are ignored, matching the client. Empty values, non-HTTPS URLs, URLs that do
  not end in `/api`, localhost, `127.0.0.1`, `::1`, private LAN addresses
  (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, link-local), and ngrok
  hosts are rejected.

Development and preview do not become production when those values are missing.
Local `expo start` can still run without them.

The preview profile has no localhost fallback. Its API URL comes from the EAS
`preview` environment. Do not assign the production API URL to the development
EAS environment.

Optional, non-secret overrides:

- `IMEAL_ANDROID_VERSION_CODE`
- `IMEAL_IOS_BUILD_NUMBER`
- `IMEAL_MOBILE_RELEASE` is set by the build profile to `development`,
  `preview`, or `production`.

## Profiles

Defined in `apps/mobile/eas.json`.

- `development`: internal non-store build, not a development client.
  `developmentClient` is false. Channel `development`, EAS environment
  `development`, and `IMEAL_MOBILE_RELEASE=development`. Android uses an APK.
  It is not the production API.
- `preview`: internal distribution, channel `preview` (the staging/preview
  channel), EAS environment `preview`. Android uses an APK so the internal
  install link is installable. The API URL comes from the EAS environment, not
  from a committed localhost fallback.
- `production`: store distribution, channel `production`,
  `autoIncrement: false`.

Signing uses `credentialsSource: remote`. Keystores, provisioning profiles,
`credentials.json`, and EAS tokens stay in EAS, not in git.
`apps/mobile/.gitignore` ignores the local credential filenames Expo would
write.

Each profile uses Node `24.18.1`, Corepack, and Yarn `4.18.0` because the
workspace requires Node 24 and Yarn 4.18.0. The default SDK 57 image is
Node 22 and Yarn 1.

## Commands

Run these from `apps/mobile`, where `eas.json` lives. Authenticate with the
Expo account that owns the project. Do not commit the token.

```text
eas build --profile development --platform android
eas build --profile preview --platform all
eas build --profile production --platform all
```

These are the operator commands. Running them is not claimed here, and a
successful future build is still not a signed store submission unless the
store credentials and submission are done separately in EAS.

## Permissions

- Camera: scan meal check-in QR codes. Audio recording stays off.
- Location: foreground only, to verify the meal check-in location. Background
  location stays off (`locationAlways` and
  `isAndroidBackgroundLocationEnabled` are false).
- Notifications: `expo-notifications` stays enabled. Android 13+
  `POST_NOTIFICATIONS` is declared in the Expo config and merged from the
  expo-notifications library manifest. Background remote notifications stay
  off.
- `expo-secure-store` stays for session storage.

Expo Go from SDK 53 does not support Android remote push notifications. A local
Expo Go bundle remains usable for flows that do not require push, but push-token
registration must be tested with a native development build, for example:

```text
eas build --profile development --platform android
```

## What this does not do

No real EAS project id, keystore, provisioning profile, or store submission is
included. API, identity, and device UAT readiness remain separate gates.
