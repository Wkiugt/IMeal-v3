# IMeal v2 — UI/UX Design

## 1. Design intent

IMeal v2 là mobile-first operational product. UI phải ưu tiên:

1. **Nhanh** — Staff đăng ký cả tuần và Kitchen giao suất trong ít thao tác.
2. **Rõ trạng thái** — đã đăng ký/chưa đăng ký/đã khóa/đã nhận/nhận hộ phải khác nhau rõ ràng.
3. **Chống thao tác sai** — serving chỉ thành công sau Kitchen confirmation và server commit.
4. **Recovery** — QR hết hạn, mất mạng, camera lỗi, delegation thay đổi đều có next action.
5. **Audit-friendly** — tên owner/receiver/date/action không được mơ hồ.
6. Accessibility và operational safety ưu tiên hơn hiệu ứng thị giác.

## 2. Primary devices

| Role    | Primary device                                                        |
| ------- | --------------------------------------------------------------------- |
| Staff   | iOS/Android phone                                                     |
| Kitchen | Android/iOS phone hoặc tablet có camera; landscape tablet phải usable |
| Admin   | Desktop web; mobile admin chỉ là optional secondary                   |

## 3. Visual direction

Giữ IEC brand nhưng redesign thành native-mobile system, không port nguyên web shell.

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
- Primary Kitchen confirm target lớn hơn mức tối thiểu.
- Default radius khoảng 10–14px phù hợp mobile card.
- Không lồng card nhiều tầng.
- Safe-area bắt buộc trên iOS/Android gesture navigation.

## 4. Global navigation

### Staff

```text
Home | Tuần ăn | Thông báo | Tài khoản
```

### Staff + Kitchen

```text
Home | Tuần ăn | Check-in | Thông báo | Tài khoản
```

Kitchen check-in phải discoverable trong 1 tap sau login.

Do not use web-style module dropdown as primary mobile navigation.

## 5. Login screen

Minimal corporate authentication:

```text
             IMeal

  Quản lý suất ăn nội bộ IEC

  [ Đăng nhập với Microsoft ]

  Sử dụng tài khoản Microsoft của tổ chức
```

States:

- Auth pending.
- Entra cancel/error.
- Wrong tenant/access denied.
- IMeal account disabled.
- API unreachable.

Không có email/password fields, signup hoặc forgot-password của IMeal.

## 6. Staff Home

Hierarchy:

1. Today meal/status.
2. QR primary action if eligible.
3. Weekly registration summary.
4. Delegation pending actions.
5. Notifications.

Example:

```text
Xin chào, Minh

HÔM NAY
Cơm gà xối mỡ
✓ Đã đăng ký

[ MỞ MÃ NHẬN SUẤT ]

TUẦN NÀY
4/5 ngày đã đăng ký
[ Quản lý tuần ăn ]

ỦY QUYỀN
1 yêu cầu đang chờ
```

## 7. Weekly registration screen

### 7.1 Day card

Each day is one compact row/card:

```text
┌──────────────────────────────┐
│ ✓  Thứ Ba · 18/08           │
│    Bún bò Huế                │
│    Sửa đến 14:00 Thứ Hai    │
└──────────────────────────────┘
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
- `Chọn cả tuần` only selects editable days.
- Sticky/footer CTA `Lưu thay đổi` appears when draft differs from server.
- Unsaved changes remain if request partially fails.
- Unticking a day with active delegation opens confirmation naming the delegate and explains that the delegation will be revoked.

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

## 8. QR screen

QR is visually dominant but status context remains visible.

If there is only one eligible meal, it is selected automatically and the QR is shown immediately. If there are multiple eligible meals, Staff chooses pickup intent before presenting the QR:

```text
MÃ NHẬN SUẤT
Nguyễn Văn B · NV105

Bạn sẽ nhận hôm nay:
☑ Suất của bạn
☑ Nhận hộ Nguyễn Văn A
☐ Nhận hộ Nguyễn Văn C

       [ QR NHẬN 2 SUẤT ]

Mã tự làm mới mỗi 5 giây
```

Requirements:

- Staff-side item selection appears only when more than one eligible pickup item exists; one-item pickup requires no extra selection step.
- QR refresh preserves the current pickup intent.
- Visible countdown/progress optional; avoid distracting animation.
- Expired QR visibly invalidates rather than silently remaining on screen.
- Refresh should not jump layout.
- Screenshot-sharing disclaimer can be subtle; system design should not depend on copy alone.
- Reduced-motion users still receive clear expiry state.
- QR TTL is 5 seconds with at most 2 seconds server-validated skew; countdown/expiry changes use an accessible live announcement.
- Outside 10:30–13:30, show the service window and do not present QR as currently usable for serving.

## 9. Delegation UX

### 9.1 Owner request

From meal detail:

```text
[ Ủy quyền nhận hộ ]
```

Search result card includes:

- Display name.
- Employee code.
- Masked/secondary email if useful to disambiguate.

Confirmation copy names both date and delegate.

### 9.2 Pending state

```text
Đang chờ Nguyễn Văn B xác nhận
[ Hủy yêu cầu ]
```

### 9.3 Incoming request

```text
Nguyễn Văn A muốn bạn nhận hộ
Thứ Ba · 18/08
Bún bò Huế

[ Từ chối ]  [ Chấp nhận ]
```

### 9.4 Accepted

Owner:

```text
✓ Nguyễn Văn B sẽ nhận hộ
[ Hủy ủy quyền ]
```

`Hủy ủy quyền` opens a confirmation naming the delegate and explaining that pickup permission ends immediately. No local success state appears before the server confirms revoke.

Delegate:

```text
✓ Bạn đã nhận lời nhận hộ Nguyễn Văn A
```

If revoked/served concurrently, UI must reconcile backend result instead of assuming local state wins.

## 10. Notification inbox

Notification is persisted in app and can be grouped:

- Delegation request.
- Delegation accepted/declined/revoked.
- Proxy serving completed.
- Registration cancellation that auto-revokes delegation.
- Published menu revision for a registered date.
- Admin change to future commitments after account disable.

Push notification is a delivery hint; tapping it deep-links to the persisted in-app item/action.

## 11. Kitchen Check-in screen

### 11.1 Priority layout

On phone/tablet:

1. Today/date/menu.
2. Large `Served / Total` KPI.
3. Scanner area.
4. Current resolved pickup card.
5. Recent log.
6. Tabs/list.

Example:

```text
Cơm gà xối mỡ
17/08

127 / 220 ĐÃ GIAO
93 còn lại
██████████░░ 57.7%

[ CAMERA SCANNER ]

VỪA CHECK-IN
12:08:31 Nguyễn Văn A · Chính chủ
12:08:25 Nguyễn Văn B · Nhận hộ A
```

### 11.2 Network state

Outside internal network:

```text
Check-in cần mạng nội bộ IEC

Thiết bị hiện không thể truy cập hệ thống giao suất.
```

Scanner/confirm controls disabled, but do not hide the reason.

Outside the 10:30–13:30 serving window, use a distinct time state—not a network error—and keep dashboard/menu readable.

## 12. Pickup resolution card

After QR scan, do not auto-serve and do not make Kitchen repeat the Staff selection in the happy path.

### One item

```text
Nguyễn Văn B · NV105

1 SUẤT · CHÍNH CHỦ
Cơm gà

[ XÁC NHẬN GIAO 1 SUẤT ]
```

### Multiple intended items

```text
Nguyễn Văn B · NV105

2 SUẤT
• Nguyễn Văn B · Chính chủ
• Nguyễn Văn A · Nhận hộ

[ XÁC NHẬN GIAO 2 SUẤT ]
```

Design requirements:

- Staff chooses the intended multi-item set before showing QR; Kitchen sees that validated set directly.
- Owner vs receiver remains visually explicit.
- Kitchen has one large confirm action and **no item checkbox list or item-edit action**; the Staff-selected QR intent is authoritative subject to server revalidation.
- Confirm button includes count and is optimized for repeated high-throughput scanning.
- If pickup session expires, keep names visible but disable confirm and ask re-scan.
- Pickup session expires after 30 seconds; display remaining validity without relying on animation alone.
- Multi-item confirm remains all-or-nothing. `PICKUP_STATE_CHANGED` means no intended item was served; disable confirm and require re-resolve.

## 13. Serving feedback

Success self:

```text
✓ Đã giao suất
Nguyễn Văn B · NV105
12:08:31
```

Success proxy:

```text
✓ Đã giao suất nhận hộ
Suất của: Nguyễn Văn A
Người nhận: Nguyễn Văn B
12:08:31
```

Duplicate:

```text
⚠ Suất đã được nhận
Người nhận: Nguyễn Văn B
12:04:18
```

Do not use generic “OK”.

Kitchen verifies the displayed Staff-selected names/count and sufficient trays before confirmation. After successful confirmation, serving is final and neither Kitchen nor Admin UI exposes reversal. If trays are temporarily short, Kitchen completes the handover by supplying the missing trays rather than changing application history.

## 14. Kitchen lists

Tabs:

```text
Đã nhận (127) | Chưa nhận (93) | Tất cả (220)
```

During service, `Chưa nhận` means a valid registration that has not been served yet. After no-show reconciliation, add a separate `Vắng mặt` tab/count so absence is not confused with someone who simply has not arrived yet.

Rows must support:

- Search name/employee code.
- Owner.
- Receiver if proxy.
- Serving time.
- Source/audit detail on expansion.

Initial loading must not appear as `0 / 0` or empty.

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
- Account status.
- Penalties.
- Serving/delegation audit (read-only serving history; no reversal control).
- Jobs/health.

Bulk/destructive actions require confirmation and visible actor/date/scope.

Admin account disable shows active roles, future registrations and delegations. Admin must confirm one workflow that disables access and cancels/quarantines all future commitments with reason `ACCOUNT_DISABLED`; these rows remain in history but are excluded from Kitchen totals and penalties. Admin Web manages independent `staff`/`kitchen` roles and clearly states that Kitchen does not inherit Staff. It has no control for granting/revoking `admin`. Jobs/Health shows run status, attempts, sanitized errors and a confirmed manual retry action.

Staff Account includes read-only meal history and penalty list/detail; mutation controls for penalty resolution are never shown to Staff.

## 17. Accessibility

- Native accessible labels/roles for all controls.
- Touch target >=44×44.
- Screen reader announces QR status, weekly selected state and serving feedback.
- Do not rely on checkbox color alone; selected state includes check/icon/text.
- Dynamic serving result uses accessible live announcement.
- Reduced motion supported.
- Text scales without losing action controls.
- Camera/manual recovery does not require gestures inaccessible to keyboard/switch control where platform supports alternatives.

## 18. Error/recovery matrix

| Flow             | Error                          | Required recovery                                                        |
| ---------------- | ------------------------------ | ------------------------------------------------------------------------ |
| Entra login      | Cancel/network/tenant          | Retry / clear reason                                                     |
| Weekly load      | API fail                       | Preserve last safe view where possible + retry                           |
| Weekly save      | partial cutoff/conflict        | Per-day result + retain failed draft                                     |
| QR               | issue/refresh fail             | Expired state + retry                                                    |
| Delegation       | target/revoke conflict         | Server message + refresh authoritative state                             |
| Scanner          | camera denied                  | Manual employee-code recovery with reason/audit                          |
| Resolve          | QR expired/forged              | Ask user show current QR                                                 |
| Confirm          | DB/network fail                | Retry with idempotency key, never fake success                           |
| Confirm batch    | any selected item stale        | Commit none; show changed item and require re-resolve                    |
| Pickup session   | reaches 30s expiry             | Disable confirm; preserve names; re-scan/re-resolve                      |
| Service window   | before 10:30 or at/after 13:30 | Keep dashboard readable; disable serving with exact window               |
| Account disabled | any protected action           | Stop action, clear sensitive session state and show account-support path |
| Menu revision    | registered date changed        | Preserve registration; show revision notice from persisted inbox         |
| Realtime         | socket disconnect              | Re-fetch snapshot and reconnect                                          |
| Menu upload      | file/upload fail               | Retry without losing text fields                                         |

## 19. UX acceptance tests

- Staff can register five-day week one-handed on common phone sizes.
- Mixed locked/editable week is understood without explanation.
- QR refresh every 5s does not cause distracting layout jumps.
- Kitchen can process 20 consecutive self/proxy/duplicate scans without losing context.
- Kitchen can distinguish owner and receiver under time pressure.
- Staff can preselect a multi-item pickup intent without forcing Kitchen to tick those items again.
- Kitchen can process the scan → final-confirm flow with one confirm action and no item-edit control.
- Multi-item proxy pickup does not accidentally serve unselected registrations.
- Multi-item conflict commits zero servings and clearly requires re-resolve.
- Exact 14:00 cutoff, 10:30/13:30 serving boundaries and 30s pickup-session expiry are understandable and testable.
- Staff can find meal history and penalty details from Account without Admin controls.
- Admin disable preview and mandatory no-penalty future-commitment cleanup form one confirmed workflow.
- Network-outside-LAN state clearly explains why serving is disabled.
- Realtime dashboard updates across two Kitchen devices.
- Screen reader/large-text/reduced-motion paths remain functional.
