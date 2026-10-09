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

macOS/Linux: đổi `Copy-Item .env.example .env` thành `cp .env.example .env`.
Các workflow local bên dưới dùng file env bị ignore, không cần gán biến trong
PowerShell hoặc shell hiện tại.

Mở `.env` và thay mọi `CHANGE_ME_LOCAL` cùng secret OTP/session bằng giá trị
local riêng. Giữ `AUTH_MODE=otp` và `REQUIRE_AUTH=true`. API đọc file này;
worker Compose chỉ nhận các biến worker mà `docker compose` truyền vào.

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
| Admin Web | sửa `apps/admin-web/.env.local`, rồi `corepack yarn workspace @imeal/admin-web dev` | `http://localhost:5173` |
| Mobile (native) | `corepack yarn workspace @imeal/mobile start` | Expo Go trên Android hoặc iOS |
| Worker | xem khối bên dưới | `localhost:3001` |

Admin Web dùng env riêng của Vite; file local này bị ignore và không được dùng
cho mobile hoặc worker:

```dotenv
# apps/admin-web/.env.local (không commit)
VITE_API_URL=http://localhost:3000
```

Expo Web is not a supported staging or production client. Use the native Android/iOS
paths above for release qualification; a local `expo start --web` session is only
for development/UI inspection and is not evidence that the API supports browser
origins or CORS preflight.

Worker không tự đọc root `.env`. Với worker chạy trực tiếp, tạo file bị ignore
`apps/worker/.env.local` và thay placeholder/SMTP local bằng giá trị riêng:

```dotenv
# apps/worker/.env.local (không commit)
NODE_ENV=development
DATABASE_URL=postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:6432/<POSTGRES_DB>?schema=public&pgbouncer=true
PORT=3001
OTP_DELIVERY_ENCRYPTION_KEY=CHANGE_ME_LOCAL_CHANGE_ME_LOCAL_CHANGE_ME_LOCAL
OTP_SMTP_HOST=smtp.gmail.com
OTP_SMTP_PORT=587
OTP_SMTP_USERNAME=otp-local@example.test
OTP_SMTP_PASSWORD=CHANGE_ME_LOCAL
OTP_SMTP_FROM=otp-local@example.test
OTP_SMTP_FROM_NAME=IMeal
OTP_SMTP_REQUIRE_TLS=true
```

Chạy worker trực tiếp bằng script chỉ nạp file này:

```powershell
corepack yarn workspace @imeal/worker start:dev:env
```

Compose vẫn dùng root `.env` và chỉ truyền các biến worker cần thiết vào
container; không nạp root `.env` wholesale vào worker process. For Gmail OTP
setup, see the [OTP email runbook](./docs/runbooks/otp-email.md). Use a
dedicated mailbox with 2-Step Verification and a Google App Password; never
put a regular Google password or a real credential in this repository.

Local SMTP injection has two supported modes:

- **Compose (selected local behavior):** `docker compose` reads the untracked
  `.env` and passes `OTP_SMTP_USERNAME`, `OTP_SMTP_PASSWORD`, `OTP_SMTP_FROM`,
  and optional `OTP_SMTP_FROM_NAME` to the worker only. The API receives no
  SMTP credentials.
- **Direct worker:** use `apps/worker/.env.local` and
  `start:dev:env` above. Both modes use STARTTLS over TCP `587`; production
  validation remains fail-closed. Rotate by creating a replacement App
  Password, updating the protected worker environment, restarting the worker,
  verifying delivery, and then revoking the old App Password. Do not add
  `OTP_PROVIDER_API_KEY` or any SMTP credential to the API environment.


## Mobile

Các lệnh Expo trực tiếp (`start`, `android`, `ios`, `web`) chạy trong
`apps/mobile` không tự đọc `.env` ở thư mục gốc. Với local/LAN, dùng file
riêng bị ignore `apps/mobile/.env.lan.local`; file này không chứa secret:

```dotenv
# apps/mobile/.env.lan.local (không commit)
IMEAL_LAN_HOST=<LAN IPv4>
EXPO_PUBLIC_API_URL=
```

`IMEAL_LAN_HOST` là địa chỉ IPv4 mà điện thoại có thể truy cập. Để trống
`EXPO_PUBLIC_API_URL` khi chạy local hoặc cùng LAN để app tự dùng
`http://<Metro-host>:3000/api`. File trên chỉ được nạp bởi
`start:lan:env`; lệnh `start:lan` hiện tại vẫn giữ cơ chế tự dò một IPv4
hoặc nhận biến môi trường đã có sẵn.

Android Expo Go từ SDK 53 không còn hỗ trợ remote push notifications của
`expo-notifications`. Khi chạy bundle bằng Expo Go, app sẽ giữ inbox và các
chức năng khác hoạt động nhưng tắt phần đăng ký push; muốn kiểm thử push phải
dùng native development build:

```powershell
cd apps/mobile
eas build --profile development --platform android
```

Không dùng `expo start`/Expo Go để kiểm thử việc nhận push.

| Thiết bị | Lệnh | Điều kiện thấy được |
| --- | --- | --- |
| Một máy ADB | `corepack yarn workspace @imeal/mobile android:local` | `adb` trong `PATH`, một target, Expo Go SDK 57 |
| Nhiều máy ADB | reverse thủ công rồi `start --localhost` | xem bên dưới |
| Android emulator | `corepack yarn workspace @imeal/mobile android` | AVD đang chạy |
| iOS Simulator | `corepack yarn workspace @imeal/mobile ios` | chỉ macOS + Xcode |
| Điện thoại cùng LAN (tự dò) | `corepack yarn workspace @imeal/mobile start:lan` | output có `exp://<LAN-IP>:8081` |
| Điện thoại cùng LAN (dùng file env) | `corepack yarn workspace @imeal/mobile start:lan:env` | dùng `apps/mobile/.env.lan.local` |
| Ngoài LAN | `start:remote` | có cả URL API và URL Metro public |

### Nhiều target ADB

```powershell
adb devices
adb -s <serial> reverse tcp:8081 tcp:8081
adb -s <serial> reverse tcp:3000 tcp:3000
corepack yarn workspace @imeal/mobile start --localhost
```

### Điện thoại cùng LAN

Điện thoại và máy dev cùng LAN. Mở inbound TCP `3000` và `8081` trên firewall.
Không dùng `start --lan`, ngrok hay cloudflared cho flow này.

Khi máy dev chỉ có một IPv4 usable, launcher tự chọn địa chỉ đó:

```powershell
corepack yarn workspace @imeal/mobile start:lan
```

`exp://127.0.0.1:8081` là sai với điện thoại vật lý. Nếu launcher báo nhiều
IPv4, ghi địa chỉ mà điện thoại có thể truy cập vào
`apps/mobile/.env.lan.local` (đã bị ignore), giữ `EXPO_PUBLIC_API_URL=` để
app dùng host của Metro, rồi chạy:

```powershell
corepack yarn workspace @imeal/mobile start:lan:env
```

### Ngoài LAN

Cần hai endpoint riêng. Ngrok chỉ public API. Metro dùng proxy riêng trỏ `localhost:8081`. Không dùng Expo tunnel.

```powershell
ngrok http 3000
```

Terminal khác:

```powershell
cloudflared tunnel --url http://localhost:8081
```

Sau khi cả hai tunnel đã sẵn sàng, dùng `start:remote`: script này mới nạp
`.env` ở thư mục gốc bằng `dotenv`. Các lệnh Expo trực tiếp và `start:lan`
không nạp file đó. Ghi endpoint remote vào `.env` gốc, không commit giá trị
thật:

```dotenv
EXPO_PUBLIC_API_URL=https://<api-id>.ngrok-free.app/api
EXPO_PACKAGER_PROXY_URL=https://<metro-id>.trycloudflare.com
```

Sau khi cập nhật `.env`, chạy:

```powershell
corepack yarn workspace @imeal/mobile start:remote
```

Giữ cả hai tunnel sống. Đổi URL thì sửa `.env` và chạy lại `start:remote`.
Admin Web có env riêng của Vite, không dùng `apps/mobile/.env.lan.local`:

```dotenv
# apps/admin-web/.env.local (không commit)
VITE_API_URL=https://<api-id>.ngrok-free.app
```

```powershell
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

Smoke thủ công cần email allowlist, role/location/roster và hộp thư Gmail OTP được cấp ngoài repository. Worker gửi mã qua SMTP `smtp.gmail.com:587`; API không gửi mail:

1. Staff xin OTP và verify code nhận từ Gmail.
2. Tạo đăng ký cho ngày đang phục vụ. Kitchen có `kitchen.serve` mở `GET /api/kitchen/check-in/qr`: một QR chung cho ngày/địa điểm, không chứa danh tính Staff.
3. Staff quét QR, cấp camera và GPS foreground. `POST /api/me/check-in/resolve` trả đúng đăng ký của caller; `intentNonce` có giá trị khi eligible, null khi không.
4. Staff review, lấy GPS mới và `POST /api/me/check-in/confirm` với cùng `sessionId`, `intentNonce` khác rỗng và idempotency key.
5. Retry cùng key, hoặc gọi `GET /api/me/check-in`. Kết quả là `CHECKED_IN` và chỉ một `MealServing`.
6. Kitchen dashboard chỉ poll khi focused/foreground, mỗi 10 giây. Bình thường snapshot hội tụ trong khoảng 15 giây. Lỗi refresh thì giữ snapshot tốt cuối và đánh dấu stale.

Không có Kitchen scanner, delegation/proxy pickup hay SSE trong flow này.

## Seed local

### Điều kiện và an toàn

Chạy các lệnh từ thư mục gốc repository. Cần có Node.js `>=24 <25`,
Corepack/Yarn `4.18.0`, Docker Desktop đang chạy và file env local (không
được commit):

```powershell
Copy-Item .env.example .env
```

Đối với seed file-based, tạo `packages/domain/.env.seed.local` (đã bị ignore)
với các gate local-only và kết nối trực tiếp PostgreSQL:

```dotenv
# packages/domain/.env.seed.local (không commit)
NODE_ENV=development
IMEAL_LOCAL_SEED=1
IMEAL_LOCAL_SEED_CONFIRM=I_UNDERSTAND_LOCAL_ONLY
IMEAL_LOCAL_SEED_BASE_EMAIL=imeal.seed@example.test
DATABASE_URL=postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5432/<POSTGRES_DB>?schema=public
```

`imeal.seed@example.test` là ví dụ synthetic; có thể thay bằng dedicated local
mailbox. Không thêm các gate seed vào `.env.example`; repository cố ý không bật
seed trong template tracked. Database dùng cho seed phải là database disposable
của máy dev.

`seed:local` vẫn là lệnh process-env-only. `seed:local:env` vẫn nạp root `.env`
để giữ tương thích hiện có; `seed:local:file` chỉ nạp
`packages/domain/.env.seed.local`, không nạp root `.env` wholesale và không
nhận secret/API setting không liên quan.

### Khởi động database và migration

```powershell
docker compose up -d db pgbouncer minio minio-create-bucket migrate
docker compose wait migrate
docker compose ps --all
docker compose logs --no-color --tail=100 db pgbouncer minio minio-create-bucket migrate
```

`migrate` và `minio-create-bucket` là service one-shot nên trạng thái `Exited (0)` là bình thường. Tiếp tục chỉ khi `db`/`pgbouncer`/`minio` ở trạng thái running/healthy và `migrate` hoàn tất thành công. Theo dõi log trực tiếp khi cần:

```powershell
docker compose logs -f db pgbouncer minio migrate
```

### Dry-run và seed thật

Seed phải kết nối PostgreSQL trực tiếp qua `localhost:5432`, không qua
PgBouncer `localhost:6432`. File `packages/domain/.env.seed.local` ở trên đã
giữ database URL riêng cho seed; không sửa file tracked và không âm thầm đổi
`DATABASE_URL` dùng chung.

```powershell
corepack yarn workspace @imeal/core seed:local:file --help
corepack yarn workspace @imeal/core seed:local:file --dry-run
corepack yarn workspace @imeal/core seed:local:file
```

`seed:local:file` nạp `NODE_ENV`, `IMEAL_LOCAL_SEED=1`,
`IMEAL_LOCAL_SEED_CONFIRM=I_UNDERSTAND_LOCAL_ONLY`,
`IMEAL_LOCAL_SEED_BASE_EMAIL` và `DATABASE_URL` chỉ từ file seed bị ignore.
Dùng `imeal.seed@example.test` hoặc dedicated local mailbox làm ví dụ base
email; workspace này có thể có giá trị admin private đã được phê duyệt trong
file local, nhưng không bao giờ sao chép địa chỉ đó, secret hoặc dữ liệu vận
hành vào README hay file tracked.

`--dry-run` kiểm tra toàn bộ plan nhưng không ghi database. Seed thật tạo dữ
liệu synthetic (50 users, bốn location `LOCAL-A`..`LOCAL-D`, assignment, menu,
registration và lịch sử serving). Cùng base email, tuần và database thì chạy
lại là idempotent; base email hoặc tuần khác cần database/schema disposable
riêng. CLI không có reset, purge hoặc delete.

Nếu thấy `INVALID_ENVIRONMENT`, kiểm tra `NODE_ENV`, marker
`IMEAL_LOCAL_SEED`, confirmation, `APP_ENV`/`RUNTIME_ENV`/`DEPLOYMENT_ENV` và
đường dẫn `packages/domain/.env.seed.local`. Không dùng env staging/production;
thiếu hoặc sai safety gate bắt buộc sẽ fail closed.

Chi tiết cohort và test bypass: [local role testing](./docs/local-role-testing.md), [seed design](./docs/superpowers/specs/2026-09-24-imeal-local-seed-design.md).

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

Các lệnh dưới đây chạy từ thư mục gốc trong PowerShell và chỉ dành cho máy dev. Docker Compose lấy service credentials từ `.env`; không dùng database staging, production hoặc database dùng chung.

### Khởi động, chờ, xem trạng thái và log

```powershell
docker compose up -d db pgbouncer minio minio-create-bucket migrate
docker compose wait migrate
docker compose ps --all
docker compose logs --no-color --tail=100 db pgbouncer minio minio-create-bucket migrate
```

Theo dõi log trực tiếp:

```powershell
docker compose logs -f db pgbouncer minio migrate
```

`migrate` và `minio-create-bucket` kết thúc với `Exited (0)` sau khi hoàn tất; `db`, `pgbouncer` và `minio` phải running/healthy. Client ngoài container dùng PostgreSQL `localhost:5432` hoặc PgBouncer `localhost:6432`. Seed local luôn dùng `5432`.

### Kiểm tra bảng và rows bằng psql

`db` phải đang chạy và healthy. Dùng `exec -T` cho các lệnh không tương tác, đồng thời truyền `PGPASSWORD` từ environment của container:

```powershell
docker compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"'
docker compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT email, name, is_active FROM public.users ORDER BY email LIMIT 10;"'
docker compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT name, count(*) FROM public.roles GROUP BY name ORDER BY name;"'
docker compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT short_code, display_name FROM public.locations ORDER BY short_code;"'
```

Tên bảng là tên map thật trong `packages/domain/prisma/schema.prisma`: `users`, `roles`, `user_roles`, `locations`, `registrations`, `meal_servings` và `_prisma_migrations`. Muốn mở phiên psql tương tác:

```powershell
docker compose exec db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Trong `psql`, dùng `\dt`, `\d public.users`, `SELECT ...;` và `\q`. Không ghi password vào command hoặc README; `PGPASSWORD` ở trên chỉ đọc giá trị đã inject vào container.

### Migration, dừng và reset

Kiểm tra migration bằng Prisma và xem history đã apply:

```powershell
docker compose run --rm migrate yarn workspace @imeal/core prisma migrate status
docker compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT migration_name, finished_at, rolled_back_at FROM public.\"_prisma_migrations\" ORDER BY finished_at DESC NULLS LAST;"'
```

Dừng service mà giữ dữ liệu:

```powershell
docker compose stop
docker compose down
```

`docker compose down` xóa container/network nhưng giữ các named volume. Reset chỉ được phép trên database disposable local và xóa toàn bộ dữ liệu:

```powershell
docker compose down --volumes
docker compose up -d db pgbouncer minio minio-create-bucket migrate
docker compose wait migrate
```

Không chạy `down --volumes` trên staging/production hoặc database dùng chung. `seed:local` không có reset/purge/delete; muốn đổi base email hoặc tuần hãy tạo database/schema disposable mới.

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

DB/e2e dùng PostgreSQL trực tiếp, không qua PgBouncer và không dùng database
production. Tạo file bị ignore `.env.db.local`:

```dotenv
# .env.db.local (không commit)
DATABASE_URL=postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5432/<POSTGRES_DB>?schema=public
```

Sau đó chạy script chỉ nạp file này:

```powershell
corepack yarn test:db:env
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
