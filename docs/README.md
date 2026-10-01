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
- Exactly four real operational locations are in scope. Names, addresses, coordinates, scanner assignments and employee roster rows are imported/approved externally before production; this repository contains no fabricated operational data.
- Roster/import fixes each active employee to a server-managed service location and preserves effective location/name/address snapshots in registration and serving history.
- Presenter GPS is foreground-only during pickup QR generation/refresh. GPS failure exposes only **Retry** and **Refresh**. Kitchen resolves and confirms without sending GPS.
- QR TTL is 5 seconds, accepted clock skew is at most 2 seconds, and a resolved pickup session lasts 30 seconds. The selected registration set is exact, sorted, server revalidated and cannot be edited by Kitchen.
- Serving confirmation is within 10:30–13:30 in `Asia/Ho_Chi_Minh`, all-or-nothing and idempotent. Serving is final in core v2; no reversal/re-serve endpoint exists.
- Linux production baseline khuyến nghị: **4 vCPU, 8 GB RAM, 100 GB SSD, 1 Gbps LAN**, Docker Compose; minimum target 2 vCPU/4 GB RAM cho workload hiện tại. Production requires centralized logs/monitoring/alerting.
- Mobile package/bundle IDs, signing ownership, minimum OS and distribution channel are intentionally TBD until the production-release phase.
- Dữ liệu meal lifecycle/business audit của v2 được giữ **1 năm** rồi purge theo retention policy; active identity/config không bị xóa chỉ vì quá 1 năm.
- Delivery là **clean slate**: Firebase chỉ chứa dữ liệu demo pitching và được xóa/decommission ngay khi bắt đầu re-development; không migrate, map, reconcile, dual-write hoặc rollback dữ liệu Firebase. Dev/staging/production v2 dùng PostgreSQL làm business source of truth.

## Bản đồ tài liệu và thứ tự đọc

Đọc theo thứ tự dưới đây khi bắt đầu thay đổi một workflow:

1. [01 — Product Requirements](./01-product-requirements.md) — product goal, role, weekly registration, menu, serving, delegation và penalty.
2. [03 — Product Flows](./03-product-flows.md) — hành vi Staff/Kitchen/Admin, OTP, QR, foreground GPS và serving flow.
3. [05 — Backend Structure](./05-backend-structure.md) — PostgreSQL schema, constraints, session/authz, location snapshots, transactions và idempotency.
4. [02 — Technical Requirements](./02-technical-requirements.md) — mobile/backend stack, environment contract, API, network, deployment và NFR.
5. [04 — UI/UX Design](./04-ui-ux-design.md) — workflow, recovery behavior, interaction/mobile screen requirements.
6. [06 — Execution Plan](./06-execution-plan.md) — clean-slate re-platform, qualification và rollout.
7. [Staging readiness runbook](./runbooks/staging-readiness.md) — exact
   backup/restore, Phase 0, protected Compose, smoke, runtime integration,
   evidence and rollback procedure; keep the decision **CONDITIONAL / NO-GO**
   until external staging gates are approved.
8. [07 — Architecture Decisions](./07-architecture-decisions.md) — quyết định kiến trúc và risk assessment.
9. [08 — IMeal Design System](./08-imeal-design-system.md) — canonical visual tokens and reusable component contracts.
10. [Local Role Testing Guide](./local-role-testing.md) — local Docker, OTP test harness và role smoke checklist; mọi bypass/fixture trong guide đều non-production.
11. [Local synthetic seed design](./superpowers/specs/2026-09-24-imeal-local-seed-design.md) — local-only seed safety contract, synthetic cohorts, deterministic data and rerun behavior.
12. [Local synthetic seed implementation plan](./superpowers/plans/2026-09-24-imeal-local-seed-plan.md) — task sequencing and focused verification for the non-production seed workflow.
13. [Approved email OTP/GPS design](./superpowers/specs/2026-09-24-imeal-email-otp-presenter-gps-design.md) — source of truth cho OTP, opaque sessions, roster/location, GPS, exact intent và residual risk.
14. [Implementation plan](./superpowers/plans/2026-09-24-imeal-email-otp-presenter-gps-plan.md) — task sequencing and verification matrix.

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
| Serving / Check-in  | Kitchen xác nhận suất đã thực sự được giao tại quầy; ghi một `meal_servings` immutable row                                         |
| Served              | Registration có đúng một serving hợp lệ; `ACTIVE + mealServing` là projection canonical, `SERVED` chỉ giữ cho legacy compatibility |
| No-show             | Đã đăng ký nhưng hết meal day vẫn chưa có serving hợp lệ                                                                           |
| Delegation          | Ủy quyền một user khác nhận hộ một registration; delegate phải accept                                                              |
| Owner               | Người sở hữu registration                                                                                                          |
| Delegate            | Người được owner yêu cầu nhận hộ và đã chấp nhận                                                                                   |
| Presenter           | Người đang cầm điện thoại và trình bày QR; chỉ presenter thu foreground GPS                                                        |
| Kitchen             | Nhân sự canteen quản lý weekly menu và serving/check-in; không tự có quyền Staff                                                   |
| Admin               | Quản trị location/allowlist/roster, role `staff`/`kitchen`, penalty và audit; không cấp role `admin` qua Admin Web                 |
| Active registration | Registration có `status=ACTIVE` và chưa có serving; nếu đã có serving thì vẫn là row `ACTIVE` nhưng được project thành `SERVED`    |
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
- QR 5 giây chỉ dùng để xác thực presenter + exact pickup intent; scan QR không tự động đánh dấu `SERVED` trước Kitchen confirmation.
- If exactly one eligible pickup item exists, mobile auto-selects it. With multiple options, Staff explicitly selects the exact sorted set on the presenter device.
- GPS is an additional serving-time signal only. It cannot grant entitlement, choose a different site, bypass authz/delegation/registration, or collect owner GPS for proxy pickup.
- GPS failures return only safe `Retry`/`Refresh`; no manual bypass, silent fallback or automatic item/location substitution.
- Delegation requires acceptance; no self-delegation, chain, concurrent active delegation or delegate re-delegation.
- Kitchen resolve accepts only the QR. Confirm accepts only the resolved pickup session ID and idempotency key; Kitchen sends no GPS and cannot add/remove registrations.
- Multi-item serving confirmation is all-or-nothing and idempotent. A stale/ineligible item rejects the whole batch without replacement.
- Exactly four real locations must be imported and approved before production. Never add seed names, coordinates, addresses, employees or assignments to source control.
- Sensitive logs and retained OTP/session/GPS evidence are minimized, access-controlled and audited. Short-lived QR and presenter GPS reduce but do not eliminate screenshot, compromised-device or GPS-spoofing risk.
- Persisted notification inbox is source of truth; Expo Push is delivery provider default.
- Production requires centralized server logging, health monitoring and alerting for API, worker/jobs and PostgreSQL.

## Cập nhật tài liệu

- Business rule thay đổi phải cập nhật Product Requirements, Product Flows và Backend Structure nếu liên quan.
- API/schema/auth/network/environment thay đổi phải cập nhật Technical Requirements và Backend Structure.
- Component/navigation/interaction thay đổi phải cập nhật UI/UX Design.
- Migration/deployment strategy thay đổi phải cập nhật Execution Plan.
- Không ghi client secret, private key, access token, refresh token, OTP, real location data, real employee data hoặc nội dung `.env` thật vào tài liệu.
