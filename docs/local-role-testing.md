# Local role and OTP testing (non-production only)

This guide is for automated tests and local development. It is **not** a
production authentication procedure. Production accepts only allowlist-A email
OTP and opaque PostgreSQL-backed sessions. There is no supported local
username/password, federated identity-provider, email-domain, manual-code,
client-role login path.

## 1. Safety boundary

- Never put real secrets, real employee data, real addresses, coordinates or
  roster assignments in this guide, `.env.example`, fixtures intended for
  source control, screenshots or test output.
- Local data must be synthetic and isolated from any production database.
- The only auth bypass is the test-harness pair below. It is rejected by
  production startup validation and must never be enabled in a deployed API,
  worker, mobile build or Admin Web session.
- The bypass is an automated/controller-test seam, not a user login method. It
  injects the synthetic principal used by API guard tests; role/permission
  guards also bypass only while that exact test flag is active.

## 2. Prerequisites

- Node.js `>=18`
- Corepack with Yarn `4.18.0`
- Docker Desktop with Linux containers for PostgreSQL-backed checks
- A disposable database/schema for DB or API e2e tests

Install without changing the lockfile:

```powershell
corepack enable
corepack prepare yarn@4.18.0 --activate
yarn install --immutable
```

For local infrastructure, copy `.env.example` to the ignored `.env`, replace
placeholders out of band, and start only synthetic/local services:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

The API startup validator requires the OTP/session/GPS/serving settings in every
non-test runtime; its HTTPS provider URL, API key and sender identity are
required only when `NODE_ENV=production`. The worker has a separate startup
validator: the encrypted delivery key is always required, while production
additionally requires database/provider settings, every `OTP_DELIVERY_*` value
and the fixed serving/QR/session values. Selected worker numeric/fixed defaults
are available outside production for unit tests. These validators are
intentionally not identical, and the API test-harness bypass does not make a
worker runtime safe to deploy.

## 3. Local synthetic seed

The `seed:local` command is for synthetic local/test data only. Run it only
against a disposable PostgreSQL database owned by the local environment. It
never runs against production, staging, preview, remote, or any other shared
database. The command requires all of these safety variables:

- `NODE_ENV=development` or `NODE_ENV=test` (the invocation below uses
  `test`);
- `IMEAL_LOCAL_SEED=1`;
- `IMEAL_LOCAL_SEED_CONFIRM=I_UNDERSTAND_LOCAL_ONLY`;
- `IMEAL_LOCAL_SEED_BASE_EMAIL`, a synthetic `.test` base email; and
- `DATABASE_URL`, which must be a PostgreSQL URL whose host is `localhost`,
  `127.0.0.1`, `::1`, or the local Compose service `db`.

Set `DATABASE_URL` in the ignored local `.env` or in the current PowerShell
session before running the exact invocation below. Do not put a shared,
staging, production, or real-data connection string in this guide.

```powershell
$env:NODE_ENV='test'
$env:IMEAL_LOCAL_SEED='1'
$env:IMEAL_LOCAL_SEED_CONFIRM='I_UNDERSTAND_LOCAL_ONLY'
$env:IMEAL_LOCAL_SEED_BASE_EMAIL='imeal.seed@example.test'
yarn workspace @imeal/core seed:local --dry-run
yarn workspace @imeal/core seed:local
```

The four synthetic locations are `LOCAL-A`, `LOCAL-B`, `LOCAL-C`, and
`LOCAL-D`; no other location values are created by this workflow.
The generated user addresses follow the base+-1..-49 convention: the base
address plus suffixes `-1` through `-49`.

The dry run validates the complete plan without writing. A write creates 50
synthetic users, exactly four synthetic locations (`LOCAL-A` through
`LOCAL-D`), 50 assignments, and the deterministic local role cohorts below.

| Cohort | Count | Roles | May own generated registrations |
| --- | ---: | --- | --- |
| Staff only | 36 | `staff` | Yes |
| Kitchen only | 6 | `kitchen` | No |
| Staff + Kitchen | 5 | `staff`, `kitchen` | Yes |
| Admin only | 2 | `admin` | No |
| Admin + Staff | 1 | `admin`, `staff` | Yes |
| **Total** | **50** |  | **42 owners** |

Kitchen-only users do not receive `staff`, and roles are never inferred from
email, client claims, or location data. The four location codes and all
assignments are synthetic test fixtures, not approved operational sites.
Real operational location data, coordinates, employee data, and roster
assignments are never stored in source control.

The seed is idempotent for the same base email, week, and serve date: reruns
converge on the same rows and do not grow counts. It has no reset, purge, or
delete mode; use a new disposable database (or a different synthetic
keyspace) when an isolated dataset is needed. Never point this workflow at a
database containing real operational data.

## 4. Test-harness bypass

Use this only for tests that explicitly need the guard seam:

```text
NODE_ENV=test
AUTH_MODE=otp
REQUIRE_AUTH=false
```

`REQUIRE_AUTH=false` is accepted only when `NODE_ENV=test`. Any other
combination, especially production, fails closed. Do not copy this block into a
runtime `.env` used by a long-lived API, worker, mobile app or Admin Web.
Typical scoped commands:

```powershell
yarn workspace @imeal/api exec vitest run src/config/environment.spec.ts
yarn workspace @imeal/api exec vitest run src/auth
yarn workspace @imeal/api exec vitest run src/pickup
yarn workspace @imeal/api exec vitest run src/admin
```

Tests that exercise real OTP/session persistence should set `REQUIRE_AUTH=true`,
provide synthetic allowlist rows and use an out-of-band disposable provider.
The provider payload may contain only the minimum verification copy and must not
be printed in test logs.

## 5. Synthetic role smoke matrix

Use test factories or an isolated seeded test schema to create synthetic users
with server-side assignments. Do not encode roles, employee codes, location
codes or account state in a token or request body.

| Principal | Expected local assertion |
| --- | --- |
| Synthetic Staff | Own registration/history/delegation APIs resolve from server state |
| Synthetic Kitchen | Resolve/confirm requires `kitchen.serve`; scanner sends QR only and no GPS |
| Synthetic Staff + Kitchen | Can use both surfaces only when both server assignments exist |
| Synthetic Admin | Can use explicitly permitted allowlist/location/roster/audit operations; cannot grant `admin` in Admin Web |
| Disabled synthetic user | Protected request resolves current status and is rejected; active sessions are revoked |
| Non-allowlisted/disabled email | OTP request response is indistinguishable and creates no session |

The guard bypass is useful for controller/permission tests, but it does not
prove OTP hashing, session revocation, roster assignment, GPS policy or serving
transaction behavior. Use focused service and DB suites for those contracts.

## 6. OTP/session checks

Verify the following with synthetic fixtures and a disposable provider/mock at
the final delivery boundary:

1. Allowlist-A emails receive a generic request response and an outbox record;
   unknown/disabled addresses receive the same response without an outbox row.
2. Only an OTP verifier/hash and expiry/attempt metadata are persisted. Clear
   OTP values never appear in logs or provider operator payloads beyond final
   delivery.
3. A valid OTP is single-use and creates only an opaque session token. The
   database stores its hash, not the token.
4. Logout, expiry, account disable, compromise, replay and explicit revocation
   invalidate the session; every request re-resolves current permissions.
5. Reusing a confirmation idempotency key with the same body returns the stored
   result; changing the intent/body returns a conflict.

## 7. Presenter GPS and Kitchen checks

- Presenter mobile captures a fresh **foreground** fix only during QR generate or
  refresh and stops collection on blur, completion, cancellation or unmount.
- GPS policy is resolved from the server-managed employee location. It cannot
  select a more permissive location or grant entitlement.
- Unavailable, denied, stale, inaccurate and outside-geofence results expose
  only `Retry` and `Refresh`; there is no manual fallback.
- Owner GPS is not collected for proxy pickup. Kitchen resolve receives only the
  QR; confirm receives only `pickupSessionId` and `idempotencyKey`.
- The exact sorted registration set is preserved through QR, resolve and the
  30-second session. Kitchen cannot add/remove items.
- Serving is only 10:30–13:30 in `Asia/Ho_Chi_Minh`; multi-item confirmation is
  all-or-nothing and idempotent; successful serving is final.

Focused checks:

```powershell
yarn workspace @imeal/contracts test
yarn workspace @imeal/api exec vitest run src/pickup src/admin
yarn workspace @imeal/worker exec vitest run src/otp-delivery-worker.service.spec.ts
yarn workspace @imeal/core test
```

## 8. Client environment names

Mobile reads only:

- `EXPO_PUBLIC_API_URL` for an explicit API origin (ending in `/api` where the
  app expects it).
- `EXPO_PACKAGER_PROXY_URL` only for a remote Metro development session.
- `EXPO_PUBLIC_EAS_PROJECT_ID` for push registration configuration.

Admin Web reads `VITE_API_URL`. Do not put API secrets, OTP/provider keys,
session secrets, location coordinates or role claims in any client variable.

## 9. Verification limitations

A local unit run does not prove live PostgreSQL, external OTP delivery, native
Expo permission/GPS behavior, device integrity or organization-approved roster
configuration. Before production, operators must import and approve exactly
four real locations plus the roster/allowlist outside source control, exercise
the provider and worker delivery path, and run the API/worker/domain e2e checks
against PostgreSQL. Record PostgreSQL/native runtime blockers exactly; do not
replace them with fabricated data or claim production readiness from this guide.
