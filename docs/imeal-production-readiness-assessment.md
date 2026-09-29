# Đánh giá mức sẵn sàng production IMeal

**Kết luận:** **NOT READY cho public production.**

Bản đánh giá này là inventory evidence-first của client/product, kết hợp các
finding backend/operations đã được quét trong repository. Task 9 bổ sung
evidence rollout local/disposable cho Workstream A, nhưng không biến local
evidence thành staging/production approval. Các P0 hạ tầng, backup/restore,
observability, identity provisioning và product workflow vẫn chặn release.

> **Phạm vi tài liệu:** đây là readiness assessment canonical. Task 9 cập nhật
> các finding Workstream A và checklist từ kết quả quan sát; không ghi secret,
> dữ liệu employee/location thật hoặc operational approval chưa có bằng chứng.

## 1. Phạm vi và độ tin cậy

### Phạm vi đã quét

- `docs/`, `README.md`, `AGENTS.md`: yêu cầu sản phẩm, UX/recovery, technical contract, architecture decisions, execution/release checklist.
- `apps/api`: auth/session, registrations, pickup/serving, Kitchen dashboard/events, notifications, delegations, admin operations.
- `apps/worker`: worker/runtime structure và các dấu hiệu retention/operational job.
- `apps/mobile`: navigation, auth/session, API wrappers, Staff/Kitchen screens, GPS/QR/camera/push, accessibility và tests hiện có.
- `apps/admin-web`: OTP, menu, penalties, locations, allowlist, roster, audit/session UI, Docker/nginx config.
- `packages/contracts`, `packages/domain`, `packages/ui`, root config/Compose/Caddy.

### Quy ước trạng thái

- **Implemented:** có client/screen hoặc API path thật, schema/route tương ứng và không thấy gap chức năng chính trong phần đã quét.
- **Partial:** có code chạy được nhưng thiếu một phần contract, UX, recovery, concurrency, data thật hoặc deployment proof.
- **Prototype:** hardcoded/static/demo/callback local, không phải product path authoritative.
- **Missing:** không tìm thấy client surface/API call/operational evidence cho yêu cầu đã nêu.

### Độ tin cậy và giới hạn

- **Cao:** kết luận dựa trên source, route, schema, config và line-level evidence.
- **Trung bình:** kết luận end-to-end/deployment vì chưa có runtime/provisioning evidence.
- Baseline assessment was a static scan and did not run deployment/UAT. The
  Task 9 addendum records disposable PostgreSQL migration, preflight, backfill,
  constraint and focused-suite commands, but no staging/production deployment,
  backup restore, secret/provider provisioning, native-device/UAT or production
  evidence.
- Vì vậy, route/source tồn tại không đồng nghĩa provider, database, secret, TLS, device permission hoặc release artifact đã được cấu hình đúng.

## 2. Tóm tắt quyết định release

| Hạng mục                            | Đánh giá                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| Staff đăng nhập OTP                 | **Implemented happy path; session-expiry recovery partial**                     |
| Staff registration/cutoff           | **Implemented API path; weekly UX và menu data partial**                        |
| QR/GPS presenter                    | **Implemented client path; device/a11y/UAT partial**                            |
| Kitchen scan/resolve/confirm        | **Implemented strongest operational path; concurrency/UAT cần chứng minh**      |
| Kitchen dashboard                   | **Implemented snapshot/polling; realtime và status filter có gap nghiêm trọng** |
| Delegation                          | **List/actions partial; owner create/search missing**                           |
| Notification inbox                  | **Implemented; push/deployment dependent**                                      |
| Staff history/penalty               | **Missing**                                                                     |
| Admin menus/penalties/operations    | **Partial đến implemented từng module**                                         |
| Admin user/role/disable/jobs/health | **Missing**                                                                     |
| Worker/retention/operations         | **Chưa có evidence đủ để release**                                              |
| Production infrastructure           | **Unsafe/local assumptions; not ready**                                         |
| Tổng thể                            | **NO-GO**                                                                       |

## 3. Inventory theo backend/domain

### 3.1 API authority, auth và contract

**Evidence:**

- Kiến trúc đặt API server làm authority, client không truy cập DB: `docs/05-backend-structure.md:1-15` và `AGENTS.md` phần architecture.
- OTP/session controller thật: `apps/api/src/auth/auth.controller.ts:44-129`.
- Session lưu token hash/audit và xử lý expired/disabled ở service: `apps/api/src/auth/session.service.ts`.
- Contract v1 có auth/session, registration, pickup, kitchen, delegation, notifications: `packages/contracts/src/v1/` và `packages/contracts/test/contracts.test.ts`.

**Đánh giá:** auth/session model có nền tảng đúng (allowlist-A, opaque session, audit), nhưng account/role/disable lifecycle chưa hoàn chỉnh ở client/admin và chưa có production provider/runtime evidence. Technical docs yêu cầu envelope, request ID và idempotency conventions (`docs/02-technical-requirements.md:216-224`), trong khi nhiều active client wrapper parse raw response (`apps/mobile/src/api/registrationAPI.ts:34-64`, `kitchenAPI.ts:49-54`, `pickupAPI.ts:165-217`). Cần xác nhận HTTP response thực tế và loại bỏ contract drift trước release.

### 3.2 Registration và menu data — lỗi P0

**Đường triển khai hiện có:**

- Mobile gọi `GET /api/registrations/week` và `PUT /api/registrations/batch`: `apps/mobile/src/api/registrationAPI.ts:21-64`.
- Route API: `apps/api/src/registrations/registrations.controller.ts:12-44`.
- Server tính cutoff, lunar date, available meal choices và đọc registration: `apps/api/src/registrations/registrations.service.ts:68-178`.
- Contract batch có per-date success/failure: `packages/contracts/src/v1/registrations.ts:33-99`.

**Critical finding:**

- `apps/api/src/registrations/registrations.service.ts:333-341` không persist **location snapshots** khi tạo/cập nhật registration.
- `apps/api/src/pickup/pickup.service.ts` yêu cầu location snapshot để kiểm tra/định tuyến pickup intent.
- Đây là lỗi tính đúng dữ liệu, không chỉ thiếu UI: registration có thể tồn tại nhưng pickup sau đó không có snapshot location authoritative.

**Client gap:**

- `apps/mobile/src/screens/employee/EmployeeCalendarScreen.tsx:400-513,526-560` gửi batch một item ngay khi toggle. Product docs yêu cầu draft cả tuần, sticky “Lưu thay đổi”, select-all và giữ failed drafts (`docs/04-ui-ux-design.md:148-206`, `docs/03-product-flows.md:128-205`).
- Contract `WeekDailyMenuSchema` chỉ có date/holiday/enabled/timestamps, không có meal content/name/image: `packages/contracts/src/v1/registrations.ts:154-183`.
- Staff Home hiển thị nội dung tĩnh `dashboard.mealName`, `mealDescription`, `location`: `apps/mobile/src/screens/employee/EmployeeDashboardScreen.tsx:104-110`; translation tĩnh tại `apps/mobile/src/i18n/translations.ts:113-116`.

**Đánh giá:** API cutoff và registration state là **partial implemented**, nhưng location snapshot phải sửa trước mọi pilot. Menu data/weekly UX chưa đủ để xác nhận staff đăng ký đúng món và location.

### 3.3 Pickup, GPS, QR và serving

**Evidence triển khai:**

- Options và exact selected intent: `apps/mobile/src/api/pickupAPI.ts:128-170`.
- QR generate, sorted IDs, server response validation: `apps/mobile/src/api/pickupAPI.ts:138-169`.
- Foreground GPS permission/watch/cleanup: `apps/mobile/src/api/locationAPI.ts:62-126`.
- Pickup intent selection, QR refresh và focus cleanup: `apps/mobile/src/screens/pickup/PickupIntentScreen.tsx:124-302`.
- Camera scan → resolve → 30-second pickup session → confirm: `apps/mobile/src/screens/kitchen/KitchenScannerScreen.tsx:190-335,598-710`.
- Confirm có idempotency key và no item-level editing: `KitchenScannerScreen.tsx:246-267`; server routes/guard: `apps/api/src/pickup/internal-pickup.controller.ts:11-34`.

**Đánh giá:** đây là path client mạnh nhất và phù hợp nguyên tắc exact intent, QR-only, foreground GPS, all-or-nothing confirm. Tuy nhiên chưa có native device UAT, concurrency run hoặc proof rằng registration location snapshot đã được lưu; vì vậy không được coi là production-safe dù code path tồn tại.

**Accessibility gap:** `QrTicket.tsx:113-119` announce state transition, nhưng TTL/countdown chỉ là progressbar metadata tại `QrTicket.tsx:267-303`; docs yêu cầu live announcement khi code sắp hết hạn (`docs/04-ui-ux-design.md:208-239`).

### 3.4 Kitchen dashboard và realtime — lỗi P0/P1

**Client/server path:**

- API wrapper: `apps/mobile/src/api/kitchenAPI.ts:41-77`.
- Dashboard screen: `apps/mobile/src/screens/kitchen/KitchenDashboardScreen.tsx:76-111,175-224,531-674`.
- API controller/SSE route: `apps/api/src/kitchen/kitchen-dashboard.controller.ts:18-63`.
- Server event envelope: `apps/api/src/kitchen/kitchen-events.service.ts`.

**Critical finding:**

- `apps/api/src/kitchen/kitchen-dashboard.service.ts:34-39` filters registrations by `ACTIVE` only.
- Serving flow changes a served registration to `SERVED`.
- Vì vậy dashboard query không còn nhìn thấy những record đã phục vụ trong cùng tập dữ liệu; counters/lists có thể mất served rows hoặc không nhất quán với `servedCount`. Đây là data correctness issue cần sửa bằng projection/status semantics rõ ràng và test concurrency/transition.

**Realtime finding:** backend có SSE nhưng mobile chỉ polling mỗi 5 giây (`KitchenDashboardScreen.tsx:101-111`), không có SSE client, event-id dedup, reconnect và forced refetch. UI có stale/offline badge và retry, nhưng không thay thế được realtime contract.

**Search gap:** client lọc theo name/email (`KitchenDashboardScreen.tsx:194-212`), không có employee-code audited recovery như product requirement (`docs/01-product-requirements.md:217-234`).

### 3.5 Delegation

- API CRUD wrapper: `apps/mobile/src/api/delegationAPI.ts:36-86`.
- Backend controller: `apps/api/src/delegations/delegations.controller.ts:20-65`.
- Mobile list/actions: `apps/mobile/src/screens/delegation/DelegationScreen.tsx:48-166`.

**Trạng thái:** **partial**. Incoming accept/decline và outgoing revoke có thật; owner `createDelegation` tồn tại ở wrapper nhưng không được screen gọi. Không có search user theo name/employee code, chọn registration/date, submit request, hiển thị tên người nhận hay revoke confirmation theo yêu cầu. Contract chỉ có IDs/status/timestamps (`packages/contracts/src/v1/delegations.ts:20-27`). Đây là missing feature cho proxy pickup.

### 3.6 Notifications

- API list/detail/read/preferences/push: `apps/mobile/src/api/notificationAPI.ts:30-153`.
- List cursor/pull refresh/retry/load more: `NotificationListScreen.tsx:42-167`.
- Detail mark-read và action deep links: `NotificationDetailScreen.tsx:21-95`.
- Expo device token/permission/revoke: `apps/mobile/src/notifications/NotificationProvider.tsx:92-377`.
- Backend routes: `apps/api/src/notifications/notifications.controller.ts:25-113`.

**Trạng thái:** persisted inbox **implemented**; push **partial/deployment-dependent**. Provider đã có fallback khi physical device/EAS configuration thiếu, nhưng chưa có evidence provider/EAS project/release build thật.

### 3.7 Admin backend/domain operations

Các path đã có client calls thật trong `apps/admin-web/src/main.ts`:

- Menu draft/edit/publish: `:419-511`, backend `apps/api/src/admin/weekly-menus/weekly-menus.controller.ts`.
- Penalties list/paid/waive: `:513-577`, backend `apps/api/src/admin/penalties/penalties.controller.ts`.
- Locations/policy/scanner: `:579-735`, backend `apps/api/src/admin/locations/locations.controller.ts`.
- Allowlist list/create/toggle: `:737-844`, backend `apps/api/src/admin/allowlist/allowlist.controller.ts`.
- Roster preview/all-or-nothing commit: `:846-948`, `apps/admin-web/src/admin-operations.ts:230-295`, backend roster import controller/service.

**Trạng thái:** từng module từ **implemented** đến **partial**. Menu không có image upload/progress; location UI không có đầy đủ create/import lifecycle; roster cần paste JSON. Admin local schemas được khai báo trong `main.ts:14-189` thay vì dùng `@imeal/contracts`, tạo drift risk.

**Missing admin lifecycle:** view union chỉ là `menus | penalties | operations` (`main.ts:206`), không có `/admin/users` hoặc screen để quản lý Staff/Kitchen roles, disable account, revoke sessions, jobs/health. Audit `main.ts:399-405,950-980` chỉ là in-memory session list, không phải server audit lookup.

## 4. Inventory theo mobile client

| Area                     | Evidence                                                                                      | Status                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Navigation/auth boundary | `apps/mobile/App.tsx:68-131,185-342`; `src/navigation.ts:5-53`                                | Implemented, nhưng no-mobile-access và expired-session recovery chưa đủ |
| OTP/session storage      | `src/api/authAPI.ts:61-170`; `src/auth/session.tsx:31-220`                                    | Implemented happy path; web localStorage và no global 401 recovery      |
| Staff calendar           | `screens/employee/EmployeeCalendarScreen.tsx:228-976`                                         | Partial: API/cutoff thật, UX save tuần thiếu                            |
| Staff Home               | `screens/employee/EmployeeDashboardScreen.tsx:27-143`                                         | Partial: status thật, menu/location tĩnh                                |
| QR/GPS                   | `screens/pickup/PickupIntentScreen.tsx`; `api/locationAPI.ts`; `api/pickupAPI.ts`             | Implemented path; device/a11y/UAT partial                               |
| Kitchen scanner          | `screens/kitchen/KitchenScannerScreen.tsx`                                                    | Implemented path; physical device/concurrency proof missing             |
| Kitchen dashboard        | `screens/kitchen/KitchenDashboardScreen.tsx`                                                  | Partial: polling, status/search/realtime gaps                           |
| Delegation               | `screens/delegation/DelegationScreen.tsx`                                                     | Partial: list/actions, create/search missing                            |
| Notification inbox       | `screens/notifications/NotificationListScreen.tsx`, `NotificationDetailScreen.tsx`            | Implemented path                                                        |
| Staff profile            | `screens/employee/EmployeeProfileScreen.tsx:202-315`                                          | Prototype data for stats; history/penalties missing                     |
| Kitchen profile          | `screens/kitchen/KitchenProfileScreen.tsx`                                                    | Basic identity/settings/logout only                                     |
| Accessibility primitives | `src/ui/components/Controls.tsx:44-98,191-232,312-423`; `AppShell.tsx`; `useReducedMotion.ts` | Good foundation; QR countdown gap                                       |
| API error/retry          | `src/api/mobileApiError.ts:15-166`; screen-local Retry                                        | Partial; generic mapping, no offline queue/global session reset         |

## 5. Inventory theo Admin Web

**Đã có:** OTP login, menu editing/publish, penalties, location policy, allowlist, roster preview/commit và safe redaction (`apps/admin-web/src/main.ts`, `admin-operations.ts`). Docker build/nginx files tồn tại (`apps/admin-web/Dockerfile`, `nginx.conf`).

**Chưa đủ:**

- Không có user/role/disable lifecycle hoặc session revoke UI.
- Không có jobs/health/worker dashboard.
- Audit không phải server-backed lookup.
- API helper không có timeout/retry/idempotency/canonical error envelope (`main.ts:199-303`).
- Admin local validation/schema không dùng shared v1 contracts.
- Input/loading/error accessibility và operational UX còn cơ bản; waive dùng `window.prompt`.
- `preview.html` và `penalties-preview.html` là static/reference demo, không phải runtime API UI (`preview.html:682-689`, `penalties-preview.html:939-1043`).

## 6. Inventory theo worker/operations

- Worker package/runtime tồn tại, nhưng scan không tìm thấy evidence đầy đủ cho retention worker, retry dashboard, backup job, health/alert integration hoặc documented runbook dưới `apps/worker`.
- Không có evidence centralized observability (logs/metrics/traces/alerts), backup-restore rehearsal, retention enforcement hoặc CI/CD pipeline/release artifact.
- Execution plan vẫn để các release/UAT/deployment gates unchecked: `docs/06-execution-plan.md:487-565,569-625`.
- Dữ liệu vận hành thật (allowlist, roster, bốn location approved, OTP provider) không nằm trong repo theo nguyên tắc `docs/README.md:12-21,91-94`; cần provision có kiểm soát, không dùng sample seed public.

## 7. P0/P1/P2 readiness gaps

### P0 — phải đóng trước pilot có dữ liệu thật

1. **Registration location/menu/owner snapshot:** implementation now resolves
   and persists immutable server-authoritative snapshots for new and reactivated
   registrations; focused pickup/registration and PostgreSQL concurrency tests
   pass. The staging preflight/backfill gate is still open.
2. **Kitchen status projection:** implementation now derives pending/served/
   no-show from registration plus `meal_servings`, retains served rows and
   fails closed on mismatches; focused dashboard, route and PostgreSQL e2e
   evidence passed. Staging approval is still open.
3. **No-show/penalty concurrency:** implementation now locks registration
   first, uses unique `Penalty.registrationId`, commits penalty/audit/
   notification/outbox atomically and preserves `PAID`/`WAIVED`; focused worker
   and PostgreSQL race/retry evidence passed. Staging approval is still open.
4. **Public network/security:** không expose DB/PgBouncer/MinIO; tắt public MinIO bucket; bỏ MD5/plain auth; rotate secrets; pin image digests/tags; sửa admin-web Dockerfile/build mismatch. Evidence hiện tại: `Caddyfile:1-17`, `docker-compose.yml` service/ports/auth/image sections, `apps/admin-web/Dockerfile`.
5. **TLS và boundary:** Caddy hiện `auto_https off`, listen `:80`; phải terminate TLS tại Caddy, redirect HTTP, set trusted proxy/security headers và verify mobile/admin URLs.
6. **Backup/restore:** có encrypted offsite backup, restore rehearsal, RPO/RTO và runbook trước pilot.
7. **Provisioning/identity:** hoàn tất allowlist, roster, role assignment, account disable/session revoke lifecycle; không có public fallback/local account.

### Workstream A Task 9 rollout evidence and blockers — NOT COMPLETE / NO-GO

The operator procedure is the
[staging readiness runbook](runbooks/staging-readiness.md), and its
`scripts/staging/runbook-links.test.mjs` acceptance checks pass locally. This
is documentation/tooling evidence only; it does not claim a staging target,
external approval, or production qualification.

- **Current hard blocker:** this application has no actual hardening `/metrics`
  collectors/endpoints, so protected runtime integration fails closed.
- **Current external blockers:** the approved edge WAF/rate-limit control and
  alert route are not provisioned; real staging env/DNS/TLS/OTP, backup
  restore, alert delivery, UAT, identity approval, and location/roster
  approval are absent.

- Fresh Step 2 disposable sequence at HEAD
  `75a9d719deb511503dfc55a11b52a81ab6d049a6` is GREEN locally:
  `phase0_step2_20260928131738` applied all eight migrations, passed generate/
  validate, returned zero rows after expand, passed clean seven-check/four-
  status preflight, ran the current backfill twice idempotently, passed
  post-backfill preflight and validated both named constraints.
- This local sequence is implementation evidence only, not Workstream A closure
  or an approval record. Release status remains **CONDITIONAL / NO-GO** because
  no approved staging/representative target, independent approval,
  backup/restore rehearsal or production evidence exists.
- The rollout scope is `status <> 'CANCELLED' OR meal_date >= current business
date in Asia/Ho_Chi_Minh`; only earlier cancelled rows are legacy history
  allowed nullable snapshots. Serving mismatches are checked for every status.
  Roster resolution requires one active, date-effective assignment and
  location.
- The existing local public schema is intentionally not approval evidence:
  preflight found 132 incomplete snapshots, 6 ambiguous/effectively invalid
  roster assignments, 132 incomplete menu revisions and 40 incomplete future
  ACTIVE rows (status counts ACTIVE 66, CANCELLED 16, SERVED 40, NO_SHOW 10).
  No backfill or validation was run against it.
- A representative disposable classification schema
  `phase0_step2_classification_20260928131738` returned
  `roster_assignment_ambiguous=1` for
  `registration-step2-invalid-location` and
  `future_active_snapshot_incomplete=1` for
  `registration-step2-stale-menu`; the other five checks were zero. Because
  named checks were nonzero, no backfill or validation was run there.
- `DATABASE_URL` was missing from the ambient shell and no staging target was
  available; the observed PostgreSQL runs used an explicitly supplied local
  disposable URL and target-safe containerized `psql` because host `psql` was
  unavailable.
- Fresh Step 1 verification at HEAD `75a9d71` supersedes the historical
  pre-75 failures: core focused 42/42; core full 93/93 with the intentional
  serial `--maxWorkers 1` caveat; API e2e 45/45 plus production concurrency
  12/12; worker e2e 5/5; `yarn typecheck` and mobile tsc passed after
  `yarn install --immutable`. Historical failure/blocker outputs remain in the
  Task 9 report for audit history.
- No independent approval/audit record, controlled external artifact/checksum,
  backup/restore rehearsal, production secret/provider provisioning,
  native-device/UAT, or staging approval was observed. If post-backfill
  preflight, validation or verification fails, cutover stays blocked and rows
  must be quarantined/remediated or the approved backup restored under the
  target's named rollback authority and decision window; no down migration is
  claimed.
- See the [Task 9 brief](../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-9-brief.md) and [Task 9 report](../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-9-report.md). Phase 0 remains **NO-GO** until the independent gates and dirty-data remediation are approved.

### P1 — phải đóng trong pilot gate

1. Staff weekly draft + sticky save/select-all/partial failure UX.
2. Server-authored menu content/name/meal type/location được trả trong contract và render ở Staff Home/calendar.
3. Mobile owner delegation create/search/date/meal selection, confirmation, status reconciliation.
4. Staff history/penalty screens/API và profile stats không hardcode.
5. Kitchen SSE/reconnect/event-id dedup hoặc documented polling fallback với explicit freshness SLA; employee-code audited recovery.
6. Global session-expiry handling, request timeout, retry classification, offline/recovery states; idempotency cho retried registration/admin mutations.
7. Physical Android camera/GPS/push/accessibility UAT và QR countdown live announcement.
8. Admin account/role/disable, jobs/health, server audit lookup; use shared contracts.
9. Centralized logs/metrics/alerts, worker health, retention worker and operational runbook.
10. CI/CD evidence: reproducible build, pinned dependencies/images, migration gate, security scan, release artifact/signing and rollback/API compatibility.

### P2 — hardening sau pilot nhưng trước mở rộng đủ bốn location

1. Loại dead duplicate `apps/mobile/src/api/servingAPI.ts` hoặc hợp nhất rõ active wrapper.
2. Xóa/đánh dấu rõ static `packages/ui` prototypes và hardcoded translation/demo data khỏi production navigation.
3. Chuẩn hóa API envelope/error/request-id giữa docs, contracts, API và Admin.
4. Hoàn thiện Admin loading, timeout, retry, structured localized errors, keyboard/screen-reader labels.
5. Bổ sung load/chaos/restore/retention/long-running worker tests và operational dashboards.
6. Cập nhật README/docs product version và deployment commands để không lẫn `imeal-v3` với canonical docs.

## 8. Topology production chi phí thấp được khuyến nghị

Mục tiêu là phục vụ khoảng **200–300 users** và bốn canteen, không over-engineer:

- **Một Linux LTS host** duy nhất, tối thiểu **4 vCPU / 8 GB RAM / 100 GB SSD**; không triển khai server riêng tại từng canteen.
- Chạy **một API process/service** và **một worker process/service**; restart policy và health check rõ ràng.
- PostgreSQL chạy private trên host/network nội bộ; không publish port DB/PgBouncer ra Internet. Chỉ expose Caddy 80/443.
- Caddy là public edge: TLS certificate tự động/managed, HTTP→HTTPS redirect, reverse proxy tới API/Admin, security headers, trusted proxy/request ID.
- Admin Web build static được serve qua Caddy; API cùng origin hoặc CORS allowlist rõ ràng cho local/dev. Không dùng `VITE_API_URL` production trỏ vào localhost.
- Offsite encrypted PostgreSQL backups, retention policy, backup verification và restore rehearsal định kỳ.
- Centralized structured logs + metrics/alerts cho API, worker, DB disk/CPU/RAM, backup, OTP delivery, push delivery, serving errors và queue lag.
- **Không dùng Kubernetes, Redis hoặc Kafka** cho quy mô 200–300 users ở giai đoạn này. Chỉ thêm khi measured bottleneck/availability requirement chứng minh cần thiết.
- Pin base image/package/image digest; không dùng `latest`; secrets qua secret manager hoặc protected host environment, không commit `.env` thật.

Sơ đồ tối giản:

```text
Staff devices / Kitchen Android / Admin managed laptop
                    |
              HTTPS :443
                    |
               Caddy TLS
              /         \
        Admin static    API
                           |
                 private PostgreSQL
                           |
                         Worker

Offsite encrypted backup <--- PostgreSQL backup job
Centralized logs/metrics/alerts <--- Caddy/API/Worker/DB
```

## 9. Device setup cho đúng bốn canteen

### Mỗi canteen

- **Một managed Android camera device** dành cho Kitchen scanner; device ID được allowlist theo location.
- Một charger cố định/stand và dây dự phòng; đặt thiết bị tại quầy, không dùng tài khoản cá nhân của nhân viên.
- Wi-Fi ổn định với network notes/contacts rõ ràng; có **4G fallback** hoặc hotspot quản trị khi Wi-Fi hỏng.
- **Spare strategy:** tối thiểu một spare Android đã enroll, sạc và cài release tương thích để thay nóng khi hỏng/mất camera/pin.
- Test đầu ca: login Kitchen, camera permission, scan QR, resolve, confirm, duplicate/expired QR, network recovery, charger/clock.
- Không đặt API/DB/server tại canteen; mọi thiết bị truy cập host trung tâm qua HTTPS.

### Người dùng khác

- **Staff:** dùng thiết bị cá nhân; hỗ trợ Android/iOS release đã ký, GPS foreground và notification opt-in. Không dựa vào Expo Go cho production.
- **Admin:** dùng managed laptop/browser được policy bảo vệ; OTP allowlist, MFA/device policy nếu tổ chức yêu cầu; không dùng browser profile chia sẻ.
- Tất cả device phải dùng production URL/TLS, timezone business `Asia/Ho_Chi_Minh`, đồng hồ hệ điều hành tự đồng bộ.

### Rollout đúng bốn location

Đăng ký và map chính xác bốn location approved; không dùng `Canteen A`, `LOC-A`, sample roster hoặc synthetic seed làm operational data. Mỗi location phải có `shortCode`, serving point, scanner device ID, GPS policy, contact, network fallback và emergency procedure.

## 10. Phased rollout

### Phase 0 — Correctness/security gate

1. Đóng location snapshot, Kitchen status projection và no-show penalty concurrency.
2. Sửa TLS/network exposure, auth/hash/plain-secret/image pinning và Dockerfile mismatch.
3. Hoàn tất backup/restore, logs/metrics/alerts, retention và worker health.
4. Provision allowlist/roles/roster/four locations bằng dữ liệu được phê duyệt.
5. Chạy API/worker migration, contract, concurrency, security và recovery tests trên staging.

**Không chuyển Phase 0 nếu một P0 còn open.**

### Phase 1 — Pilot một canteen

- Chọn một canteen có Wi-Fi tốt và đặt một managed Android + spare.
- Dùng nhóm staff/kitchen/admin thật nhưng giới hạn phạm vi; không coi sample data là pilot evidence.
- Chạy full workflow: OTP, weekly registration, cutoff, QR/GPS, scan/resolve/confirm, delegation, notification, no-show/penalty, disabled account, backup/restore và outage/retry.
- Theo dõi duplicate serving, stale dashboard, OTP delivery, push, API latency, error rate, device battery/network và operator recovery.
- Chỉ mở rộng khi pilot có sign-off theo go/no-go checklist và không còn P0.

### Phase 2 — Mở rộng location-by-location

- Thêm canteen thứ hai, thứ ba, thứ tư từng bước; mỗi bước provision location/policy/device/network/contact/roster riêng.
- Sau mỗi location, lặp smoke/UAT, verify counters/serving logs, backup, alert và incident runbook.
- Không mở đồng thời cả bốn location nếu chưa có spare/device support và load evidence.

### Phase 3 — Ổn định và tối ưu

- Chỉ sau khi bốn location ổn định mới cân nhắc thêm scaling/Redis/Kafka/Kubernetes dựa trên metrics thật.
- Duy trì quarterly restore rehearsal, dependency/image patching, device replacement và role/allowlist review.

## 11. Go/no-go checklist

### Data correctness và business invariants

- [ ] Registration persist location/menu/owner snapshots and pickup reads them
      correctly; implementation and disposable focused evidence passed, but staging
      preflight/backfill approval is not evidenced.
- [ ] Dashboard projection distinguishes pending/served/no-show and retains
      served rows; implementation and disposable API/e2e evidence passed, but the
      production gate remains open.
- [ ] Serving confirm is all-or-nothing, idempotent and duplicate-safe under
      retry/concurrency; local PostgreSQL race evidence passed, with no staging
      approval yet.
- [ ] No-show/penalty creates one registration-keyed penalty under concurrent
      retry; local worker/e2e evidence passed, with no staging approval yet.
- [ ] Cutoff, timezone `Asia/Ho_Chi_Minh`, serving window, QR TTL/skew, pickup session được test bằng server time.
- [ ] Exact selected intent và delegation consent được kiểm tra server-side.

### Product/client completeness

- [ ] Staff weekly save/select-all/partial failures hoàn chỉnh.
- [ ] Server-authored menu/location content hiển thị, không còn hardcoded meal/location/stats.
- [ ] Owner delegation create/search/confirm/revoke và notification deep-link hoàn chỉnh.
- [ ] Staff history/penalty thật, Admin users/roles/disable/jobs/health/audit lookup thật.
- [ ] Kitchen realtime/reconnect/dedup hoặc fallback SLA đã test.
- [ ] Session expiry/offline/timeout/retry/recovery đã test trên mobile và Admin.

### Security/deployment

- [ ] Caddy TLS production, redirect HTTP, security headers và trusted proxy.
- [ ] DB/PgBouncer/MinIO private; MinIO bucket không public; secrets không dùng default/placeholder.
- [ ] Bỏ MD5/plain auth; pin images/dependencies; sửa Dockerfile mismatch.
- [ ] Production mobile package/bundle IDs, signing ownership, min OS, distribution channel và EAS project đã provision.
- [ ] API/Admin/CORS/origin topology được test từ browser/device thật.
- [ ] Actual hardening `/metrics` collectors/endpoints deployed and observed;
      protected runtime integration remains fail-closed until then.
- [ ] Approved edge WAF/rate-limit control, alert route, real staging
      DNS/TLS/OTP, backup restore, UAT, identity, location and roster approvals
      are provisioned and independently reviewed.

### Operations

- [ ] Encrypted offsite backup chạy tự động và restore rehearsal thành công.
- [ ] Centralized logs/metrics/alerts, API/worker/DB health, queue/OTP/push/backup monitoring.
- [ ] Retention worker/chính sách lưu trữ và purge/audit legal review.
- [ ] CI/CD reproducible build, test gates, migration/rollback, artifact signing và release evidence.
- [ ] Bốn managed kitchen devices, chargers, Wi-Fi + 4G fallback, spare strategy được nghiệm thu.
- [ ] Pilot một canteen sign-off trước mở location tiếp theo.

**Hiện tại checklist chưa đạt; quyết định là NO-GO.**

## 12. Immediate next actions

1. Obtain an approved disposable/staging `DATABASE_URL`; rerun expand,
   preflight approval, exact backfill, post-backfill validation and all focused
   suites against the representative staging dataset.
2. Remediate or explicitly quarantine every dirty local/staging legacy gap;
   do not infer snapshots, merge penalties or validate unresolved checks.
3. Retain the historical pre-75 full-domain five-failure and mobile typecheck
   blocker results as superseded audit evidence. Fresh Step 1 evidence at HEAD
   `75a9d71` is green: core focused 42/42; core full serial 93/93 with
   `--maxWorkers 1`; API e2e 45/45 plus production concurrency 12/12; worker
   e2e 5/5; `yarn typecheck` and mobile tsc pass after `yarn install --immutable`.
   This does not replace the staging/representative-data or release gates.
4. Tách Compose local khỏi production: private DB/PgBouncer/MinIO, disable public bucket, bỏ MD5/plain/default auth, pin images, sửa `apps/admin-web/Dockerfile`.
5. Cấu hình Caddy TLS thật và kiểm thử API/Admin/mobile từ production-like hostname; xác nhận CORS/origin.
6. Thiết lập backup encrypted offsite + restore rehearsal trước khi nạp dữ liệu thật; record RPO/RTO, rollback authority and decision window.
7. Bổ sung centralized observability, retention worker, worker health và CI/CD release gates.
8. Đóng Staff menu/history/penalty, weekly save và delegation create/search; loại hardcoded dashboard/profile data.
9. Quyết định SSE/reconnect/dedup hoặc documented polling SLA; bổ sung employee-code recovery.
10. Provision đúng bốn location/roster/allowlist/role và bốn Kitchen Android devices; chạy pilot một canteen rồi sign-off.

## 13. Kết luận cuối

IMeal đã có implementation và local/disposable evidence cho ba finding
Workstream A: immutable registration snapshots, canonical Kitchen dashboard
projection và lock-safe no-show/penalty processing. Fresh Step 1 verification
at HEAD `75a9d71` is green for the listed local suites; the historical pre-75
failure/blocker results remain explicitly superseded audit evidence. Tuy nhiên
đây chưa phải production product hoàn chỉnh: dirty local data chưa được
approved/remediated, staging `DATABASE_URL` và representative staging sign-off
chưa có, independent approval/audit chưa có, backup/restore rehearsal và named
rollback authority chưa có, production/UAT/security/observability/release
evidence vẫn thiếu. Vì vậy quyết định vẫn là **NO-GO**; chỉ sau khi staging
preflight/backfill/validation, independent approval, backup/restore,
rollback-authority, full verification and product/UAT gates được phê duyệt mới
được pilot một canteen rồi mở rộng lần lượt tới đủ bốn canteen.
