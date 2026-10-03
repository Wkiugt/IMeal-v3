# IMeal v2 Documentation

Bộ tài liệu đặc tả sản phẩm và kỹ thuật cho **IMeal v2** — hệ thống đăng ký và kiểm soát suất ăn nội bộ IEC cho khoảng **200–300 nhân sự**.

IMeal v2 là một re-platforming so với hệ thống web Firebase/Firestore hiện tại. Kiến trúc đích chuyển sang **mobile-first**, backend self-host trên Linux và PostgreSQL làm nguồn dữ liệu chính.

## Định hướng đã chốt

- Mobile app: **React Native + Expo + TypeScript**, hỗ trợ Android và iOS.
- Backend: **NestJS (Fastify Adapter) + TypeScript**, mọi business write đi qua API server để đạt tối đa throughput.
- Database: **PostgreSQL + PgBouncer** (connection pooling); không dùng Firestore làm database production cho v2.
- Authentication production: **email OTP qua allowlist A** là phương thức duy nhất. Allowlist và trạng thái tài khoản do PostgreSQL quản lý; không có federated login, username/password, email-domain authorization hoặc client-supplied role.
- A successful OTP creates only a high-entropy opaque session token. PostgreSQL stores only its one-way hash and minimized session metadata; every protected request re-resolves account status and permissions.
- Local auth bypass exists only for an explicitly configured non-production test harness (`NODE_ENV=test` and `REQUIRE_AUTH=false`). It is not an end-user login method and is rejected in production.
- Exactly four real operational locations are in scope. Names, addresses, coordinates and employee roster rows are imported/approved externally before production; this repository contains no fabricated operational data.
- Roster/import fixes each active employee to a server-managed service location and preserves effective location/name/address snapshots in registration and serving history.
- **Current Staff self check-in cutover:** Kitchen displays one stable, server-issued QR for the active meal date/location. Staff scans that shared QR, sends a fresh foreground GPS sample to resolve, reviews the own-registration result, then sends another fresh foreground GPS sample to explicitly confirm. Staff can check in only the authenticated caller's own registration.
- Kitchen has no employee scanner, employee lookup, delegation flow or SSE
  requirement. Its aggregate dashboard is polled only while the screen is
  focused and the app is foregrounded, every 10 seconds; under healthy polling
  the visible snapshot normally converges within approximately 15 seconds.
  During a refresh failure, retain the last good snapshot indefinitely and
  mark it stale until a successful refresh; never invent zeroes.
- Check-in confirm creates the canonical `MealServing` outcome once per registration. The self-check-in session is additive compatibility context; historical pickup/delegation tables remain retained for history, but their active APIs/UI are not part of this cutover. Only safe GPS verification result/timestamp/accuracy/location ID are retained; raw coordinates are not logged.
- Serving confirmation is within 10:30–13:30 in `Asia/Ho_Chi_Minh`, transactionally revalidated and idempotent. Confirm is final in the current flow; no reversal/re-serve endpoint exists.
- Linux production baseline khuyến nghị: **4 vCPU, 8 GB RAM, 100 GB SSD, 1 Gbps LAN**, Docker Compose; minimum target 2 vCPU/4 GB RAM cho workload hiện tại. Production requires centralized logs/monitoring/alerting.
- Mobile package/bundle IDs, signing ownership, minimum OS and distribution channel are intentionally TBD until the production-release phase.
- Dữ liệu meal lifecycle/business audit của v2 được giữ **1 năm** rồi purge theo retention policy; active identity/config không bị xóa chỉ vì quá 1 năm.
- Delivery là **clean slate**: Firebase chỉ chứa dữ liệu demo pitching và được xóa/decommission ngay khi bắt đầu re-development; không migrate, map, reconcile, dual-write hoặc rollback dữ liệu Firebase. Dev/staging/production v2 dùng PostgreSQL làm business source of truth.

## Current check-in architecture

The active contract is a **Staff self check-in** flow, not a Kitchen scanner flow:

1. Kitchen requests `GET /api/kitchen/check-in/qr`. The server lazily creates or reuses the stable QR session for the authenticated Kitchen user's assigned location and current meal date. The QR carries no employee identity and is active only for the server-authoritative check-in window.
2. Staff scans the shared QR and calls `POST /api/me/check-in/resolve` with the
   QR and a fresh foreground GPS sample (`capturedAt`, `latitude`, `longitude`,
   `accuracyMeters`). When eligible, resolve returns an opaque signed
   `intentNonce` scoped to the authenticated caller, own registration, session
   and location; it is nullable when `eligibility=false`. Resolve only returns
   the authenticated Staff user's normalized employee/menu/location/registration/
   eligibility; it does not consume the registration.
3. Staff reviews the result and calls `POST /api/me/check-in/confirm` with the
   resolved `sessionId`, non-empty `intentNonce`, a caller idempotency key, and
   a new foreground GPS sample. The server validates the nonce/caller/session/
   registration, revalidates window/location/GPS policy and own registration in
   one transaction, then creates/replays the single `MealServing` outcome.
4. Staff calls `GET /api/me/check-in` for authoritative reconciliation after
   success, retry, timeout or app restart. Kitchen polls
   `GET /api/kitchen/check-in/dashboard?date=YYYY-MM-DD` every 10 seconds only
   while focused/foregrounded; under healthy polling the UI normally converges
   within approximately 15 seconds. On refresh failure it keeps the last good
   aggregate snapshot indefinitely and marks it stale rather than inventing
   zeroes.

The current flow has no active proxy/delegation check-in, no Kitchen employee scan/resolve/confirm, and no SSE stream. Existing pickup/delegation tables and old serving context remain retained for historical compatibility; they are not an active client contract.

The check-in migration is additive. `registrations` remain the registration source, `MealServing.registrationId` remains unique and is the sole compatibility outcome source, and new check-in metadata links the serving/confirm request to the stable `CheckInSession`. A Staff-confirmed event is owned by the authenticated Staff caller; no raw GPS coordinate history is written.

Legacy QR/pickup/delegation descriptions in dated design/plan documents are historical reference only. They must not be used as current implementation or staging acceptance criteria.


## Bản đồ tài liệu và thứ tự đọc

Đọc theo thứ tự dưới đây khi bắt đầu thay đổi một workflow:

1. [01 — Product Requirements](./01-product-requirements.md) — product goal, role, weekly registration, menu, Staff self check-in, serving and penalty.
2. [03 — Product Flows](./03-product-flows.md) — current Staff scan → resolve → confirm and Kitchen aggregate flow; OTP and registration flows remain active.
3. [05 — Backend Structure](./05-backend-structure.md) — PostgreSQL schema, check-in session/serving compatibility, constraints, session/authz and transactions.
4. [02 — Technical Requirements](./02-technical-requirements.md) — mobile/backend stack, current check-in API, environment, network, deployment and NFR.
5. [04 — UI/UX Design](./04-ui-ux-design.md) — current scan/resolve/confirm interaction, polling and recovery behavior.
6. [06 — Execution Plan](./06-execution-plan.md) — cutover qualification and rollout.
7. [Staging readiness runbook](./runbooks/staging-readiness.md) — exact
   backup/restore, Phase 0, protected Compose, self-check-in smoke,
   evidence and rollback procedure; keep the decision **CONDITIONAL / NO-GO**
   until external staging gates are approved.
8. [07 — Architecture Decisions](./07-architecture-decisions.md) — quyết định kiến trúc và risk assessment.
9. [08 — IMeal Design System](./08-imeal-design-system.md) — canonical visual tokens and reusable component contracts.
10. [Local Role Testing Guide](./local-role-testing.md) — local Docker, OTP test harness và role smoke checklist; mọi bypass/fixture trong guide đều non-production.
11. [Local synthetic seed design](./superpowers/specs/2026-09-24-imeal-local-seed-design.md) — local-only seed safety contract, synthetic cohorts, deterministic data and rerun behavior.
12. [Local synthetic seed implementation plan](./superpowers/plans/2026-09-24-imeal-local-seed-plan.md) — task sequencing and focused verification for the non-production seed workflow.
13. [Approved email OTP/GPS design](./superpowers/specs/2026-09-24-imeal-email-otp-presenter-gps-design.md) — historical presenter/pickup design; not the current self-check-in contract.
14. [Implementation plan](./superpowers/plans/2026-09-24-imeal-email-otp-presenter-gps-plan.md) — historical presenter/pickup plan; current rollout follows the canonical docs above.

`08-imeal-design-system.md` is authoritative for visual tokens and reusable component contracts. `04-ui-ux-design.md` remains authoritative for workflow and recovery behavior; `System-design-UI/**` is preserved prototype provenance, not a competing runtime contract.

## Thuật ngữ canonical

| Thuật ngữ           | Định nghĩa                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Meal date           | Ngày sử dụng suất ăn theo `Asia/Ho_Chi_Minh`, `YYYY-MM-DD`                                                                         |
| Week                | Tuần hiển thị trên Staff/Kitchen để quản lý menu và registration                                                                   |
| Weekly registration window | Monday–Sunday Vietnam week; current week is eligible before Saturday `17:00`, next week opens at exactly that boundary while current week remains eligible through Sunday, and dates outside current/next are locked |
| Daily menu          | Một món cố định cho một meal date                                                                                                  |
| Meal choice         | Loại suất `REGULAR` hoặc `VEGETARIAN`; ngày bình thường chỉ `REGULAR`, ngày mùng 1/15 âm lịch (kể cả tháng nhuận) cho phép cả hai  |
| Cutoff              | 14:00 ngày trước meal date; đúng `14:00:00` là đã khóa                                                                             |
| Registration        | Quyền giữ một suất của một user trong một meal date, lưu menu revision cùng meal choice và immutable owner/location snapshots      |
| Check-in / Serving  | Staff tự xác nhận đã nhận suất bằng shared Kitchen QR; server tạo một `MealServing` immutable row, còn public state dùng `CHECKED_IN` |
| Checked-in          | Registration có đúng một serving hợp lệ; `MealServing.registrationId` là unique và là nguồn outcome canonical, còn `SERVED` chỉ giữ cho legacy compatibility |
| No-show             | Đã đăng ký nhưng hết meal day vẫn chưa có serving hợp lệ                                                                           |
| Delegation          | **Historical only:** dữ liệu ủy quyền cũ được giữ để đọc/audit; không có active proxy check-in trong cutover hiện tại              |
| Owner               | Người sở hữu registration                                                                                                          |
| Delegate            | **Historical only:** người từng được owner yêu cầu nhận hộ trong dữ liệu cũ; không phải actor của current check-in                |
| Presenter           | Staff authenticated caller đang cầm điện thoại, quét shared QR và gửi foreground GPS; chỉ caller đó được resolve/confirm         |
| Kitchen             | Nhân sự canteen quản lý weekly menu, phát shared QR và xem aggregate dashboard; không quét/resolve/confirm nhân viên             |
| Admin               | Quản trị location/allowlist/roster, role `staff`/`kitchen`, penalty và audit; không cấp role `admin` qua Admin Web                 |
| Active registration | Registration có `status=ACTIVE` và chưa có serving; nếu đã có serving thì public check-in state là `CHECKED_IN`                   |
| Serving window      | Khoảng `10:30–13:30` của meal date, theo `Asia/Ho_Chi_Minh`                                                                        |

## Nguồn sự thật và thứ tự ưu tiên

1. Business policy được IEC phê duyệt.
2. Tài liệu v2 trong thư mục này, đặc biệt 02/03/05.
3. Shared domain contracts/API schemas của v2.
4. NestJS domain/service implementation.
5. PostgreSQL schema/migrations/constraints.
6. React Native mobile behavior và Admin Web behavior.
7. Source/tài liệu legacy chỉ dùng để hiểu sản phẩm cũ; không là contract hoặc nguồn dữ liệu của v2.

Nếu implementation và docs v2 khác nhau, thay đổi phải cập nhật cả code, migration/schema liên quan và tài liệu trong cùng work item.

## Nguyên tắc domain quan trọng

- `Asia/Ho_Chi_Minh` là timezone business duy nhất; timestamps are UTC instants.
- Mobile không được trực tiếp ghi database; server time là nguồn sự thật cho cutoff và meal date.
- Weekly registration authority is separate from per-meal `CUTOFF_TIME`: server reads remain viewable for any week, while mutation editability and per-action flags/reasons combine both restrictions.
- `UNIQUE(user_id, meal_date)` ngăn duplicate registration; registration lưu lựa chọn suất và effective location snapshot.
- One stable Kitchen QR represents the current meal date/location check-in session; it is not a Staff QR and does not contain employee identity. `GET /api/kitchen/check-in/qr` is Kitchen-only.
- Staff scans the shared QR, calls `POST /api/me/check-in/resolve` with a fresh
  foreground GPS sample, receives an eligible opaque `intentNonce` scoped to
  caller/session/registration/location, reviews the exact own-registration
  result, then calls `POST /api/me/check-in/confirm` with that nonce, a new
  fresh foreground GPS sample and an idempotency key.
- `GET /api/me/check-in` is the Staff reconciliation authority. Resolve never consumes a registration; confirm revalidates the authenticated caller, active assignment/location, GPS policy, date/window/session and registration inside the serving transaction.
- GPS cannot grant entitlement, choose a different site, bypass authz/registration/window/concurrency, or be collected in the background. Only safe verification result/timestamp/accuracy/location ID are retained; raw coordinates are not logged.
- Current check-in is own-user only. Delegation/pickup tables and historical events remain retained for compatibility/read-only history, but there is no active proxy/delegation check-in API or UI.
- `MealServing.registrationId` remains unique and is the sole compatibility outcome source. Check-in metadata and `CheckInSession` are additive context; a successful Staff confirm owns the event to the authenticated Staff caller.
- Kitchen dashboard is aggregate-only and uses
  `GET /api/kitchen/check-in/dashboard?date=YYYY-MM-DD`; poll every 10 seconds
  only while focused and foregrounded, normally converge within approximately
  15 seconds, and on refresh failure retain the last good snapshot indefinitely
  with a stale indicator; do not depend on SSE.
- Exactly four real locations must be imported and approved before production. Never add seed names, coordinates, addresses, employees or assignments to source control.
- Sensitive logs and retained OTP/session/GPS evidence are minimized,
  access-controlled and audited. A practical day/location shared session and
  foreground GPS reduce but do not eliminate screenshot, compromised-device or
  GPS-spoofing risk.
- Persisted notification inbox is source of truth; Expo Push is delivery provider default.
- Production requires centralized server logging, health monitoring and alerting for API, worker/jobs and PostgreSQL.

## Cập nhật tài liệu

- Business rule thay đổi phải cập nhật Product Requirements, Product Flows và Backend Structure nếu liên quan.
- API/schema/auth/network/environment thay đổi phải cập nhật Technical Requirements và Backend Structure.
- Component/navigation/interaction thay đổi phải cập nhật UI/UX Design.
- Migration/deployment strategy thay đổi phải cập nhật Execution Plan.
- Không ghi client secret, private key, access token, refresh token, OTP, real location data, real employee data hoặc nội dung `.env` thật vào tài liệu.
