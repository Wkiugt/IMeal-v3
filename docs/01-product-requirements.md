# IMeal v2 — Product Requirements

## 1. Product summary

IMeal v2 là ứng dụng nội bộ IEC giúp quản lý vòng đời suất ăn cho khoảng **200–300 nhân sự** theo mô hình:

**Kitchen publish menu tuần → Staff tick ngày muốn ăn và chọn loại suất phù hợp → cutoff từng ngày → Kitchen chuẩn bị suất → Kitchen mở shared QR ổn định theo ngày/location → Staff scan, gửi GPS mới để resolve, xem chính đăng ký của mình và explicit confirm bằng GPS mới → no-show/penalty/audit**.

V2 chuyển trọng tâm từ web “đăng ký ngày mai + chọn món” sang **mobile-first weekly registration**. Mỗi ngày chỉ có **một món cố định do Kitchen quản lý**; ngày service bình thường chỉ nhận loại `REGULAR`, còn ngày mùng 1 hoặc 15 âm lịch (kể cả tháng nhuận) cho phép Staff chọn `REGULAR` hoặc `VEGETARIAN`.

## 2. Product problems

### 2.1 Staff

- Cần đăng ký nhiều ngày trong tuần nhanh, không phải lặp lại từng ngày.
- Cần nhìn rõ menu tuần và deadline của từng ngày.
- Cần check-in nhanh bằng cách quét shared QR của Kitchen, gửi foreground GPS mới ở bước resolve và confirm, nhưng chỉ có thể xác nhận đăng ký của chính mình.
- Không có active proxy/delegation check-in trong current cutover; dữ liệu nhận hộ cũ chỉ còn để đọc lịch sử/audit.
- Cần dùng các tính năng đăng ký/lịch sử/penalty kể cả khi không ở mạng nội bộ IEC.

### 2.2 Kitchen

- Cần tạo/publish menu tuần, một món/ngày.
- Cần biết tổng số suất phải chuẩn bị sau cutoff.
- Cần tránh double-serving trong giờ cao điểm bằng transaction/idempotency, nhưng Kitchen không quét hay tra cứu nhân viên.
- Cần dashboard aggregate-only về `registered / checked-in / pending / no-show` và shared QR theo ngày/location.
- Kitchen dashboard cần hội tụ bằng polling foreground/focus 10 giây, giữ snapshot cũ khi lỗi tạm thời; không yêu cầu SSE.

### 2.3 Admin/Finance

- Cần quản lý role, account status, penalty và audit.
- Cần truy vết registration owner, delegate, receiver và Kitchen actor.
- Cần số liệu no-show đáng tin cậy để giảm lãng phí và xử lý policy.

## 3. Product goals

1. Staff có thể hoàn tất đăng ký cả tuần trong dưới một phút với thao tác tick/untick.
2. Kitchen có menu tuần rõ ràng và tổng số suất từng ngày sau cutoff.
3. Một registration không thể bị duplicate hoặc serve hai lần dưới concurrency.
4. Staff self check-in chỉ được xác nhận bởi authenticated Staff caller sau khi server kiểm tra own registration, GPS/location/window và authorization.
5. Shared QR ổn định theo meal date/location không chứa employee identity và không xoay theo từng Staff; Staff vẫn phải gửi GPS foreground mới khi resolve và confirm.
6. Một `MealServing` duy nhất cho mỗi registration; confirm transaction/idempotency không tạo double-serving hoặc duplicate outcome.
7. Kitchen dashboard aggregate-only hội tụ qua focused/foreground polling 10 giây; UI giữ snapshot gần nhất và đánh dấu stale khi tạm mất API, không phụ thuộc SSE.
8. No-show tự động sau meal day nếu registration chưa có serving hợp lệ.
9. Hệ thống vận hành ổn định cho 200–300 user trên Linux self-host.

## 4. User roles

| Role      | Quyền chính                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `staff`   | Xem menu tuần, tick/untick registration, scan shared Kitchen QR, resolve/confirm own check-in, lịch sử và penalty; không có active delegation/check-in hộ |
| `kitchen` | Quản lý/publish weekly menu; phát shared QR ổn định theo ngày/location; xem aggregate dashboard; không quét/resolve/confirm nhân viên và không tự có quyền Staff |
| `admin`   | Quản lý user + role `staff`/`kitchen`, penalty, audit, jobs/config; không thể cấp `admin` qua Admin Web và không tự động có Kitchen serving capability |

### Role policy

- An administrator-provisioned, active allowlist-A email requests and verifies an
  OTP; successful verification does not auto-provision a privileged role.
- `staff`, `kitchen` and `admin` assignments are managed server-side with audit.
- Admin Web only manages/can grant or revoke `staff` and `kitchen`; it has no
  Admin-role grant control.
- The first Admin is provisioned by an explicit audited server-side operation;
  no email-domain, client-role, username/password or manual-code login path
  exists.
- A user may have `staff + kitchen` or `staff + admin`. Kitchen staff need the
  explicit `staff` assignment to use Staff registration and self check-in
  surfaces; Kitchen assignment alone cannot check in an employee.
- No `finance` or `kitchen_lead` role exists in MVP; sensitive capability uses
  `penalty.read` and `penalty.resolve`.
- Finance workflow uses Admin Web with the appropriate penalty/report
  permissions.

## 5. Authentication policy

- Production authentication is **allowlist-A email OTP only**.
- OTP request responses are generic for allowlisted, unknown and disabled
  addresses; only an active allowlist record can create a challenge/outbox row.
- OTP values are never persisted or logged. Verification is single-use and
  bounded by expiry and attempt/rate limits.
- Successful verification creates only a high-entropy opaque session token;
  PostgreSQL stores its one-way hash and minimized metadata.
- Every protected request re-resolves current account status and permissions.
  Disabling an account revokes sessions and rejects subsequent requests.
- There is no federated identity-provider login, username/password login,
  authorization, manual-code login, client-supplied role or local production
  bypass.
- Before disabling an account, Admin must preview future registrations and any
  retained historical delegation context and confirm cleanup in one audited
  workflow.
- Cleanup changes future registrations to `canceled` with reason
  `ACCOUNT_DISABLED`, quarantines related historical delegation rows, excludes
  them from Kitchen preparation totals and prevents no-show/penalty creation;
  history, actor, time and reason remain auditable.

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
- Weekly registration eligibility uses Vietnam Monday–Sunday weeks. Before the current week’s Saturday `17:00`, only current-week dates may mutate. At exactly Saturday `17:00`, next week opens while the current week remains eligible through Sunday, subject to each date’s separate cutoff. On the following Monday, the former week is outside the registration window and the new next week stays closed until its Saturday `17:00`.
- Dates outside the current and next week are locked by the weekly window. The weekly gate is independent from `CUTOFF_TIME`; both server-authoritative restrictions apply.
- Một tuần có thể chứa mixed state: ngày đã khóa, ngày còn editable.
- Batch save trả kết quả từng ngày; ngày không hợp lệ không được làm mất draft của ngày khác.
- Không persist literal `unregistered`; không có registration row nghĩa là unregistered.
- `active registration` nghĩa là row có `status=registered` và chưa có active serving.
- Cancel registration atomically quarantines any retained historical delegation
  context, writes audit/notification and never grants current check-in access.
  Historical rows remain readable but are not active authorization.

## 8. Staff self check-in

The current serving flow is **Staff scan → resolve → explicit confirm**. The
Kitchen device does not scan employees or resolve/confirm employee records.

### 8.1 Shared Kitchen QR

- Kitchen calls `GET /api/kitchen/check-in/qr` with its authenticated
  `kitchen.serve` session. The server chooses the caller's active roster
  location; the request has no employee or registration body.
- The response is `{ data: { qr, date, location, activeFrom, expiresAt } }`.
  The QR is stable for the active meal date/location check-in session: it does
  not rotate per Staff and contains no employee identity.
- The server lazily creates or reuses one practical active session for the meal
  date and assigned location. `activeFrom`/`expiresAt` and the
  `10:30–13:30` `Asia/Ho_Chi_Minh` window are server-authoritative.
- Kitchen displays the shared QR and an aggregate dashboard. It does not expose
  a camera scanner, employee lookup, per-employee list or SSE dependency.

### 8.2 Staff resolve and confirm

1. Staff opens the self check-in screen, scans the shared Kitchen QR and
   optionally calls `GET /api/me/check-in` to reconcile current status.
2. Staff captures a **fresh foreground** GPS sample and calls
   `POST /api/me/check-in/resolve` with:

   ```json
   {
     "qr": "<scanned-shared-qr>",
     "gps": {
       "capturedAt": "<UTC ISO instant>",
       "latitude": 10.77,
       "longitude": 106.69,
       "accuracyMeters": 12
     }
   }
   ```

   The sample above is illustrative only; no real coordinates belong in
   source control or evidence. Resolve returns the authenticated caller's
   normalized employee/menu/location/registration/eligibility and, when
   `eligibility=true`, an opaque signed `intentNonce` scoped to caller,
   registration, session and location. It persists a `VALID`
   `ServingVerification` for that scope; `intentNonce` is nullable when
   `eligibility=false`. Resolve does not consume the registration or create a
   serving.
3. Staff reviews the returned own-registration result and explicitly confirms.
   The app captures a **new fresh foreground** GPS sample and calls
   `POST /api/me/check-in/confirm` with
   `{ sessionId, intentNonce, idempotencyKey, gps }`. `intentNonce` is required
   and non-empty for an eligible confirm.
4. Confirm validates the non-empty nonce against the persisted `VALID`
   `ServingVerification`, authenticated caller, session, registration and
   location, then revalidates date/window and fresh GPS policy in one
   transaction. A committed result is
   `{ data: { status: "CHECKED_IN", registrationId, servingId, servedAt } }`;
   retrying the same caller/key/body replays the result without a duplicate.
5. After a timeout, network error or app restart, Staff calls
   `GET /api/me/check-in` and trusts its authoritative state rather than
   displaying local success.

The active flow is own-user only. There is no active delegation, proxy
pickup, owner/delegate selection, multi-item intent or Kitchen employee scan.
Historical delegation tables/events remain retained for read-only history and
compatibility, but they do not authorize current check-in.

### 8.3 Check-in and serving semantics

- Public check-in state is `CHECKED_IN`; the canonical compatibility outcome is
  one immutable `MealServing` row with unique `registrationId`. Registration
  source and registration uniqueness remain unchanged.
- The new `CheckInSession` and confirm metadata are additive context linking the
  stable QR/session to the canonical `MealServing`; they do not create a second
  serving source.
- Confirm is valid only during `10:30–13:30` on the meal date. There is no
  mandatory check-out, reversal or re-serve endpoint.
- Resolve and confirm evaluate the active roster location and configured GPS
  freshness/accuracy/geofence policy. GPS cannot grant entitlement, switch
  location, bypass authorization or replace an ineligible registration.
- GPS collection is foreground/focus-bound to the Staff screen. On denied,
  unavailable, stale, inaccurate or outside-geofence fixes, expose only
  `Retry`/`Refresh`; there is no manual coordinate or manual-code bypass.
- Persist only the safe verification result, verification timestamp, accuracy
  and resolved location ID. Raw latitude/longitude, QR payloads and session
  tokens are not normal logs or retained GPS history.
- Canonical errors include `INVALID_QR`, `INACTIVE_CHECKIN_SESSION`,
  `NO_REGISTRATION`, `REGISTRATION_CANCELLED`, `ALREADY_CHECKED_IN`,
  `OUTSIDE_CHECKIN_WINDOW`, `LOCATION_MISMATCH`, `GPS_REQUIRED`, `GPS_STALE`,
  `GPS_INACCURATE` and `OUTSIDE_GEOFENCE`.

## 9. Historical pickup delegation / nhận hộ

> **Historical design, not current product behavior.** The tables and immutable
> records remain for compatibility, audit and read-only history. The current
> Staff self check-in cutover has no delegation request/accept/revoke API, no
> proxy pickup authorization and no active delegation UI. Do not use the
> following retained rules as staging acceptance criteria.

### 9.1 Product flow

1. A có registration ngày X.
2. A chọn “Ủy quyền nhận hộ”.
3. A tìm B theo user/mã NV và gửi request.
4. B nhận notification/in-app request.
5. B `Accept` hoặc `Decline`.
6. Khi accepted, B có quyền nhận registration của A trong ngày X.
7. Trước khi đưa QR, B chọn trên mobile các suất B thực sự dự định lấy; nếu chỉ có một suất eligible thì app chọn mặc định.
8. B dùng **QR của chính B** tại Kitchen; QR mang pickup intent ngắn hạn của B.
9. Kitchen scan B, nhìn thấy chính xác danh sách/số suất B đã chọn và **chỉ
   confirm trong happy path**, không phải tick lại từng item.
10. Nếu B đổi intent hoặc số khay thực tế không khớp danh sách đã chọn, không
   confirm và không chỉnh sửa trên Kitchen; B phải cập nhật intent rồi đưa QR
   mới để Kitchen resolve lại.
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

## 10. Kitchen aggregate dashboard

The Kitchen screen displays the shared QR and aggregate state only. It calls
`GET /api/kitchen/check-in/dashboard?date=YYYY-MM-DD`, which returns
`{ data: { date, location, window, lastUpdated, counts } }` where `counts`
contains `registered`, `checkedIn`, `pending`, `noShow`, `regular` and
`vegetarian`.

The screen must show:

- Today's menu/date, the stable shared QR and its server-provided active window.
- `Registered`, `Checked in`, `Pending` and (after reconciliation) `No-show`.
- Dietary totals where applicable; `checkedIn + pending + noShow = registered`
  and `regular + vegetarian = registered`.
- A server `lastUpdated` value and a clear stale/offline indicator when the
  retained snapshot is not fresh.

Kitchen polls the dashboard every **10 seconds** only while the dashboard is
focused and the app is foregrounded. Under healthy polling, the dashboard
normally converges within approximately **15 seconds**. A temporary request
failure retains the last good aggregate snapshot indefinitely, marks it stale
and never resets counts to zero. Re-entering focus/foreground triggers an
immediate refresh. The active contract has no SSE/WebSocket requirement,
scanner, employee search, per-employee list or serving log.

Multiple Kitchen devices converge by reading the same committed aggregate
snapshot. Staff confirm is the only check-in mutation; Kitchen never confirms
on behalf of Staff.

## 11. No-show and penalty

### 11.1 No-show

Một registration là no-show khi:

```text
registration active
AND no valid serving exists
AND server time >= 13:30 của meal date
```

Current check-in has no active delegation. Any retained delegation row without
a valid `MealServing` is not a received meal and does not alter the canonical
no-show rule.

No-show worker bắt đầu lúc **13:45** và retry/recovery phải idempotent.

### 11.2 Penalty

- Mỗi no-show tạo đúng một penalty **50.000 VND**.
- `open → paid` hoặc `open → waived`.
- Waive bắt buộc lý do.
- Resolve cần actor/time/audit.
- Job retry không duplicate/reopen penalty đã resolve.

## 12. Serving finality

- Staff confirms only their own registration after the server revalidates
  session, location/GPS evidence, registration and serving window.
- Confirm success creates the final immutable `MealServing` outcome; there is no
  reversal/re-serve API or UI.
- If Kitchen physically has fewer trays, it completes the handover without
  rewriting the committed serving history.
- Serving evidence is not edited/deleted during the retention window.

## 13. Self check-in authorization policy

Self check-in authorization does not depend on client network location.
`GET /api/kitchen/check-in/qr` requires an authenticated Kitchen principal with
`kitchen.serve` and chooses that principal's active roster location. Staff
resolve/confirm requires an authenticated Staff principal and is always scoped
to the caller's own registration.

Resolve/confirm require the shared QR/session, the server check-in window,
fresh foreground GPS policy, current location assignment and database
eligibility. There is no manual-code recovery, manual serving bypass, Kitchen
employee scan or delegation bypass. Login, menu, registration, history,
penalty and notification flows retain their existing allowlist-A
OTP/opaque-session authorization.

## 14. Notifications

Notification inbox là source of truth. Mọi notification được lưu trong PostgreSQL trước khi
delivery; Expo Push chỉ là delivery channel/best-effort hint. Push fail, thiết bị bị revoke,
hoặc user chưa cấp quyền hệ điều hành không được làm mất inbox item. Không giả định có native
device proof trong product requirement.

### 14.1 Canonical event matrix

The inbox remains active and authoritative. The rows marked **Historical only**
are retained for old records/audit compatibility and are not emitted by the
current own-user check-in flow.

| Kind | Trigger/timing | Recipient (exact) | Payload/semantics |
| ---- | -------------- | ----------------- | ----------------- |
| `REGISTRATION_OPENED` | Kitchen **first-publish** weekly menu; publish initializes missing revisions and sets `publishedAt`. Repeated/concurrent publish is a no-op. | Tất cả Staff đang active của IMeal (không phụ thuộc `remindersEnabled`). | `{ weekStart, weekEnd }`; registration/menu action deep-links tới Calendar. |
| `REGISTRATION_REMINDER` | Worker mỗi Chủ nhật **10:00** (`Asia/Ho_Chi_Minh`) cho menu đã publish của thứ Hai tuần kế tiếp; tối đa một item/user/week. | Staff active có ít nhất một enabled, non-holiday meal date chưa có registration `ACTIVE` và `remindersEnabled=true`. | `{ weekStart, weekEnd, remainingMealDates }`; deep-links tới Calendar. |
| `PICKUP_REMINDER` | Worker mỗi ngày **11:30** giờ Việt Nam, cho các registration `ACTIVE`, chưa có serving của ngày hiện tại. | Registration owner only; bỏ qua recipient có `remindersEnabled=false`. | `{ mealDate, registrationIds, registrationCount }`; deep-links tới current Staff check-in. |
| `DELEGATION_REQUESTED` **(Historical only)** | Retained legacy delegation request. | Historical delegate record. | Read-only history/audit; not emitted by current API. |
| `DELEGATION_ACCEPTED` **(Historical only)** | Retained legacy delegation acceptance. | Historical owner record. | Read-only history/audit; not emitted by current API. |
| `DELEGATION_DECLINED` **(Historical only)** | Retained legacy delegation response. | Historical owner record. | Read-only history/audit; not emitted by current API. |
| `DELEGATION_REVOKED` **(Historical only)** | Retained legacy delegation revoke/cancellation record. | Historical delegate record. | Read-only history/audit; not emitted by current API. |
| `PROXY_PICKUP_COMPLETED` **(Historical only)** | Retained legacy proxy serving record. | Historical owner record. | Read-only history/audit; current check-in is own-user only. |
| `REGISTERED_MENU_CHANGED` | Kitchen sửa **published** menu date và có actual tracked change (content, meal type, holiday hoặc enabled). No-op không tạo revision/notification. | Mỗi Staff đang có registration `ACTIVE` cho meal date đó. | `{ dailyMenuRevisionId, mealDate }`; registration/menu action tới Calendar. |
| `NO_SHOW_PENALTY_CREATED` | No-show worker lúc **13:45** VN, sau serving window 10:30–13:30; transaction tạo no-show và penalty idempotently. | Registration owner. | `{ penaltyId, registrationId, mealDate, amount: 50000 }`; readable trong inbox, không có CTA. |

`REGISTRATION_OPENED` chỉ phát ở first publish. Chỉnh sửa một ngày đã publish dùng
`REGISTERED_MENU_CHANGED`, không dùng lại `REGISTRATION_OPENED`. Admin account-disable
notification **không thuộc implementation hiện tại**; nếu cần sẽ thuộc account-disable
subsystem tương lai, không thêm dormant notification kind.

### 14.2 Inbox contract, copy và preferences

Mỗi item có shape bất biến:

```text
{
  id: UUID,
  kind: LEGACY_MESSAGE | REGISTRATION_OPENED | REGISTRATION_REMINDER |
        PICKUP_REMINDER | DELEGATION_REQUESTED | DELEGATION_ACCEPTED |
        DELEGATION_DECLINED | DELEGATION_REVOKED | PROXY_PICKUP_COMPLETED |
        REGISTERED_MENU_CHANGED | NO_SHOW_PENALTY_CREATED,
  payload: kind-specific strict JSON,
  copy: { vi: { title, body }, en: { title, body } },
  readAt: UTC ISO timestamp | null,
  createdAt: UTC ISO timestamp
}
```

IDs và cursor là UUID; timestamp persistence/response dùng UTC ISO (`Z`); meal dates dùng
`YYYY-MM-DD`. Payload strict theo matrix: delegation IDs và related entity IDs là UUID;
`PICKUP_REMINDER.registrationCount` phải bằng số `registrationIds`; no-show amount là
positive integer (canonical 50,000 VND); revoked reason chỉ nhận hai enum ở trên. `LEGACY_MESSAGE`
chỉ để đọc dữ liệu migration cũ, không được tạo bởi application publisher mới.

API owner-scoped (missing và foreign ID cùng trả `NOTIFICATION_NOT_FOUND`):

- `GET /api/notifications?cursor=<UUID>&limit=<1..50>` (default limit 20): trả
  `{ data, meta: { nextCursor, hasNextPage, unreadCount } }`, sort `createdAt DESC, id DESC`.
- `GET /api/notifications/:id`: detail của owner.
- `PATCH /api/notifications/:id/read`: mark-read idempotently, chỉ sau khi detail load thành công.
- `GET /api/notifications/preferences` và `PATCH` cùng path: `{ remindersEnabled, locale }`;
  PATCH phải gửi ít nhất một field, locale là `vi|en`.
- `POST /api/notifications/push-devices`: đăng ký `{ token, platform: ios|android }`.
- `DELETE /api/notifications/push-devices`: revoke `{ token }` chỉ trên device đang thuộc owner.

Copy được render song ngữ cố định khi publish, định dạng ngày bằng `Asia/Ho_Chi_Minh`;
dispatch chọn bản `vi` hoặc `en` theo `User.notificationLocale` (mặc định `vi`). Fallback
`counterpartName` là name → email → neutral fallback. Bản copy không chứa QR/auth/session data.
`remindersEnabled` mặc định `true` và là một opt-out chung cho cả registration reminder và
same-day pickup reminder; không tắt các event notification transactional ở matrix.

### 14.3 Push onboarding và deep link

Sau authenticated native login, mobile hiển thị một contextual permission explainer một lần:
`Enable` mới gọi OS prompt; `Not now` đánh dấu đã xem. Nếu user deny thì không auto-prompt
lại; CTA `Enable` khi permission đã denied mở OS Settings. Web không làm push-specific work;
simulator hiển thị physical-device-required; thiếu EAS project config báo lỗi rõ ràng nhưng
inbox vẫn dùng được. System-notification status/Settings CTA độc lập với reminder switch.

Push data dùng URL chính xác `imeal://notifications/<notificationId UUID>` và mở
`NotificationDetail`. CTA trong detail: registration/menu (`REGISTRATION_OPENED`,
`REGISTRATION_REMINDER`, `REGISTERED_MENU_CHANGED`) → Calendar; `PICKUP_REMINDER`
→ current Staff check-in. Delegation kinds are historical read-only records and
have no current CTA. No-show và legacy vẫn đọc được trong inbox; push delivery
không được coi là authoritative.

### 14.4 Delivery reliability

API và worker publisher tạo `Notification` cùng `NOTIFICATION_CREATED` outbox event trong
cùng transaction, dedupe bằng notification key và `notification-delivery:<notificationId>`.
Worker dispatch chạy mỗi 15 giây: claim outbox bằng row lock/`SKIP LOCKED`, tạo
per-device delivery cho non-revoked devices rồi mark outbox processed; sau đó claim/send
delivery theo locale. Delivery transient network/HTTP 429/5xx/`MessageRateExceeded` retry sau
1, 5 và 15 phút; lần failed thứ tư chuyển `FAILED`. `DeviceNotRegistered` revoke device và
các lỗi permanent `MessageTooBig`, `MismatchSenderId`, `InvalidCredentials` chuyển
`FAILED`. Recover `PROCESSING` quá 5 phút; log chỉ IDs/attempt/provider code/sanitized error.

## 15. Admin and operations

Admin cần tối thiểu:

- Search/list user.
- Quản lý/cấp-gỡ role `staff`/`kitchen` với audit; **không có action cấp role `admin` trong Admin Web**.
- Quản lý Allowlist A với quyền `allowlist.manage`: các thao tác add/list/toggle
  từng địa chỉ đã có sẵn; Admin Web cũng cung cấp bulk textarea để gửi tối đa
  500 dòng email đầu vào trong một lần với cùng state, effective-date range và
  reason; server chuẩn hóa rồi loại trùng.
- Bulk allowlist chuẩn hóa và loại trùng email ở server, validate toàn bộ trước
  khi ghi và upsert trong một transaction; có thể liên kết user hiện có cùng
  email nhưng không tạo user hoặc role. Kết quả phải phân biệt linked và
  unlinked; audit chỉ ghi aggregate an toàn.
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
| Check-in API availability             | ≥99.9% trong serving window 10:30–13:30, đo theo tháng                                       |
| Staff confirm response P95            | <1 giây                                                                                      |
| Invalid/stale QR or GPS creates serving sai | 0                                                                                         |
| No-show/penalty duplicate             | 0                                                                                             |
| Kitchen aggregate snapshot drift      | 0 after reconciliation; focused/foreground poll normally converges within approximately 15 seconds; refresh failures retain stale last-good data indefinitely |
| Active proxy/delegation check-in      | 0 (current flow is own-user only)                                                            |

## 17. Non-goals v2 MVP

- Không quản lý kho/nguyên liệu/công thức/nhà cung cấp.
- Không cho Staff chọn nhiều món trong cùng ngày.
- Không dùng check-out để chứng minh user đã ăn hết suất.
- Không tự động dự báo giảm số suất nấu bằng ML ở MVP.
- Staff không được xác nhận thay cho người khác; self check-in chỉ xác nhận
  registration của authenticated caller sau server revalidation.
- Không có active proxy/delegation check-in; retained legacy delegation records
  remain read-only and cannot authorize a current check-in.

## 18. Canonical implementation policy

| Policy                | Canonical value                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| Check-in recovery     | No manual-code/GPS bypass; rescan shared QR, capture fresh GPS and retry/reconcile authoritative status  |
| Cutoff boundary       | `server_now < 14:00` ngày trước; đúng 14:00 đã khóa                                                       |
| Serving/no-show       | Serving/check-in 10:30–13:30; no-show worker bắt đầu 13:45 VN                                             |
| Shared QR             | Stable per active meal date/location; Kitchen `GET /api/kitchen/check-in/qr`; no employee identity      |
| Staff flow            | `GET /api/me/check-in` → scan → `POST /api/me/check-in/resolve` + fresh GPS → eligible `intentNonce` → explicit `POST /api/me/check-in/confirm` + same nonce + fresh GPS |
| Confirm outcome       | One unique `MealServing.registrationId`; caller/key/body idempotent replay; no reversal/re-serve       |
| Kitchen dashboard     | `GET /api/kitchen/check-in/dashboard?date=YYYY-MM-DD`; aggregate-only, focused/foreground polling 10s, normally converge ~15s, retain stale snapshot indefinitely on refresh failure, no SSE |
| Push provider         | Persisted inbox + Expo Push delivery                                                                        |
| Serving finality      | Confirm là cuối cùng; Staff xác nhận own registration, không có Kitchen employee confirm                 |
| Penalty               | Mỗi no-show tạo 50.000 VND; ngoại lệ dùng audited waive                                                   |
| Menu image storage    | Object/file storage; không lưu binary trong PostgreSQL                                                     |
| Data retention        | Meal lifecycle/business audit history giữ 1 năm rồi purge theo retention policy                            |
| Migration compatibility| `MealServing` remains sole serving source; `CheckInSession`/confirm metadata additive; historical pickup/delegation tables retained; no raw GPS logs |
| Legacy data           | Firebase legacy bỏ ngay từ khi bắt đầu re-development; không migrate/dual-write/rollback                  |
