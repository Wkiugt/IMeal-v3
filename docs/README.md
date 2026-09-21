# IMeal v2 Documentation

Bộ tài liệu đặc tả sản phẩm và kỹ thuật cho **IMeal v2** — hệ thống đăng ký và kiểm soát suất ăn nội bộ IEC cho khoảng **200–300 nhân sự**.

IMeal v2 là một re-platforming so với hệ thống web Firebase/Firestore hiện tại. Kiến trúc đích chuyển sang **mobile-first**, backend self-host trên Linux và PostgreSQL làm nguồn dữ liệu chính.

## Định hướng đã chốt

- Mobile app: **React Native + Expo + TypeScript**, hỗ trợ Android và iOS.
- Backend: **NestJS (Fastify Adapter) + TypeScript**, mọi business write đi qua API server để đạt tối đa throughput.
- Database: **PostgreSQL + PgBouncer** (connection pooling); không dùng Firestore làm database production cho v2.
- Authentication: **Microsoft Entra ID single-tenant** của tổ chức; tenant/client/scope/redirect values remain TBD until IEC Entra administrator provisions them.
- Lần login đầu tiên: **auto-provision** user vào PostgreSQL với role `staff`.
- Role `kitchen` được Admin Web quản lý thủ công và **không bao gồm quyền `staff`**. Nhân sự Kitchen cần đăng ký suất cá nhân phải được cấp đồng thời `staff + kitchen`. Role `admin` chỉ được cấp qua operation server-side được audit, không thể được Admin khác cấp trong Admin Web.
- Menu: Kitchen chuẩn bị/công bố tuần tiếp theo vào Thứ Bảy–Chủ Nhật; **mỗi ngày có đúng một món cố định**. Ngày service bình thường chỉ có lựa chọn `REGULAR`; ngày mùng 1 hoặc 15 âm lịch (kể cả tháng nhuận) cho phép `REGULAR` hoặc `VEGETARIAN`.
- Staff: đăng ký theo tuần bằng cách tick/untick từng ngày; không chọn món nhưng có thể chọn loại suất `REGULAR`/`VEGETARIAN` theo policy ngày âm lịch.
- Cutoff: giữ business rule **14:00 ngày trước meal date**, áp dụng độc lập cho từng ngày.
- Cutoff boundary: registration mutation chỉ hợp lệ khi server time **nhỏ hơn 14:00**; đúng `14:00:00` là đã khóa.
- Tuần bắt đầu Thứ Hai; service dates mặc định Thứ Hai–Thứ Sáu, holiday/non-service date phải disable rõ ràng.
- Serving window mặc định **10:30–13:30**; no-show processing bắt đầu **13:45**, theo `Asia/Ho_Chi_Minh`.
- QR nhận suất: QR động, TTL/refresh mục tiêu **5 giây**.
- QR clock skew tối đa **2 giây**; pickup session TTL **30 giây**.
- Serving/check-in: chỉ Kitchen xác nhận tại điểm giao suất; không có mandatory check-out trong core flow.
- Nhận hộ: owner gửi yêu cầu cho delegate trong app; delegate phải accept trước khi có quyền nhận.
- All clients use the normal HTTPS API path; Kitchen serving/check-in requires an authenticated Kitchen identity with the appropriate permission, and server-side pickup rules remain authoritative.
- Linux production baseline khuyến nghị: **4 vCPU, 8 GB RAM, 100 GB SSD, 1 Gbps LAN**, Docker Compose; minimum target 2 vCPU/4 GB RAM cho workload hiện tại. Production requires centralized logs/monitoring/alerting.
- Mobile package/bundle IDs, signing ownership, minimum OS and distribution channel are intentionally TBD until the production-release phase.
- Dữ liệu meal lifecycle/business audit của v2 được giữ **1 năm** rồi purge theo retention policy; active identity/config không bị xóa chỉ vì quá 1 năm.
- Delivery là **clean slate**: Firebase chỉ chứa dữ liệu demo pitching và được xóa/decommission ngay khi bắt đầu re-development; không migrate, map, reconcile, dual-write hoặc rollback dữ liệu Firebase. Dev/staging/production v2 dùng PostgreSQL làm business source of truth.

## Bản đồ tài liệu

| Tài liệu                                                      | Mục đích                                                                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [01 — Product Requirements](./01-product-requirements.md)     | Product goal, role, weekly registration, menu, serving, delegation, penalty và scope   |
| [02 — Technical Requirements](./02-technical-requirements.md) | Mobile/backend stack, Entra auth, API, network, Linux deployment và NFR                |
| [03 — Product Flows](./03-product-flows.md)                   | User journey Staff/Kitchen/Admin, weekly flow, QR, delegation và serving flow          |
| [04 — UI/UX Design](./04-ui-ux-design.md)                     | Workflow, recovery behavior, and mobile interaction requirements; remains authoritative for those behaviors |
| [05 — Backend Structure](./05-backend-structure.md)           | PostgreSQL schema, constraints, transactions, authz, idempotency và data flows         |
| [06 — Execution Plan](./06-execution-plan.md)                 | Kế hoạch clean-slate re-platform và rollout IMeal v2                                   |
| [07 — Architecture Decisions](./07-architecture-decisions.md) | Quyết định kiến trúc, đánh giá rủi ro (Risk Assessment) và Trade-offs                  |
| [08 — IMeal Design System](./08-imeal-design-system.md)       | Canonical visual tokens, surfaces, components, indicators, motion, and accessibility contract |
| [Local Role Testing Guide](./local-role-testing.md)            | Local Docker, API, mobile, Admin Web setup and role smoke checklist                    |

`08-imeal-design-system.md` is authoritative for visual tokens and reusable component contracts. `04-ui-ux-design.md` remains authoritative for workflow and recovery behavior; `System-design-UI/**` is preserved prototype provenance, not a competing runtime contract.

## Thuật ngữ canonical

| Thuật ngữ           | Định nghĩa                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Meal date           | Ngày sử dụng suất ăn theo `Asia/Ho_Chi_Minh`, `YYYY-MM-DD`                                                                        |
| Week                | Tuần hiển thị trên Staff/Kitchen để quản lý menu và registration                                                                  |
| Daily menu          | Một món cố định cho một meal date                                                                                                 |
| Meal choice         | Loại suất `REGULAR` hoặc `VEGETARIAN`; ngày bình thường chỉ `REGULAR`, ngày mùng 1/15 âm lịch (kể cả tháng nhuận) cho phép cả hai |
| Cutoff              | 14:00 ngày trước meal date                                                                                                        |
| Registration        | Quyền giữ một suất của một user trong một meal date, lưu thêm meal choice                                                        |
| Serving / Check-in  | Kitchen xác nhận suất đã thực sự được giao tại quầy                                                                               |
| Served              | Registration đã có serving hợp lệ; là nguồn sự thật cho “đã nhận suất”                                                            |
| No-show             | Đã đăng ký nhưng hết meal day vẫn chưa có serving hợp lệ                                                                          |
| Delegation          | Ủy quyền một user khác nhận hộ một registration                                                                                   |
| Owner               | Người sở hữu registration                                                                                                         |
| Delegate            | Người được owner yêu cầu nhận hộ và đã chấp nhận                                                                                  |
| Staff               | Nhân viên dùng app để đăng ký, xem QR, lịch sử, penalty và delegation                                                             |
| Kitchen             | Nhân sự canteen quản lý weekly menu và serving/check-in; không tự có quyền Staff                                                  |
| Admin               | Quản trị user + role `staff`/`kitchen`, penalty, user lifecycle, audit và vận hành hệ thống; không cấp role `admin` qua Admin Web |
| Active registration | Registration có `status=registered` và chưa có active serving                                                                     |
| Active delegation   | Delegation có `status=pending` hoặc `status=accepted`                                                                             |
| Serving window      | Khoảng `10:30–13:30` của meal date, theo `Asia/Ho_Chi_Minh`                                                                       |

## Nguồn sự thật và thứ tự ưu tiên

1. Business policy được IEC phê duyệt.
2. Tài liệu v2 trong thư mục này.
3. Shared domain contracts/API schemas của v2.
4. NestJS domain/service implementation.
5. PostgreSQL schema/migrations/constraints.
6. React Native mobile behavior và Admin Web behavior.
7. Source/tài liệu legacy chỉ dùng để hiểu sản phẩm cũ; không là contract hoặc nguồn dữ liệu của v2.

Nếu implementation và docs v2 khác nhau, thay đổi phải cập nhật cả code, migration/schema liên quan và tài liệu trong cùng work item.

## Nguyên tắc domain quan trọng

- `Asia/Ho_Chi_Minh` là timezone business duy nhất.
- Mobile không được trực tiếp ghi database.
- Server time là nguồn sự thật cho cutoff và meal date.
- `UNIQUE(user_id, meal_date)` ngăn duplicate registration; registration lưu thêm lựa chọn suất (`REGULAR` hoặc `VEGETARIAN`).
- Ngày service bình thường chỉ có `REGULAR`; ngày mùng 1 hoặc 15 âm lịch, kể cả tháng nhuận, cho phép `REGULAR` hoặc `VEGETARIAN`.
- QR 5 giây chỉ dùng để xác thực presenter + pickup intent; scan QR không tự động đánh dấu `SERVED` trước Kitchen confirmation.
- Nếu presenter có nhiều suất hợp lệ, Staff chọn trước các suất dự định lấy trên mobile; Kitchen happy path chỉ scan, kiểm tra số suất/tên và confirm, không phải tick từng item.
- Delegation không chia sẻ QR của owner; delegate dùng QR của chính mình sau khi đã accept delegation.
- Role/authorization nằm trong PostgreSQL; Microsoft Entra trả lời “user là ai”, IMeal trả lời “user được phép làm gì”.
- Kitchen identity/permission and server-side pickup rules remain authoritative for serving/check-in.
- Multi-item serving confirmation là **all-or-nothing**; một item conflict làm rollback toàn batch và yêu cầu resolve lại.
- Kitchen chỉ xác nhận sau khi đã đối chiếu presenter, danh sách suất và số khay chuẩn bị giao. Sau confirm, serving là kết quả cuối cùng; thiếu khay được xử lý bằng giao bổ sung tại quầy, không sửa ngược dữ liệu.
- Lịch sử nghiệp vụ/audit của meal lifecycle được giữ **1 năm**; trong retention window serving/audit là append-oriented/immutable, sau đó được purge theo retention job/policy.
- `staff`, `kitchen`, `admin` là roles canonical và độc lập; `kitchen` không kế thừa `staff`. Capability nhạy cảm dùng permission như `penalty.read`, `penalty.resolve`, không qua implicit Admin superuser bypass.
- Admin Web chỉ quản lý role `staff`/`kitchen`; Admin không thể cấp role `admin` cho user khác. Admin-role lifecycle nằm ngoài Admin Web và phải dùng quy trình server-side được audit.
- `admin` không tự động có Kitchen serving capability nếu không được cấp quyền tương ứng.
- Persisted notification inbox là source of truth; Expo Push là delivery provider mặc định.
- Production bắt buộc có centralized server logging, health monitoring và alerting cho API, worker/jobs và PostgreSQL; destination/retention chi tiết được chốt trước rollout.

## Điểm bắt đầu cho developer mới

1. Đọc `01-product-requirements.md` để hiểu domain và policy.
2. Đọc `03-product-flows.md` để hiểu hành vi của Staff/Kitchen/Admin.
3. Đọc `05-backend-structure.md` trước khi thay đổi schema, transaction hoặc serving/delegation.
4. Đọc `02-technical-requirements.md` trước khi thêm dependency, API, auth hoặc deployment.
5. Dùng `04-ui-ux-design.md` cho mọi thay đổi interaction/mobile screen.
6. Dùng `06-execution-plan.md` làm thứ tự triển khai, qualification và rollout.

## Cập nhật tài liệu

- Business rule thay đổi phải cập nhật Product Requirements, Product Flows và Backend Structure nếu liên quan.
- API/schema/auth/network thay đổi phải cập nhật Technical Requirements và Backend Structure.
- Component/navigation/interaction thay đổi phải cập nhật UI/UX Design.
- Migration/deployment strategy thay đổi phải cập nhật Execution Plan.
- Không ghi client secret, private key, access token, refresh token hoặc nội dung `.env` thật vào tài liệu.
