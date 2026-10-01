# Mobile UI 1:1 Implementation

## Scope

This change converts the mobile Staff and Kitchen actors to the preserved prototypes in `docs/System-design-UI/` without changing the server-authoritative meal, pickup, delegation, or serving workflows. Admin Web is outside this mobile scope.

## Mobile navigation

- Staff: `Dashboard | Calendar | Ticket | Profile`
- Staff + Kitchen: `Dashboard | Calendar | Ticket | Check-in | Profile`
- Kitchen-only: `Dashboard | Scanner | Profile`

Protected routes no longer receive access tokens or roles through navigation
parameters. `SessionProvider` restores the opaque session from secure storage
and fetches the current profile/permissions from `/auth/me`; cold deep links
redirect unauthenticated users to the allowlist-A email OTP screen.

## Implemented surfaces

- Employee dashboard: business-date greeting, authoritative daily lifecycle/menu/location summary and registration denominator; QR is shown only for an active registration whose server response allows opening it.
- Employee calendar: seven server-returned days (including weekends and disabled/unpublished days), monthly booking markers, authoritative per-day toggle/choice flags, draft batch save, per-date partial-success reconciliation, cutoff/delegation warnings and explicit refresh retry.
- Employee profile: identity, account metadata, preferences surface, delegation entry, logout.
- Kitchen profile: server-backed kitchen identity, language selection, persistence warning, logout confirmation; no Staff-only meal or delegation controls.
- Delegations: outgoing/incoming tabs, search, status pills, accept/decline/revoke actions.
- Kitchen dashboard: serving slider, compact non-mirrored 40/60 bento metrics on normal phones, stacked narrow/large-text fallback, polling, pull-to-refresh, search, registration tabs, logs.
- Kitchen scanner: centered transparent scan guide over the live camera preview with viewport scrim, camera permission state, QR resolve, explicit confirmation, proxy indicator, thirty-second pickup-session expiry, reduced-motion scan treatment.

## API details

The employee registration client uses the existing API controller paths:

- `GET /registrations/week?startDate=YYYY-MM-DD` returns exactly seven `days` with menu, registration, location, lunar date, choices, cutoff, delegation and authoritative action/reason fields. The client uses `serverNowAt` for business-date/week alignment and does not infer weekday availability.
- `PUT /registrations/batch` accepts only dirty date changes. The response is per-date: successful changes commit, failed changes remain in the draft, and all returned failure reasons are shown.

The mobile API base strips a trailing `/api` for registration, auth, and direct controller paths. Pickup and serving endpoints use the shared API origin. In Expo development, the host is derived from the Metro session as `http://<Metro-host>:3000/api`; every connected device uses that endpoint.
Serving authorization no longer depends on an internal LAN source IP; an active
opaque session with `kitchen.serve` permission is required.

## Run

Install dependencies with the repository's Yarn version:

```powershell
corepack enable
corepack prepare yarn@4.18.0 --activate
corepack yarn install --immutable
```

Create `apps/mobile/.env` only with the public API origins needed by the
selected target. Production authentication remains allowlist-A email OTP; do
not put provider keys, session secrets, identity-provider credentials or role
claims in a mobile variable:

```env
EXPO_PUBLIC_API_URL=https://<approved-api-origin>/api
EXPO_PACKAGER_PROXY_URL=https://<approved-metro-proxy>
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
corepack yarn workspace @imeal/mobile test
```

Expo web smoke coverage includes the employee dashboard and calendar against a local API fixture, including the seven-day surface, lifecycle-aware QR visibility, server cutoff states and draft save/reconciliation. Physical camera scanning, native-device session expiry and role-specific native flows still require a device with the API, OTP provider and approved role configuration.
