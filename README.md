# IMeal v2

IMeal v2 là monorepo dùng Yarn Workspaces và Turborepo cho hệ thống đăng ký, quản lý và giao suất ăn nội bộ.

Tài liệu này ưu tiên local development với `AUTH_MODE=local`: chạy dependency bằng Docker, chạy API trên host để hot reload/debug, sau đó chọn Admin Web hoặc Expo theo thiết bị. Mọi lệnh bên dưới chạy từ thư mục gốc repository; không cần `cd` vào từng workspace.

## Thành phần

| Thành phần        | Thư mục              | Công nghệ                 | Vai trò                                                           |
| ----------------- | -------------------- | ------------------------- | ----------------------------------------------------------------- |
| API backend       | `apps/api`           | NestJS + Fastify + Prisma | API nghiệp vụ và xác thực local hoặc Microsoft Entra tùy cấu hình |
| Background worker | `apps/worker`        | NestJS + Scheduler        | Job định kỳ và xử lý nghiệp vụ nền                                |
| Mobile frontend   | `apps/mobile`        | React Native + Expo       | Ứng dụng Staff/Kitchen trên Android, iOS và web preview           |
| Admin frontend    | `apps/admin-web`     | Vite + TypeScript         | Giao diện quản trị local bằng username/password                   |
| Database/domain   | `packages/domain`    | PostgreSQL + Prisma       | Schema, migration và domain services                              |
| API contracts     | `packages/contracts` | TypeScript + Zod          | Schema dùng chung giữa các package                                |
| Reverse proxy     | `Caddyfile`          | Caddy                     | Entry point cho deployment; không cần cho luồng local mặc định    |

## Yêu cầu cài đặt

- Windows, macOS hoặc Linux.
- Node.js `>=18`; khuyến nghị Node.js 20 vì Dockerfiles và tài liệu local dùng bản này.
- Corepack và Yarn `4.18.0`.
- Git.
- Docker Desktop chạy Linux containers và Docker Compose v2.
- Nếu dùng Android Emulator: Android Studio, một Android Virtual Device (AVD), JDK 17, `ANDROID_HOME` và `adb`. Xem [hướng dẫn Android Emulator của Expo](https://docs.expo.dev/workflow/android-studio-emulator/).
- Nếu dùng iOS Simulator: macOS có Xcode. Simulator iOS không chạy trên Windows hoặc Linux; xem [hướng dẫn iOS Simulator của Expo](https://docs.expo.dev/workflow/ios-simulator/).

### Kích hoạt Yarn

Repository khai báo:

```json
"packageManager": "yarn@4.18.0"
```

PowerShell:

```powershell
corepack enable
corepack prepare yarn@4.18.0 --activate
corepack yarn --version
```

Một số bản Corepack hỗ trợ lệnh tương đương:

```powershell
corepack install --global yarn@4.18.0
```

Nếu `corepack` không tồn tại:

```powershell
npm install --global corepack
corepack enable
corepack prepare yarn@4.18.0 --activate
```

Bash (macOS/Linux):

```bash
corepack enable
corepack prepare yarn@4.18.0 --activate
corepack yarn --version
```

Kết quả của `corepack yarn --version` phải là `4.18.0`. Không cài một bản Yarn global độc lập ngoài Corepack.

## Quick start local

### 1. Cài dependency và tạo environment

PowerShell:

```powershell
corepack yarn install --immutable
Copy-Item .env.example .env
```

Bash:

```bash
corepack yarn install --immutable
cp .env.example .env
```

Mở `.env` và thay mọi giá trị placeholder, đặc biệt là:

- `POSTGRES_PASSWORD` và `MINIO_ROOT_PASSWORD` nếu cần đổi credential local.
- `QR_SIGNING_SECRET` và `LOCAL_AUTH_JWT_SECRET` bằng chuỗi ngẫu nhiên dài ít nhất 32 ký tự.
- Mọi giá trị `replace-me` trong `LOCAL_AUTH_USERS` bằng password local riêng.

Luồng mặc định dùng `AUTH_MODE=local` và `REQUIRE_AUTH=true`. Các tài khoản local được cấu hình trong `LOCAL_AUTH_USERS` gồm `staff01`…`staff05`, `kitchen01`, `kitchen02` và `admin01`. Login thành công sẽ tự provision user/role vào PostgreSQL; không cần lệnh seed user riêng.

Sinh Prisma Client cho process chạy trên host:

```powershell
corepack yarn workspace @imeal/core prisma generate
```

Build package contract để API host resolve được `@imeal/contracts`:

```powershell
corepack yarn workspace @imeal/contracts build
```

### 2. Khởi động dependency và migration

```powershell
docker compose up -d db pgbouncer minio minio-create-bucket migrate
```

Lệnh trên khởi động PostgreSQL, PgBouncer, MinIO, tạo bucket và chạy Prisma migration. Chờ migration kết thúc trước khi chạy API:

```powershell
docker compose wait migrate
docker compose ps --all
```

`docker compose wait migrate` trả lỗi nếu process migration kết thúc thất bại. Trong output `docker compose ps --all`, `migrate` phải có trạng thái `Exited (0)`.

### 3. Chạy API trên host

Mở terminal thứ hai, vẫn ở repository root:

```powershell
corepack yarn workspace @imeal/api start:dev
```

API script tự nạp root `.env` qua `dotenv -e ../../.env`, bind trên `0.0.0.0:3000`. Kiểm tra từ terminal khác:

```powershell
curl.exe http://localhost:3000/health
```

Bash:

```bash
curl http://localhost:3000/health
```

Expected HTTP status: `200`.

### 4. Chọn surface cần chạy

- Admin Web: xem [Admin Web](#admin-web).
- Mobile web: xem [Mobile web](#mobile-web).
- Android Emulator: xem [Android Emulator](#android-emulator).
- Android phone/tablet thật: xem [Android phone/tablet thật](#android-phone-và-tablet-thật).
- iOS Simulator và iPhone/iPad thật: xem [iOS](#ios).

## Hợp đồng environment

| File/biến                                                    | Process đọc                                                       | Ghi chú                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------ |
| Root `.env`                                                  | Docker Compose và API scripts `start`, `start:dev`, `start:debug` | API scripts nạp qua `dotenv -e ../../.env`       |
| Environment của terminal                                     | Worker chạy trên host, Admin Web và Expo                          | Export/set trước khi khởi động process tương ứng |
| `packages/domain/.env.test` hoặc `DATABASE_URL` của terminal | Domain/API DB tests                                               | Dùng PostgreSQL trực tiếp và database test riêng |

### API local auth

Các giá trị local nên giữ như sau trong root `.env`:

```dotenv
AUTH_MODE=local
REQUIRE_AUTH=true
DATABASE_URL=postgresql://postgres:postgres@localhost:6432/imeal?schema=public&pgbouncer=true
QR_SIGNING_SECRET=<ít nhất-32-ký-tự>
LOCAL_AUTH_JWT_SECRET=<ít nhất-32-ký-tự>
LOCAL_AUTH_USERS='[...]'
```

API kiểm tra `DATABASE_URL`, `QR_SIGNING_SECRET`, và trong local mode kiểm tra thêm `LOCAL_AUTH_JWT_SECRET` cùng `LOCAL_AUTH_USERS`. `QR_SIGNING_SECRET` phải dài ít nhất 32 ký tự. `REQUIRE_AUTH=true` là cấu hình local mặc định; không tắt authentication ngoài test bypass được kiểm soát.

`LOCAL_AUTH_USERS` là JSON array theo mẫu trong `.env.example`, mỗi entry có `username`, `password`, `email`, `name` và `role`. Có thể dùng các account sau:

| Role    | Username                 |
| ------- | ------------------------ |
| Staff   | `staff01` … `staff05`    |
| Kitchen | `kitchen01`, `kitchen02` |
| Admin   | `admin01`                |

Không commit `.env`, password, client secret, private key, access token hoặc refresh token.

### Entra tùy chọn

Chỉ backend mode `AUTH_MODE=entra` mới yêu cầu:

```dotenv
AUTH_MODE=entra
ENTRA_TENANT_ID=<tenant-id>
ENTRA_CLIENT_ID=<client-id>
ENTRA_API_SCOPE=api://<client-id>/access_as_user
```

`ENTRA_API_SCOPE` thuộc contract cấu hình backend. Frontend hiện gọi local login và không đọc `VITE_ENTRA_*` hoặc `EXPO_PUBLIC_ENTRA_*`; không tạo các biến đó như điều kiện để chạy frontend local. Không mô tả Entra frontend là flow đã được nối dây.

### Connection URL

- Process chạy lâu dài trên host dùng PgBouncer: `localhost:6432`, như `DATABASE_URL` trong `.env.example`.
- DB tests dùng PostgreSQL trực tiếp: `localhost:5432`, với account có quyền tạo và xóa schema.
- Không bao giờ trỏ DB test vào production hoặc database chứa dữ liệu thật.

## Docker và backend host

### Dependency graph và ports

Dependency graph hiện tại là:

```text
db ───────> pgbouncer ───────> api / worker
  └───────> migrate ────────> api / worker
minio ────> minio-create-bucket
```

Đây là các cổng mặc định được publish ra host:

| Service              |            Host port | Ghi chú                                 |
| -------------------- | -------------------: | --------------------------------------- |
| PostgreSQL           |               `5432` | Kết nối trực tiếp, chủ yếu cho DB tests |
| PgBouncer            |               `6432` | Kết nối app host lâu dài                |
| MinIO API            |               `9000` | Object storage                          |
| MinIO Console        |               `9001` | Giao diện MinIO                         |
| API trong Compose    | Không publish `3000` | API host local mới dùng `3000`          |
| Worker trong Compose | Không publish `3001` | Worker host local mới dùng `3001`       |

`api` và `worker` trong Compose chỉ chạy sau khi `migrate` hoàn tất. `minio-create-bucket` chỉ phụ thuộc MinIO; các service không khởi động theo một thứ tự tuyến tính duy nhất.

### Luồng hybrid được hỗ trợ

Đây là luồng chuẩn cho phát triển và debug:

1. Chạy `db`, `pgbouncer`, `minio`, `minio-create-bucket`, `migrate` bằng Docker.
2. Chạy API trên host bằng `yarn workspace @imeal/api start:dev`.
3. Chạy worker trên host nếu cần job hot reload.
4. Chạy Admin Web hoặc Expo trên host.

Worker scripts không tự nạp root `.env`. Trong PowerShell, set environment ngay trong terminal chạy worker:

```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:6432/imeal?schema=public&pgbouncer=true"
$env:PORT = "3001"
corepack yarn workspace @imeal/worker start:dev
```

Nếu dùng Bash:

```bash
export DATABASE_URL='postgresql://postgres:postgres@localhost:6432/imeal?schema=public&pgbouncer=true'
export PORT=3001
corepack yarn workspace @imeal/worker start:dev
```

API bind `0.0.0.0:3000`, nên cùng endpoint có thể phục vụ browser local, Android Emulator alias và điện thoại trong LAN khi firewall cho phép.
Các endpoint serving không còn yêu cầu request đến từ mạng LAN nội bộ; bearer token hợp lệ với quyền `kitchen.serve` mới là điều kiện ủy quyền.


### Vận hành stack

```powershell
docker compose ps
docker compose logs -f db pgbouncer minio migrate
docker compose down
```

`docker compose down` giữ lại volumes. `docker compose down -v` xóa volumes PostgreSQL, MinIO và Caddy; chỉ dùng khi cố ý reset toàn bộ dữ liệu local.

Full-stack `docker compose up --build -d` chưa phải quick start được hỗ trợ: service `admin-web` hiện chỉ có `build.context: .`, không chỉ định `apps/admin-web/Dockerfile`, trong khi repository root không có `Dockerfile`. Không sửa Compose trong phạm vi README này; dùng hybrid flow ở trên để chạy local.

## Chạy frontend theo surface và thiết bị

### Admin Web

Trên máy development:

```powershell
$env:VITE_API_URL = "http://localhost:3000"
corepack yarn workspace @imeal/admin-web dev
```

Bash:

```bash
export VITE_API_URL='http://localhost:3000'
corepack yarn workspace @imeal/admin-web dev
```

Mở URL Vite mặc định `http://localhost:5173`, login bằng `admin01` và password tương ứng trong `.env`.

Để truy cập từ thiết bị khác trong LAN:

```powershell
$env:VITE_API_URL = "http://<DEV_MACHINE_LAN_IP>:3000"
corepack yarn workspace @imeal/admin-web dev --host 0.0.0.0
```

Bash:

```bash
export VITE_API_URL='http://<DEV_MACHINE_LAN_IP>:3000'
corepack yarn workspace @imeal/admin-web dev --host 0.0.0.0
```

Mở `http://<DEV_MACHINE_LAN_IP>:5173` và cho phép inbound TCP `3000` cùng `5173` trong firewall.

### Mobile web

```powershell
corepack yarn workspace @imeal/mobile web
```

Bash:

```bash
corepack yarn workspace @imeal/mobile web
```

Expo derives `http://<Metro-host>:3000/api` once from the Metro session; every connected device uses that endpoint. No API IP value is required for ordinary local Expo runs.

Login bằng Staff hoặc Kitchen account và dùng Browser DevTools để kiểm tra Console, Network và Sources. Mobile web là smoke UI/API; camera, secure storage và native behavior phải kiểm tra trên thiết bị native.

### Android Emulator

Khởi động AVD trong Android Studio rồi chạy:

```powershell
corepack yarn workspace @imeal/mobile android
```

Bash:

```bash
corepack yarn workspace @imeal/mobile android
```

### Android phone và tablet thật

Thiết bị và máy development phải cùng LAN. Chạy Expo mà không gán API IP:

```powershell
corepack yarn workspace @imeal/mobile start --lan
```

Bash:

```bash
corepack yarn workspace @imeal/mobile start --lan
```

Expo tự suy ra `http://<Metro-host>:3000/api` một lần từ Metro session để mọi thiết bị đã kết nối dùng chung. Mở app bằng Expo client tương thích Expo SDK `~51.0.28`. Cho phép inbound TCP `3000` và Metro port `8081` trong firewall. API phải bind `0.0.0.0:3000`.

### iOS

**iOS Simulator** chỉ chạy trên macOS có Xcode:

```bash
corepack yarn workspace @imeal/mobile ios
```

Simulator không có camera thật, nên không chứng minh được QR scanning.

**iPhone/iPad thật** dùng cùng LAN với máy development:

```bash
corepack yarn workspace @imeal/mobile start --lan
```

Thiết bị thật cần Expo client tương thích SDK `~51.0.28`. Repository chưa có signing/provisioning, EAS hoặc native iOS project, nên không cam kết flow cài native iOS. Xem [Expo environment setup](https://docs.expo.dev/get-started/set-up-your-environment/) và [iOS Simulator](https://docs.expo.dev/workflow/ios-simulator/) cho platform setup.

`EXPO_PUBLIC_API_URL` chỉ bắt buộc cho production và là override tùy chọn khi dùng Expo tunnel, reverse proxy hoặc API port khác mặc định. Local Expo LAN thông thường không cần đặt biến này.


### Checklist role nhanh

- Staff: login bằng `staff01`…`staff05`, đăng ký/reload, rồi xác nhận dữ liệu giữa các account được tách riêng.
- Kitchen: mở dashboard/scanner và kiểm tra camera trên thiết bị thật.
- Admin: tải weekly menu/penalty, refresh để kiểm tra session và logout.

Checklist đầy đủ ở [Local Role Testing Guide](./docs/local-role-testing.md).

## Debug

### API và worker runtime

```powershell
corepack yarn workspace @imeal/api start:debug
corepack yarn workspace @imeal/worker start:debug
```

Nest chạy watch mode với Node inspector. Attach IDE hoặc mở `chrome://inspect`, dùng inspector URL được in trong terminal; không giả định một port hoặc IDE launch profile cố định. API debug tự nạp root `.env`; worker vẫn cần `DATABASE_URL` trong terminal.

### API và worker tests

Script debug chạy Vitest với `--inspect-brk --no-file-parallelism`:

```powershell
corepack yarn workspace @imeal/api test:debug src/config/environment.spec.ts
corepack yarn workspace @imeal/worker test:debug src/no-show-worker.service.spec.ts
```

Attach debugger trước khi resume process. Có thể bỏ path test để debug toàn bộ unit tests của workspace.

### Admin Web và Mobile web

Chạy Vite hoặc Expo web dev server, sau đó dùng Browser DevTools:

- **Console**: lỗi runtime và log.
- **Network**: URL API, status code, request/response.
- **Sources**: breakpoint và source maps.

Repository không có script `debug` riêng cho Admin Web hoặc Mobile web.

### Expo native

Mở Expo Developer menu để xem log JavaScript, debug network và dùng công cụ debug của Expo client tương thích. Xem [Expo debugging tools](https://docs.expo.dev/debugging/tools/). Không giả định có `.vscode/launch.json` hoặc VS Code launch profile.

### Process trong Docker

Xem log container bằng:

```powershell
docker compose logs -f <service>
```

Để đặt source breakpoint, ưu tiên chạy `start:debug` trên host. Compose hiện không publish inspector ports; không mô tả attach debugger vào production container.

## Automated checks

| Mục đích          | Lệnh                                               | Phạm vi/điều kiện                                             |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| Typecheck         | `corepack yarn typecheck`                          | Toàn workspace                                                |
| Lint              | `corepack yarn lint`                               | Toàn workspace                                                |
| Build             | `corepack yarn build`                              | Toàn workspace                                                |
| Unit tests        | `corepack yarn test:unit`                          | Contracts, API và worker; theo contract root không yêu cầu DB |
| Unit watch API    | `corepack yarn workspace @imeal/api test:watch`    | Vòng lặp API unit test                                        |
| Unit watch worker | `corepack yarn workspace @imeal/worker test:watch` | Vòng lặp worker unit test                                     |
| DB/e2e tests      | `corepack yarn test:db`                            | Domain DB suite, API e2e và worker e2e                        |

Trước `test:db`, dùng PostgreSQL trực tiếp `localhost:5432` bằng account có quyền tạo/xóa schema. Có thể tạo ignored file `packages/domain/.env.test` hoặc export `DATABASE_URL` trong terminal. Domain và API e2e tạo schema ngẫu nhiên, deploy migration, truncate giữa các test rồi drop sau suite. Worker e2e không dùng setup cô lập này; không giả định mọi suite có cùng isolation.

Ví dụ PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/imeal?schema=public"
corepack yarn test:db
```

Bash:

```bash
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/imeal?schema=public'
corepack yarn test:db
```

Không dùng database có dữ liệu production cho bất kỳ DB test nào.

## Troubleshooting

### Thiếu Corepack hoặc Yarn sai version

**Triệu chứng:** `corepack` không nhận diện hoặc `yarn --version` khác `4.18.0`.

**Kiểm tra và sửa:**

```powershell
npm install --global corepack
corepack enable
corepack prepare yarn@4.18.0 --activate
corepack yarn --version
```

### Docker Engine tắt

**Triệu chứng:** Docker Compose không kết nối được daemon.

**Kiểm tra:** mở Docker Desktop, chọn Linux containers, rồi chạy:

```powershell
docker version
docker compose ps
```

### Port đã bị chiếm

**Triệu chứng:** service không bind được `3000`, `3001`, `5173`, `5432`, `6432`, `8081`, `9000` hoặc `9001`.

**Kiểm tra trên Windows:**

```powershell
Get-NetTCPConnection -LocalPort 3000,3001,5173,5432,6432,8081,9000,9001 -ErrorAction SilentlyContinue
```

Dừng process/container đang dùng port, hoặc đổi port qua biến cấu hình tương ứng (`PORT`, `POSTGRES_PORT`, `PGBOUNCER_PORT`, `MINIO_PORT`, `MINIO_CONSOLE_PORT`). Nếu đổi API port, cập nhật `VITE_API_URL` và `EXPO_PUBLIC_API_URL`.

### Migration hoặc DB thất bại

**Triệu chứng:** `migrate` exit khác `0`, API báo lỗi Prisma/connection.

**Kiểm tra:**

```powershell
docker compose ps
docker compose logs migrate db pgbouncer
```

Sau khi sửa credential/connection:

```powershell
docker compose up -d migrate
```

Restart API sau khi migration thành công. App host dùng PgBouncer `localhost:6432`; DB test dùng PostgreSQL trực tiếp `localhost:5432`.

### API trả `401`

**Triệu chứng:** local login hoặc protected endpoint trả `401`.

**Kiểm tra:**

- `.env` có `AUTH_MODE=local` và `REQUIRE_AUTH=true`.
- Username khớp chính xác entry trong `LOCAL_AUTH_USERS`.
- Password đã thay `replace-me` và khớp giá trị trong `.env`.
- API đã restart sau khi đổi `.env`.
- Login qua `POST http://localhost:3000/auth/local-login`; protected request gửi `Authorization: Bearer <token>`.

### Phone không gọi được API

**Triệu chứng:** app trên điện thoại timeout hoặc Network không tới API.

**Kiểm tra:**

- Start Expo bằng `corepack yarn workspace @imeal/mobile start --lan`; không cần gán API IP.
- Expo tự suy ra `http://<Metro-host>:3000/api` một lần cho mọi thiết bị đã kết nối.
- Điện thoại và máy development cùng LAN.
- API đang bind `0.0.0.0:3000`, Windows Firewall cho inbound TCP `3000`.
- Expo/Metro có thể tới máy development qua port `8081`.

### Metro cache lỗi

```powershell
corepack yarn workspace @imeal/mobile start --clear
```

### iOS Simulator không chạy

iOS Simulator yêu cầu macOS và Xcode. Trên Windows/Linux chỉ dùng Android Emulator, Mobile web hoặc thiết bị iOS thật với Expo client tương thích và Expo LAN tự động.

### Cấu hình Entra bị yêu cầu trong local

Frontend local không cần `VITE_ENTRA_*` hoặc `EXPO_PUBLIC_ENTRA_*`. Nếu API báo thiếu biến Entra, kiểm tra:

```powershell
Select-String -Path .env -Pattern '^AUTH_MODE='
```

Đặt `AUTH_MODE=local`, bảo đảm có `LOCAL_AUTH_JWT_SECRET` và `LOCAL_AUTH_USERS`, rồi restart API/frontend dev servers.

## Tài liệu liên quan

- [Documentation map và canonical product rules](./docs/README.md)
- [Technical Requirements](./docs/02-technical-requirements.md)
- [Backend Structure](./docs/05-backend-structure.md)
- [Local Role Testing Guide](./docs/local-role-testing.md)
