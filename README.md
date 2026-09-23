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

Chạy mỗi lệnh trong một terminal riêng. API phải chạy trước các chế độ mobile:

| Thành phần        | Lệnh                                                                                      | URL/Ghi chú                                      |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| API               | `corepack yarn workspace @imeal/api start:dev`                                            | `http://localhost:3000`                          |
| Admin Web         | `$env:VITE_API_URL='http://localhost:3000'; corepack yarn workspace @imeal/admin-web dev` | `http://localhost:5173`                          |
| Mobile web        | `corepack yarn workspace @imeal/mobile web`                                               | Expo web                                          |
| Android local     | `corepack yarn workspace @imeal/mobile android:local`                                     | Emulator hoặc Android cắm USB; cần `adb`         |
| Android Emulator  | `corepack yarn workspace @imeal/mobile android`                                           | Cần AVD đang chạy                                 |
| iOS Simulator     | `corepack yarn workspace @imeal/mobile ios`                                               | Chỉ macOS + Xcode                                 |
| Mobile LAN        | `corepack yarn workspace @imeal/mobile start:lan`                                         | Điện thoại và máy cùng LAN                        |
| Mobile remote     | `corepack yarn workspace @imeal/mobile start:remote`                                      | Cần `EXPO_PACKAGER_PROXY_URL` và API public URL   |
| Worker            | `corepack yarn workspace @imeal/worker start:dev`                                         | Cần `DATABASE_URL` trong terminal                  |

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

Để trống `EXPO_PUBLIC_API_URL`, giữ API bind `0.0.0.0:3000`, cho phép inbound TCP `3000` và `8081` trong Windows Firewall, rồi chạy:

```powershell
corepack yarn workspace @imeal/mobile start:lan
```

Quét QR trên điện thoại. Không dùng ngrok trong chế độ LAN.

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
