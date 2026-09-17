# imeal-v3

IMeal là monorepo Yarn Workspaces + Turborepo cho hệ thống đăng ký, quản lý và giao suất ăn nội bộ.

## Yêu cầu

- Node.js `>=18` (khuyến nghị Node.js 20)
- Corepack, Yarn `4.18.0`
- Docker Desktop + Docker Compose v2
- Expo/Android Studio nếu chạy mobile native
- [ngrok](https://ngrok.com/download) nếu cần truy cập API từ Internet hoặc thiết bị ngoài LAN

Mọi lệnh chạy từ thư mục gốc repository.

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

Giữ local auth trong `.env`:

```dotenv
AUTH_MODE=local
REQUIRE_AUTH=true
DATABASE_URL=postgresql://postgres:postgres@localhost:6432/imeal?schema=public&pgbouncer=true
QR_SIGNING_SECRET=<chuỗi-ngẫu-nhiên-it-nhat-32-ky-tu>
LOCAL_AUTH_JWT_SECRET=<chuỗi-ngẫu-nhiên-it-nhat-32-ky-tu>
```

Thay các secret và password trong `LOCAL_AUTH_USERS`. Tài khoản mẫu gồm `staff01`–`staff05`, `kitchen01`, `kitchen02` và `admin01`.

### 2. Khởi động database và migration

```powershell
corepack yarn workspace @imeal/core prisma generate
corepack yarn workspace @imeal/contracts build
docker compose up -d db pgbouncer minio minio-create-bucket migrate
docker compose wait migrate
docker compose ps --all
```

`migrate` phải có trạng thái `Exited (0)`.

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

Chạy mỗi lệnh trong một terminal riêng:

| Thành phần       | Lệnh                                                                                      | URL/Ghi chú                       |
| ---------------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| API              | `corepack yarn workspace @imeal/api start:dev`                                            | `http://localhost:3000`           |
| Admin Web        | `$env:VITE_API_URL='http://localhost:3000'; corepack yarn workspace @imeal/admin-web dev` | `http://localhost:5173`           |
| Mobile web       | `corepack yarn workspace @imeal/mobile web`                                               | Expo web                          |
| Android Emulator | `corepack yarn workspace @imeal/mobile android`                                           | Cần AVD đang chạy                 |
| iOS Simulator    | `corepack yarn workspace @imeal/mobile ios`                                               | Chỉ macOS + Xcode                 |
| Mobile LAN       | `corepack yarn workspace @imeal/mobile start --lan`                                       | Điện thoại và máy cùng LAN        |
| Mobile tunnel    | `corepack yarn workspace @imeal/mobile start:tunnel`                                      | Tunnel cho Expo/Metro             |
| Worker           | `corepack yarn workspace @imeal/worker start:dev`                                         | Cần `DATABASE_URL` trong terminal |

API bind trên `0.0.0.0:3000`, nên có thể dùng từ browser, Android Emulator và thiết bị trong LAN. Mobile Expo LAN tự suy ra API theo máy chạy Metro; thường không cần `EXPO_PUBLIC_API_URL`.

### Chạy worker trên host

PowerShell:

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:6432/imeal?schema=public&pgbouncer=true'
$env:PORT='3001'
corepack yarn workspace @imeal/worker start:dev
```

macOS/Linux:

```bash
export DATABASE_URL='postgresql://postgres:postgres@localhost:6432/imeal?schema=public&pgbouncer=true'
export PORT=3001
corepack yarn workspace @imeal/worker start:dev
```

## Dùng ngrok

Dùng ngrok để public API đang chạy trên host:

Cài ngrok:

```powershell
winget install Ngrok.Ngrok
```

Hoặc tải từ [ngrok.com/download](https://ngrok.com/download). Đăng nhập một lần bằng auth token:

```powershell
ngrok config add-authtoken <NGROK_AUTHTOKEN>
```

```powershell
ngrok http 3000
```

Ngrok hiển thị URL dạng `https://xxxx.ngrok-free.app`. API khi đó là:

```text
https://xxxx.ngrok-free.app/api
```

### Mobile qua ngrok

Thêm URL API vào `.env` ở thư mục gốc:

```dotenv
EXPO_PUBLIC_API_URL=https://xxxx.ngrok-free.app/api
```

Sau đó khởi động lại Metro:

```powershell
corepack yarn workspace @imeal/mobile start:tunnel
```

`start:tunnel` tạo tunnel cho Expo/Metro; vẫn cần chạy riêng `ngrok http 3000` cho API. Mỗi lần URL ngrok thay đổi, cập nhật `.env` và restart Metro.

### Admin Web qua ngrok

```powershell
$env:VITE_API_URL='https://xxxx.ngrok-free.app'
corepack yarn workspace @imeal/admin-web dev
```

Không commit `.env`, token ngrok, password hoặc secret.

## Docker và kiểm tra

```powershell
# Xem service
docker compose ps

# Xem log
docker compose logs -f db pgbouncer minio migrate

# Dừng stack, giữ dữ liệu
docker compose down

# Xóa toàn bộ dữ liệu local
docker compose down -v
```

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
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/imeal?schema=public'
corepack yarn test:db
```

## Tài liệu

- [Documentation map](./docs/README.md)
- [Technical Requirements](./docs/02-technical-requirements.md)
- [Backend Structure](./docs/05-backend-structure.md)
- [Local Role Testing Guide](./docs/local-role-testing.md)
