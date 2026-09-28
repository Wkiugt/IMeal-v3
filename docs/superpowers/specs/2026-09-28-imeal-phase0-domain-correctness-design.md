# IMeal Workstream A — Phase 0 Domain Correctness

**Date:** 2026-09-28  
**Status:** Draft — pending user review
**Scope:** Registration snapshots, meal-lifecycle projection, no-show/penalty concurrency and the contracts/migrations required to make those rules authoritative.

## 1. Mục tiêu, không thuộc phạm vi và release gate

### 1.1 Mục tiêu

Workstream A đóng ba lỗi P0 về tính đúng dữ liệu đã được ghi nhận trong `docs/imeal-production-readiness-assessment.md:65-86,103-119,193-200`:

1. Mọi registration mới hoặc được kích hoạt lại phải được server resolve menu revision và roster/location hiệu lực, sau đó lưu snapshot đủ để `pickup.service.ts` kiểm tra lại mà không suy diễn từ dữ liệu hiện tại.
2. Kitchen dashboard phải là một projection nhất quán của registration và `meal_servings`, không làm các dòng đã phục vụ biến mất vì filter `ACTIVE` tại `apps/api/src/kitchen/kitchen-dashboard.service.ts:31-83`.
3. No-show, penalty và serving phải có transaction/unique invariant chịu được worker retry, API retry và race giữa serving với no-show.

Mọi business write vẫn do API/worker và PostgreSQL làm authority; client không được tự quyết định trạng thái, location, menu revision hay penalty. Timezone nghiệp vụ là `Asia/Ho_Chi_Minh`; timestamp lưu dưới dạng UTC instant; meal date vẫn là `YYYY-MM-DD`, theo `docs/README.md:45-65`.

### 1.2 Không thuộc phạm vi

- Không triển khai SSE/realtime client, reconnect, dedup hoặc UI Kitchen; đây là workstream riêng. Spec này chỉ quy định event sau commit và backend event shape cần để workstream đó dùng.
- Không thay đổi OTP/session, network/TLS, backup, observability, retention vận hành, roster-import UI hoặc dữ liệu thật của bốn location.
- Không thêm delegation UX, history/penalty screen, menu-authoring UX hoặc các route mới không cần cho invariant.
- Không tạo dữ liệu vận hành mẫu. Tên, địa chỉ, tọa độ, employee code và assignment thật phải đến từ nguồn được phê duyệt ngoài source control.
- Không mở serving reversal/re-serve. `meal_servings` thành công vẫn là bằng chứng cuối cùng.

### 1.3 Release gate

Phase 0 chỉ được pass khi **tất cả** điều kiện sau được chứng minh trên staging với migration thật và dữ liệu đại diện:

- New registration, active update và cancelled reactivation đều lưu được location snapshot và menu revision hợp lệ; không còn active registration thiếu snapshot trong preflight report.
- Pickup options/resolve/confirm fail closed khi registration thiếu snapshot; không có fallback sang location/menu hiện tại để che dữ liệu cũ.
- Dashboard snapshot bao gồm đúng pending, served và no-show theo state model §2; một registration đã `SERVED` không biến mất khỏi tổng hoặc danh sách served.
- Concurrent serving/no-show/cancellation/delegation tests chứng minh chỉ một transaction thắng, không có serving kép, penalty kép hoặc penalty cho row đã served/cancelled/disabled.
- Penalty mới có unique key theo registration; retry cùng worker job và retry sau mất response không tạo row thứ hai, không reopen `PAID`/`WAIVED`.
- Migration preflight đã phân loại mọi row legacy null/ambiguous; không có backfill nào điền giá trị suy đoán. Nếu còn row operational thiếu dữ liệu, rollout dừng theo §8.
- Permanent tests trong §7 pass; không dùng mock wiring hoặc test source text để thay thế database/concurrency proof.

## 2. Canonical state model

### 2.1 Registration và meal serving

Prisma hiện có `RegistrationStatus` gồm `ACTIVE`, `CANCELLED`, `SERVED`, `NO_SHOW` tại `packages/domain/prisma/schema.prisma:10-15`, và `MealServing.registrationId` unique tại `:341-384`. Tuy nhiên, canonical backend model quy định logical `SERVED` được **suy ra từ `meal_servings`**, không phải một status registration bị ghi trùng (`docs/05-backend-structure.md:381-392`). Phase 0 vì vậy giữ enum `SERVED` để đọc legacy data/wire compatibility, nhưng không coi nó là nguồn sự thật và không ghi nó cho lifecycle mới.

- `ACTIVE`: persisted registration còn entitlement nếu chưa có serving; `ACTIVE + mealServing` là row đã served theo canonical projection, không phải state mismatch.
- `SERVED`: projection của một registration có đúng một `meal_servings` hợp lệ. Legacy database row có `status=SERVED` chỉ được chấp nhận khi serving tồn tại; API có thể serialize projection status `SERVED` từ serving.
- `NO_SHOW`: registration chưa có serving và worker đã commit no-show + penalty sau service end. Đây là trạng thái cuối, không re-activate.
- `CANCELLED`: registration bị owner cancel hoặc account-disable cleanup trước serving. Đây là trạng thái không còn entitlement và không được tính vào Kitchen preparation/dashboard/no-show.

`meal_servings` unique theo registration là serving authority. Serving transaction phải tạo serving, lifecycle audit và any projection update atomically; implementation phải ngừng tạo một status `SERVED` độc lập cho row mới. `SERVED + mealServing=null`, `NO_SHOW + mealServing`, hoặc `CANCELLED + mealServing` là invariant violation; dashboard/worker không tự sửa mà fail closed và audit/alert. `ACTIVE + mealServing` là canonical served projection và không được no-show hoặc registration update coi là eligible.

Transition hợp lệ:

```text
missing -> ACTIVE                         trước cutoff, menu/location hợp lệ
CANCELLED -> ACTIVE                       trước cutoff, bắt đầu lifecycle mới
ACTIVE -> CANCELLED                       trước cutoff, revoke delegation atomically
ACTIVE + mealServing                      Kitchen confirm transaction; projection SERVED
ACTIVE -> NO_SHOW + penalty               >= 13:30 VN, không có serving
```

Serving và `NO_SHOW` là final. `CANCELLED` không được phục hồi sau khi serving/no-show đã tồn tại; `CANCELLED` chỉ re-activate trước cutoff theo §3.3. A registration có serving hoặc no-show đang chờ commit không được coi là pickup eligible.

### 2.2 Delegation và account-disabled rows

`PENDING|ACCEPTED` là active delegation. Cancel registration phải lock registration trước, rồi lock/update các delegation active thành `REVOKED`, tạo audit và notification trong cùng transaction như flow tại `apps/api/src/registrations/registrations.service.ts:343-385`. Serving lock và revalidate registration/delegation; transaction thua race nhận conflict canonical, không silently substitute item.

Account disable dùng cùng transition `ACTIVE -> CANCELLED` nhưng `cancelReason=ACCOUNT_DISABLED`, revoke active delegation/session và giữ history. Các row này bị loại khỏi `totalRegistered`, `pending`, `served`, `noShow`, no-show candidates và penalty creation. Row đã served trước lúc disable vẫn giữ lịch sử `meal_servings`, không rewrite.

### 2.3 Dashboard projection và list membership

Dashboard cho meal date `D` phải load toàn bộ row có `status IN (ACTIVE, SERVED, NO_SHOW)`; tuyệt đối không dùng `status='ACTIVE'` làm tập chính như hiện tại (`apps/api/src/kitchen/kitchen-dashboard.service.ts:34-46`). Vì canonical `SERVED` là projection, tập này phải bao gồm cả `ACTIVE` rows có serving; `status=SERVED` chỉ là legacy compatibility. `CANCELLED` và account-disabled rows bị loại ngay từ query.

Projection canonical:

| Projection | Định nghĩa chính xác |
| --- | --- |
| `totalRegistered` | Số registration hợp lệ của `D`, gồm `ACTIVE` rows (pending hoặc đã có serving), legacy `SERVED` rows có serving và `NO_SHOW`; không gồm `CANCELLED`/disabled. |
| `servedTotal` | Số row trong tập trên có `mealServing != null`; đây là authority, không phụ thuộc registration status. Legacy `status=SERVED` hợp lệ chỉ khi count này cũng có serving. |
| `noShowTotal` | Số row `status=NO_SHOW` và không có serving. |
| `pending` list | `status=ACTIVE` và `mealServing=null`; đây là người còn có thể nhận, không gồm no-show. |
| `served` list | `mealServing != null`; hiển thị owner/choice/servedAt từ registration + serving snapshot. |
| `noShow` list | `status=NO_SHOW` và `mealServing=null`; hiển thị owner/choice, `servedAt=null`. |
| `all` list | Hợp của ba list trên, mỗi row chỉ xuất hiện một lần, thứ tự deterministic; không chứa cancelled/disabled. |
| `remaining` | `pending.length`. Trong serving window, bằng `totalRegistered-servedTotal`; sau no-show reconciliation không cộng người no-show vào “còn phải nhận”. |
| `regularTotal`/`vegetarianTotal` | Đếm trên toàn bộ `totalRegistered` projection; tổng hai số phải bằng `totalRegistered`. |

Nếu một row vi phạm state invariant, endpoint không được trả snapshot partial có thể bị hiểu là số liệu thật; trả canonical `INTERNAL_SERVER_ERROR` envelope kèm `requestId` (diagnostic chi tiết chỉ ở audit/metric), và yêu cầu operator xử lý. Không thêm một public error code mới cho lỗi dữ liệu nội bộ. Missing location/menu snapshot không làm một registration hợp lệ biến mất khỏi tổng dashboard, nhưng vẫn làm pickup fail closed theo §3.4.

`noShowTotal` có thể bằng 0 trước worker reconciliation; người `ACTIVE` lúc đó vẫn ở pending. **Worker scheduler bắt đầu lúc `13:45` VN; `13:30` chỉ là mốc domain eligibility sau khi serving window kết thúc.** Vì vậy normal cron không được process lúc 13:30, nhưng transaction predicate phải cho phép manual/recovery invocation sau 13:30 (với force policy hiện có) và normal cron lúc 13:45.

## 3. Registration write transaction

### 3.1 Server-authoritative resolution

Public API hiện giữ nguyên `PUT /api/registrations/batch` tại `apps/api/src/registrations/registrations.controller.ts:12-32`; batch trả kết quả theo từng ngày. `RegistrationsService.batchRegister` hiện tách transaction theo item và lock row hiện hữu tại `apps/api/src/registrations/registrations.service.ts:237-395`, nhưng create ở `:333-341` chưa ghi location snapshot. Implementation Phase 0 phải thay transaction bằng flow sau:

1. Capture một `serverNow` cho toàn batch; parse meal date và enforce cutoff strict `< 14:00` trước ngày ăn. Không dùng client time.
2. Trong từng item transaction, lock existing registration theo unique `(userId, mealDate)` nếu đã tồn tại. Nếu concurrent create đụng unique, retry đúng một lần rồi đọc row đã commit như logic hiện tại.
3. Resolve daily menu đã published/enabled và immutable current `DailyMenuRevision` cho đúng `mealDate`. Nếu thiếu menu/revision hoặc revision content không đầy đủ, transaction trả `REGISTRATION_FAILED`; không tạo registration và không chọn menu hiện tại gần nhất.
4. Resolve đúng một `EmployeeLocationAssignment` active mà effective range bao phủ meal date, cùng `Location` active/effective tương ứng. Ambiguous, missing hoặc inactive assignment là lỗi `REGISTRATION_FAILED`; không dùng email domain, GPS, QR hoặc location hiện tại của client.
5. Validate `mealChoice` theo lunar policy trước write (`REGULAR` ngày thường; `REGULAR|VEGETARIAN` ngày 1/15 âm lịch kể cả leap month).
6. Build snapshot object từ kết quả server resolution. Các giá trị snapshot được ghi cùng row; không gọi `resolveEffectiveLocation` rồi bỏ kết quả như tình trạng cũ.
7. Commit registration, cancellation/delegation changes, audit và notifications atomically. Chỉ sau commit mới phát event/realtime.

Registration không được coi là thành công nếu write snapshot thất bại. Một batch có thể partial success theo contract hiện tại: item lỗi không rollback ngày khác, nhưng mỗi item transaction là all-or-nothing.

### 3.2 Snapshot inventory: đã có và phải migrate

**Đã có trong Prisma/migration nhưng hiện nullable hoặc chưa được populate:**

- `Registration.serviceLocationId`, `serviceLocationAssignmentId`, `serviceLocationCode`, `serviceLocationName`, `serviceLocationAddress`, `serviceLocationEffectiveFrom`, `serviceLocationSnapshotAt` tại `packages/domain/prisma/schema.prisma:271-299`; các cột được thêm ở `packages/domain/prisma/migrations/20260924000000_email_otp_presenter_gps/migration.sql:311-318`.
- `MealServing.ownerEmailSnapshot`, `ownerNameSnapshot`, `locationShortCode`, `locationNameSnapshot`, `locationAddressSnapshot`, `mealDate`, `menuRevisionId` tại `schema.prisma:341-384`; migration thêm chúng ở `migration.sql:345-377`.
- `ServingConfirmRequest(callerUserId,idempotencyKey,requestBodyHash,resultSnapshot)` và unique `(callerUserId,idempotencyKey)` tại `schema.prisma:316-338`; đây là request-level idempotency hiện tại, không thay bằng item-level key.

**Bắt buộc thêm bằng migration mới:**

- `Registration.menuRevisionId` FK restrictive tới immutable `DailyMenuRevision`.
- `Registration.ownerNameSnapshot`, `Registration.employeeCodeSnapshot`, `menuNameSnapshot`, `menuDescriptionSnapshot`, `menuImageSnapshot`, `registeredAt`, `cancelledAt`, `cancelReason`, `cancelledByUserId`, `noShowAt`. Các cột có thể nullable đối với legacy rows trong expand phase, nhưng mọi lifecycle mới phải non-null đúng theo state.
- `DailyMenuRevision.revision`, `mealName`, `description`, `imageUrl`, `createdByUserId` và unique `(dailyMenuId, revision)`. `content` legacy không được coi là menu snapshot canonical nếu không parse/verify được.
- `MealDay` menu snapshot/lock fields cần cho historical serving (`menuNameSnapshot`, `menuDescriptionSnapshot`, `menuImageSnapshot`, `lockedAt`, `serviceStartAt`, `serviceEndAt`). `MealDay.mealType`/`isServingReady` hiện ở `schema.prisma:258-269` không đủ để render immutable menu history.
- `MealServing.menuNameSnapshot`, `menuDescriptionSnapshot`, `menuImageSnapshot`; serving write phải copy từ registration/menu revision, không đọc lại menu mới nhất để thay thế lịch sử.
- `Penalty.registrationId` (FK, unique), `Penalty.mealDate`; giữ `PenaltyStatus` hiện tại `PENDING|PAID|WAIVED` để không phá admin contract. Schema hiện chỉ có `(userId, amount, reason, status)` tại `schema.prisma:398-416`, nên `findFirst(userId,reason)` không đủ chống race.

Snapshot name/address/code là historical facts của registration lifecycle. Với `ACTIVE -> ACTIVE` chỉ đổi `mealChoice` thì không rewrite location/owner snapshot. Với `CANCELLED -> ACTIVE`, đây là lifecycle mới: resolve snapshot mới và ghi audit before/after; snapshot serving/no-show final không bao giờ bị rewrite. Menu-publish transaction phải cập nhật revision của active registrations theo rule `docs/05-backend-structure.md:310-326`; registration write không tự đổi revision do đọc một menu khác.

### 3.3 Create, update, reactivate và cancel

- **Create:** chỉ `ACTIVE` item có menu revision và location assignment hợp lệ mới tạo row. Ghi `version=1`, `registeredAt=serverNow`, mọi snapshot trên cùng insert.
- **Active cùng choice:** nếu snapshot đã complete thì không write thừa. Nếu legacy snapshot thiếu, transaction phải resolve exact assignment/menu và fill được từ nguồn canonical; nếu không, trả failure, không coi là no-op.
- **Active đổi choice:** giữ location/owner/menu snapshot hiện hành, tăng `version`; không chuyển location theo assignment mới giữa chừng. Nếu menu service đã tạo revision mới cho active registration, revision update phải là transaction riêng có audit/notification.
- **Cancelled reactivation:** chỉ trước cutoff, không có serving/penalty/no-show. Lock row, resolve current effective assignment/menu, clear cancellation fields, set `ACTIVE`, tăng version và audit lifecycle mới. Không được reactivate row đã có serving (kể cả legacy `status=SERVED`) hoặc `NO_SHOW`.
- **Cancel:** `ACTIVE -> CANCELLED` chỉ trước cutoff, set reason/actor/time, revoke `PENDING|ACCEPTED` delegations, audit và notify delegate atomically. Missing row hoặc already cancelled là idempotent success; final row trả `REGISTRATION_FINALIZED`.
- **Account disabled:** dùng cùng transaction với `cancelReason=ACCOUNT_DISABLED`, nhưng actor là admin workflow; không để worker chọn row này sau đó.

### 3.4 Pickup read invariants

`apps/api/src/pickup/pickup.service.ts:287-360` tiếp tục trả own + accepted delegation options, nhưng một option chỉ eligible khi `ACTIVE`, chưa có `mealServing`, đúng meal date và registration có đầy đủ `serviceLocationId`, `serviceLocationCode`, `serviceLocationName`, `serviceLocationAddress`, `serviceLocationEffectiveFrom`, `serviceLocationSnapshotAt`, `menuRevisionId` và menu snapshot bắt buộc. `apps/api/src/pickup/pickup.service.ts:381-469` phải coi thiếu bất kỳ trường nào là `PICKUP_INTENT_CONFLICT`, không resolve bằng location/address hiện tại.

Mọi selected registration trong một intent phải cùng effective `serviceLocationId`; location policy hiện hành chỉ dùng để kiểm tra serving-time GPS. Historical snapshot copy vào `MealServing` luôn lấy từ registration (`apps/api/src/pickup/pickup.service.ts:1473-1503`), không dùng các fallback `?? location.shortCode/displayName/address` hiện tại. Confirm vẫn giữ exact pickup session, 30-second TTL, serving window 10:30–13:30, all-or-nothing và request idempotency như `ConfirmPickupSchema` (`packages/contracts/src/v1/pickup.ts:145-152`).

## 4. No-show/penalty transaction và concurrency

### 4.1 Transaction boundary

`apps/worker/src/no-show-worker.service.ts:88-201` hiện fetch candidates rồi update nhiều row trong một transaction, recheck bằng `findUnique` nhưng không lock registration và tìm penalty theo `userId+reason`. Thay bằng một transaction độc lập cho từng registration candidate, theo `id ASC`; batch worker có thể tiếp tục candidate kế tiếp sau khi transaction trước rollback.

Trong một no-show transaction:

1. `SELECT registration ... FOR UPDATE` theo registration ID.
2. Đọc `mealServing` dưới cùng lock. Nếu status không còn `ACTIVE`, có serving, cancelled/disabled hoặc server time `< 13:30` thì commit no-op và không tạo penalty.
3. Lock penalty theo unique `registrationId` nếu đã có. Nếu chưa có, insert `userId=registration.userId`, `registrationId`, `mealDate`, `amount=50000`, `reason='NO_SHOW'`, `status=PENDING`.
4. Update registration `status=NO_SHOW`, `noShowAt=serverNow`.
5. Insert immutable audit (`NO_SHOW_PROCESSED`) và persisted notification `NO_SHOW_PENALTY_CREATED`; dedupe notification bằng key hiện có `no-show-penalty:{userId}:{registrationId}`. Event/outbox write cũng nằm trong transaction.
6. Commit tất cả hoặc rollback tất cả. Nếu audit, notification, outbox hoặc penalty write lỗi, registration vẫn `ACTIVE` và lần retry sau xử lý lại.

Một penalty hiện hữu với cùng `registrationId` không được tạo lại. Nếu row hiện hữu không khớp owner/meal date/amount/reason, transaction fail closed và tạo operational alert; không tự sửa hoặc chuyển penalty sang registration khác. `PAID`/`WAIVED` được giữ nguyên; retry chỉ hoàn tất trạng thái registration/audit còn thiếu nếu invariant đã được xác minh, không reopen penalty.

### 4.2 Unique và retry strategy

- DB unique `Penalty.registrationId` là authority; không dùng chuỗi reason làm idempotency key.
- Existing legacy penalties không có registration ID chỉ được backfill khi mapping một-một có bằng chứng; duplicate/ambiguous mapping dừng migration, không merge hoặc xóa tự động.
- Worker retry sau commit nhưng trước khi nhận response sẽ lock row, thấy `NO_SHOW` hoặc penalty đã tồn tại và no-op. Hai worker chạy cùng lúc serialize trên registration lock.
- `JobRun`/cron không được dùng làm business uniqueness duy nhất. Có thể thêm unique `jobName` cho operational reporting, nhưng correctness vẫn dựa trên registration lock + penalty unique + notification dedupe.
- API confirm tiếp tục dùng `(callerUserId,idempotencyKey)` và request hash ở `ServingConfirmRequest`; same key/body trả result cũ, key/body khác trả `IDEMPOTENCY_CONFLICT`, `PROCESSING` chưa hết lease trả `REQUEST_IN_PROGRESS` theo `docs/02-technical-requirements.md:216-224`.
- Không tạo endpoint mới để client tự tạo no-show/penalty. `apps/api/src/admin/penalties/penalties.service.ts:133-281` chỉ resolve `PENDING -> PAID|WAIVED`; các mutation này lock penalty row, audit actor/time/reason và không được đổi registration/no-show state.

### 4.3 Serving/no-show/cancel race và lock order

Lock order canonical:

```text
Serving: serving_confirm_request -> pickup_session -> registrations(sorted id)
         -> delegations(sorted id) -> participant accounts(sorted id) -> servings
No-show: registrations(sorted id, one transaction) -> penalty(registration_id)
Cancel:  registration -> delegations(sorted id) -> audit/notification
```

No-show không lock pickup session trước registration, nên không tạo cycle với serving. Serving lấy registration lock trước delegation lock như flow hiện tại tại `apps/api/src/pickup/pickup.service.ts:1180-1225`; no-show thắng thì confirm thấy `NO_SHOW` và reject whole batch; serving thắng thì no-show thấy `ACTIVE + mealServing` và không tạo penalty. Cancel thắng thì cả hai skip/reject; serving thắng thì cancel trả finalized conflict. Mọi multi-item serving vẫn zero-or-all: một stale row rollback toàn bộ serving rows, delegation transitions và result claim.

## 5. API và shared contract impact

Không thêm route mới và không cho client gửi snapshot/location/menu authority.

### 5.1 Giữ nguyên

- `PUT /api/registrations/batch` với `BatchRegistrationItemSchema` (`ACTIVE|CANCELLED`, `mealDate`, `mealChoice`) tại `packages/contracts/src/v1/registrations.ts:30-57`. Server chỉ bổ sung resolution nội bộ; không nhận `locationId`, `menuRevisionId`, status `SERVED` hoặc `NO_SHOW` từ client.
- `POST /internal/api/v1/pickup/resolve` và `POST /internal/api/v1/pickup/confirm` cùng các aliases controller tại `apps/api/src/pickup/internal-pickup.controller.ts:11-33`; `ResolvePickupSchema` chỉ nhận QR, `ConfirmPickupSchema` chỉ nhận `pickupSessionId` + `idempotencyKey`.
- `GET /v1/kitchen/days/:date/dashboard` và alias `/api/kitchen/days/:date/dashboard` tại `apps/api/src/kitchen/kitchen-dashboard.controller.ts:18-35`; envelope success/error, `X-Request-Id` và stable error codes không đổi.
- Server-authoritative response envelope `{ data, meta?: { requestId, pagination? } }` và error `{ error: { code, message, details? }, requestId }` phải được giữ theo `docs/02-technical-requirements.md:216-224`. Không trả snapshot lấy từ request body.

### 5.2 Contract changes required by the projection

- `KitchenRegistrationItemSchema` tại `packages/contracts/src/v1/kitchen.ts:40-50` thêm bắt buộc `state: z.enum(['PENDING','SERVED','NO_SHOW'])`. Giữ `isServed` trong Phase 0 để client hiện tại không hiểu nhầm; server phải đảm bảo `isServed === (state === 'SERVED')`. `served`, `pending`, `noShow`, `all` dùng cùng type và semantics §2.3.
- `KitchenDashboardCountersSchema` giữ nguyên các field hiện có tại `kitchen.ts:4-26`; không thêm counter suy diễn. `noShowTotal` và `remaining` đổi semantics theo §2.3.
- `WeekDailyMenuSchema` tại `packages/contracts/src/v1/registrations.ts:154-176` thêm `menuRevisionId`, `mealName`, `description`, `imageUrl` nullable cho legacy response; row mới published phải trả revision/name thật. `RegistrationRecordSchema` thêm `menuRevisionId` nullable để client reconcile revision, nhưng không nhận revision từ client.
- `PenaltyItemDtoSchema` tại `packages/contracts/src/v1/penalties.ts:6-22` thêm `registrationId` và `mealDate` nullable cho legacy rows; penalty no-show mới luôn trả hai field. Không đổi `PenaltyStatusSchema`; không thêm route create.
- `packages/contracts/src/v1/pickup.ts:20-164` không thêm location/menu input. Pickup response có thể giữ option hiện tại; missing snapshot là server error, không phải nullable fallback success.

Contract test phải parse strict cả new state/snapshot fields và tiếp tục chứng minh exact sorted intent, idempotency key, envelope và no client-selected location.

## 6. Realtime event implications sau commit

Workstream A không triển khai client, nhưng state transitions phải phát đúng thời điểm:

- Serving đã có pattern đúng: `confirmPickup` emit `SERVING_CONFIRMED` sau `$transaction` tại `apps/api/src/pickup/pickup.service.ts:1634-1643`; giữ nguyên, payload counters/list phải được tính từ projection mới.
- No-show worker tạo `OutboxEvent` trong cùng transaction với `NO_SHOW`/penalty, dùng dedupe key `kitchen:no-show:{registrationId}`. Worker process không gọi in-memory `KitchenEventsService` trực tiếp; publisher/API bridge chỉ emit `NO_SHOW_RECONCILED` sau outbox commit.
- Registration cancel/reactivate ảnh hưởng dashboard thì emit `REGISTRATION_CHANGED` sau commit hoặc để consumer refetch snapshot từ event. Event payload chỉ gồm `eventId,eventType,mealDate,occurredAt,requestId,payload` theo `apps/api/src/kitchen/kitchen-events.service.ts:6-24`; không đưa QR, session, OTP hoặc raw GPS.
- `eventId` phải stable/deduplicable theo aggregate transition; duplicate delivery không được tạo domain write. Client workstream sẽ dedup và refetch snapshot sau reconnect; Phase 0 chỉ yêu cầu backend không emit event trước commit.

## 7. Permanent test matrix

| Boundary/transition | Permanent test và expected proof |
| --- | --- |
| Cutoff | `apps/api/src/registrations/registrations.service.spec.ts` giữ test `14:00:00` fail (`:60-81`) và thêm `13:59:59` success; server time, không client time. |
| Registration snapshot create | Extend existing create test (`registrations.service.spec.ts:235-259`) để assert assignment/location/menu/owner snapshots trong `create.data`; thiếu assignment/menu là failure, không create. |
| Active update | Existing same-choice no-op (`:286-307`) không rewrite immutable snapshots; changed choice increments version and preserves snapshots (`:308-332`). |
| Reactivation | Existing cancelled row (`:333-361`) gets new effective assignment/menu snapshot and cancellation lifecycle audit; `SERVED`/`NO_SHOW` remain finalized. |
| Cancellation/delegation | Existing transactional test (`:363-402`) proves cancel, delegation revoke, audit and notification are all-or-nothing; add account-disabled exclusion. |
| Concurrent registration | Domain concurrency test (`packages/domain/test/concurrency.test.ts:16-52`) proves one `(user,date)` row and complete snapshots under concurrent create/reactivation. |
| Menu/roster staleness | New integration test changes assignment/menu after registration; pickup and serving retain old immutable snapshot, while a new reactivation resolves the new effective values. |
| Pickup stale snapshot | `apps/api/src/pickup/pickup.service.spec.ts` proves options/resolve/confirm reject each required null snapshot with `PICKUP_INTENT_CONFLICT`; no current-location fallback. |
| Serving projection | Extend `apps/api/src/kitchen/kitchen-dashboard.service.spec.ts:42-137` with ACTIVE pending, ACTIVE+mealServing, legacy SERVED+mealServing, NO_SHOW and CANCELLED rows; assert totals, `served`, `pending`, `noShow`, `all`, state field and no served disappearance. |
| Dashboard invariant | Test `SERVED+mealServing=null`, `NO_SHOW+mealServing` và `CANCELLED+mealServing` trả canonical `INTERNAL_SERVER_ERROR` envelope và không trả partial counters. |
| Dashboard account disable | Disabled/cancelled rows never affect `totalRegistered`, choice totals, remaining, served or no-show lists. |
| No-show boundary | `apps/worker/src/no-show-worker.service.spec.ts` proves before `13:30` no transition, at `13:30` eligible, cron gate at `13:45` remains enforced (`:69-113`). |
| No-show retry | First transaction commits `NO_SHOW+penalty`; repeated worker run creates no second penalty/notification/audit and preserves `PAID`/`WAIVED`. |
| Concurrent workers | Two `processNoShows` calls for same registration produce one status transition and one penalty under real PostgreSQL row lock + unique registration ID. |
| Serving/no-show race | Real domain test races `confirmPickup` and no-show: exactly one wins; winner state is canonical and loser creates no side effect. |
| No-show rollback | Inject penalty/audit/outbox failure; assert registration remains ACTIVE and no partial penalty/notification is committed. |
| Penalty unique | Domain persistence test inserts two penalties for one registration and expects DB unique violation; legacy unmapped penalties do not get silently merged. |
| Serving retry/race | Existing domain matrix (`packages/domain/test/concurrency.test.ts:92-402`) remains green for two scanners, owner/delegate, revoke/serve, same idempotency key, stale multi-item and all-or-nothing rollback. |
| Contract boundaries | `packages/contracts` tests parse exact dashboard `state`, nullable legacy metadata, unchanged pickup exact intent and unchanged registration input; reject client location/menu authority. |
| Realtime timing | Existing post-commit proof in `apps/api/src/pickup/pickup.service.spec.ts` (`:678-707,778-815`) extends to no-show outbox/event: no event is observed when transaction rolls back. |

## 8. Rollout, migration và legacy data policy

### 8.1 Expand/preflight

1. Deploy additive nullable columns, FKs/indexes and contract parser support first. Do not make old rows fail at migration parse time.
2. Run a read-only preflight report over registrations, revisions and penalties: counts by status, missing each required snapshot, ambiguous roster assignment, missing/invalid menu revision, duplicate candidate penalties, and existing serving/status mismatches. Store report/audit output outside the application data model; do not create synthetic operational rows.
3. Backfill only when the source is exact and one-to-one: location fields may be copied from an assignment whose effective date and location ID are unambiguous; menu fields may be copied only from a verified immutable revision. Never use current assignment/location/menu to represent an unknown historical fact. Do not set `snapshotAt`, `registeredAt` or revision numbers merely because migration time is available.
4. Existing `DailyMenuRevision.content` is legacy. Parse it only when its format is documented and validates all required fields; otherwise leave new columns null and report the row. Do not create a revision from a current `DailyMenu` without historical evidence.
5. Existing `Penalty` rows without `registrationId` are retained. Populate the FK only from an exact audit/reason mapping; duplicate or ambiguous mapping blocks the unique-index step and requires operator resolution. No delete/merge/reopen is automatic.

### 8.2 Enforcement and fail-closed behavior

After preflight is clean for operational rows, validate partial checks/FKs ensuring every new non-cancelled registration has all required snapshots and a valid menu revision. Legacy cancelled/history rows may remain nullable when they have no future operational effect; they remain visibly legacy in the migration report.

For any legacy null/ambiguous snapshot that remains:

- registration update/reactivation fails with `REGISTRATION_FAILED`; it does not infer data;
- pickup options omit it and QR resolve/confirm return `PICKUP_INTENT_CONFLICT`; no manual location/menu substitution exists;
- serving cannot create a `MealServing` for it;
- dashboard may count it as a real ACTIVE/SERVED/NO_SHOW lifecycle row when state/serving invariants are valid, so totals are not silently understated; the operator report still marks it incomplete;
- no-show may process it because penalty ownership comes from registration/user and does not require inventing a location snapshot, but it must not make the row pickup-eligible;
- state mismatches fail closed as §2.3, rather than silently repairing history.

The pilot release gate requires zero incomplete **future ACTIVE** rows after approved remediation. If a legacy row cannot be proven, it remains quarantined from pickup and the gate is NO-GO; an operator may explicitly cancel it with audited reason rather than inventing a snapshot. No Firebase migration, dual-write or fabricated location/employee/menu data is allowed.

## 9. File-by-file change map

| File/path | Planned implementation responsibility |
| --- | --- |
| `packages/domain/prisma/schema.prisma` | Add lifecycle/menu/owner snapshot fields, menu revision structure, penalty registration uniqueness and any required historical FKs/checks while retaining current enum names. |
| `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/migration.sql` | Expand, preflight-compatible backfill, exact indexes/unique constraints/FKs/checks; no operational seed rows. |
| `apps/api/src/registrations/registrations.service.ts` | Server resolve menu + assignment/location, populate immutable snapshots, lifecycle-specific update/reactivation/cancel and deterministic lock/retry behavior. |
| `apps/api/src/registrations/registrations.service.spec.ts` | Unit coverage for cutoff, snapshot writes, no-op/update/reactivation/cancel and failure precedence. |
| `apps/api/src/pickup/pickup.service.ts` | Enforce complete snapshot read invariants; remove historical fallback values; copy registration/menu snapshots into serving and preserve existing exact-intent/idempotency transaction. |
| `apps/api/src/pickup/pickup.service.spec.ts` | Null/stale snapshot, location/menu mismatch, serving race and post-commit event coverage. |
| `apps/api/src/pickup/internal-pickup.controller.ts` | Keep exact existing routes and schemas; only map new stable domain errors to the canonical envelope. |
| `apps/api/src/kitchen/kitchen-dashboard.service.ts` | Replace ACTIVE-only query with canonical projection, validate state invariant, deterministic lists/counters and cancellation/disabled exclusion. |
| `apps/api/src/kitchen/kitchen-dashboard.service.spec.ts` | Projection boundaries, served persistence, no-show transition, mismatch fail-closed and event payload tests. |
| `apps/api/src/kitchen/kitchen-events.service.ts` | Add backend event types needed for committed no-show/registration changes; preserve event envelope and dedup behavior. |
| `apps/worker/src/no-show-worker.service.ts` | Per-registration locked transaction, registrationId penalty uniqueness, rollback/idempotent retry and committed outbox/event write. |
| `apps/worker/src/no-show-worker.service.spec.ts` | Time boundary, retry, penalty state preservation and failure rollback tests; retain worker date/force guard coverage. |
| `apps/api/src/admin/penalties/penalties.service.ts` | Keep paid/waived transitions row-locked and audited; expose new relation fields if DTO mapping needs them; never create no-show penalties from admin mutation. |
| `packages/contracts/src/v1/registrations.ts` | Add only server-returned menu revision/content fields and nullable legacy representation; keep batch input authoritative boundary unchanged. |
| `packages/contracts/src/v1/kitchen.ts` | Add `state` to dashboard list items and preserve counter/envelope semantics. |
| `packages/contracts/src/v1/pickup.ts` | No client snapshot/location fields; preserve exact sorted intent and idempotency schema. |
| `packages/contracts/src/v1/penalties.ts` | Add nullable legacy-aware `registrationId`/`mealDate` response fields; no create contract. |
| `packages/domain/test/concurrency.test.ts` | Add real PostgreSQL registration/no-show/serving races and unique penalty proof. |
| `packages/domain/test/emailOtpLocationServing.test.ts` | Extend persistence assertions for complete registration/serving snapshots and new unique constraints without inserting real operational data. |
| `apps/api/test/registrations.e2e-spec.ts`, `apps/api/test/pickup.e2e-spec.ts`, `apps/api/test/kitchen-dashboard.e2e-spec.ts` | Preserve route/envelope/controller tests and add consumer-visible snapshot/projection/error assertions; do not add a route alias. |

## 10. Acceptance criteria

1. A successful new or reactivated registration has server-resolved `menuRevisionId`, owner snapshot, location ID/assignment/code/name/address/effective timestamp and snapshot timestamp; client input cannot override any of them.
2. Active meal-choice update preserves immutable registration snapshots; cancelled reactivation creates a new audited lifecycle snapshot; served/no-show history is never rewritten.
3. Registration cancel revokes pending/accepted delegation atomically; account-disabled cancellations are excluded from dashboard/no-show/penalty.
4. Pickup option, resolve and confirm reject any incomplete or inconsistent snapshot with a stable conflict and never substitute current location/menu data.
5. Confirmed serving stores owner, receiver/presenter, Kitchen actor, location, menu revision/snapshots, delegation/session/request/verification context and creates the serving projection atomically; new lifecycle writes do not duplicate `SERVED` into registration status.
6. Dashboard `totalRegistered`, `servedTotal`, `remaining`, `noShowTotal`, choice totals and all four lists satisfy §2.3 for every combination of ACTIVE, SERVED, NO_SHOW and CANCELLED rows; served rows do not disappear.
7. State/serving mismatches fail closed instead of being silently counted or repaired.
8. No-show transaction eligibility is `server time >= 13:30` VN, while the normal worker scheduler first processes at `13:45` VN; the transaction commits registration no-show state, one `50,000` VND penalty, audit, notification and outbox atomically per registration.
9. Concurrent worker retries, serving, cancellation and delegation races have one deterministic winner; no duplicate serving, penalty, notification or reopening of `PAID`/`WAIVED`.
10. Existing serving idempotency convention `(callerUserId,idempotencyKey,requestBodyHash)` and server-authoritative envelopes/routes remain intact.
11. Realtime events are emitted only after commit; rollback leaves no dashboard event that represents uncommitted state.
12. Migration/backfill reports every legacy gap, never fabricates snapshots, and Phase 0 cannot pass with an unresolved future ACTIVE row that would be pickup-ineligible.
