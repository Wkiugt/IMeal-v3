# imeal-v3

IMeal là monorepo Yarn Workspaces + Turborepo cho hệ thống đăng ký, quản lý và giao suất ăn nội bộ.

## Yêu cầu

- Node.js `>=18` (khuyến nghị Node.js 20)
- Corepack, Yarn `4.18.0`
- Docker Desktop + Docker Compose v2
- Expo/Android Studio nếu chạy mobile native
- [ngrok](https://ngrok.com/download) nếu cần truy cập API từ Internet hoặc thiết bị ngoài LAN

Mọi lệnh chạy từ thư mục gốc repository.

## Mục lục

- [Yêu cầu](#yêu-cầu)
- [Setup nhanh](#setup-nhanh)
  - [Seed synthetic local/dev/test/UAT](#seed-synthetic-localdevtestuat)
- [Deploy production](#deploy-production)
- [Các lệnh run](#các-lệnh-run)
- [Dùng ngrok](#dùng-ngrok)
- [Docker và kiểm tra](#docker-và-kiểm-tra)
- [Tài liệu](#tài-liệu)

## Setup nhanh

### 1. Cài dependency và tạo `.env`

PowerShell:

```powershell
corepack enable
corepack prepare yarn@4.18.0 --activate
corepack yarn install --immutable
Copy-Item .env.example .env
```

macOS/Linux:

```bash
corepack enable
corepack prepare yarn@4.18.0 --activate
corepack yarn install --immutable
cp .env.example .env
```

Production và mọi môi trường chạy API/worker dùng **allowlist-A email OTP** và
opaque PostgreSQL-backed sessions. Copy `.env.example`, sau đó thay toàn bộ
placeholder bằng secret/provider configuration được cấp ngoài source control;
không dùng local auth mode, username/password hoặc sample accounts:

```dotenv
AUTH_MODE=otp
REQUIRE_AUTH=true
DATABASE_URL=postgresql://CHANGE_ME_LOCAL:CHANGE_ME_LOCAL@localhost:6432/imeal?schema=public&pgbouncer=true
QR_SIGNING_SECRET=<chuỗi-ngẫu-nhiên-it-nhat-32-ky-tu>
OTP_HASH_SECRET=<chuỗi-ngẫu-nhiên-it-nhat-32-ky-tu>
OTP_DELIVERY_ENCRYPTION_KEY=<chuỗi-ngẫu-nhiên-it-nhat-32-ky-tu>
OTP_PROVIDER_URL=<https-provider-url>
OTP_PROVIDER_API_KEY=<provider-secret>
OTP_PROVIDER_FROM=<approved-sender-identity>
```

Test harness mới được phép dùng bypass đúng cặp `NODE_ENV=test` và
`REQUIRE_AUTH=false`; bypass này không phải login method và bị production
startup validation từ chối. Repository không chứa account, employee, roster,
location hoặc coordinate data mẫu.

### 2. Khởi động database và migration

```powershell
corepack yarn workspace @imeal/core prisma generate
corepack yarn workspace @imeal/contracts build
docker compose up -d db pgbouncer minio minio-create-bucket migrate
docker compose wait migrate
docker compose ps --all
```

`migrate` phải có trạng thái `Exited (0)`.

### Seed synthetic local/dev/test/UAT

Workflow này **chỉ dành cho local/dev/test/UAT**, tuyệt đối không dùng cho production. Không có dữ liệu employee, location hoặc coordinate thực nào trong source control; seed chỉ tạo fixture tổng hợp và credentials phải ở `.env` đã ignore hoặc shell hiện tại, không bao giờ được in ra.

Khởi động một database/schema disposable cho local rồi chạy migration (không dùng database dùng chung):

```powershell
docker compose up -d db pgbouncer minio minio-create-bucket migrate
docker compose wait migrate
```

Trong **cùng shell hiện tại**, đặt các biến bắt buộc sau. `DATABASE_URL` chỉ là placeholder local tổng hợp; thay bằng connection string disposable local của bạn, không dùng credential/secret thật trong README:

```powershell
$env:NODE_ENV='test' # hoặc 'development'
$env:IMEAL_LOCAL_SEED='1'
$env:IMEAL_LOCAL_SEED_CONFIRM='I_UNDERSTAND_LOCAL_ONLY'
$env:IMEAL_LOCAL_SEED_BASE_EMAIL='imeal.seed@example.test'
$env:DATABASE_URL='postgresql://LOCAL_USER:LOCAL_PASSWORD@localhost:5432/imeal_local?schema=public'
```

Chạy đúng các lệnh CLI:

```powershell
corepack yarn workspace @imeal/core seed:local --help
corepack yarn workspace @imeal/core seed:local --dry-run
corepack yarn workspace @imeal/core seed:local
```

Seed tạo 50 email tổng hợp (email base và `-1`..`-49`), các cohort/role: 36 `staff` only, 6 `kitchen` only, 5 `staff` + `kitchen`, 2 `admin` only và 1 `admin` + `staff`; bốn location tổng hợp `LOCAL-A`..`LOCAL-D`, assignment, menu, 126 registration cùng lịch sử serving, delegation và penalty. Với cùng base email, tuần và database, lần chạy đầu tiên đã quan sát trong local smoke summary `created=589 updated=0 unchanged=0`; chạy lại y hệt cho `created=0 updated=0 unchanged=589`. Đây chỉ là hành vi smoke local đã quan sát, không phải bảo đảm production.

`--dry-run` kiểm tra safety và toàn bộ plan nhưng không ghi database. Thiếu/sai biến safety, `NODE_ENV` khác `test`/`development`, database host không local, production marker, database/schema không disposable hoặc xung đột unique đều phải fail closed. Không có chế độ reset/purge/delete. Base email hoặc tuần khác cần database/schema disposable riêng; cùng database sẽ xung đột và fail closed.

Kiểm tra sau seed:

```powershell
corepack yarn workspace @imeal/core test:unit
$env:DATABASE_URL='postgresql://LOCAL_USER:LOCAL_PASSWORD@localhost:5432/imeal_local?schema=public'
corepack yarn test:db
corepack yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json
```

Xem thêm [hướng dẫn local role testing](./docs/local-role-testing.md) và [thiết kế local synthetic seed](./docs/superpowers/specs/2026-09-24-imeal-local-seed-design.md).

### 3. Chạy API

Mở terminal mới:

```powershell
corepack yarn workspace @imeal/api start:dev
```

API chạy tại `http://localhost:3000`. Kiểm tra:

```powershell
curl.exe http://localhost:3000/health
```

## Các lệnh run

Chạy mỗi lệnh trong một terminal riêng. API phải chạy trước các chế độ mobile:

| Thành phần       | Lệnh                                                                                      | URL/Ghi chú                                     |
| ---------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- |
| API              | `corepack yarn workspace @imeal/api start:dev`                                            | `http://localhost:3000`                         |
| Admin Web        | `$env:VITE_API_URL='http://localhost:3000'; corepack yarn workspace @imeal/admin-web dev` | `http://localhost:5173`                         |
| Mobile web       | `corepack yarn workspace @imeal/mobile web`                                               | Expo web                                        |
| Android local    | `corepack yarn workspace @imeal/mobile android:local`                                     | Emulator hoặc Android cắm USB; cần `adb`        |
| Android Emulator | `corepack yarn workspace @imeal/mobile android`                                           | Cần AVD đang chạy                               |
| iOS Simulator    | `corepack yarn workspace @imeal/mobile ios`                                               | Chỉ macOS + Xcode                               |
| Mobile LAN       | `corepack yarn workspace @imeal/mobile start:lan`                                         | Điện thoại và máy cùng LAN                      |
| Mobile remote    | `corepack yarn workspace @imeal/mobile start:remote`                                      | Cần `EXPO_PACKAGER_PROXY_URL` và API public URL |
| Worker           | `corepack yarn workspace @imeal/worker start:dev`                                         | Cần `DATABASE_URL` trong terminal               |

API bind trên `0.0.0.0:3000`, nên có thể dùng từ browser và thiết bị trong LAN. Mobile LAN tự suy ra `http://<Metro-host>:3000/api`; không cần `EXPO_PUBLIC_API_URL` cho local/LAN.

### Android Emulator hoặc Android cắm USB

Với một target ADB duy nhất, khởi động API rồi chạy:

```powershell
corepack yarn workspace @imeal/mobile android:local
```

Lệnh này reverse Metro `8081` và API `3000` qua ADB rồi chạy Expo với `--localhost`. Yêu cầu `adb` trong `PATH`, Expo Go SDK 51 và chỉ một target đang kết nối.

Nếu có nhiều target, chọn serial trước rồi chạy các lệnh reverse thủ công:

```powershell
adb devices
adb -s <serial> reverse tcp:8081 tcp:8081
adb -s <serial> reverse tcp:3000 tcp:3000
corepack yarn workspace @imeal/mobile start --localhost
```

Chọn target đã reverse từ terminal Expo.

### Điện thoại Android cùng LAN

Điện thoại và máy Windows phải ở cùng một LAN. API phải bind trên `0.0.0.0:3000`; cài đúng Expo Go SDK 51, cho phép inbound TCP `3000` và `8081` trong Windows Firewall, và để trống `EXPO_PUBLIC_API_URL`. Chế độ LAN không dùng ngrok hoặc cloudflared.

Lệnh chuẩn và duy nhất cho flow này là:

```powershell
corepack yarn workspace @imeal/mobile start:lan
```

Không dùng `corepack yarn workspace @imeal/mobile start --lan` cho điện thoại vật lý. Launcher `start:lan` tự chọn địa chỉ LAN và đặt `REACT_NATIVE_PACKAGER_HOSTNAME` để Expo quảng bá đúng host. Trước khi quét QR, output Expo phải có:

```text
Metro waiting on exp://<LAN-IP>:8081
```

`<LAN-IP>` là IPv4 của máy Windows trên LAN đang dùng. `exp://127.0.0.1:8081` là sai đối với điện thoại vật lý; điện thoại sẽ không truy cập được Metro.

Thông thường không cần đặt `IMEAL_LAN_HOST`. Chỉ đặt biến này khi launcher báo có nhiều IPv4 ứng viên (ví dụ Wi-Fi, VPN, Tailscale hoặc Hyper-V). Khi đó, xem danh sách địa chỉ và chọn IPv4 của interface LAN hiện tại:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' } |
  Format-Table InterfaceAlias, IPAddress
$env:IMEAL_LAN_HOST = '<LAN IPv4>'
corepack yarn workspace @imeal/mobile start:lan
```

### Smoke test thủ công Android LAN

Flow này cần allowlist-A emails, role/location/roster assignments và OTP
provider configuration được provisioned ngoài repository; không có account mẫu:

1. Staff request OTP bằng email allowlist-A và verify code nhận qua provider.
2. Tạo đăng ký và mở QR pickup intent.
3. Logout; Kitchen request/verify OTP bằng email đã được cấp
   `kitchen.serve`.
4. Mở scanner và cấp quyền camera khi được hỏi.
5. Quét QR nhận suất của Staff.
6. Kiểm tra presenter, danh sách pickup intent và pickup session trong review.
7. Xác nhận serving và kiểm tra trạng thái thành công.

Không dùng username/password, local credentials hoặc client-supplied role để
thay thế flow trên. Với test tự động không có provider, xem
`docs/local-role-testing.md` và chỉ dùng test harness bypass được mô tả ở đó.

### Khắc phục nhanh Android LAN

- **`Something went wrong`:** kiểm tra output có `Metro waiting on exp://<LAN-IP>:8081`, điện thoại và máy ở cùng LAN, Expo Go SDK 51 và Firewall đã mở TCP `3000`/`8081`. Dừng Metro bằng `Ctrl+C`, rồi chạy lại `start:lan`.
- **QR có host sai:** nếu QR là `exp://127.0.0.1:8081` hoặc IPv4 không thuộc LAN đang dùng, dừng Metro và chạy lại lệnh chuẩn. Chỉ khi launcher báo nhiều ứng viên mới đặt `IMEAL_LAN_HOST` theo hướng dẫn trên.
- **Không kết nối được API:** bảo đảm API đang chạy, `EXPO_PUBLIC_API_URL` để trống, kiểm tra `curl.exe http://localhost:3000/health`, rồi kiểm tra Firewall TCP `3000` và cùng LAN trước khi chạy lại `start:lan`.
- **Metro cũ hoặc port `8081` bị chiếm:** dừng terminal Metro bằng `Ctrl+C`. Nếu vẫn còn listener, xem process và dừng đúng PID của Metro:

  ```powershell
  Get-NetTCPConnection -LocalPort 8081 -State Listen |
    Select-Object OwningProcess
  Stop-Process -Id <PID>
  ```

  Sau đó chạy lại `corepack yarn workspace @imeal/mobile start:lan`.

### Điện thoại ngoài LAN

Chế độ remote cần hai endpoint độc lập: ngrok v3 do người dùng sở hữu cho API và một proxy Metro public trỏ tới port `8081`. Không dùng chế độ tunnel tích hợp của Expo.

1. Cài và xác thực ngrok v3:

   ```powershell
   winget install Ngrok.Ngrok
   ngrok config add-authtoken <NGROK_AUTHTOKEN>
   ```

2. Khởi động API và Metro LAN tạm thời:

   ```powershell
   ngrok http 3000
   corepack yarn workspace @imeal/mobile start:lan
   ```

3. Trong terminal khác, tạo proxy Metro bằng Cloudflare Quick Tunnel:

   ```powershell
   cloudflared tunnel --url http://localhost:8081
   ```

4. Ghi hai URL vào `.env` gốc, không commit giá trị thật:

   ```dotenv
   EXPO_PUBLIC_API_URL=https://<api-id>.ngrok-free.app/api
   EXPO_PACKAGER_PROXY_URL=https://<metro-id>.trycloudflare.com
   ```

   Dừng Metro LAN tạm thời sau khi proxy đã có origin, rồi khởi động lại:

   ```powershell
   corepack yarn workspace @imeal/mobile start:remote
   ```

Giữ cả hai tunnel sống suốt session và restart `start:remote` khi URL thay đổi. Cloudflare Quick Tunnel chỉ dùng cho Metro; không dùng cho API vì IMeal kitchen realtime dùng SSE. Nếu không dùng được `cloudflared`, thay bằng public HTTP/WebSocket reverse proxy do người dùng sở hữu trỏ tới `localhost:8081`.

Với Expo SDK 51, Android device/emulator phải cài đúng Expo Go SDK 51 từ [expo.dev/go](https://expo.dev/go); store build hiện tại có thể chỉ hỗ trợ SDK mới nhất. Không trộn nâng cấp Expo vào networking fix này.

Lỗi `Cannot read properties of undefined (reading 'body')` là lỗi Expo shared tunnel, không chứng minh API ngrok bị down. Khi API ngrok đổi URL, cập nhật `.env` và restart Metro.

### Chạy worker trên host

PowerShell:

```powershell
$env:DATABASE_URL='postgresql://CHANGE_ME_LOCAL:CHANGE_ME_LOCAL@localhost:6432/imeal?schema=public&pgbouncer=true'
$env:PORT='3001'
corepack yarn workspace @imeal/worker start:dev
```

macOS/Linux:

```bash
export DATABASE_URL='postgresql://CHANGE_ME_LOCAL:CHANGE_ME_LOCAL@localhost:6432/imeal?schema=public&pgbouncer=true'
export PORT=3001
corepack yarn workspace @imeal/worker start:dev
```

## Dùng ngrok

Ngrok chỉ public API đang chạy trên host; Metro remote dùng proxy riêng như phần trên.

```powershell
ngrok http 3000
```

URL API phải có suffix `/api`:

```text
https://xxxx.ngrok-free.app/api
```

Không đặt authtoken, URL tunnel đang hoạt động, password hoặc secret vào file tracked.

### Admin Web qua ngrok

```powershell
$env:VITE_API_URL='https://xxxx.ngrok-free.app'
corepack yarn workspace @imeal/admin-web dev
```

Không commit `.env`, token ngrok, password hoặc secret.

## Deploy production

Phần này dành cho môi trường production thật, **không phải** cách chạy local ở
[Setup nhanh](#setup-nhanh). Compose và Caddy hiện tại chưa được harden cho
public exposure; phải có production override/configuration đã được review trước
khi mở Internet. Repository không có một deploy script chuyên dụng.

### Phạm vi và topology

```text
Mobile / Admin Web / Kitchen
          │ HTTPS
          ▼
Reverse proxy (TLS, rate limit) ──► API
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
              PostgreSQL          OTP provider       Object storage
              / PgBouncer

Worker ──► PostgreSQL / PgBouncer, OTP provider, object storage
       └─► scheduled jobs (OTP delivery, serving/no-show và các job định kỳ)
```

Chỉ reverse proxy nhận traffic public. API và worker dùng PostgreSQL/PgBouncer,
OTP provider và object storage qua network private hoặc egress policy đã duyệt;
worker chạy các scheduled jobs và không được public trực tiếp.

### Điều kiện trước khi deploy

- Linux LTS và Docker Compose v2; nếu build trên host thì cài Node.js `>=18`,
  Corepack và Yarn `4.18.0`.
- Khuyến nghị tối thiểu **4 vCPU, 8 GB RAM, 100 GB disk**, tăng theo tải,
  retention và dung lượng object storage.
- Domain/DNS do tổ chức sở hữu, certificate/TLS hợp lệ và nơi lưu backup riêng.
- Outbound HTTPS tới OTP, push và image providers; xác nhận allowlist/network
  policy không chặn các endpoint này.
- Centralized logging, monitoring và alerting đã có owner/on-call; phân công
  owner cho allowlist-A, roles/permissions, roster và locations.
- Chốt trước owner, RPO và RTO; không go-live nếu chưa có kế hoạch khôi phục
  được diễn tập.

### Secrets và cấu hình

`.env.example` chỉ được dùng như **checklist tên biến**. Có thể copy nó để rà
soát biến còn thiếu, nhưng phải provision giá trị production out-of-band (secret
manager hoặc cơ chế triển khai được kiểm soát), không commit file runtime và
không bao giờ dùng lại `CHANGE_ME_LOCAL`.

Các cài đặt bắt buộc cần rà soát/provision gồm:

- `NODE_ENV=production`, `AUTH_MODE=otp`, `REQUIRE_AUTH=true`.
- PostgreSQL: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
  `DATABASE_URL`; PgBouncer phải dùng credential production.
- Object storage: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`,
  `MINIO_BUCKET_NAME` và access policy private/least-privilege.
- `QR_SIGNING_SECRET`, `OTP_HASH_SECRET`, `OTP_DELIVERY_ENCRYPTION_KEY`,
  `SESSION_HASH_SECRET` (secret ngẫu nhiên đủ mạnh, không ghi vào README).
- `OTP_PROVIDER_URL`, `OTP_PROVIDER_API_KEY`, `OTP_PROVIDER_FROM` cùng các
  expiry/rate-limit/retry/batch/claim-timeout settings của API và worker.
- `GPS_DEFAULT_GEOFENCE_RADIUS_METERS`,
  `GPS_DEFAULT_MAX_FIX_AGE_SECONDS`, `GPS_DEFAULT_MAX_ACCURACY_METERS` theo
  policy đã duyệt; tọa độ thật chỉ được import qua operation được ủy quyền.
- Các giá trị business cố định phải đúng và sẽ được startup/config validation
  kiểm tra: `SERVING_TIME_ZONE=Asia/Ho_Chi_Minh`,
  `SERVING_WINDOW_START=10:30`, `SERVING_WINDOW_END=13:30`,
  `NO_SHOW_PROCESSING_TIME=13:45`, `QR_TTL_SECONDS=5`,
  `QR_CLOCK_SKEW_SECONDS=2`, `PICKUP_SESSION_TTL_SECONDS=30`.

Không đặt secret, PII, email thật hoặc tọa độ thật trong README. Mobile và
Admin client chỉ nhận public API URL; tuyệt đối không đưa database, OTP,
object-storage, session hoặc provider secret vào client.

### Quy trình triển khai

Staging qualification và production deployment là hai gate khác nhau. Quy trình
operator canonical nằm trong [staging readiness runbook](docs/runbooks/staging-readiness.md);
runbook này dùng đúng các wrapper/CLI, staging Compose override, protected CI
workflow và artifact names đã có trong repository. Không ghi secret, PII,
domain thật hoặc credential vào command/evidence.

Local repository tooling can be checked without staging credentials:

```bash
yarn test:staging-tools
node --test scripts/staging/compose-config.test.mjs
```

These checks are implementation evidence only. Current release status remains
**CONDITIONAL / NO-GO** until an approved staging target, backup/restore,
DNS/TLS, OTP provider path, WAF/rate-limit control, alert delivery, UAT,
identity approval, and four-location/roster approval exist.

On an approved Linux staging or production host, after the reviewed
environment file and external gates are complete, the checked-in service names
are:

```bash
corepack yarn install --immutable
corepack yarn build

docker compose build
docker compose up -d db pgbouncer minio minio-create-bucket migrate
docker compose wait migrate
docker compose ps --all
```

`migrate` **bắt buộc** phải hiển thị `Exited (0)`. If migration status,
target fingerprint, Phase 0 preflight, approval, backfill, post-validation,
backup/restore, or security gates fail, stop and preserve redacted evidence.
Do not infer a production gate from disposable local tests.

After migration reaches the reviewed gate:

```bash
docker compose up -d api worker admin-web caddy
docker compose ps --all
docker compose exec api wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health
```

The commands above describe existing Compose service names only; they do not
claim that the current base Compose file is production-hardened. The
production/staging override must pin every image, keep data services private,
configure TLS and security headers, and provide reviewed secrets and
trusted-proxy settings before public exposure. The protected staging workflow
instead uses `docker-compose.yml` plus `docker-compose.staging.yml`, validates
the rendered configuration, scans the exact digest refs before deployment,
waits for the migration gate, and runs runtime integration and token-backed
smoke.

### Provision dữ liệu và vận hành

- Provision **đúng bốn approved locations and policies**, allowlist-A users,
  roles/permissions and roster through an authorized server-side operation.
  Never use sample data as operational evidence.
- First Admin is a separately audited server-side operation; no client-supplied
  role or local credential is acceptable.
- Track API, worker, PostgreSQL, OTP, queue and backup health through the
  approved centralized observability path. The current repository has no
  actual hardening `/metrics` collectors/endpoints, so runtime integration
  fails closed until those endpoints and evidence exist.
- Keep PostgreSQL and object-storage backups separate, encrypted and
  access-controlled; perform and retain the restore rehearsal before pilot.
- Schema migration and rollback authority/window must be reviewed for the
  PostgreSQL v2 stack. The legacy Firebase path is not a rollback mechanism.

### Checklist bảo mật trước public exposure

- [ ] Private/firewalled DB, PgBouncer, MinIO and worker ports; expose only the
      reviewed edge.
- [ ] Replace current PostgreSQL/PgBouncer development authentication with the
      approved production policy.
- [ ] Make object storage private with least privilege.
- [ ] Configure an operator-owned domain, TLS certificate, HTTPS redirect,
      security headers and trusted-proxy handling; do not invent a domain here.
- [ ] Pin every image/version or digest and verify the exact release manifest.
- [ ] Enable the approved edge WAF/rate-limit control and verify client-IP
      handling, CORS and trusted proxy settings.
- [ ] Verify encrypted backups, restore rehearsal, secret rotation, alert
      delivery and named on-call ownership.

### Release gate

- [ ] Staging is rendered from `docker-compose.yml` and
      `docker-compose.staging.yml` with immutable image refs.
- [ ] Target fingerprint, migration status, Phase 0 preflight/approval/
      backfill/post-validation and restore evidence are PASS.
- [ ] Protected CI records exact deployed image scans, runtime integration and
      session-token smoke; missing hardening collectors fail closed.
- [ ] WAF/rate-limit, TLS/DNS, OTP delivery, alert route, UAT, identity,
      location and roster approvals are present.
- [ ] Evidence manifest, SHA-256 checksums and independent sign-off are
      complete; no P0 defect remains and rollback authority is named.

### Evidence and smoke verification

The staging tooling and Compose boundary can be verified without credentials:

```bash
yarn test:staging-tools
node --test scripts/staging/compose-config.test.mjs
node --test scripts/staging/runbook-links.test.mjs
```

After an approved staging target exists, follow the [staging readiness
runbook](docs/runbooks/staging-readiness.md). Its smoke invocation reads the
session token by name:

```bash
yarn staging:smoke \
  --api-origin "$STAGING_API_ORIGIN" \
  --admin-origin "$STAGING_ADMIN_ORIGIN" \
  --session-token-env STAGING_SMOKE_SESSION_TOKEN \
  --output "$EVIDENCE_DIR/smoke-infrastructure.json"
```

The network runner's business workflow remains `NOT_RUN`; retain separately
reviewed business, identity/RBAC, mobile/Admin and worker evidence. CI/local
results must never be described as staging or production qualification.

Do not put operational credentials, local auth bypasses, sample seeds,
destructive volume cleanup, or legacy-provider rollback instructions in a
production procedure.

## Docker và kiểm tra (local-only)

The commands in this section are for local development only, never for a
staging or production target.

```powershell
# Xem service
docker compose ps

# Xem log
docker compose logs -f db pgbouncer minio migrate

# Dừng stack, giữ dữ liệu
docker compose down
```

Do not remove database volumes as part of a production operation.

### Kiểm tra database PostgreSQL

Khởi động PostgreSQL và PgBouncer nếu chưa chạy:

```powershell
docker compose up -d db pgbouncer
```

Mở `psql` trực tiếp trong container PostgreSQL. Lệnh tự dùng
`POSTGRES_USER` và `POSTGRES_DB` từ environment của container:

```powershell
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Các lệnh thường dùng trong `psql`:

```sql
\conninfo
\dt
\dt public.*
\d "TênBảng"
SELECT * FROM "TênBảng" LIMIT 10;
\q
```

Chạy query mà không mở shell tương tác:

```powershell
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"'
```

Kết nối từ DBeaver, TablePlus hoặc pgAdmin:

- PostgreSQL trực tiếp: host `localhost`, port `5432`
- Qua PgBouncer, giống connection của API: host `localhost`, port `6432`
- Database, username và password: lấy từ `.env`

Kiểm tra trạng thái migration:

```powershell
docker compose run --rm migrate yarn workspace @imeal/core prisma migrate status
```

Không xóa volume `db_data` trong quy trình staging hoặc production; thao tác
volume destructive chỉ thuộc môi trường local disposable.

Các port mặc định:

- API: `3000`
- Worker: `3001`
- PostgreSQL: `5432`
- PgBouncer: `6432`
- MinIO: `9000`, Console: `9001`
- Admin Web: `5173`

Lệnh kiểm tra:

```powershell
corepack yarn typecheck
corepack yarn lint
corepack yarn build
corepack yarn test:unit
```

DB/e2e test dùng PostgreSQL trực tiếp tại `localhost:5432`, không dùng database production:

```powershell
$env:DATABASE_URL='postgresql://CHANGE_ME_LOCAL:CHANGE_ME_LOCAL@localhost:5432/imeal?schema=public'
corepack yarn test:db
```

## Tài liệu

- [Documentation map](./docs/README.md)
- [Technical Requirements](./docs/02-technical-requirements.md)
- [Backend Structure](./docs/05-backend-structure.md)
- [Local Role Testing Guide](./docs/local-role-testing.md)
