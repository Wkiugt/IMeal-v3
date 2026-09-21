# Task 10 — Final review fix wave

## Status

Completed both final review findings in one focused fix wave.

## Changes

- `QrRefreshIndicator` now resolves its progressbar accessibility countdown through `useLanguage` and the existing localized `pickup.expires` interpolation key. The public props, fixed-height layout, numeric progress values, and visual label remain unchanged.
- `KitchenProfileScreen` now follows the focused profile treatment used by `EmployeeProfileScreen`: `AppFrame`, `SectionHeader`, `IdentityCard`, `StatisticsCard`, a token-backed `Surface`, `Divider`, `AppText`, accessible language radio options, and the shared critical `ActionButton`.
- Kitchen profile statistics remain honest `—` values because the profile flow has no validated kitchen metrics. The kitchen role identity, language persistence/error notice, logout confirmation, and route behavior remain unchanged.

## Focused checks

- Passed focused TypeScript proof with no diagnostics:
  `corepack yarn exec tsc --noEmit --jsx react-native --moduleResolution bundler --module ESNext --target ESNext --strict --skipLibCheck src/ui/components/QrTicket.tsx src/screens/kitchen/KitchenProfileScreen.tsx src/i18n/translations.ts`
- Static inspection confirmed `QrTicket.tsx` no longer contains the hard-coded `seconds remaining` accessibility phrase and uses `pickup.expires` from `useLanguage`.
- Static inspection confirmed `KitchenProfileScreen.tsx` uses the shared profile primitives, accessible radio states, token-backed visual values, and no raw `Text` profile styling.
- No automated test suites or formatters were run, per request.

## Concerns

- Full repository validation and native/device smoke checks were intentionally not rerun in this focused review-fix wave.
- The pre-existing user-owned `docker-compose.yml` modification remains outside this fix wave and must stay uncommitted.
