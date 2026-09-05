# IMeal v2 — Architecture Decisions & Risk Assessment

## 1. Context

Quá trình re-platforming hệ thống IMeal v2 từ Firebase/Next.js sang hệ thống self-host yêu cầu các tiêu chuẩn vô cùng khắt khe về mặt hiệu năng, với mục tiêu xử lý concurrent cao trong khung giờ cao điểm (10:30 – 13:30).

Mục tiêu cốt lõi:

- **P95 Latency < 1s** cho các thao tác đăng ký tuần và check-in QR tại Kitchen.
- Đảm bảo tính nguyên vẹn dữ liệu (0% duplicate serving).

Ban đầu, một giải pháp kiến trúc dựa trên **Golang + Redis** đã được cân nhắc để đạt hiệu năng tuyệt đối. Tuy nhiên, sau khi đánh giá rủi ro và Developer Experience (DX), hệ thống đã thống nhất phương án sử dụng **NestJS (Fastify)** làm backend cốt lõi.

---

## 2. Architecture Decisions

### 2.1 Backend Framework: NestJS + Fastify

- **Quyết định**: Giữ nguyên hệ sinh thái Node.js/TypeScript, nhưng chuyển từ bộ chuyển tiếp Express mặc định sang **Fastify Adapter**.
- **Lý do**: Fastify cung cấp thông lượng (throughput) xử lý request/sec cao hơn đáng kể và overhead thấp hơn Express. Nó giúp NestJS có khả năng chịu tải tương đương với các ngôn ngữ biên dịch ở quy mô 200-300 users, trong khi vẫn giữ lại toàn bộ ưu điểm về Developer Experience (DX) của TypeScript.

### 2.2 Database Layer: PostgreSQL + PgBouncer

- **Quyết định**: Sử dụng PostgreSQL làm source of truth duy nhất, kết hợp với **PgBouncer** cho connection pooling.
- **Lý do**: Việc thêm PgBouncer ngăn chặn tình trạng cạn kiệt connection pool khi có hàng trăm request đồng thời đổ về API từ Kitchen devices và Staff mobiles trong khung giờ trưa. Node.js event loop sẽ không bị block do chờ cấp phát DB connection.

### 2.3 Mobile State Management: React Native + Zustand

- **Quyết định**: Sử dụng Zustand thay vì Context API mặc định của React.
- **Lý do**: Zustand cung cấp cơ chế quản lý global state siêu nhẹ, chống lại các chu kỳ re-render không cần thiết (re-render bloat) vốn thường làm chậm ứng dụng React Native trên các thiết bị mobile cấu hình thấp.

---

## 3. Risk Assessment & Trade-offs

Quyết định sử dụng NestJS (Fastify) thay vì Golang kéo theo một số trade-offs quan trọng đã được phân tích:

### 3.1 Developer Experience (DX) & Learning Curve

- **Lợi ích**: DX cực kỳ tối ưu vì đội ngũ phát triển có thể sử dụng TypeScript cho toàn bộ stack (Mobile + Backend + Admin Web). Mã nguồn dễ đọc, có thể chia sẻ các schemas/DTOs giữa client và server một cách mượt mà.
- **Đánh đổi**: So với Golang, Node.js dễ bị phình to về mặt logic nếu không có cơ chế quản lý scope rõ ràng, đòi hỏi team phải tuân thủ nghiêm ngặt các quy chuẩn code của NestJS.

### 3.2 Time-to-Market & Development Speed

- **Lợi ích**: NestJS cung cấp sẵn các module, decorators, và cơ chế Dependency Injection (DI) rất mạnh, giúp đẩy nhanh tốc độ scaffolding và ra mắt sản phẩm.
- **Đánh đổi**: Các công cụ "ma thuật" (decorators, reflection) có overhead khi khởi động ứng dụng và đòi hỏi tuning bộ nhớ chặt chẽ khi deploy.

### 3.3 Infrastructure Costs & Maintenance

- **Lợi ích**: Triển khai dễ dàng qua Docker Compose trên một server Linux tiêu chuẩn, không cần bảo trì cụm Redis phức tạp hay Edge Computing (bỏ qua Redis để đơn giản hoá infra như specs ban đầu).
- **Đánh đổi**: Mức tiêu thụ RAM của ứng dụng Node.js (V8 engine) lớn hơn đáng kể so với Golang. Team Infrastructure cần liên tục giám sát memory footprint để tránh OOM (Out Of Memory) kill trên server 4GB/8GB RAM. PgBouncer cũng đóng vai trò là một component mới cần được giám sát log.

### 3.4 Concurrency & QR TTL (5 seconds)

- **Đánh đổi**: Do Node.js là single-threaded (dựa trên event-loop), các thuật toán mã hoá QR, ký JWT hoặc validation nặng có thể block event loop.
- **Giải pháp giảm thiểu rủi ro**: Chuyển các thao tác I/O xuống PostgreSQL tối ưu nhất có thể, sử dụng Fastify để tăng tốc I/O network, và có thể ứng dụng worker threads của Node.js nếu phần parse mã QR trở thành bottleneck trong tương lai.
