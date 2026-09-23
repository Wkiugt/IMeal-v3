# Mobile UI 1:1 Implementation

## Scope

This change converts the mobile Staff and Kitchen actors to the preserved prototypes in `docs/System-design-UI/` without changing the server-authoritative meal, pickup, delegation, or serving workflows. Admin Web is outside this mobile scope.

## Mobile navigation

- Staff: `Dashboard | Calendar | Ticket | Profile`
- Staff + Kitchen: `Dashboard | Calendar | Ticket | Check-in | Profile`
- Kitchen-only: `Dashboard | Scanner | Profile`

Protected routes no longer receive access tokens through navigation parameters. `SessionProvider` restores the Entra session and supplies the token/profile to mobile screens. Cold deep links redirect unauthenticated users to `Auth`.

## Implemented surfaces

- Employee dashboard: greeting, meal card, meal status, canteen location, ticket CTA.
- Employee calendar: monthly booking markers, weekly registration toggles, server partial-success handling, cutoff error rollback.
- Employee ticket: real pickup options, multi-selection, signed QR generation, five-second refresh/countdown, QR progress indicator.
- Employee profile: identity, account metadata, preferences surface, delegation entry, logout.
- Kitchen profile: server-backed kitchen identity, language selection, persistence warning, logout confirmation; no Staff-only meal or delegation controls.
- Delegations: outgoing/incoming tabs, search, status pills, accept/decline/revoke actions.
- Kitchen dashboard: serving slider, compact non-mirrored 40/60 bento metrics on normal phones, stacked narrow/large-text fallback, polling, pull-to-refresh, search, registration tabs, logs.
- Kitchen scanner: centered transparent scan guide over the live camera preview with viewport scrim, camera permission state, QR resolve, explicit confirmation, proxy indicator, thirty-second pickup-session expiry, reduced-motion scan treatment.

## API details

The employee registration client uses the existing API controller paths:

- `GET /registrations/week?startDate=YYYY-MM-DD`
- `PUT /registrations/batch`

The mobile API base strips a trailing `/api` for registration, auth, and direct controller paths. Pickup and serving endpoints use the shared API origin. In Expo development, the host is derived from the Metro session as `http://<Metro-host>:3000/api`; every connected device uses that endpoint.
Serving authorization no longer depends on an internal LAN source IP; a valid bearer token with `kitchen.serve` permission is required.

## Run

Install dependencies with the repository's Yarn version:

```powershell
corepack enable
corepack prepare yarn@4.18.0 --activate
corepack yarn install --immutable
```

Create `apps/mobile/.env` only with the Entra values needed by the selected auth configuration:

```env
EXPO_PUBLIC_ENTRA_TENANT_ID=...
EXPO_PUBLIC_ENTRA_CLIENT_ID=...
EXPO_PUBLIC_ENTRA_API_SCOPE=...
```

Run local Expo targets without setting an API IP value:

```powershell
corepack yarn workspace @imeal/mobile web
corepack yarn workspace @imeal/mobile android
corepack yarn workspace @imeal/mobile ios
corepack yarn workspace @imeal/mobile start:lan
```

The phone and development machine must be on the same LAN. The API listens on `0.0.0.0:3000`; allow inbound TCP port `3000` and Metro port `8081` in the firewall.

`EXPO_PUBLIC_API_URL` is required for production and is an optional exact override for an Expo tunnel, reverse proxy, or non-default API port. For a reverse proxy, set it to the operator-provided API URL reachable by every target device.

## Verification

Validated during implementation:

```text
corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json
```

Expo web smoke coverage included the login surface, protected cold deep links, employee dashboard/calendar/ticket/profile/delegations, kitchen dashboard, scanner permission state, 1440px desktop framing, and 360px/390px mobile layouts. Physical camera scanning and native-device session expiry still require a device with the API and Entra environment configured.
