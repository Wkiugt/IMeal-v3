# Mobile UI 1:1 Implementation

## Scope

This note records an earlier mobile UI pass. It is not the current contract
where it describes a Kitchen employee scanner, Staff-generated pickup QR,
active delegation, or proxy pickup. The current flow is: Kitchen publishes the
menu, Staff registers, Kitchen displays one shared daily/location QR, Staff
scans that QR and sends fresh foreground GPS, the server resolves only that
Staff user's own registration, Staff confirms, and confirm creates exactly one
`MealServing`.

## Mobile navigation

- Staff: Dashboard, Calendar, self check-in, Notifications, Profile.
- Kitchen-only: Dashboard, shared QR, Profile. There is no Kitchen scanner tab.
- Staff + Kitchen uses the Staff navigation; Kitchen does not gain an employee scanner.

Protected routes no longer receive access tokens or roles through navigation
parameters. `SessionProvider` restores the opaque session from secure storage
and fetches the current profile/permissions from `/auth/me`; cold deep links
redirect unauthenticated users to the allowlist-A email OTP screen.

## Implemented surfaces

- Employee dashboard and calendar remain registration surfaces. They do not
  generate an employee QR for Kitchen to scan.
- Employee profile links to Meal History and Penalty list/detail. Those screens
  are not missing. There is no active delegation entry.
- Kitchen profile is identity/settings/logout. Kitchen displays the shared QR
  and does not scan employees.
- Delegation Create/Search and proxy pickup are not current surfaces.


## API details

The employee registration client uses the existing API controller paths:

- `GET /registrations/week?startDate=YYYY-MM-DD` returns the week days with menu, registration, location, cutoff, and authoritative action fields. Delegation is not an active check-in field. The client uses `serverNowAt` for business-date/week alignment and does not infer weekday availability.
- `PUT /registrations/batch` accepts only dirty date changes. The response is per-date: successful changes commit, failed changes remain in the draft, and all returned failure reasons are shown.

The mobile API base is `EXPO_PUBLIC_API_URL`, which the client expects to end in `/api`. Staff check-in calls that base; Kitchen does not resolve or confirm employees. `kitchen.serve` authorizes the shared QR and aggregate dashboard only.

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
