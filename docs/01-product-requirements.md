# IMeal v2 — Product Requirements

## 1. Product summary

IMeal v2 là ứng dụng nội bộ IEC giúp quản lý vòng đời suất ăn cho khoảng **200–300 nhân sự** theo mô hình:

**Kitchen publish menu tuần → Staff tick ngày muốn ăn và chọn loại suất phù hợp → cutoff từng ngày → Kitchen chuẩn bị suất → Kitchen xác nhận giao suất → no-show/penalty/audit**.

V2 chuyển trọng tâm từ web “đăng ký ngày mai + chọn món” sang **mobile-first weekly registration**. Mỗi ngày chỉ có **một món cố định do Kitchen quản lý**; ngày service bình thường chỉ nhận loại `REGULAR`, còn ngày mùng 1 hoặc 15 âm lịch (kể cả tháng nhuận) cho phép Staff chọn `REGULAR` hoặc `VEGETARIAN`.

## 2. Product problems

### 2.1 Staff

- Cần đăng ký nhiều ngày trong tuần nhanh, không phải lặp lại từng ngày.
- Cần nhìn rõ menu tuần và deadline của từng ngày.
- Cần nhận suất nhanh bằng QR nhưng vẫn hạn chế screenshot/share gian lận.
- Cần quy trình nhận hộ chính thức thay vì gửi QR cho nhau.
- Cần dùng các tính năng đăng ký/lịch sử/delegation kể cả khi không ở mạng nội bộ IEC.

### 2.2 Kitchen

- Cần tạo/publish menu tuần, một món/ngày.
- Cần biết tổng số suất phải chuẩn bị sau cutoff.
- Cần giao suất nhanh tại giờ cao điểm, tránh double-serving.
- Cần dashboard realtime biết `đã giao / tổng đăng ký`, ai vừa nhận và ai chưa nhận.
- Cần phân biệt nhận chính chủ và nhận hộ có ủy quyền.

### 2.3 Admin/Finance

- Cần quản lý role, account status, penalty và audit.
- Cần truy vết registration owner, delegate, receiver và Kitchen actor.
- Cần số liệu no-show đáng tin cậy để giảm lãng phí và xử lý policy.

## 3. Product goals

1. Staff có thể hoàn tất đăng ký cả tuần trong dưới một phút với thao tác tick/untick.
2. Kitchen có menu tuần rõ ràng và tổng số suất từng ngày sau cutoff.
3. Một registration không thể bị duplicate hoặc serve hai lần dưới concurrency.
4. Serving/check-in chỉ được xác nhận bởi Kitchen tại điểm giao suất và sau khi server kiểm tra authentication/authorization.
5. QR động TTL 5 giây làm giảm replay/screenshot reuse.
6. Nhận hộ có consent hai phía và audit; không cần chia sẻ QR của owner.
7. Kitchen dashboard cập nhật realtime số đã giao, còn lại và log serving.
8. No-show tự động sau meal day nếu registration chưa có serving hợp lệ.
9. Hệ thống vận hành ổn định cho 200–300 user trên Linux self-host.

## 4. User roles

| Role      | Quyền chính                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `staff`   | Xem menu tuần, tick/untick registration, QR cá nhân, lịch sử, penalty, gửi/nhận delegation                                                             |
| `kitchen` | Quản lý/publish weekly menu; mở scanner; xác nhận serving; xem realtime dashboard/list/log; không tự có quyền Staff                                    |
| `admin`   | Quản lý user + role `staff`/`kitchen`, penalty, audit, jobs/config; không thể cấp `admin` qua Admin Web và không tự động có Kitchen serving capability |

### Role policy

- Microsoft Entra login thành công lần đầu → auto-provision `staff`.
- `kitchen` và `admin` không được auto-provision.
- Admin Web chỉ được quản lý/cấp-gỡ role `staff` và `kitchen`; **không được cấp role `admin` cho user khác**.
- Role `admin` không được cấp qua Admin Web; lifecycle Admin dùng operation server-side được audit và gắn explicit Entra object ID.
- User có thể đồng thời có `staff + kitchen` hoặc `staff + admin`. Nhân sự Kitchen muốn dùng suất cá nhân phải có thêm role `staff`.
- Không tạo role `finance` hoặc `kitchen_lead` trong MVP; capability nhạy cảm dùng permission `penalty.read`, `penalty.resolve`.
- Finance workflow dùng Admin Web với permission penalty/report phù hợp.
- Admin đầu tiên được cấp qua one-shot bootstrap command được audit, gắn với explicit Entra object ID.

## 5. Authentication policy

- Identity provider: Microsoft Entra ID của tổ chức, **single-tenant**.
- Không có public signup/email-password riêng của IMeal.
- PostgreSQL lưu immutable Entra identity (`tenant_id + object_id`) và role IMeal.
- Email/display name là profile; không dùng email domain làm authorization boundary.
- User `disabled` trong IMeal có thể login Entra thành công nhưng API trả `ACCOUNT_DISABLED`.
- Mọi protected API phải đọc account status authoritative phía server; token/role còn hạn không bypass được `disabled`.
- Trước khi disable, Admin bắt buộc xem preview future registrations/delegations và xác nhận cleanup trong cùng workflow.
- Cleanup chuyển future registrations sang canceled với reason `ACCOUNT_DISABLED`, revoke delegation liên quan, không tính vào Kitchen preparation totals và không tạo no-show/penalty. Lịch sử, actor, time và reason vẫn được giữ để audit.

## 6. Weekly menu

### 6.1 Core rules

- Kitchen chuẩn bị và công bố menu tuần tiếp theo vào Thứ Bảy–Chủ Nhật của tuần trước.
- Tuần bắt đầu Thứ Hai; service dates mặc định Thứ Hai–Thứ Sáu. Holiday/non-service date phải được disable có chủ đích.
- Mỗi meal date có đúng **0 hoặc 1 daily menu**.
- Mỗi daily menu có đúng **một món cố định**.
- Ngày service bình thường chỉ có lựa chọn suất `REGULAR`.
- Ngày mùng 1 hoặc 15 âm lịch, kể cả tháng nhuận, cho phép lựa chọn `REGULAR` hoặc `VEGETARIAN`.
- Weekly menu hỗ trợ ít nhất `draft` và `published`.
- Staff chỉ đăng ký trên ngày có menu đã được publish.
- Publish yêu cầu mọi enabled service date có daily menu hợp lệ; tuần được phép chứa disabled non-service dates.
- Publish lần đầu transactionally tạo immutable revision 1 cho từng enabled daily menu trước khi Staff được đăng ký.
- Kitchen có thể chỉnh menu đã publish khi server time còn `< 14:00` ngày trước meal date. Mỗi lần sửa tạo revision mới, giữ registration, ghi audit và tự tạo persisted notification cho Staff đã đăng ký.
- Không được unpublish/xóa daily menu đã có active registration.
- Sau cutoff, menu của ngày đó được khóa/snapshot để giữ lịch sử nhất quán.

### 6.2 Daily menu data

MVP cần:

- Meal name.
- Optional description.
- Optional image.
- Meal date.
- Publish/updated metadata.

## 7. Weekly registration

### 7.1 UX model

Staff mở một tuần và tick từng ngày:

```text
✓ Thứ Hai   Cơm gà
✓ Thứ Ba    Bún bò
□ Thứ Tư    Cơm sườn
✓ Thứ Năm   Cá kho
□ Thứ Sáu   Bún thịt nướng

[Chọn cả tuần]        [Lưu thay đổi]
```

`✓` = đăng ký một suất cho ngày đó.
`□` = không đăng ký / hủy nếu trước đó đã đăng ký và còn trước cutoff.

### 7.2 Domain rules

- Registration identity: `user + meal_date` unique; mỗi row lưu thêm `meal_choice` (`REGULAR` hoặc `VEGETARIAN`).
- Ngày service bình thường chỉ chấp nhận `REGULAR`; ngày mùng 1 hoặc 15 âm lịch (kể cả tháng nhuận) chấp nhận cả `REGULAR` và `VEGETARIAN`.
- Weekly screen là presentation/batch-edit layer; source of truth vẫn là registration từng ngày.
- Cutoff giữ **14:00 ngày trước meal date**, áp dụng độc lập cho từng ngày. Mutation chỉ hợp lệ khi server time `< 14:00`; đúng `14:00:00` là đã khóa.
- Server time là nguồn sự thật; mobile không được tự quyết định cutoff.
- Một tuần có thể chứa mixed state: ngày đã khóa, ngày còn editable.
- Batch save trả kết quả từng ngày; ngày không hợp lệ không được làm mất draft của ngày khác.
- Không persist literal `unregistered`; không có registration row nghĩa là unregistered.

## 8. QR and serving/check-in

### 8.1 QR

- Mỗi Staff có QR động cho meal date hiện tại.
- TTL/refresh: **5 giây**; allowed clock skew tối đa **2 giây**.
- QR phải được ký server-side và chống replay ngoài thời gian hợp lệ.
- QR xác định presenter và pickup intent đã được Staff chọn trước; **scan QR không tự động tạo serving**.
- Nếu presenter chỉ có một suất eligible, app mặc định intent là suất đó và không yêu cầu Staff tick.
- Nếu presenter có nhiều suất eligible (own + accepted delegations), Staff chọn trên mobile các suất dự định lấy trước khi đưa QR cho Kitchen.
- Pickup intent không tạo quyền mới: resolve/confirm luôn revalidate registration/delegation hiện tại trong DB.
- Nếu Kitchen đã resolve QR hợp lệ, UI dùng pickup session TTL **30 giây** để Kitchen kịp confirm dù QR gốc vừa hết 5 giây.

### 8.2 Serving semantics

Trong UI Kitchen có thể tiếp tục gọi thao tác là **Check-in**, nhưng canonical backend event là **Serving / SERVED**:

> Kitchen xác nhận suất đã thực sự được giao tại quầy.

- Không có mandatory check-out trong core flow.
- `SERVED` là bằng chứng một suất đã rời Kitchen để giao cho receiver.
- Check-out/exit canteen không được dùng để xác định no-show hoặc penalty.
- Kitchen serving endpoint yêu cầu Kitchen authentication và permission; server-side pickup rules remain authoritative.
- Serving chỉ hợp lệ trong window mặc định **10:30–13:30** của meal date.
- Happy path Kitchen không tick từng item: scan → xem presenter + danh sách/số suất Staff đã chọn → confirm giao.
- Kitchen không được thêm/bớt item; nếu Staff đổi ý, Staff cập nhật pickup intent trên mobile và đưa QR mới trước khi Kitchen resolve/confirm.
- Multi-item confirmation là all-or-nothing; conflict ở một item rollback toàn batch và Kitchen phải resolve lại.
- Employee-code recovery được phép với Kitchen confirmation, reason, audit và rate limit.

## 9. Pickup delegation / nhận hộ

### 9.1 Product flow

1. A có registration ngày X.
2. A chọn “Ủy quyền nhận hộ”.
3. A tìm B theo user/mã NV và gửi request.
4. B nhận notification/in-app request.
5. B `Accept` hoặc `Decline`.
6. Khi accepted, B có quyền nhận registration của A trong ngày X.
7. Trước khi đưa QR, B chọn trên mobile các suất B thực sự dự định lấy; nếu chỉ có một suất eligible thì app chọn mặc định.
8. B dùng **QR của chính B** tại Kitchen; QR mang pickup intent ngắn hạn của B.
9. Kitchen scan B, nhìn thấy chính xác danh sách/số suất B đã chọn và **chỉ confirm trong happy path**, không phải tick lại từng item.
10. Nếu B đổi ý/số khay thực tế khác intent trước khi confirm, Kitchen dùng action chỉnh sửa exception rồi confirm.
11. Serving lưu owner, receiver, Kitchen actor và pickup type.

### 9.2 Delegation rules

- Một registration chỉ có tối đa một delegation active tại một thời điểm.
- Owner có thể revoke trước khi serving xảy ra; UI bắt buộc confirm action và nêu rõ delegate sẽ mất quyền nhận hộ.
- Delegate phải accept; request pending chưa tạo quyền nhận.
- Không self-delegate.
- Không delegation chain (`A → B → C`).
- Delegate không được ủy quyền tiếp registration của owner.
- Không tạo/revoke delegation sau khi registration đã served.
- Khi serving xảy ra, delegation tương ứng chuyển `consumed`.
- Khi meal day kết thúc chưa dùng, delegation chuyển `expired`.
- `active delegation` nghĩa là `pending` hoặc `accepted`.
- Penalty/no-show luôn gắn với registration owner.

## 10. Kitchen realtime dashboard

Màn hình Kitchen chính phải hiển thị tối thiểu:

- Menu hôm nay.
- `Total registered`: tất cả registration hợp lệ, không tính `canceled`/`account_disabled`.
- `Served`: số registration đã có serving, ví dụ `127 / 220`.
- `Remaining = total_registered - served_total` trong serving window.
- Sau no-show reconciliation, hiển thị thêm `Vắng mặt` để không nhầm với người chưa đến nhận trong giờ phục vụ.
- Progress percentage.
- Scanner QR.
- Search/check bằng mã nhân viên như audited recovery path.
- Trong giờ phục vụ dùng `Chưa nhận`, `Đã nhận`, `Tất cả`; sau reconciliation thêm `Vắng mặt`.
- Realtime log các serving mới.
- Log phân biệt `SELF` và `PROXY`.
- Duplicate scan phải hiển thị ai đã nhận, thời điểm và không tạo serving thứ hai.

Nhiều Kitchen device phải nhìn cùng số liệu sau khi một serving commit.

## 11. No-show and penalty

### 11.1 No-show

Một registration là no-show khi:

```text
registration active
AND no valid serving exists
AND server time >= 13:30 của meal date
```

Delegation pending/accepted nhưng không có serving vẫn không được tính là đã nhận suất.

No-show worker bắt đầu lúc **13:45** và retry/recovery phải idempotent.

### 11.2 Penalty

- Mỗi no-show tạo đúng một penalty **50.000 VND**.
- `open → paid` hoặc `open → waived`.
- Waive bắt buộc lý do.
- Resolve cần actor/time/audit.
- Job retry không duplicate/reopen penalty đã resolve.

## 12. Serving finality

- Kitchen chỉ confirm sau khi đã kiểm tra presenter, danh sách suất Staff chọn trước và đủ số khay chuẩn bị giao.
- Confirm thành công là kết quả cuối cùng trong core v2; không có reversal/re-serve API hoặc UI.
- Nếu quầy đang thiếu khay so với số suất đã confirm, Kitchen giao bổ sung đủ khay thay vì sửa ngược dữ liệu.
- Serving evidence không bị sửa/xóa trong retention window.

## 13. Pickup serving authorization policy

Pickup resolve/confirm authorization does not depend on client network location. Requests still require an active authenticated Kitchen principal with kitchen.serve permission and all QR, pickup-session, serving-window, and database eligibility checks. A replacement pickup user-verification mechanism will be specified separately.

Serving/check-in and employee-code recovery remain subject to Kitchen confirmation, reason/audit requirements where applicable, rate limiting, HTTPS, and all server-side business rules. Login, menu, registration, history, penalty, delegation and notification flows use the normal API path and retain their existing authentication and authorization requirements.

## 14. Notifications

Business requirements:

- B nhận thông báo khi A yêu cầu nhận hộ.
- A nhận trạng thái khi B accept/decline.
- B nhận thông báo nếu A revoke.
- A nhận thông báo khi suất của mình được B nhận hộ.
- Notification phải được persist trong inbox; push chỉ là delivery channel, không phải source of truth.

Expo Push là provider mặc định. Hệ thống vẫn phải hoạt động đúng nếu push delivery fail nhưng user mở app và đọc inbox.

## 15. Admin and operations

Admin cần tối thiểu:

- Search/list user.
- Quản lý/cấp-gỡ role `staff`/`kitchen` với audit; **không có action cấp role `admin` trong Admin Web**.
- Disable/enable IMeal user.
- Penalty report/resolve/export.
- Serving/delegation audit lookup.
- Job run/history và health.
- Centralized server logging/monitoring/alerting cho API, worker/jobs và PostgreSQL là production requirement.
- Permission assignment `penalty.read`, `penalty.resolve`.
- Mandatory preview + confirmed audited cleanup khi disable account để cancel/cách ly future commitments không penalty.

Khuyến nghị giữ **Admin Web** cho workflow bảng/bulk/report; mobile tập trung Staff + Kitchen.

## 16. Success metrics

| Metric                             | Mục tiêu ban đầu                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Weekly registration action success | ≥99% request hợp lệ                                                                                  |
| Weekly registration completion     | P95 ≤60 giây từ lúc mở tuần đã load đến response save authoritative, đo trên tuần có 5 service dates |
| Duplicate registration             | 0                                                                                                    |
| Double-serving cùng registration   | 0                                                                                                    |
| Kitchen serving API availability   | ≥99.9% trong serving window 10:30–13:30, đo theo tháng                                               |
| Serving response P95                  | <1 giây                                                                                              |
| QR expired/replay tạo serving sai  | 0                                                                                                    |
| No-show/penalty duplicate          | 0                                                                                                    |
| Kitchen realtime count drift       | 0 sau snapshot/reconciliation; reconnect phải hội tụ ≤5 giây                                         |
| Delegation without consent         | 0                                                                                                    |

## 17. Non-goals v2 MVP

- Không quản lý kho/nguyên liệu/công thức/nhà cung cấp.
- Không cho Staff chọn nhiều món trong cùng ngày.
- Không dùng check-out để chứng minh user đã ăn hết suất.
- Không tự động dự báo giảm số suất nấu bằng ML ở MVP.
- Không cho Staff tự xác nhận “đã nhận suất”.
- Không cho nhận hộ chỉ bằng chia sẻ QR của owner.

## 18. Canonical implementation policy

| Policy                | Canonical value                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Week/service dates    | Monday-start; mặc định Monday–Friday; holiday disable explicit                           |
| Cutoff boundary       | `server_now < 14:00` ngày trước; đúng 14:00 đã khóa                                      |
| Serving/no-show       | Serving 10:30–13:30; no-show worker bắt đầu 13:45 VN                                     |
| QR/pickup session     | QR TTL 5s; skew 2s; pickup session TTL 30s                                               |
| Push provider         | Persisted inbox + Expo Push delivery                                                     |
| Employee-code serving | Recovery; confirm + reason + audit + rate limit                                 |
| Pickup intent         | Staff chọn trước các suất sẽ lấy; Kitchen happy path scan + confirm, không tick item     |
| Serving finality      | Confirm là cuối cùng; Kitchen chỉ confirm khi đủ khay và giao bổ sung nếu thiếu          |
| Batch serving         | All-or-nothing transaction                                                               |
| Penalty               | Mỗi no-show tạo 50.000 VND; ngoại lệ dùng audited waive                                  |
| Menu image storage    | Object/file storage; không lưu binary trong PostgreSQL                                   |
| Data retention        | Meal lifecycle/business audit history giữ 1 năm rồi purge theo retention policy          |
| Legacy data           | Firebase legacy bỏ ngay từ khi bắt đầu re-development; không migrate/dual-write/rollback |
