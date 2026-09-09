# Task 3 Report — Centralize mobile endpoint resolution

## Status

Completed.

## Changes

- Added the direct Expo SDK-matched dependency `expo-constants: "~16.0.2"` to `apps/mobile/package.json`.
- Synchronized `yarn.lock` through Corepack Yarn 4.18.0.
- Added `apps/mobile/src/api/apiConfig.ts` as the only mobile API-origin resolver in this task.
- Exported exactly `API_BASE: string` and `API_ROOT: string`.
- Implemented resolution precedence:
  - Trimmed, trailing-slash-stripped `EXPO_PUBLIC_API_URL` override first.
  - Development Metro host discovery through `Constants.expoConfig?.hostUri` with `http://` parsing, port `3000`, and IPv6 bracket preservation.
  - Expo web `globalThis.location.hostname` fallback when Metro host data is unavailable.
  - Development localhost fallback.
  - Exact production error: `EXPO_PUBLIC_API_URL is required outside Expo development.`
- Did not modify `apps/mobile/package-lock.json`.
- Did not migrate API callers; that is covered by the subsequent migration task.

## Verification

1. `corepack yarn --version`
   - Output: `4.18.0`
2. `corepack yarn workspace @imeal/mobile add expo-constants@~16.0.2`
   - Output: completed successfully with the existing peer-dependency warning (`YN0086`).
3. `corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json`
   - Output: no errors.
4. `corepack yarn install --immutable`
   - Output: completed successfully with the existing peer-dependency warning (`YN0086`).
5. Resolver smoke check using the transpiled module with mocked Expo constants:
   - Explicit override normalization passed: `https://example.test/api///` -> `https://example.test/api`.
   - Metro host passed: `192.168.0.10:8081` -> `http://192.168.0.10:3000/api`.
   - IPv6 host passed: `[::1]:8081` -> `http://[::1]:3000/api`.
   - Malformed Metro host to web hostname fallback passed.
   - Development localhost fallback passed.
   - Production missing-override error matched exactly.
6. `git diff --quiet -- apps/mobile/package-lock.json`
   - Output: clean; no obsolete package-lock changes.

## Commit

- `2ed27ad feat(mobile): centralize Expo API endpoint resolution`

## Concerns

- Yarn reports the repository's pre-existing peer-dependency warning (`YN0086`); dependency installation and immutable lock verification still completed successfully.
- API caller migration remains intentionally deferred to the next task.
