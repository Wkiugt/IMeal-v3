# IMeal

Monorepo Yarn Workspaces + Turborepo cho hệ thống đăng ký và nhận suất ăn nội bộ. Server là nguồn sự thật. Mobile và Admin Web chỉ gọi API; không ghi PostgreSQL trực tiếp.

Mọi lệnh chạy từ thư mục gốc repository. Không commit `.env`, secret, PII, email thật hoặc tọa độ thật.

## Chọn đường đi

| Bạn cần | Làm theo | Không làm |
| --- | --- | --- |
| Chạy trên máy dev | [Local](#local) | Không dùng overlay staging/production |
| Điện thoại hoặc emulator | [Mobile](#mobile) | Không dùng tunnel tích hợp của Expo |
| Dữ liệu giả để thử role | [Seed local](#seed-local) | Không trỏ vào database dùng chung |
| Staging hoặc production | [Triển khai](#triển-khai) | Không `docker compose up` file gốc rồi coi là production |

Trạng thái release hiện tại: **CONDITIONAL / NO-GO**. CI không secret, test local và `docker compose up` file gốc không phải qualification staging hay production.

## Yêu cầu

- Node.js `>=24 <25`
- Corepack, Yarn `4.18.0`
- Docker Desktop + Docker Compose v2
- Expo Go SDK 57 và Android Studio nếu chạy mobile native
- [ngrok](https://ngrok.com/download) v3 chỉ khi API phải ra ngoài LAN

Production nhận **email OTP allowlist-A** và session opaque lưu hash trên PostgreSQL. Không có username/password, local login hay account mẫu. `REQUIRE_AUTH=false` chỉ hợp lệ khi `NODE_ENV=test`; production từ chối cặp này.

## Local

### 1. Cài dependency và tạo `.env`

PowerShell:

```powershell
corepack enable
corepack prepare yarn@4.18.0 --activate
corepack yarn install --immutable
Copy-Item .env.example .env
```

macOS/Linux: đổi `Copy-Item .env.example .env` thành `cp .env.example .env`. Các biến shell bên dưới dùng `$env:NAME='value'`; shell bash dùng `export NAME='value'`.

Mở `.env` và thay mọi `CHANGE_ME_LOCAL` cùng secret OTP/session bằng giá trị local riêng. Giữ `AUTH_MODE=otp` và `REQUIRE_AUTH=true`. API đọc file này; worker thì không.

### 2. Database và migration

```powershell
corepack yarn build
docker compose up -d db pgbouncer minio minio-create-bucket migrate
docker compose wait migrate
docker compose ps --all
```

`yarn build` chỉ generate Prisma metadata; không kết nối database. `migrate` phải là `Exited (0)`. Nếu không, xem `docker compose logs migrate` và dừng lại.

### 3. API

Terminal mới:

```powershell
corepack yarn workspace @imeal/api start:dev
curl.exe http://localhost:3000/health
```

API lắng nghe `0.0.0.0:3000`.

### 4. Các app còn lại

Mỗi lệnh một terminal. API phải chạy trước mobile.

| App | Lệnh | Đích |
| --- | --- | --- |
| Admin Web | `$env:VITE_API_URL='http://localhost:3000'; corepack yarn workspace @imeal/admin-web dev` | `http://localhost:5173` |
| Mobile web | `corepack yarn workspace @imeal/mobile web` | Expo web |
| Worker | xem khối bên dưới | `localhost:3001` |

Worker không tự đọc `.env`:

```powershell
$env:DATABASE_URL='postgresql://CHANGE_ME_LOCAL:CHANGE_ME_LOCAL@localhost:6432/imeal?schema=public&pgbouncer=true'
$env:PORT='3001'
corepack yarn workspace @imeal/worker start:dev
```

Thay user/password bằng đúng giá trị trong `.env`.

## Mobile

Để trống `EXPO_PUBLIC_API_URL` khi chạy local hoặc cùng LAN. App tự dùng `http://<Metro-host>:3000/api`.

| Thiết bị | Lệnh | Điều kiện thấy được |
| --- | --- | --- |
| Một máy ADB | `corepack yarn workspace @imeal/mobile android:local` | `adb` trong `PATH`, một target, Expo Go SDK 57 |
| Nhiều máy ADB | reverse thủ công rồi `start --localhost` | xem bên dưới |
| Android emulator | `corepack yarn workspace @imeal/mobile android` | AVD đang chạy |
| iOS Simulator | `corepack yarn workspace @imeal/mobile ios` | chỉ macOS + Xcode |
| Điện thoại cùng LAN | `corepack yarn workspace @imeal/mobile start:lan` | output có `exp://<LAN-IP>:8081` |
| Ngoài LAN | `start:remote` | có cả URL API và URL Metro public |

### Nhiều target ADB

```powershell
adb devices
adb -s <serial> reverse tcp:8081 tcp:8081
adb -s <serial> reverse tcp:3000 tcp:3000
corepack yarn workspace @imeal/mobile start --localhost
```

### Điện thoại cùng LAN

Điện thoại và máy dev cùng LAN. Mở inbound TCP `3000` và `8081` trên firewall. Không dùng `start --lan`, ngrok hay cloudflared cho flow này.

```powershell
corepack yarn workspace @imeal/mobile start:lan
```

`exp://127.0.0.1:8081` là sai với điện thoại vật lý. Chỉ đặt `IMEAL_LAN_HOST` khi launcher báo nhiều IPv4:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' } |
  Format-Table InterfaceAlias, IPAddress
$env:IMEAL_LAN_HOST = '<LAN IPv4>'
corepack yarn workspace @imeal/mobile start:lan
```

### Ngoài LAN

Cần hai endpoint riêng. Ngrok chỉ public API. Metro dùng proxy riêng trỏ `localhost:8081`. Không dùng Expo tunnel.

```powershell
ngrok http 3000
corepack yarn workspace @imeal/mobile start:lan
```

Terminal khác:

```powershell
cloudflared tunnel --url http://localhost:8081
```

Ghi vào `.env` gốc, không commit giá trị thật:

```dotenv
EXPO_PUBLIC_API_URL=https://<api-id>.ngrok-free.app/api
EXPO_PACKAGER_PROXY_URL=https://<metro-id>.trycloudflare.com
```

Dừng Metro tạm, rồi:

```powershell
corepack yarn workspace @imeal/mobile start:remote
```

Giữ cả hai tunnel sống. Đổi URL thì sửa `.env` và chạy lại `start:remote`. Admin Web qua ngrok dùng origin không có suffix `/api`:

```powershell
$env:VITE_API_URL='https://<api-id>.ngrok-free.app'
corepack yarn workspace @imeal/admin-web dev
```

Lỗi `Cannot read properties of undefined (reading 'body')` là lỗi Expo shared tunnel, không chứng minh API ngrok down.

### Khi LAN không vào được

| Triệu chứng | Việc làm |
| --- | --- |
| `Something went wrong` | Output phải có `exp://<LAN-IP>:8081`, cùng LAN, Expo Go SDK 57, firewall mở `3000`/`8081`. `Ctrl+C` rồi chạy lại `start:lan`. |
| QR là `127.0.0.1` hoặc IP lạ | Dừng Metro, chạy lại `start:lan`. Chỉ đặt `IMEAL_LAN_HOST` khi có nhiều ứng viên. |
| App không gọi được API | API đang chạy, `EXPO_PUBLIC_API_URL` trống, `curl.exe http://localhost:3000/health` thành công, firewall mở `3000`. |
| Port `8081` bị chiếm | `Ctrl+C`. Nếu còn listener: `Get-NetTCPConnection -LocalPort 8081 -State Listen`, rồi `Stop-Process -Id <PID>` và chạy lại `start:lan`. |

Smoke thủ công cần email allowlist, role/location/roster và OTP provider được cấp ngoài repository:

1. Staff xin OTP và verify code từ provider.
2. Tạo đăng ký cho ngày đang phục vụ. Kitchen có `kitchen.serve` mở `GET /api/kitchen/check-in/qr`: một QR chung cho ngày/địa điểm, không chứa danh tính Staff.
3. Staff quét QR, cấp camera và GPS foreground. `POST /api/me/check-in/resolve` trả đúng đăng ký của caller; `intentNonce` có giá trị khi eligible, null khi không.
4. Staff review, lấy GPS mới và `POST /api/me/check-in/confirm` với cùng `sessionId`, `intentNonce` khác rỗng và idempotency key.
5. Retry cùng key, hoặc gọi `GET /api/me/check-in`. Kết quả là `CHECKED_IN` và chỉ một `MealServing`.
6. Kitchen dashboard chỉ poll khi focused/foreground, mỗi 10 giây. Bình thường snapshot hội tụ trong khoảng 15 giây. Lỗi refresh thì giữ snapshot tốt cuối và đánh dấu stale.

Không có Kitchen scanner, delegation/proxy pickup hay SSE trong flow này.

## Seed local

Chỉ cho database disposable local, `NODE_ENV=test` hoặc `development`. Không chạy trên staging, production, preview hay database dùng chung. CLI không tự đọc `.env`. Không có chế độ reset, purge hay delete.

```powershell
docker compose up -d db pgbouncer minio minio-create-bucket migrate
docker compose wait migrate

$env:NODE_ENV='test'
$env:IMEAL_LOCAL_SEED='1'
$env:IMEAL_LOCAL_SEED_CONFIRM='I_UNDERSTAND_LOCAL_ONLY'
$env:IMEAL_LOCAL_SEED_BASE_EMAIL='imeal.seed@example.test'
$env:DATABASE_URL='postgresql://CHANGE_ME_LOCAL:CHANGE_ME_LOCAL@localhost:5432/imeal?schema=public'

corepack yarn workspace @imeal/core seed:local --help
corepack yarn workspace @imeal/core seed:local --dry-run
corepack yarn workspace @imeal/core seed:local
```

Thay user, password và tên database bằng đúng `POSTGRES_USER`, `POSTGRES_PASSWORD` và `POSTGRES_DB` trong `.env`. Dùng port `5432` (PostgreSQL trực tiếp). `migrate` đã apply schema vào database này. Không dùng port `6432` và không đổi tên database thành `imeal_local` trừ khi database đó đã được tạo và migrate riêng.

`--dry-run` không ghi database. Host phải là `localhost`, `127.0.0.1`, `::1` hoặc service Compose `db`. Sai biến safety, host không local, marker production hoặc xung đột unique đều fail closed.

Seed tạo 50 email tổng hợp, cohort `staff`/`kitchen`/`admin`, bốn location `LOCAL-A`..`LOCAL-D`, assignment, menu, registration và lịch sử serving. Cùng base email, tuần và database thì lần chạy sau không thêm dòng. Base email hoặc tuần khác cần schema disposable riêng.

Chi tiết cohort và bypass test: [local role testing](./docs/local-role-testing.md), [seed design](./docs/superpowers/specs/2026-09-24-imeal-local-seed-design.md).

## Triển khai

Stack local là `docker compose up` của file gốc, không kèm overlay. Staging và production không đi từ lệnh đó. Secret và file env đã review nằm ngoài source control. README không ghi secret hay domain thật; chi tiết ở runbook, không sao chép vào đây.

### Staging

Chỉ render, chưa start:

```bash
docker compose --env-file <reviewed.env> -f docker-compose.yml -f docker-compose.staging.yml config --quiet
```

Staging được bảo vệ là GitHub environment `staging` và job `staging-readiness / Protected staging qualification (ephemeral Compose)`. Job này không phải check bắt buộc của pull request. Quy trình: [sẵn sàng staging](./docs/runbooks/staging-readiness.md).

### Production

Production chỉ `workflow_dispatch`, workflow `production-release`, job `production-release / Production release`, GitHub environment `production`. Job chạy trên `${{ vars.PRODUCTION_RUNNER_LABEL }}`, nhãn self-hosted trên host Compose production. Nhãn rỗng, `ubuntu-latest` và `ubuntu-24.04` fail closed. Không hardcode hostname.

Sau backup và migration gate, deploy là:

```bash
docker compose --env-file <reviewed.env> -f docker-compose.yml -f docker-compose.production.yml up --detach --no-build api worker admin-web caddy
```

Không thêm `--build`, `down`, `--volumes` hay `--remove-orphans`. Gate: [cổng migration](./infra/migrations/README.md). Release: [production release](./docs/runbooks/production-release.md). Rollback: [production rollback](./docs/runbooks/production-rollback.md).

### Proxy và backup

Production bắt buộc `TRUSTED_PROXY_CIDRS`. Danh sách rỗng nghĩa là không tin ai. Caller trực tiếp không giả được `X-Forwarded-For`. Xem [trusted proxy](./docs/runbooks/trusted-proxy.md).

Backup không phải volume MinIO trong stack. Mục tiêu operator, chưa phải evidence đã diễn tập: RPO 24 giờ, RTO 4 giờ, giữ 35 ngày, mỗi ngày 17:30 Asia/Ho_Chi_Minh. Overlay `docker-compose.backup.yml` không được file gốc start. Xem [backup và restore](./docs/runbooks/backup-restore.md).

### Mobile và admin

Release mobile production nằm ở [mobile release](./docs/mobile-release.md). Tài liệu này không ghi nhận signed store build. Vận hành admin: [admin operations](./docs/runbooks/admin-operations.md).

### Tên check cho branch protection

Đây là tên để maintainer chọn. Repository này không bật được GitHub protection. Xem [bảo vệ nhánh](./docs/runbooks/branch-protection.md).

Chỉ check tổng hợp sau là bắt buộc cho qualification pull request của `deploy/develop` và `deploy/staging`. Job đó fail-closed trên mọi producer job và mọi evidence lane:

- staging-readiness / Secretless qualification (disposable PostgreSQL)

Không chọn context con của matrix như `staging-readiness / Security matrix (audit)` hoặc `staging-readiness / Image build scan SBOM matrix (api)`. Không chọn tên producer riêng lẻ. Không chọn `staging-readiness / Protected staging qualification (ephemeral Compose)` làm check bắt buộc của pull request. CI không bí mật không phải qualification staging hoặc production.

## Docker local

Các lệnh này chỉ cho máy dev.

```powershell
docker compose ps
docker compose logs -f db pgbouncer minio migrate
docker compose down
```

`down` giữ volume. Không xóa `db_data` trên staging hoặc production.

```powershell
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Trong `psql`: `\dt`, `\d "TênBảng"`, `\q`. Một query không cần shell:

```powershell
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"'
```

Client ngoài container: PostgreSQL `localhost:5432`, PgBouncer `localhost:6432`. User, database và password lấy từ `.env`.

| Port | Service |
| --- | --- |
| 3000 | API |
| 3001 | Worker |
| 5173 | Admin Web dev |
| 5432 | PostgreSQL |
| 6432 | PgBouncer |
| 9000 / 9001 | MinIO API / Console |
| 8081 | Metro |

```powershell
corepack yarn typecheck
corepack yarn lint
corepack yarn build
corepack yarn test:unit
```

DB/e2e dùng PostgreSQL trực tiếp, không qua PgBouncer và không dùng database production:

```powershell
$env:DATABASE_URL='postgresql://CHANGE_ME_LOCAL:CHANGE_ME_LOCAL@localhost:5432/imeal?schema=public'
corepack yarn test:db
```

Trạng thái migration local:

```powershell
docker compose run --rm migrate yarn workspace @imeal/core prisma migrate status
```

## Tài liệu

- [Bản đồ tài liệu](./docs/README.md)
- [Technical requirements](./docs/02-technical-requirements.md)
- [Backend structure](./docs/05-backend-structure.md)
- [Local role testing](./docs/local-role-testing.md)
- [Sẵn sàng staging](./docs/runbooks/staging-readiness.md)
- [Bảo vệ nhánh](./docs/runbooks/branch-protection.md)
- [Backup và restore](./docs/runbooks/backup-restore.md)
- [Production release](./docs/runbooks/production-release.md)
- [Production rollback](./docs/runbooks/production-rollback.md)
- [Trusted proxy](./docs/runbooks/trusted-proxy.md)
- [Admin operations](./docs/runbooks/admin-operations.md)
- [Mobile release](./docs/mobile-release.md)
- [Cổng migration production](./infra/migrations/README.md)
