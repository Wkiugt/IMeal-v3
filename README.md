# IMeal v2

IMeal v2 là monorepo dùng Yarn Workspaces và Turborepo cho hệ thống đăng ký, quản lý và giao suất ăn nội bộ.

## Kiến trúc

| Thành phần | Thư mục | Công nghệ | Vai trò |
| --- | --- | --- | --- |
| API backend | `apps/api` | NestJS + Fastify + Prisma | API nghiệp vụ, xác thực Microsoft Entra ID |
| Background worker | `apps/worker` | NestJS + Scheduler | Job định kỳ, xử lý nghiệp vụ nền |
| Mobile frontend | `apps/mobile` | React Native + Expo | Ứng dụng Staff/Kitchen trên Android, iOS và web preview |
| Admin frontend | `apps/admin-web` | Vite + TypeScript + MSAL | Giao diện quản trị, được build thành static files |
| Database/domain | `packages/domain` | PostgreSQL + Prisma | Schema, migration và domain services |
| API contracts | `packages/contracts` | TypeScript + Zod | Schema dùng chung giữa các package |
| Reverse proxy | `Caddyfile` | Caddy | Một entry point cho Admin Web, API và object storage |

Luồng request khi chạy Docker:

```text
Browser/Mobile
      |
      v
Caddy :80
  |       \
  |        +--> Admin Web (Nginx :80)
  +-------> API (NestJS :3000) --> PgBouncer --> PostgreSQL
  |
  +-------> MinIO (/storage/*)

Worker (NestJS :3001) -------------------------> PgBouncer/PostgreSQL
```

## Yêu cầu cài đặt

- Node.js 20 LTS (khuyến nghị). Workspace khai báo Node.js `>=18`; nếu dùng Node.js 25+ thì cài Corepack riêng như hướng dẫn bên dưới. Docker image sử dụng Node.js 20.
- Corepack và Yarn `4.18.0`.
- Docker Desktop có Docker Compose v2; trên server Linux dùng Docker Engine + Compose plugin.
- Tài khoản Microsoft Entra ID và các giá trị tenant/client/scope hợp lệ nếu bật đăng nhập thật.
### Corepack là gì?

Node.js là runtime để chạy JavaScript; npm và Yarn là các package manager. Corepack là lớp trung gian đi kèm một số bản Node.js, tạo lệnh `yarn`/`pnpm` và tự chọn đúng phiên bản package manager mà project khai báo.

Root `package.json` của IMeal khai báo:

```json
"packageManager": "yarn@4.18.0"
```

Vì vậy không cần cài Yarn 4 bằng một bản global tùy ý. Corepack sẽ dùng đúng Yarn `4.18.0`, giúp mọi máy developer và CI dùng cùng cách resolve dependency.

Corepack **không phải Node.js**, không thay thế npm và không cài dependency của project:

1. `corepack enable` tạo các shim/lệnh `yarn` trong PATH.
2. `corepack install --global yarn@4.18.0` tải và kích hoạt Yarn 4.18.0 cho Corepack.
3. `yarn install --immutable` dùng Yarn đã chọn để cài dependency từ lockfile; nếu lockfile cần thay đổi, lệnh sẽ dừng thay vì tự sửa.

Node.js 20 thường đã có Corepack. Từ một số bản Node.js mới hơn, Corepack không còn được đóng gói sẵn. Nếu PowerShell báo `corepack is not recognized`, cài Corepack riêng bằng npm:

```powershell
npm install --global corepack
corepack enable
corepack install --global yarn@4.18.0
```

Nếu `corepack` đã có sẵn, chỉ cần:

```bash
corepack enable
corepack install --global yarn@4.18.0
```

Kiểm tra sau khi cài:

```bash
node --version
corepack --version
yarn --version
```

Kết quả cuối cùng của `yarn --version` phải là `4.18.0`. Một số Corepack cũ dùng lệnh tương đương `corepack prepare yarn@4.18.0 --activate`.

## Cài đặt source và dependency

Clone source:

```bash
git clone <repository-url>
cd IMeal
```

Kích hoạt Yarn và cài dependency:

```bash
corepack enable
corepack install --global yarn@4.18.0
yarn install --immutable
```

`corepack enable` chỉ cần chạy lại khi shim bị mất hoặc khi đổi Node.js. `yarn install --immutable` cần chạy sau khi clone project, sau khi xóa `node_modules` hoặc khi dependency thay đổi.

Nếu dùng Node.js 25+ và máy chưa có Corepack, thực hiện phần cài Corepack ở trên trước khi chạy các lệnh này.

Kiểm tra workspace sau khi cài:

```bash
yarn typecheck
yarn test:unit
yarn build
```

Các test cần database dùng PostgreSQL và biến `DATABASE_URL`:

```bash
yarn test:db
```

## Biến môi trường

Tạo file `.env` ở thư mục gốc để Docker Compose đọc:

```bash
cp .env.example .env
```

Trên PowerShell:

```powershell
Copy-Item .env.example .env
```

Thay tối thiểu các placeholder sau trong `.env` trước khi chạy stack:

| Biến | Mục đích |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Tài khoản và database PostgreSQL |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | Tài khoản MinIO |
| `MINIO_BUCKET_NAME` | Bucket lưu object |
| `ENTRA_TENANT_ID` | Tenant Microsoft Entra ID |
| `ENTRA_CLIENT_ID` | App registration của API/Admin Web |
| `ENTRA_API_SCOPE` | Scope API mà frontend yêu cầu |
| `QR_SIGNING_SECRET` | Secret ký QR, bắt buộc ít nhất 32 ký tự ngẫu nhiên |
| `PROXY_HTTP_PORT`, `PROXY_HTTPS_PORT` | Port public của Caddy |

Không commit `.env`, client secret, private key hoặc token. Đổi toàn bộ mật khẩu mặc định trước khi triển khai Internet-facing.

`EXPO_PUBLIC_*` và `VITE_*` chủ yếu dùng cho chạy frontend local. Khi build `admin-web` bằng Compose, các giá trị Entra được truyền từ `ENTRA_*` vào Docker build.

## Chạy toàn bộ server bằng Docker Compose

### 1. Kiểm tra cấu hình Compose

```bash
docker compose config
```

Lệnh này giúp phát hiện biến môi trường bắt buộc còn thiếu trước khi build.

### 2. Build và khởi động server

```bash
docker compose up --build -d
```

Compose khởi động các service theo thứ tự healthcheck:

1. `db`: PostgreSQL 15 và volume `db_data`.
2. `pgbouncer`: connection pool cho PostgreSQL.
3. `minio`: object storage và volume `minio_data`.
4. `minio-create-bucket`: tạo bucket nếu chưa tồn tại.
5. `migrate`: chạy `prisma migrate deploy` một lần.
6. `api`: NestJS API, chỉ khởi động sau khi migration thành công.
7. `worker`: background jobs.
8. `admin-web`: build frontend và phục vụ bằng Nginx.
9. `caddy`: reverse proxy public.

Kiểm tra trạng thái:

```bash
docker compose ps
docker compose logs -f api worker caddy
```

### 3. Các địa chỉ sau khi chạy

| Địa chỉ | Nội dung |
| --- | --- |
| `http://localhost/` | Admin Web qua Caddy |
| `http://localhost/api/...` | API qua Caddy |
| `http://localhost/health` | Health endpoint của Admin Web |
| `http://localhost:9001` | MinIO Console |
| `http://localhost:9000` | MinIO API |
| `localhost:5432` | PostgreSQL từ máy host |
| `localhost:6432` | PgBouncer từ máy host |

API container không publish trực tiếp port `3000` ra host; request production đi qua Caddy. Health của API có thể kiểm tra bên trong container:

```bash
docker compose exec api wget -qO- http://127.0.0.1:3000/health
docker compose exec worker wget -qO- http://127.0.0.1:3001/
```

Các route API được Caddy chuyển tiếp gồm `/api/*`, `/auth/*`, `/registrations/*`, `/admin/*`, `/v1/*` và `/internal/*`. Object storage được chuyển tiếp qua `/storage/*`.

### 4. Dừng, xem log và cập nhật

```bash
# Dừng container nhưng giữ database/object-storage volumes
docker compose down

# Build lại sau khi thay đổi source
docker compose up --build -d

# Theo dõi toàn bộ log
docker compose logs -f
```

Không dùng `docker compose down -v` trừ khi muốn xóa toàn bộ dữ liệu PostgreSQL, MinIO và dữ liệu Caddy.

## Chạy backend local để phát triển

Docker Compose là cách đơn giản nhất để chạy đầy đủ backend. Nếu cần hot reload API/worker, chạy dependency bằng Docker và chạy process Node.js trên máy host.

### 1. Khởi động dependency

```bash
docker compose up -d db pgbouncer minio minio-create-bucket
```

### 2. Tạo environment cho API local

Script `apps/api` nạp file `packages/domain/.env`. Tạo file này và đặt các giá trị tương ứng:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/imeal?schema=public
REQUIRE_AUTH=true
ENTRA_TENANT_ID=<entra-tenant-id>
ENTRA_CLIENT_ID=<entra-client-id>
ENTRA_API_SCOPE=api://<entra-client-id>/access_as_user
QR_SIGNING_SECRET=<chuoi-ngau-nhien-it-nhat-32-ky-tu>
```

Chạy migration và generate Prisma Client:

```bash
yarn workspace @imeal/core prisma migrate deploy
yarn workspace @imeal/core prisma generate
```

### 3. Chạy API và worker

API có sẵn script nạp `packages/domain/.env`:

```bash
yarn workspace @imeal/api start:dev
```

API local lắng nghe tại `http://localhost:3000`.

Worker cần nhận `DATABASE_URL` trong environment của terminal. Ví dụ:

```bash
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/imeal?schema=public'
yarn workspace @imeal/worker start:dev
```

Trên PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/imeal?schema=public"
yarn workspace @imeal/worker start:dev
```

Worker local lắng nghe tại `http://localhost:3001`.

## Chạy frontend local

### Admin Web

Tạo `apps/admin-web/.env.local`:

```dotenv
VITE_API_URL=http://localhost:3000
VITE_ENTRA_TENANT_ID=<entra-tenant-id>
VITE_ENTRA_CLIENT_ID=<entra-client-id>
VITE_ENTRA_API_SCOPE=api://<entra-client-id>/access_as_user
```

Chạy Vite dev server:

```bash
yarn workspace @imeal/admin-web dev
```

Mở URL Vite hiển thị trong terminal, thường là `http://localhost:5173`.

Nếu muốn frontend local gọi API qua Caddy thay vì port `3000`, đặt `VITE_API_URL=http://localhost` và bảo đảm Docker Compose đang chạy.

Build production frontend:

```bash
yarn workspace @imeal/admin-web build
```

### Mobile Expo

Tạo `apps/mobile/.env`:

```dotenv
EXPO_PUBLIC_API_URL=http://<host-ip>:3000/api
EXPO_PUBLIC_ENTRA_TENANT_ID=<entra-tenant-id>
EXPO_PUBLIC_ENTRA_CLIENT_ID=<entra-client-id>
EXPO_PUBLIC_ENTRA_API_SCOPE=api://<entra-client-id>/access_as_user
```

Chạy Expo:

```bash
yarn workspace @imeal/mobile start
yarn workspace @imeal/mobile android
yarn workspace @imeal/mobile ios
yarn workspace @imeal/mobile web
```

- iOS Simulator có thể dùng `http://localhost:3000/api`.
- Android Emulator thường dùng `http://10.0.2.2:3000/api` để truy cập host.
- Điện thoại thật phải dùng IP LAN của máy chạy API, ví dụ `http://192.168.1.10:3000/api`, và firewall phải cho phép port đó.

Mobile hiện không có Dockerfile và không nằm trong `docker-compose.yml`; chạy qua Expo là flow phát triển chính thức. Khi dùng server Docker, đổi `EXPO_PUBLIC_API_URL` thành địa chỉ server, ví dụ `http://imeal.example.com/api`.

## Triển khai server Linux

1. Cài Docker Engine và Docker Compose plugin.
2. Clone source vào server.
3. Tạo `.env` từ `.env.example`, dùng secret/mật khẩu riêng của môi trường production.
4. Mở firewall cho port public đã chọn (`PROXY_HTTP_PORT`, và HTTPS nếu cấu hình TLS).
5. Chạy:

```bash
docker compose config
docker compose up --build -d
docker compose ps
docker compose logs -f api worker caddy
```

Compose hiện cấu hình Caddy ở chế độ HTTP (`auto_https off`) và route `:80`. Port `443` được khai báo trong Compose nhưng muốn có HTTPS thật cần cập nhật `Caddyfile` với domain và cấu hình TLS trước khi public Internet. Không dùng cấu hình bucket public mặc định của local stack cho dữ liệu nhạy cảm nếu chưa review policy storage.

Baseline production được khuyến nghị trong tài liệu kiến trúc là Linux 4 vCPU, 8 GB RAM, 100 GB SSD; workload nhỏ có thể bắt đầu từ 2 vCPU và 4 GB RAM. Production cần bổ sung backup PostgreSQL/MinIO, centralized logging, health monitoring và alerting.

## Kiểm tra và phát triển

```bash
# Kiểm tra type toàn workspace
yarn typecheck

# Unit tests không cần database
yarn test:unit

# Database/e2e tests; cần PostgreSQL và DATABASE_URL
yarn test:db

# Build toàn workspace
yarn build

# Format source và tài liệu khi cần
yarn format
```

## Tài liệu kỹ thuật

- [Tài liệu kiến trúc và đặc tả](./docs/README.md)
- [Yêu cầu kỹ thuật](./docs/02-technical-requirements.md)
- [Cấu trúc backend](./docs/05-backend-structure.md)
- [Kế hoạch triển khai](./docs/06-execution-plan.md)
- [Quyết định kiến trúc](./docs/07-architecture-decisions.md)
