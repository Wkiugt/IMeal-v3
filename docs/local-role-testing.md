# Local Role Testing Guide

This guide covers local testing for the `staff`, `kitchen`, and `admin` roles without Microsoft Entra authentication.

## 1. Prerequisites

- Node.js 20+
- Corepack enabled
- Docker Desktop running with Linux containers
- A phone on the same LAN as the development machine for physical mobile testing

Install dependencies from the repository root:

```powershell
corepack yarn install
```

The local credentials are stored in the ignored root `.env` file. Do not commit `.env` or copy its passwords into documentation.

Configured usernames:

| Role    | Usernames                | Surface              |
| ------- | ------------------------ | -------------------- |
| Staff   | `staff01` … `staff05`    | Mobile employee flow |
| Kitchen | `kitchen01`, `kitchen02` | Mobile kitchen flow  |
| Admin   | `admin01`                | Admin Web            |

## 2. Start PostgreSQL, PgBouncer, MinIO, and migrations

Start the dependencies and apply Prisma migrations:

```powershell
docker compose up -d db pgbouncer minio minio-create-bucket migrate
```

Check service status:

```powershell
docker compose ps
```

The API local configuration uses:

```text
AUTH_MODE=local
REQUIRE_AUTH=true
```

A successful local login lazily upserts the configured user and its role into PostgreSQL. No separate user seed command is required.

## 3. Start the API

Run the API from the repository root:

```powershell
corepack yarn workspace @imeal/api start:dev
```

Expected health response:

```powershell
curl.exe http://localhost:3000/health
```

Expected status: `200`.

The API reads the root `.env` because the API start scripts load `../../.env`.

## 4. Verify authentication with curl

Use the password for the selected user from `.env`.

### Login

```powershell
$body = @{ username = "staff01"; password = "<password-from-.env>" } | ConvertTo-Json
$login = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/auth/local-login `
  -ContentType "application/json" `
  -Body $body

$token = $login.accessToken
$login.user
```

Expected profile properties:

```text
roles contains staff
permissions is an array
```

### Read the current profile

```powershell
Invoke-RestMethod `
  -Uri http://localhost:3000/auth/me `
  -Headers @{ Authorization = "Bearer $token" }
```

### Negative checks

Missing or invalid credentials must return `401`:

```powershell
$body = @{ username = "staff01"; password = "wrong-password" } | ConvertTo-Json
Invoke-WebRequest `
  -Method Post `
  -Uri http://localhost:3000/auth/local-login `
  -ContentType "application/json" `
  -Body $body `
  -SkipHttpErrorCheck
```

Calling a protected endpoint without a Bearer token must also return `401`.

## 5. Test the mobile app

Use one of these connectivity modes. Start the API first; it listens on `0.0.0.0:3000`.

### Android Emulator or Android over USB

Install Expo Go SDK 51 from [expo.dev/go](https://expo.dev/go); the current store build may only support the latest SDK. With one ADB target, run:

```powershell
corepack yarn workspace @imeal/mobile android:local
```

The script reverses Metro `8081` and API `3000` through ADB, then runs Expo with `--localhost`. Requirements: `adb` on `PATH`, one connected target, and Expo Go SDK 51.

For multiple targets, choose a serial and reverse ports explicitly:

```powershell
adb devices
adb -s <serial> reverse tcp:8081 tcp:8081
adb -s <serial> reverse tcp:3000 tcp:3000
corepack yarn workspace @imeal/mobile start --localhost
```

Select the target that was reversed from the Expo terminal. Verify with:

```powershell
adb -s <serial> reverse --list
```

The app should load its bundle and call `http://127.0.0.1:3000/api` through the reverse.

### Android phone on the same LAN

Expo SDK 51 on Windows can advertise the wrong Metro URL, `exp://127.0.0.1:8081`, because its older `internal-ip`/`default-gateway` path expects WMIC, which may be missing. The phone cannot fetch Metro and Expo Go shows `Something went wrong`.

Install Expo Go SDK 51 from [expo.dev/go](https://expo.dev/go). Keep `EXPO_PUBLIC_API_URL` empty, ensure the API binds to `0.0.0.0:3000`, allow inbound TCP `3000` and `8081` in Windows Firewall, and run the normal command:

```powershell
corepack yarn workspace @imeal/mobile start:lan
```

The root Node launcher used by `start:lan` selects the LAN IPv4 and sets `REACT_NATIVE_PACKAGER_HOSTNAME=<LAN-IP>`, which fixes the advertised host. Expo output must show `exp://<LAN-IP>:8081`, never `exp://127.0.0.1:8081`; stop and rerun if it shows the loopback address.

If the launcher reports multiple candidate IPv4 addresses, list Windows IPv4 addresses and select the address for the active LAN:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' } |
  Format-Table InterfaceAlias, IPAddress
$env:IMEAL_LAN_HOST = "<LAN IPv4>"
corepack yarn workspace @imeal/mobile start:lan
```

Do not use ngrok or cloudflared for LAN mode.

### Android phone outside the LAN

Remote mode uses two independent user-owned endpoints:

- ngrok v3 for the API on port `3000`; its URL ends with `/api`.
- A public HTTP/WebSocket proxy for Metro on port `8081`; Cloudflare Quick Tunnel is the documented fallback.

Start a temporary LAN Metro session, create both endpoints, and keep both tunnels alive:

```powershell
ngrok http 3000
corepack yarn workspace @imeal/mobile start:lan
cloudflared tunnel --url http://localhost:8081
```

Set the resulting origins in the ignored root `.env`:

```dotenv
EXPO_PUBLIC_API_URL=https://<api-id>.ngrok-free.app/api
EXPO_PACKAGER_PROXY_URL=https://<metro-id>.trycloudflare.com
```

Stop the temporary Metro session, then restart it with:

```powershell
corepack yarn workspace @imeal/mobile start:remote
```

The API ngrok URL and Metro proxy URL are different endpoints. Restart `start:remote` whenever either URL changes. Cloudflare Quick Tunnel is for Metro only; do not use it for the API because kitchen realtime requires SSE. If `cloudflared` is unavailable, use another user-owned public HTTP/WebSocket reverse proxy to `localhost:8081`.

Never use Expo's built-in tunnel mode or restore its removed tunnel dependency. `Cannot read properties of undefined (reading 'body')` identifies the Expo shared-tunnel failure, not an API ngrok outage.

For web, Android, or iOS targets, use the corresponding Expo command:

```powershell
corepack yarn workspace @imeal/mobile web
corepack yarn workspace @imeal/mobile android
corepack yarn workspace @imeal/mobile ios
```

Set `EXPO_PUBLIC_API_URL` only for production, remote mode, a reverse proxy, or a non-default API port.

### Staff checklist

For each staff account, use the mobile login form:

1. Login with `staff01` … `staff05`.
2. Confirm navigation to the employee dashboard.
3. Open the calendar and registration flow.
4. Register one meal day.
5. Reload the screen and confirm the registration remains active.
6. Logout and login with another staff account.
7. Confirm the second account does not see the first account's personal data.

### Kitchen checklist

For `kitchen01` and `kitchen02`:

1. Login with the selected kitchen account.
2. Confirm navigation to the kitchen dashboard.
3. Open the scanner screen.
4. Load the dashboard snapshot for today's date.
5. Toggle the serving-ready signal.
6. Confirm the signal and dashboard counters update.
7. Logout and repeat with the second kitchen account.

A kitchen account is not automatically a staff account. If a kitchen user must also register personal meals, the database role assignment must explicitly include `staff` as well.

## 6. Test the Admin Web dashboard

Start the Vite development server:

```powershell
$env:VITE_API_URL = "http://localhost:3000"
corepack yarn workspace @imeal/admin-web dev --host 0.0.0.0
```

Open:

```text
http://localhost:5173
```

Use `admin01` and its password from `.env`.

### Admin checklist

1. Confirm the local username/password form is shown.
2. Login as `admin01`.
3. Confirm the weekly menu view loads.
4. Confirm the penalties view is accessible.
5. Update a menu field and verify the server response.
6. Resolve or waive a penalty only when test data exists.
7. Logout and confirm the login form returns.
8. Refresh after login and confirm the session is restored from `sessionStorage`.

The Admin Web uses API URL `http://localhost:3000` and does not require any `VITE_ENTRA_*` variables in local mode.

## 7. API role smoke matrix

| Check                              | Staff |                          Kitchen |                                Admin |
| ---------------------------------- | ----: | -------------------------------: | -----------------------------------: |
| `POST /auth/local-login`           |   Yes |                              Yes |                                  Yes |
| `GET /auth/me`                     |   Yes |                              Yes |                                  Yes |
| Employee registration flow         |   Yes | No, unless also assigned `staff` |                                   No |
| Kitchen dashboard and serving flow |    No |                              Yes | Only with `kitchen.serve` permission |

Serving authorization no longer depends on an internal LAN source IP; a valid bearer token with `kitchen.serve` permission is required.

| Weekly menu administration | No | Yes, according to current migration permissions | Yes |
| Penalty administration | No | No | Yes |

The source of truth for role permissions is the canonical role/permission migration under `packages/domain/prisma/migrations/`.

## 8. Stop the local stack

Stop containers while preserving volumes:

```powershell
docker compose stop
```

Remove containers but preserve database data:

```powershell
docker compose down
```

Remove containers and local database/MinIO volumes:

```powershell
docker compose down -v
```

Use `down -v` only when intentionally resetting local test data.

## 9. Automated checks

Run the API tests:

```powershell
corepack yarn workspace @imeal/api test
```

Run all workspace typechecks:

```powershell
corepack yarn typecheck
```

Build API and Admin Web:

```powershell
corepack yarn workspace @imeal/api build
corepack yarn workspace @imeal/admin-web build
```

## 10. Troubleshooting

### Docker engine unavailable

Start Docker Desktop and verify:

```powershell
docker version
docker compose ps
```

### API returns database errors

Run migrations again:

```powershell
docker compose up -d migrate
```

Then restart the API.

### Mobile phone cannot reach the API

- Run `corepack yarn workspace @imeal/mobile start:lan`; do not use `start --lan`.
- Keep `EXPO_PUBLIC_API_URL` empty. The launcher sets `REACT_NATIVE_PACKAGER_HOSTNAME`; Expo output must show `exp://<LAN-IP>:8081`, not `exp://127.0.0.1:8081`.
- If the launcher reports multiple candidate IPv4 addresses, set `IMEAL_LAN_HOST` to the active LAN IPv4 before rerunning.
- Confirm the phone and development machine share a LAN, Windows Firewall allows inbound TCP `3000` and `8081`, and the API listens on `0.0.0.0:3000`.
- Do not use ngrok or cloudflared for LAN mode.

### Login returns `401`

- Confirm `AUTH_MODE=local` in `.env`.
- Confirm the username exactly matches one entry in `LOCAL_AUTH_USERS`.
- Confirm the password is copied from `.env`.
- Restart the API after changing `.env`.

### Entra variables are requested

The API is not in local mode. Set:

```text
AUTH_MODE=local
```

Then restart the API, mobile app, and Admin Web dev servers.
