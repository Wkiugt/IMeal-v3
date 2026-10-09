# IMeal v2 — UI/UX Design

## 1. Design intent

IMeal v2 là mobile-first operational product. UI phải ưu tiên:

1. **Nhanh** — Staff đăng ký cả tuần, quét QR Kitchen và xác nhận chính suất
   của mình trong ít thao tác.
2. **Rõ trạng thái** — chưa đăng ký/đã đăng ký/đã check-in/đã khóa/NO_SHOW
   phải khác nhau rõ ràng.
3. **Chống thao tác sai** — chỉ Staff xác nhận đăng ký của chính mình sau
   resolve và confirm đều có GPS foreground mới, rồi server commit.
4. **Recovery** — QR shared không hợp lệ, mất mạng, GPS/camera lỗi đều có
   next action; không có delegation active.
5. **Audit-friendly** — actor/date/registration/serving outcome không mơ hồ;
   Kitchen chỉ thấy aggregate.
6. Accessibility và operational safety ưu tiên hơn hiệu ứng thị giác.

## 2. Primary devices

| Role    | Primary device                                                        |
| ------- | --------------------------------------------------------------------- |
| Staff   | iOS/Android phone                                                     |
| Kitchen | Android/iOS phone hoặc tablet làm màn hình QR/dashboard; không cần camera |
| Admin   | Desktop web; mobile admin chỉ là optional secondary                   |

## 3. Visual direction

Giữ IEC brand nhưng redesign thành native-mobile system, không port nguyên web shell.

Visual-system authority now lives in [`08-imeal-design-system.md`](./08-imeal-design-system.md). Use that guideline for visual tokens, surfaces, reusable component contracts, semantic indicators, motion, and accessibility consistency. This document remains authoritative for current Staff scan→resolve→explicit-confirm, foreground-GPS recovery, Kitchen shared QR/aggregate polling, cutoff, service-window, notification and permission states. Historical delegation/scanner/pickup visuals are retained only as provenance, not as a runtime contract. `docs/System-design-UI/DESIGN.md` remains preserved prototype provenance rather than a new runtime contract.

### 3.1 Palette baseline

Chưa phát triển

### 3.2 Semantic colors

- Success: green + icon/text.
- Warning: amber + text.
- Error/destructive: red + text.
- Info: blue/navy.
- Không dùng màu là tín hiệu duy nhất.

### 3.3 Typography

Recommendation:

- Một font family nhất quán cho mobile, ưu tiên Montserrat nếu brand yêu cầu và Vietnamese rendering ổn định.
- Body 14–16px equivalent.
- Important counters 28–40px tùy device.
- Captions tối thiểu 12px.
- Line-height ≥1.4 cho text dài.

Không giữ exception Fraunces/Inter của login legacy trừ khi brand review yêu cầu.

### 3.4 Touch and geometry

- Touch target tối thiểu 44×44.
- Primary Staff Confirm target and Kitchen QR display target are larger than
  the minimum; Kitchen has no employee scanner/confirm control.
- Default radius khoảng 10–14px phù hợp mobile card.
- Không lồng card nhiều tầng.
- Safe-area bắt buộc trên iOS/Android gesture navigation.

### 3.5 Loading and transitions

- Initial asynchronous data or permission loads use `BrandLoader` for a minimum of 2,000 ms before successful content is revealed.
- Known initial errors and recovery states bypass this minimum immediately.
- Revalidation and mutation flows never receive artificial loading delay. Static or session-only screens are not gated.

## 4. Global navigation

### Staff

```text
Home | Tuần ăn | Thông báo | Tài khoản
```

### Staff + Kitchen

```text
Home | Tuần ăn | Check-in | Thông báo | Tài khoản
```

### Kitchen-only

```text
Dashboard | Shared QR | Tài khoản
```

Kitchen check-in dashboard/QR must be discoverable in 1 tap after login. There
is no Kitchen scanner navigation item.


Do not use web-style module dropdown as primary mobile navigation.

- The outer bottom-navigation backing uses the screen background. Keep the floating pill at least `theme.spacing.navInset` (16px) from the available physical edge, using the OS bottom inset when it is larger.

## 5. Login screen

Production login is allowlist-A email OTP only:

```text
             IMeal

  Quản lý suất ăn nội bộ IEC

  [ Email công việc                         ]
  [ Gửi mã OTP                              ]

  Nếu email được cấp quyền, mã xác minh sẽ được gửi.
```

States:

- OTP request pending/success with generic non-disclosure copy.
- OTP verification pending, invalid, expired or attempt-limited.
- Account disabled/session revoked.
- API or provider unreachable.

An invalid or expired OTP is an operation error: preserve any unrelated
authenticated session and let the user retry verification. A protected
`SESSION_INVALID` response is different: clear only the matching opaque session,
reset navigation to Auth, and show the reason-safe sign-in prompt.

OTP success creates an opaque server session; the mobile client never receives
identity-provider tokens or chooses a role. Không có federated identity-provider
email/password fields, signup, forgot-password, email-domain authorization,
manual-code login hoặc local production bypass.

## 6. Staff Home

Hierarchy:

1. Today meal/status.
2. Own Staff check-in action if the caller has an active registration.
3. Weekly registration summary.
4. Notifications.

Example:

```text
Xin chào, Minh

HÔM NAY
Cơm gà xối mỡ
✓ Đã đăng ký

[ MỞ SELF CHECK-IN ]

TUẦN NÀY
4/5 ngày đã đăng ký
[ Quản lý tuần ăn ]
```

## 7. Weekly registration screen

### 7.1 Day card

Each day is one compact row/card. The server supplies the lunar metadata and available meal choices:

```text
┌────────────────────────────────┐
│ ✓  Thứ Ba · 18/08              │
│    Bún bò Huế                  │
│    Rằm · 15 âm lịch            │
│    [ Mặn ] [ Chay ]            │
│    Sửa đến 14:00 Thứ Hai      │
└────────────────────────────────┘
```

Locked:

```text
🔒 Thứ Hai · 17/08
   Cơm gà
   Đã khóa
```

No published menu:

```text
—  Thứ Sáu · 21/08
   Thực đơn chưa được công bố
```

### 7.2 Controls

- Tap checkbox/row to toggle editable day.
- On normal service dates, only `Mặn (REGULAR)` is available.
- On lunar day 1 (`Mùng 1 âm lịch`) or lunar day 15 (`Rằm · 15 âm lịch`), including a leap month, show `Mặn (REGULAR)` and `Chay (VEGETARIAN)`; the selected choice is persisted with the registration.
- `Chọn cả tuần` only selects editable days and defaults to `Mặn (REGULAR)` unless an eligible lunar day is explicitly changed.
- Sticky/footer CTA `Lưu thay đổi` appears when draft differs from server.
- Unsaved changes remain if request partially fails.
- The weekly display keeps `ACTIVE` selected and mutable while allowed; `SERVED` remains selected as meal received and `NO_SHOW` remains selected with a receipt-not-recorded warning; both finalized states are locked and never become mutation payloads. `CANCELLED` and unregistered dates are not booked.
- Month booked markers include `ACTIVE`, `SERVED`, and `NO_SHOW`; Home/count semantics remain unchanged.
- If a save fails because cutoff or authority changed, retain the failed local draft through authoritative refresh. The user can always choose the authoritative active state or meal choice to restore the complete server state locally; meal-choice restore is allowed only when the draft has the same authoritative active state, while divergent activation follows current capability and cutoff rules.
- Unticking a day with a serving or finalized state is blocked by the
  authoritative registration state; there is no active delegation prompt.

### 7.3 Feedback

Success:

```text
Đã cập nhật đăng ký tuần 17–21/08.
```

Partial:

```text
Đã lưu 4 ngày.
Thứ Ba không thể thay đổi vì đã qua hạn.
```

Do not use optimistic “saved” state before API success.

- Pending opacity and toggle animation belong only to the day currently being saved. Other days may be interaction-disabled while requests serialize, but must not receive the visual saving state.

## 8. Staff self check-in screen

The Staff app scans the Kitchen's stable shared QR. Staff does not generate a
QR and does not select another person or multiple registrations.

```text
SELF CHECK-IN

Đăng ký hôm nay
Cơm gà xối mỡ · Địa điểm do server xác định

[ QUÉT QR KITCHEN ]

Camera: foreground only
GPS: cần mẫu mới khi resolve và mẫu mới lần nữa khi xác nhận
```

After scanning, capture a fresh foreground GPS sample and call
`POST /api/me/check-in/resolve` with `{ qr, gps }`. When eligible, the
response includes an opaque signed `intentNonce` scoped to the caller,
session, own registration and location; it is nullable when
`eligibility=false`. Show only the authenticated caller's own
employee/menu/location/registration/eligibility.
Require an explicit review and Confirm action:

```text
Bạn: Nguyễn Văn A
Món: Cơm gà
Đăng ký: ACTIVE
Địa điểm: [server value]

[ XÁC NHẬN CHECK-IN ]
```

Confirm captures a **new** fresh foreground GPS sample and calls
`POST /api/me/check-in/confirm` with
`{ sessionId, intentNonce, idempotencyKey, gps }`. A non-empty `intentNonce`
is required for an eligible confirm; the server validates its caller/session/
registration/location scope. Success is `CHECKED_IN` with server serving
ID/time. `GET /api/me/check-in` reconciles initial state, timeout/lost response
and already-checked-in state.

Requirements:

- The Kitchen QR is stable for one day/location session and displays
  server-provided `activeFrom`/`expiresAt`; it contains no employee data.
- GPS denied/stale/inaccurate/outside-geofence states expose Retry/Refresh only;
  no manual coordinates or background tracking.
- Stop camera/GPS collection on blur, background, completion, cancellation or
  unmount. Do not retain raw coordinates in UI logs/evidence.
- Retry the same idempotency key after a lost confirm response; never show local
  success before server confirmation.
- No Staff-generated QR, delegation/proxy flow, multi-item intent or manual
  code bypass exists in the current UI.

## 9. Historical delegation UX

The old owner/delegate request, accept, revoke and proxy-pickup surfaces are
not part of the current navigation or acceptance flow. Historical records may
remain readable in owner-scoped history/notifications for audit and migration
compatibility, with no current action CTA. They must never authorize current
Staff check-in or appear as Kitchen dashboard controls.


## 10. Notification inbox

Notification is a persisted, owner-scoped inbox rather than a push-only feed. The list is
ordered newest first and supports initial load, pull-to-refresh, empty, loading, error/retry,
unread markers, tab badge, and cursor pagination (limit 20; server bounds 1–50). Use immutable
replacement after mark-read so the opened detail and unread badge agree with server state.
Group list rows by date without changing the server order.

Each item renders the stored localized copy and kind-specific content:

```text
{
  id: UUID,
  kind,
  payload,
  copy: { vi: { title, body }, en: { title, body } },
  readAt: UTC ISO timestamp | null,
  createdAt: UTC ISO timestamp
}
```

Detail loads `GET /api/notifications/:id` owner-scoped and only then calls
`PATCH /api/notifications/:id/read`. Missing and foreign IDs show the same safe not-found
recovery. Render no QR/auth/session data in copy. Bilingual copy is fixed at publish time;
push/in-app date formatting follows `Asia/Ho_Chi_Minh`, and the user's `vi|en` locale selects
the push language.

### 10.1 Notification matrix and actions

| Kind                                          | Recipient and timing                                                                                                           | Detail CTA/destination   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| `REGISTRATION_OPENED`                         | Every active Staff user when Kitchen first publishes a week; repeat publish is a no-op.                                        | Calendar.                |
| `REGISTRATION_REMINDER`                       | Staff missing enabled non-holiday registrations, Sunday 10:00 VN for next week, only when reminders are enabled.               | Calendar.                |
| `PICKUP_REMINDER`                             | Owner's active unserved registration, daily 11:30 VN, when reminders are enabled.                                              | Staff Check-in.          |
| `REGISTERED_MENU_CHANGED`                     | Active registrants after an actual edit to a published date; no-op has no item.                                                | Calendar/date.           |
| `NO_SHOW_PENALTY_CREATED`                     | Owner after 13:45 VN no-show processing, with 50,000 VND amount.                                                               | Readable detail, no CTA. |

Delegation/proxy kinds remain readable historical notification rows with no
current CTA and are not emitted by the current self check-in flow.

First publish emits `REGISTRATION_OPENED`; an edit to an already-published registered date
emits `REGISTERED_MENU_CHANGED`, not another opened item. Admin account-disable notification
is future scope only and has no current UI kind.

### 10.2 Push permission onboarding

On first authenticated native login, show one contextual explainer:

```text
Nhận thông báo để không bỏ lỡ đăng ký và self check-in
[ Bật thông báo ] [ Để sau ]
```

`Bật thông báo` is the only path that calls the OS permission prompt; `Để sau` marks the
one-time explainer as seen. Once permission is denied, never auto-prompt again; the Enable
action becomes an OS Settings CTA. The profile also exposes an independent system-notification
status/Settings action, separate from the reminder preference. Web does no push-specific work;
simulators show that a physical device is required; missing EAS configuration shows a clear
registration error while inbox remains usable. Avoid claiming native-device proof in this UI
spec.

The shared reminder switch defaults on and controls weekly registration and
owner-only same-day Staff check-in reminders. It changes only after
`PATCH /api/notifications/preferences` succeeds; on failure restore the
confirmed server value and show recovery copy. Locale PATCH is best effort and
must preserve VI/EN key parity. Transactional menu, cancellation and no-show
notifications are not silenced by this switch; historical delegation/proxy
rows are not emitted.

### 10.3 Push tap and screen states

Push data uses the exact `imeal://notifications/<validated UUID>` URL. Foreground
and background/cold-start responses navigate through the authenticated
navigation ref to `NotificationDetail`; if auth/navigation is not ready, queue
the UUID until ready. Ignore malformed or mismatched payloads. Detail actions go
to Calendar or current Staff Check-in as listed above. Historical
delegation/proxy, no-show and legacy items remain readable without a current CTA.
System push is best effort; tapping/opening the inbox is authoritative.

## 11. Kitchen shared QR and aggregate dashboard

### 11.1 Priority layout

On phone/tablet:

1. Meal date/menu and server-resolved location.
2. Large shared QR with `activeFrom`/`expiresAt`.
3. Aggregate `Registered / Checked in / Pending / No-show` KPIs.
4. Dietary totals `Regular / Vegetarian`.
5. Server `lastUpdated` and stale/recovery indicator.

The Kitchen surface is a display and monitoring surface. It has no camera
scanner, employee search, employee names, per-person list, delegation/proxy
control or serving log.

Example:

```text
Cơm gà xối mỡ · 17/08
Địa điểm: Kitchen A

[        STABLE SHARED QR        ]
Hoạt động: 10:30–13:30

ĐĂNG KÝ       ĐÃ CHECK-IN       CÒN CHỜ       VẮNG MẶT
220            127               93             0

THƯỜNG 190 · CHAY 30
Cập nhật máy chủ: 12:08:31
```

### 11.2 Serving-window state

Outside 10:30–13:30, keep the menu/dashboard readable and show the server
window/state distinctly from a network error. Do not present the QR as an
employee authorization result outside its server-provided active window.

## 12. Kitchen polling and stale snapshot

The dashboard calls
`GET /api/kitchen/check-in/dashboard?date=YYYY-MM-DD` only while the app is
foregrounded and the dashboard is focused. Poll every 10 seconds and fetch
immediately on re-entry. The QR is loaded from
`GET /api/kitchen/check-in/qr` and remains stable for the active day/location
session.

On temporary request failure, retain the last good snapshot and mark it stale
until a successful refresh. Under healthy polling, the visible snapshot normally
converges within approximately 15 seconds. Never replace a snapshot with
`0 / 0`, an empty employee list or invented success. There is no SSE/WebSocket
dependency. Multiple Kitchen displays converge by fetching the same
server-derived aggregate state.

```text
CHECK-IN DASHBOARD · STALE
Last server update: 12:08:31
Retrying when focused...
[ Registered 220 ] [ Checked in 127 ] [ Pending 93 ]
```

The server invariants shown by the UI are
`checkedIn + pending + noShow = registered` and
`regular + vegetarian = registered`. An invariant/error response shows safe
recovery without partial counters.

## 13. Staff resolve/confirm result card

The Staff app owns the only current scan/resolve/confirm surface. After resolve,
render the authenticated caller's own result:

```text
SELF CHECK-IN
Bạn: Nguyễn Văn A
Đăng ký: ACTIVE
Món: Cơm gà
Địa điểm: Kitchen A
GPS: Đã xác minh · mẫu mới

[ XÁC NHẬN CHECK-IN ]
```

Confirm takes a new foreground GPS sample and sends the same
`idempotencyKey` on retry. On success:

```text
✓ CHECKED_IN
Đăng ký: <registrationId>
Serving: <servingId>
Thời gian: 12:08:31
```

If already checked in, resolve/status reconciliation shows the existing
server state instead of creating another serving. If resolve or confirm fails
for invalid QR, inactive session, missing/canceled registration, window,
location or GPS policy, show the canonical safe error and Retry/Refresh only.

## 14. Kitchen aggregate data surface

The response is aggregate-only and may contain `date`, `location`, `window`,
`lastUpdated`, `registered`, `checkedIn`, `pending`, `noShow`, `regular` and
`vegetarian` counts. Do not add client-side employee data, owner/receiver names,
delegation state, QR payloads, raw GPS or per-serving event logs.

`MealServing.registrationId` remains the unique canonical outcome. Historical
pickup/delegation tables and notification rows can remain readable in Admin or
owner history but never become Kitchen controls or current Staff authorization.

## 15. Weekly menu management UX

Kitchen menu editor optimized for one fixed meal/day:

```text
Tuần 17–21/08 · Nháp

T2 · 17/08
[ Tên món ]
[ Mô tả ]
[ Ảnh ]

...

[ Lưu nháp ] [ Công bố ]
```

Requirements:

- Clear draft/published state.
- Week starts Monday; all enabled Monday–Friday service dates require a valid menu, while holidays are explicitly disabled.
- Published-menu edit before cutoff is labeled as a new revision and confirms that registered Staff will be notified.
- Registered daily menu cannot be unpublished/deleted.
- Locked day read-only.
- Image upload progress/error/retry.
- Confirm publication when action exposes menu to all Staff.

## 16. Admin Web UX

Desktop-first tables/cards for:

- User + `staff`/`kitchen` role management; no Admin-role grant control.
- Allowlist A single-record add/list/toggle and bulk provisioning. The bulk
  control is a textarea for up to 500 email entries plus shared state, effective-date
  range and reason fields; the server normalizes and deduplicates them, then
  shows linked/unlinked counts returned by the server using the explicit
  `allowlist.manage` permission.
- Account status.
- Penalties.
- Serving/delegation audit (read-only serving history; no reversal control).
- Jobs/health.
Bulk/destructive actions require confirmation and visible actor/date/scope.

Admin account disable shows active roles, future registrations and retained
historical delegation rows. Admin must confirm one workflow that disables access
and cancels/quarantines future commitments with reason `ACCOUNT_DISABLED`; these
rows remain in history but are excluded from Kitchen totals and penalties. Admin
Web manages independent `staff`/`kitchen` roles and clearly states that Kitchen
does not inherit Staff. It has no control for granting/revoking `admin`.
Jobs/Health shows run status, attempts, sanitized errors and a confirmed manual
retry action.

The Users view is server-authoritative: identity, effective service location, roster
assignment and Allowlist A state are shown as separate concepts, with no fabricated
department or location labels. Role controls expose only independently managed
`staff` and `kitchen` checkboxes; Admin roles are displayed but never grantable or
revocable from this surface. List filters and detail sessions/audit entries are
server-paginated.

Account lifecycle is explicit: disabling opens a preview with future registration,
retained historical delegation and active-session counts before a separate
confirmation; self-disable is blocked. Enabling restores only account `active`
status and does not restore allowlist state, commitments, historical delegated
authority or revoked sessions. Session revocation states the persisted
`ADMIN_REVOKED` reason, and audit details preserve managed-role before/after
arrays in readable form.

If a protected Admin Web request returns structured `SESSION_INVALID`, the client
clears the matching opaque session and returns to login without calling logout.
In-flight Users responses are ignored after navigation or logout so protected
content cannot be reattached to a new or unauthenticated surface.

Staff Account includes read-only mobile meal history and penalty list/detail views in the Profile stack (`MealHistory`, `PenaltyList`, and `PenaltyDetail`) with profile links, paginated loading, filter selection, retry, and empty/error states; the profile also shows server-backed booked/enjoyed totals for the current Vietnam business month, where a real `0` is distinct from loading or unavailable data and stats failures remain non-blocking with retry; mutation controls for penalty resolution are never shown to Staff.

## 17. Accessibility

- Native accessible labels/roles for all controls.
- Touch target >=44×44.
- Screen reader announces QR status, weekly selected state and serving feedback.
- Do not rely on checkbox color alone; selected state includes check/icon/text.
- Dynamic serving result uses accessible live announcement.
- Reduced motion supported.
- Text scales without losing action controls.
- Camera/GPS recovery does not require gestures inaccessible to
  keyboard/switch control where platform supports alternatives.

## 18. Error/recovery matrix

| Flow                  | Error                                  | Required recovery                                                                  |
| --------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| Email OTP             | invalid/expired/network/disabled       | Generic reason-safe copy; retry request or verification without account disclosure |
| Weekly load           | API fail                               | Preserve last safe view where possible + retry                                     |
| Weekly save           | partial cutoff/conflict                | Per-day result + retain failed draft                                               |
| Shared QR             | invalid/expired/wrong location        | Staff rescans current Kitchen QR; no manual-code fallback                         |
| GPS                   | denied/stale/inaccurate/geofence       | Foreground Retry/Refresh only; no manual coordinates or background tracking       |
| Resolve               | no registration/canceled/window error  | Show canonical own-user state/error; do not substitute another user                |
| Confirm               | DB/network/already checked-in          | Retry same idempotency key or call own status; never fake success                  |
| Dashboard poll        | temporary request error                | Retain last good aggregate snapshot indefinitely, mark stale until successful refresh; healthy polling normally converges within ~15 seconds |
| Service window        | before 10:30 or at/after 13:30         | Keep dashboard readable; disable Staff resolve/confirm with exact window           |
| Account disabled      | any protected action                   | Stop action, clear sensitive session state and show account-support path           |
| Menu revision         | registered date changed                | Preserve registration; show revision notice from persisted inbox                   |
| Menu upload           | file/upload fail                       | Retry without losing text fields                                                   |

## 19. UX acceptance tests

- Staff can register five-day week one-handed on common phone sizes.
- Mixed locked/editable week is understood without explanation.
- Staff scans a stable shared Kitchen QR, sees only own registration and
  explicitly confirms after resolve.
- Resolve captures fresh foreground GPS; confirm captures a second fresh sample.
- Invalid QR, missing/canceled/already-checked-in registration, window/location
  and GPS errors show safe canonical recovery.
- Lost confirm response retries the same idempotency key or reconciles own
  status, with exactly one unique `MealServing`.
- Kitchen displays the stable QR and aggregate counts with no employee scanner,
  search, list, names, delegation/proxy control or serving log.
- Kitchen dashboard polls every 10 seconds only while focused/foreground and
  normally converges within approximately 15 seconds; on errors it keeps a
  stale last-good snapshot indefinitely until a successful refresh.
- Dashboard invariants hold and two Kitchen devices converge through snapshots;
  no SSE/WebSocket is required.
- Exact 14:00 cutoff and 10:30/13:30 service boundaries are understandable.
- Staff can find meal history and penalty details from Account without Admin
  controls.
- Admin disable preview and mandatory no-penalty future-commitment cleanup form
  one confirmed workflow.
- Admin Users distinguishes account lifecycle, Allowlist A, roster assignment and
  server-effective location; role, session and persisted-audit pagination remain
  usable without exposing Admin-role mutation.
- Screen reader/large-text/reduced-motion paths remain functional.
