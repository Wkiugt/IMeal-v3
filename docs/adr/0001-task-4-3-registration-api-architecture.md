# ADR 001: Task 4.3 — Staff Weekly Registration API Architecture

## Status

Accepted

## Date

2026-08-29

## Context

Xây dựng API đăng ký suất ăn hàng tuần cho nhân viên (Task 4.3) đòi hỏi một hệ thống có khả năng chịu tải cao vào các khung giờ cao điểm (sáng thứ 2), đảm bảo tính toàn vẹn dữ liệu tuyệt đối (không lệch múi giờ, không dính race condition) và dễ dàng bảo trì trong tương lai. Qua quá trình phân tích rủi ro (Senior Engineer Audit), Product Owner đã chốt các quyết định kiến trúc cốt lõi dưới đây.

## Quyết định Kiến trúc & Lý do (Decisions & Rationale)

### 1. Hiệu ứng bầy đàn (Thundering Herd Problem)

- **Quyết định:** Option B - Triển khai cơ chế điều tiết lưu lượng (Traffic smoothing mechanisms), ví dụ: Request queuing hoặc Caching với Jitter.
- **Lý do:** Đảm bảo Database không bị sập khi hàng ngàn nhân viên đồng loạt truy cập hệ thống để lấy thực đơn và đăng ký vào đầu tuần.
- **Trade-offs (Đánh đổi):** Tăng độ phức tạp của hạ tầng (cần thêm message queue hoặc cache server) so với việc chỉ tối ưu truy vấn DB đơn thuần.

### 2. Thảm họa Timezone (Timezone Catastrophe)

- **Quyết định:** Option A - Áp dụng chính sách "UTC everywhere" nghiêm ngặt. Tất cả timestamp trong DB phải lưu ở chuẩn UTC, và chỉ được format theo local timezone ở phía Client.
- **Lý do:** Bảo vệ tuyệt đối ràng buộc duy nhất (unique constraint) của `mealDate`, ngăn chặn triệt để lỗi logic do lệch múi giờ giữa các thiết bị.
- **Trade-offs (Đánh đổi):** Yêu cầu đội dev frontend và backend phải cực kỳ kỷ luật trong việc xử lý date/time, bất kỳ module nào vi phạm sẽ gây lỗi hệ thống.

### 3. Xử lý lỗi một phần (Partial Success)

- **Quyết định:** Option B - Xử lý lỗi phân tán một cách khéo léo thông qua Eventual Consistency (ví dụ: Outbox pattern hoặc Idempotent retries).
- **Lý do:** Mang lại trải nghiệm UX tốt nhất. Hệ thống chấp nhận lưu các ngày đăng ký hợp lệ và từ chối/retry các ngày bị lỗi thay vì bắt user làm lại từ đầu.
- **Trade-offs (Đánh đổi):** Kiến trúc xử lý giao dịch (transaction) phức tạp hơn rất nhiều so với mô hình All-or-Nothing truyền thống.

### 4. Race Condition ở vạch đích Cutoff

- **Quyết định:** Option A - Sử dụng Optimistic Concurrency Control (OCC). Đồng thời, phát triển thêm một tính năng "Document/Application" cho phép người dùng (Quản trị viên) tạo form đệ trình để linh hoạt thay đổi giờ Cutoff.
- **Lý do:** OCC giúp giải quyết xung đột dữ liệu một cách công bằng và chính xác khi có nhiều request đồng thời chạm mốc Cutoff. Tính năng Application giúp hệ thống mềm dẻo hơn thay vì hard-code giờ chốt.
- **Trade-offs (Đánh đổi):** Cần thêm cơ chế quản lý version (versioning) cho các bản ghi. Tốn thêm effort để code flow phê duyệt/thay đổi giờ Cutoff.

### 5. Khớp nối mã nguồn (Coupling Code trong Cascade Revoke)

- **Quyết định:** Option A - Duy trì ranh giới module nghiêm ngặt (Strict modular boundaries) theo hướng Domain-Driven Design (DDD).
- **Lý do:** Giúp Registration và Delegation độc lập với nhau. Khi logic một bên thay đổi sẽ không làm vỡ code của bên kia.
- **Trade-offs (Đánh đổi):** Đòi hỏi thiết kế Interface giữa các domain thật chuẩn xác, thời gian setup architecture ban đầu sẽ lâu hơn.

### 6. Tối ưu bảng Registration (Registration Table)

- **Quyết định:** Option A - Tối ưu schema cho luồng xử lý đồng thời thông lượng cao (high-throughput concurrency) và lập chỉ mục mạnh mẽ (robust indexing). Cụ thể là đánh Composite Index `@@index([userId, mealDate])`.
- **Lý do:** Đảm bảo truy vấn lịch sử đăng ký luôn mượt mà kể cả khi bảng Registration phình to lên hàng triệu dòng sau nhiều năm vận hành.
- **Trade-offs (Đánh đổi):** Tốn thêm một lượng cực nhỏ dung lượng lưu trữ (Storage overhead) cho Index.
