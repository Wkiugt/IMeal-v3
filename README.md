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
$env:DATABASE_URL='postgresql://CHANGE_ME_LOCAL:CHANGE_ME_LOCAL@localhost:5432/imeal?schema=public'
corepack yarn test:db
```

## Tài liệu

- [Documentation map](./docs/README.md)
- [Technical Requirements](./docs/02-technical-requirements.md)
- [Backend Structure](./docs/05-backend-structure.md)
- [Local Role Testing Guide](./docs/local-role-testing.md)
