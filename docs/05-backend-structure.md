# IMeal v2 — Backend Structure

## 1. Backend overview

IMeal v2 dùng backend server-authoritative:

- Allowlist-A email OTP is the sole production authentication method.
- NestJS consumes/atomically verifies OTP challenges and resolves opaque
  PostgreSQL-backed sessions before enforcing business rules.
- PostgreSQL is the source of truth for identity, allowlist, account status,
  authorization, roster/location, registration and serving data.
- Mobile/Admin Web never write the database directly; Staff check-in mutations
  go through the authenticated own-user API path, while Kitchen only obtains a
  shared QR and aggregate dashboard snapshot.
- Kitchen dashboard freshness uses focused/foreground HTTPS polling; there is
  no SSE/WebSocket dependency.

```mermaid
flowchart TB
    MOB[Mobile]
    ADM[Admin Web]
    RP[Reverse Proxy]
    API[NestJS API]
    PG[(PostgreSQL)]
    SMTP[smtp.gmail.com:587]
    JOB[Worker/Cron]
    PUSH[Notification Provider]

    MOB -->|HTTPS + opaque session| RP
    ADM -->|HTTPS + opaque session| RP
    RP --> API
    API --> PG
    JOB -->|claim encrypted OTP outbox| PG
    JOB -->|SMTP STARTTLS| SMTP
    API --> PUSH
```

| Table                           | Purpose/source of truth                                                   |
| ------------------------------- | ------------------------------------------------------------------------- |
| `users`                         | Canonical employee identity, status and profile                           |
| `otp_allowlist`                 | Administrator-managed allowlist-A email eligibility                       |
| `otp_challenges`                | Hashed verifier, expiry, attempts and atomic-use state                    |
| `otp_delivery_outbox`           | Encrypted provider payload, claim/retry state and redacted delivery audit |
| `auth_sessions`                 | One-way opaque session hash, expiry/revocation and minimized metadata     |
| `roles`                         | Canonical roles                                                           |
| `user_roles`                    | User-role assignments + audit                                             |
| `permissions`                   | Canonical sensitive capability codes                                      |
| `role_permissions`              | Default permission grants by role                                         |
| `user_permissions`              | Exceptional direct grants/revocations + audit                             |
| `locations`                     | Exactly four organization-approved operational location records           |
| `location_policies`             | Effective geofence/freshness/accuracy policy per location                 |
| `employee_location_assignments` | Effective roster assignment and immutable employee/location snapshots     |
| `roster_import_batches`         | Preview/commit result and idempotent import audit                         |
| `weekly_menus`                  | Weekly menu lifecycle                                                     |
| `daily_menus`                   | One fixed meal per date                                                   |
| `daily_menu_revisions`          | Immutable menu content revisions for history/notification                 |
| `meal_days`                     | Locked/snapshot operational day data                                      |
| `registrations`                 | One reserved meal per user/date plus location/name/address snapshot       |
| `pickup_delegations`            | Historical A→B data retained for audit/compatibility only                |
| `pickup_sessions`               | Historical pickup context retained; not current authorization             |
| `serving_verifications`         | Current minimized GPS validation + resolved intent evidence; legacy-safe context retained, no raw coordinate history |
| `check_in_sessions`             | Stable day/location QR session + Staff resolve/confirm context             |
| `serving_confirm_requests`      | Caller/key idempotency claim and result for one confirm                   |
| `meal_servings`                 | Immutable final serving; unique canonical `registrationId` outcome        |
| `meal_events`                   | Immutable meal lifecycle audit ledger                                     |
| `penalties`                     | No-show financial state                                                   |
| `notifications`                 | Persisted notification inbox                                              |
| `push_devices`                  | Device push token metadata if push enabled                                |
| `job_runs`                      | Job execution history                                                     |
| `outbox_events`                 | Transactional notification-created delivery work                          |
| `notification_deliveries`       | Per-notification/per-device delivery state and retry metadata             |
| `audit_logs`                    | Generic sensitive admin/audit actions                                     |

## 3. Entity relationships

```mermaid
erDiagram
    USER ||--o{ OTP_ALLOWLIST : eligible_email
    USER ||--o{ OTP_CHALLENGE : requests
    USER ||--o{ AUTH_SESSION : owns
    USER ||--o{ USER_ROLE : has
    ROLE ||--o{ USER_ROLE : grants
    ROLE ||--o{ ROLE_PERMISSION : grants
    PERMISSION ||--o{ ROLE_PERMISSION : includes
    USER ||--o{ USER_PERMISSION : overrides
    PERMISSION ||--o{ USER_PERMISSION : controls
    LOCATION ||--o{ LOCATION_POLICY : governs
    USER ||--o{ EMPLOYEE_LOCATION_ASSIGNMENT : assigned
    LOCATION ||--o{ EMPLOYEE_LOCATION_ASSIGNMENT : serves
    WEEKLY_MENU ||--o{ DAILY_MENU : contains
    DAILY_MENU ||--o{ DAILY_MENU_REVISION : revisions
    USER ||--o{ REGISTRATION : owns
    DAILY_MENU_REVISION ||--o{ REGISTRATION : menu_history
    LOCATION ||--o{ REGISTRATION : effective_snapshot
    REGISTRATION ||--o{ PICKUP_DELEGATION : historical
    CHECK_IN_SESSION ||--o{ SERVING_CONFIRM_REQUEST : confirms
    CHECK_IN_SESSION ||--o{ MEAL_SERVING : context
    SERVING_CONFIRM_REQUEST ||--o| MEAL_SERVING : creates
    REGISTRATION ||--o| MEAL_SERVING : served_by
    USER ||--o{ MEAL_SERVING : staff_actor
    LOCATION ||--o{ MEAL_SERVING : served_at
    REGISTRATION ||--o{ MEAL_EVENT : audits
    REGISTRATION ||--o| PENALTY : causes
    USER ||--o{ NOTIFICATION : receives
```

## 4. `users`, allowlist and opaque sessions

```text
users
──────────────────────────────
id                  UUID PK
email               text NOT NULL, normalized
display_name        text NULL
employee_code       text NULL
status              active | disabled
created_at          timestamptz
updated_at          timestamptz
last_login_at       timestamptz NULL

UNIQUE(email)
UNIQUE(employee_code) WHERE employee_code IS NOT NULL
```

Production identity starts only when an administrator has imported an active
allowlist-A row for the normalized email. Email domain, profile text, employee
code supplied by a client, role claims and GPS never authorize a user.
Unknown/disabled/non-allowlisted request attempts remain indistinguishable.

```text
otp_allowlist
  id, normalized_email, user_id NULL, purpose=SESSION_LOGIN
  is_active, effective_from, effective_to, reason, audit_actor_id, timestamps

otp_challenges
  id, allowlist_id, verifier_hash, expires_at, attempt_count, max_attempts
  consumed_at NULL, client_hash NULL, created_at

auth_sessions
  id, user_id, token_hash UNIQUE, purpose=SESSION_LOGIN
  created_at, last_used_at, idle_expires_at, absolute_expires_at
  revoked_at NULL, revocation_reason NULL, device_hash/client_ip_hash/user_agent_hash
  created_by_audit_id
```

Only the clear OTP and opaque session token cross the HTTPS boundary. The
database stores the OTP verifier and session hash, never either secret. Every
protected request resolves current account status and permissions; logout,
disable, compromise, replay, explicit revocation and expiry invalidate sessions.

The only bypass is the non-production harness pair `NODE_ENV=test` and
`REQUIRE_AUTH=false`. It injects a synthetic principal for automated tests and
is rejected in production; it is not documented or supported as production auth.

## 5. Roles

```text
roles
────────────
id
code UNIQUE     staff | kitchen | admin
```

Sensitive permissions are canonical codes assigned through audited role/permission mapping, including `penalty.read` and `penalty.resolve`. API authorization always evaluates permissions; it never special-cases Admin as a superuser. Canonical `admin` role is seeded with penalty/audit/job permissions, but not Kitchen pickup resolve/confirm.

```text
permissions
────────────────────────────
id
code UNIQUE     penalty.read | penalty.resolve | ...

role_permissions
────────────────────────────
role_id FK
permission_id FK
granted_at
UNIQUE(role_id, permission_id)

user_permissions
────────────────────────────
user_id FK
permission_id FK
effect          grant | revoke
assigned_by_user_id FK
assigned_at
revoked_at NULL
UNIQUE(user_id, permission_id) for active override
```

```text
user_roles
────────────────────────────
user_id FK
role_id FK
assigned_by_user_id FK NULL
assigned_at
revoked_at NULL

UNIQUE(user_id, role_id) for active assignment
```

Allowlist import and roster commit never auto-grant roles. Admin Web may manage
`staff`/`kitchen` assignments with audit, but **cannot grant or revoke `admin`**.
Admin-role lifecycle is a separately audited server-side operation.

`staff` and `kitchen` are independent. Assigning `kitchen` never grants Staff
registration or self check-in capabilities; a Kitchen employee who also eats
must hold both roles. Delegation/pickup permissions are historical only.

### 5.1 Account disable transaction

1. Preview the authoritative actionable set from the current business date
   onward: `ACTIVE`, unserved registrations with no existing penalties, and
   `PENDING|ACCEPTED` delegations in both directions (as owner and delegate).
2. Admin confirms the named account and the affected commitment/session counts.
3. In one transaction, acquire the shared PostgreSQL advisory transaction lock
   `imeal:user-lifecycle`, lock the actionable registration rows, then lock the
   target user row. Recompute the authoritative actionable set after those
   locks, set `users.is_active=false`, revoke active sessions with
   `revoked_reason=ACCOUNT_DISABLED`, cancel actionable registrations with
   `cancel_reason=ACCOUNT_DISABLED`, revoke actionable `PENDING|ACCEPTED`
   delegations, and insert audit/notifications.
4. Role replacement, account enable, and revoke-all-sessions transactions use
   the same lock order of advisory global lock followed by the target user row
   lock. This preserves one order when reciprocal admin actions write audit rows
   for one another or disable publishes notifications to a delegate.
5. Already served rows and rows with existing penalties remain historical and
   are not rewritten.
6. The transaction reports the actual mutation counts after recomputation; it
   never applies a partial cleanup.

7. `ACCOUNT_DISABLED` cancellations are excluded from Kitchen
   preparation/dashboard totals and no-show/penalty selection.

### 5.2 Locations and fixed roster assignments

Exactly four real operational location records are in scope. Their names,
addresses, coordinates, scanner assignments and employee roster rows are
organization-owned inputs and are intentionally absent from source control.
Production is blocked until all four records and the approved roster import have
been completed through authorized Admin operations; no seed endpoint or
fabricated fixture is allowed.

```text
locations
  id, short_code UNIQUE, display_name, serving_point_name, address,
  time_zone=Asia/Ho_Chi_Minh, is_active, effective_from/to, audited metadata

location_policies
  id, location_id, latitude, longitude, geofence_radius_meters,
  max_fix_age_seconds, max_accuracy_meters, effective_from/to, is_active

employee_location_assignments
  id, user_id, location_id, employee_code, effective_from/to, is_active,
  imported_by, import_batch_id, audit timestamps
```

Roster import validates normalized email, name, employee code, active state,
role and location code before an atomic, repeatable commit. Location selection
is server-side; email domain, mobile coordinates, QR data and client role/status
claims cannot change an assignment. Registration creation/reactivation resolves
the effective assignment and stores immutable location, assignment, name and
address snapshots for history. Serving retains those snapshots and the
server-resolved location/verification context even after future roster/policy
changes.

The weekly registration read model uses `REGISTRATION_SNAPSHOT` locations only
for `ACTIVE`, `SERVED`, and `NO_SHOW` rows. `CANCELLED` rows retain their status
but, like dates without a registration, display the current effective roster
location for that meal date (`EFFECTIVE_ROSTER_ASSIGNMENT`), or `null` when
unavailable or ambiguous. This matches creation/reactivation authority:
`canActivate` remains governed by the effective assignment, menu and cutoff.
Reading a cancelled day does not rewrite its stored historical snapshots.

Staff check-in evaluates a fresh foreground GPS fix at resolve and a new fresh
foreground fix at confirm against the effective location policy. The API stores
only safe verification result, timestamp, accuracy and location/session
context; raw coordinates are not retained. GPS failure returns only safe
`Retry`/`Refresh`; Kitchen sends no GPS.

## 6. Weekly and daily menus

### 6.1 `weekly_menus`

```text
id                  UUID PK
week_start_date     date UNIQUE
status              draft | published
created_by_user_id  FK
published_by_user_id FK NULL
created_at
updated_at
published_at NULL
revision             integer NOT NULL DEFAULT 1
```

### 6.2 `daily_menus`

```text
id                  UUID PK
weekly_menu_id      FK
meal_date           date UNIQUE
meal_name           text NULL
description         text NULL
image_url            text NULL
created_at
updated_at
updated_by_user_id  FK
revision            integer NOT NULL
is_service_date     boolean NOT NULL DEFAULT true

CHECK (
  (is_service_date = true AND meal_name IS NOT NULL)
  OR
  (is_service_date = false AND meal_name IS NULL)
)
```

```text
daily_menu_revisions
──────────────────────────────
id                  UUID PK
daily_menu_id       UUID FK
revision            integer NULL
meal_name           text NULL
description         text NULL
image_url           text NULL
created_by_user_id  UUID NULL
created_at          timestamptz

UNIQUE(daily_menu_id, revision)
```

Invariant:

```text
enabled meal_date → exactly one daily menu row with one fixed meal
disabled meal_date → explicit daily menu row with is_service_date=false and no meal
```

- Ngày service bình thường chỉ có lựa chọn suất `REGULAR`.
- Ngày mùng 1 hoặc 15 âm lịch, kể cả tháng nhuận, cho phép `REGULAR` hoặc `VEGETARIAN`.
- Registration không lưu menu variant; chỉ lưu category chuẩn bị `meal_choice` cùng unique key `(user_id, meal_date)`.

- `week_start_date` is Monday; default enabled service dates are Monday–Friday.
- Publish requires every enabled service date to have a valid daily menu; holiday/non-service dates are explicitly disabled.
- Kitchen prepares/publishes the next week on the preceding Saturday–Sunday. First publish transactionally inserts immutable revision 1 for every enabled daily menu and sets it as current before registration opens.
- Editing a published menu before cutoff inserts an immutable revision, updates the daily menu current fields/revision, moves active registrations to the new `menu_revision_id`, and inserts notifications for registered Staff in the same transaction. Canceled registrations keep their prior revision for history.
- A daily menu with active registrations cannot be unpublished/deleted. At cutoff its content is copied to `meal_days` snapshot.
- `daily_menu_revisions` referenced by any registration use restrictive foreign keys and are never update/deleted; canceled history therefore remains renderable before or after cutoff.

## 7. `meal_days`

Operational/snapshot table:

```text
id                   UUID PK
daily_menu_id        UUID FK UNIQUE
meal_type            text
is_serving_ready     boolean NOT NULL DEFAULT false
menu_name_snapshot   text NULL
menu_description_snapshot text NULL
menu_image_snapshot  text NULL
locked_at            timestamptz NULL
service_start_at     timestamptz NULL
service_end_at       timestamptz NULL
created_at           timestamptz
```

Purpose:

- Freeze historical meal display after cutoff/lock.
- Optional Kitchen prepared count/operations data.
- Registration remains source of truth for reservation count.
- Default service window is 10:30–13:30; no-show processing begins at 13:45.

## 8. `registrations`

id UUID PK
user_id UUID FK
meal_date date NOT NULL
meal_choice REGULAR | VEGETARIAN NOT NULL DEFAULT REGULAR
status ACTIVE | CANCELLED | SERVED | NO_SHOW
menu_revision_id UUID NULL FK daily_menu_revisions
owner_name_snapshot text NULL
employee_code_snapshot text NULL
menu_name_snapshot text NULL
menu_description_snapshot text NULL
menu_image_snapshot text NULL
service_location_id UUID NULL FK locations
service_location_assignment_id UUID NULL FK employee_location_assignments
service_location_code text NULL
service_location_name text NULL
service_location_address text NULL
service_location_effective_from timestamptz NULL
service_location_snapshot_at timestamptz NULL
registered_at timestamptz NULL
cancelled_at timestamptz NULL
cancel_reason text NULL
cancelled_by_user_id UUID NULL
no_show_at timestamptz NULL
created_at/updated_at
version integer NOT NULL DEFAULT 1

UNIQUE(user_id, meal_date)

The physical lifecycle/menu/owner/location columns are nullable during the
expand phase so legacy rows remain readable. The
`registration_lifecycle_snapshot_complete` check is `NOT VALID` until the
external preflight and approved exact backfill pass; rows with
`registered_at IS NULL` remain explicitly legacy. Every new or reactivated
operational row must have `registered_at`, the menu revision/name, owner and
employee snapshots, and all seven location snapshot values.

`daily_menu_revisions.revision`, `meal_name`, `description`, `image_url` and
`created_by_user_id` are nullable for legacy compatibility, with
`UNIQUE(daily_menu_id, revision)` and a restrictive registration foreign key.
`daily_menu_revisions.content` is legacy evidence only; it is parsed by the
approved backfill only when it is a complete verified JSON object.
For future `ACTIVE` rows, Staff self check-in rollout eligibility requires the
complete registration/serving snapshot used by the Staff self check-in flow:
required text is non-null and non-blank after trimming; `registered_at`,
location effective/snapshot timestamps and all location/assignment references
are valid; the immutable revision belongs to the same menu date;
`menu_name_snapshot` equals the exact verified stored revision name (after
non-blank validation, without silently trimming or accepting a mismatch); and
nullable description/image snapshots use `IS NOT DISTINCT FROM` equality with
the immutable revision. Any mismatch remains a reported remediation or
quarantine row and makes Staff self check-in fail closed.

`meal_days` stores nullable `menu_name_snapshot`, `menu_description_snapshot`,
`menu_image_snapshot`, `locked_at`, `service_start_at` and `service_end_at`
alongside its existing day fields. `meal_servings` stores nullable legacy-aware
`menu_name_snapshot`, `menu_description_snapshot` and `menu_image_snapshot`.

`penalties.registration_id` and `penalties.meal_date` are nullable for legacy
rows, with a restrictive foreign key and a partial unique index on non-null
`registration_id`.

- Ngày bình thường chỉ được lưu `REGULAR`; mùng 1 hoặc 15 âm lịch (kể cả tháng nhuận) được lưu `REGULAR` hoặc `VEGETARIAN`.
- `meal_choice` là category chuẩn bị, không phải menu variant; `MealDay.mealType` tiếp tục điều khiển serving window.

Logical business state `SERVED` is derived from a valid `meal_servings` row.
The retained `RegistrationStatus.SERVED` enum is legacy read/wire
compatibility only; new serving writes leave the registration `ACTIVE`.

### 8.1 Registration transitions and snapshot policy

```text
missing → ACTIVE
CANCELLED → ACTIVE       before cutoff, only without serving/no-show/penalty
ACTIVE → CANCELLED       before cutoff
ACTIVE + meal_serving     logical SERVED projection
ACTIVE → NO_SHOW          server time >= 13:30 VN, no serving
```

`SERVED` without a serving, `NO_SHOW` with a serving, and `CANCELLED` with a
serving violate `registration_serving_consistency` and fail closed. A valid
`ACTIVE + meal_serving` row remains in the dashboard served projection.
The Staff self check-in consumes the `ACTIVE` registration by creating exactly one
`MealServing`; the registration remains `ACTIVE` for compatibility, and
`MealServing` is the only current serving outcome source. No second serving or
delegation projection is created.
Final serving/no-show history is never rewritten. An `ACTIVE` meal-choice
update preserves its existing immutable snapshots; reactivation resolves and
records a new lifecycle snapshot.

Legacy rows with incomplete snapshots cannot be made current check-in eligible:
registration reactivation/update fails with `REGISTRATION_FAILED`, and current
status/resolve/confirm returns the canonical own-user state/error without
substituting a current location/menu/name/address value. A state-valid row
remains in aggregate accounting so historical counts are not silently
understated.

One API request captures server time once, resolves the effective roster
assignment/location and verified menu revision in each transaction, writes all
snapshots atomically, and returns per-date results. Cancellation locks the
registration, quarantines any retained historical delegation context, and
writes audit and notifications in the same transaction.

### 8.2 Weekly registration read contract

`GET /api/registrations/week` returns an ordered seven-day `days` projection
alongside the legacy `menu`, `registrations` and `registrationWindow` fields.
Each day carries its ISO `mealDate`, lunar date, cutoff instant, available meal
choices, published menu (or `null`), registration (or `null`), optional
delegation, and per-action availability/reason arrays. The menu lookup is
published-only; a draft or ambiguous latest revision is not an activation
authority.

For a registered row, `location` is always the persisted registration snapshot
(`source: REGISTRATION_SNAPSHOT`) when that snapshot is complete. An empty day
may expose the effective roster assignment (`source:
EFFECTIVE_ROSTER_ASSIGNMENT`) only when the assignment, employee identity and
related location are active, date-effective, non-ambiguous, internally
consistent and display-complete. This read-side authority uses the same
location identity and menu-revision validity checks as activation; it never
replaces a registered snapshot with current roster data.

Weekly registration eligibility is resolved from one server timestamp in
`Asia/Ho_Chi_Minh`: Monday–Sunday current and next week boundaries are
computed from the Vietnam business date. Before the current week’s Saturday
`17:00`, only current-week dates are eligible; at exactly `17:00`, next week
opens while the current week remains eligible through Sunday. On the next
Monday, the former week is outside and the new next week is closed until its
Saturday `17:00`. Reads remain viewable for historical, current, next, and
future weeks; `registrationWindow.days[].editable` and action flags/reasons
combine this weekly result with the independent per-meal cutoff.

`canActivate` is the only action that requires current published-menu and
effective-location authority. For an existing registration,
`canCancel` and `canChangeMealChoice` use the persisted lifecycle and snapshot
without requiring current menu or roster authority; they still remain gated by
the per-meal cutoff, weekly registration eligibility, and finalized state.
Historical rows remain viewable as read-only data when those mutation gates
are closed.
Any linked `meal_servings` row is projected as `SERVED` (including legacy
`ACTIVE + meal_serving` rows), while finalized serving/no-show/penalty history
blocks lifecycle mutations. The reason arrays are machine-readable contract
values (`HOLIDAY`, `DISABLED`, `NO_PUBLISHED_MENU`, `LOCATION_UNAVAILABLE`,
`LOCATION_AMBIGUOUS`, `CUTOFF_PASSED`, `REGISTRATION_WEEK_NOT_OPEN`,
`OUTSIDE_REGISTRATION_WINDOW`, `REGISTRATION_FINALIZED`, `ALREADY_ACTIVE`,
`NOT_ACTIVE`, and `NO_ALTERNATIVE_MEAL_CHOICE`).

## 9. Historical pickup/delegation compatibility

`pickup_delegations` and `pickup_sessions` remain retained/readable for
accounting, audit and migration compatibility. They are not current
authorization sources and are not queried as eligible Staff check-in targets:

```text
pickup_delegations
  historical owner/delegate/registration lifecycle and audit timestamps

pickup_sessions
  historical presenter intent/session context
```

`serving_verifications` is different: current Staff resolve creates the
minimized GPS validation and opaque resolved-intent evidence that confirm
consumes transactionally. Older safe verification context remains readable for
history/compatibility; neither current nor legacy rows retain raw coordinates.

Existing foreign keys, immutable history and retention rules remain intact where
needed for old records. Registration cancellation/account disable may
quarantine historical delegation context, but no current route creates or
consumes a delegation. Current `MealServing.registrationId` is the only serving
outcome source.

## 10. Staff self check-in and stable shared QR

### 10.1 Current API authority

The current client contract is:

```text
GET  /api/me/check-in
POST /api/me/check-in/resolve
POST /api/me/check-in/confirm
GET  /api/kitchen/check-in/qr
GET  /api/kitchen/check-in/dashboard?date=YYYY-MM-DD
```

`GET /api/kitchen/check-in/qr` requires `kitchen.serve`. The server resolves
the caller's active roster/location assignment and creates or reuses one stable
day/location check-in session. The QR contains no employee identity and does not
rotate per Staff. The response exposes only `qr`, `date`, `location`,
`activeFrom` and `expiresAt`.

The stable QR is a session locator/authorization input, not a serving result.
No `QR_TTL_SECONDS`, `QR_CLOCK_SKEW_SECONDS` or `PICKUP_SESSION_TTL_SECONDS`
environment setting is part of the current contract. The practical
day/location `CheckInSession` uses server-issued `activeFrom`/`expiresAt`.

`GET /api/me/check-in` is authoritative for the authenticated caller only. It
returns the caller's own normalized registration/menu/location/eligibility
state and action flags for initial display and timeout reconciliation.

### 10.2 Resolve with fresh foreground GPS

Staff scans the shared Kitchen QR and sends:

```json
{
  "qr": "<shared-qr>",
  "gps": {
    "capturedAt": "<UTC ISO instant>",
    "latitude": 10.77,
    "longitude": 106.69,
    "accuracyMeters": 12
  }
}
```

`POST /api/me/check-in/resolve` authenticates the caller, validates the stable
session/date/location/window and evaluates the fresh foreground GPS against the
server location policy. It returns only the caller's own `sessionId`, date,
expiry, employee/menu/location/registration/eligibility projection and, when
`eligibility=true`, an opaque signed `intentNonce` scoped to caller,
registration, session and location. `intentNonce` is nullable when
`eligibility=false`. Resolve does not consume a registration and does not create
`MealServing`.

For an eligible resolve, the server persists a `VALID`
`ServingVerification` bound to the opaque nonce, authenticated caller, own
registration, check-in session and location. It stores safe verification
context only; the nonce itself is not a serving outcome.

Safe error codes are `INVALID_QR`, `INACTIVE_CHECKIN_SESSION`,
`NO_REGISTRATION`, `REGISTRATION_CANCELLED`, `OUTSIDE_CHECKIN_WINDOW`,
`LOCATION_MISMATCH`, `GPS_REQUIRED`, `GPS_STALE`, `GPS_INACCURATE` and
`OUTSIDE_GEOFENCE`. Raw latitude/longitude is not logged or retained as
operational history; safe verification result, timestamp, accuracy and
location/session context are sufficient.

### 10.3 Confirm with fresh GPS and idempotency

After reviewing the own-user result, Staff captures a **new** fresh foreground
GPS sample and sends:

```json
{
  "sessionId": "<check-in-session-id>",
  "intentNonce": "<opaque-signed-intent-nonce>",
  "idempotencyKey": "<caller-retry-key>",
  "gps": {
    "capturedAt": "<new-UTC ISO instant>",
    "latitude": 10.77,
    "longitude": 106.69,
    "accuracyMeters": 12
  }
}
```

`POST /api/me/check-in/confirm` requires a non-empty `intentNonce` and validates
it against the persisted `VALID` `ServingVerification`, authenticated caller,
session, own registration and location. It then revalidates date/location/window,
account and fresh GPS policy in one transaction. It returns `CHECKED_IN`,
`registrationId`, `servingId` and `servedAt`. The caller cannot provide another
user's registration ID or a delegation/multi-item intent.

## 11. `meal_servings` and confirm idempotency

### 11.1 `serving_confirm_requests`

One Staff confirm request produces at most one serving:

```text
id                    UUID PK
caller_user_id        UUID FK
idempotency_key       UUID/string
request_hash          text
status                processing | succeeded | rejected
result_payload        jsonb NULL
locked_until          timestamptz NULL
created_at
finished_at           timestamptz NULL

UNIQUE(caller_user_id, idempotency_key)
```

The claim workflow inserts or locks the `(caller_user_id, idempotency_key)`
claim and compares the request hash. The same caller/key/body replays the
committed result. Reusing the key with a different body returns
`IDEMPOTENCY_CONFLICT`; an in-flight claim is retryable. Infrastructure failure
rolls back the claim/domain transaction rather than fabricating success.

### 11.2 `check_in_sessions`

`CheckInSession` is additive context for the stable day/location QR and Staff
resolve/confirm flow:

```text
id                    UUID PK
meal_date             date
location_id           UUID FK
active_from           timestamptz
expires_at            timestamptz
qr/session fingerprint server-side stable-session material
safe verification     result/timestamp/accuracy/location context only
```

It does not replace `registrations` or `meal_servings`, and it does not permit
cross-user access. Session rows are locked and revalidated at confirm.

### 11.3 `meal_servings`

```text
id                       UUID PK
registration_id          UUID FK UNIQUE
owner_user_id            UUID FK
receiver_type            SELF
staff_actor_user_id      UUID FK
location_id              UUID FK
meal_date                date
menu_revision_id         UUID FK NULL
check_in_session_id      UUID FK NULL
verification_outcome     text NULL
served_at                timestamptz NOT NULL DEFAULT now()
```

The deployed schema may retain nullable legacy presenter/receiver/Kitchen,
pickup-session, delegation and snapshot columns for old rows. New current
writes link the authenticated Staff actor, own registration and additive check
in session, while preserving immutable menu/location snapshots. The unique
`registration_id` constraint remains the canonical exactly-once boundary.
Successful serving is immutable/final; no reversal/re-serve endpoint exists.

## 12. Check-in serving transaction

```text
BEGIN
  lock serving_confirm_request by authenticated caller + idempotency key
  compare request hash; replay result or return IDEMPOTENCY_CONFLICT
  lock CheckInSession and the caller-owned registration deterministically
  verify caller/account, date, active location and 10:30–13:30 window
  verify fresh confirm GPS, accuracy and geofence
  verify registration is ACTIVE and has no MealServing
  if any deterministic conflict:
      roll back all claim/domain writes
      return the canonical error; client reconciles or retries safely
  insert one MealServing with registration/session/safe verification context
  insert one immutable Staff-owned meal event
  update request = succeeded + result
COMMIT
```

Only the authenticated caller's own registration is eligible. A successful
confirm returns `CHECKED_IN`; the same caller/key/body returns the original
result, while concurrent/retried requests cannot create a second
`MealServing`. No raw GPS coordinates, QR payload or session token appears in
normal logs or operational dashboards.

## 13. Concurrency cases

### 13.1 Concurrent confirms for one registration

Both requests lock the idempotency/session/registration rows and race the
`UNIQUE(registration_id)` constraint. Exactly one commits the immutable serving;
the other returns the canonical already-checked-in/replayed result.

### 13.2 Wrong caller or stale session

The API resolves registration ownership from the authenticated session, never
from a client-supplied owner/delegate ID. A wrong caller, canceled registration,
closed window, stale session or failed GPS check cannot be substituted or
bypassed.

### 13.3 Client retry after lost response

The same idempotency key/body replays the stored result. Staff may also call
`GET /api/me/check-in`; the client never displays local success before server
confirmation.

## 14. `meal_events`

Immutable ledger:

```text
id                  UUID PK
registration_id     UUID FK
meal_date           date
event_type          CHECKED_IN | NO_SHOW | ...
owner_user_id       UUID FK
actor_user_id       UUID FK NULL
source              STAFF_CHECK_IN | NO_SHOW | ...
metadata            jsonb
created_at          timestamptz
```

Never update/delete historical events during normal operations. Meal
lifecycle/audit history is retained for **1 year**, after which the retention
process may purge expired rows in dependency-safe order.

## 15. Kitchen aggregate dashboard queries

For date `D`, load one consistent server snapshot of active registrations,
valid `MealServing` rows and reconciled no-show state. Exclude canceled and
account-disabled rows. The response is aggregate-only:

```text
date, location, window, lastUpdated
registered, checkedIn, pending, noShow, regular, vegetarian
```

The invariants are:

```text
checkedIn + pending + noShow = registered
regular + vegetarian = registered
```

An invariant violation returns a generic error with request ID and no partial
counters. At 200–300 rows/day, PostgreSQL aggregate queries are sufficient;
do not introduce denormalized counters unless profiling proves need.

Recommended indexes:

```text
registrations(meal_date, status)
meal_servings(registration_id)
meal_servings(served_at)
check_in_sessions(meal_date, location_id)
```

## 16. Aggregate dashboard polling

- Initial `GET /api/kitchen/check-in/dashboard?date=YYYY-MM-DD` returns the
  canonical aggregate snapshot and `lastUpdated`.
- Kitchen clients poll every 10 seconds only while the dashboard is focused and
  the app is foregrounded; re-entry triggers an immediate fetch.
- A temporary failure retains the last good snapshot and marks it stale until a
  successful refresh; the client never substitutes zero/empty counts. Under
  healthy polling, the visible snapshot normally converges within approximately
  15 seconds.
- There is no SSE/WebSocket dependency and no per-person dashboard/log payload.
- Each refresh reads PostgreSQL-derived state, so multiple displays converge on
  the same aggregate snapshot without an event-stream contract.

## 17. `penalties`

```text
id                  UUID PK
registration_id     UUID NULL FK UNIQUE WHERE NOT NULL
user_id             UUID FK   # registration owner
meal_date           date NULL
amount              integer
status              PENDING | PAID | WAIVED
reason              text
paid_at             timestamptz NULL
waived_at           timestamptz NULL
waive_reason        text NULL
waived_by_user_id   UUID NULL FK
created_at/updated_at
```

`registration_id` is the database idempotency authority for new no-show
penalties. It is nullable only for retained legacy rows and is backfilled only
from an exact one-to-one documented identity. `meal_date` accompanies that
identity. The restrictive foreign key and partial unique index reject a second
penalty for one registration without rejecting multiple legacy nulls.

Canonical amount is 50,000 VND for every no-show; exceptions use an audited
`WAIVED` resolution. A worker retry locks the registration and
registration-keyed penalty, preserves `PAID`/`WAIVED`, and never reopens or
creates a duplicate.

## 18. Notifications

The persisted inbox is authoritative. Notification creation is part of the business
transaction; push is optional/best effort and never the source of truth.

### 18.1 PostgreSQL models

```text
notifications
────────────────────────────────────────────
id                  UUID PK
user_id             UUID FK users
kind                NotificationKind
payload             jsonb strict kind-specific payload
title_vi/body_vi    text bilingual copy
title_en/body_en    text bilingual copy
read_at             timestamptz NULL
dedupe_key          text UNIQUE
created_at          timestamptz

INDEX(user_id, created_at DESC, id DESC)
INDEX(user_id, read_at, created_at DESC, id DESC)
```

Kinds include `LEGACY_MESSAGE`, `REGISTRATION_OPENED`,
`REGISTRATION_REMINDER`, `PICKUP_REMINDER` (current owner-only Staff
check-in reminder), `REGISTERED_MENU_CHANGED` and
`NO_SHOW_PENALTY_CREATED`. Historical delegation/proxy kinds
(`DELEGATION_REQUESTED`, `DELEGATION_ACCEPTED`, `DELEGATION_DECLINED`,
`DELEGATION_REVOKED`, `PROXY_PICKUP_COMPLETED`) remain readable for migration
history; current publishers must not create them.

```text
push_devices
────────────────────────────────────────────
id                  UUID PK
user_id             UUID FK users
token               text UNIQUE             # ExpoPushToken[...] / ExponentPushToken[...]
platform            IOS | ANDROID | UNKNOWN
last_seen_at        timestamptz
revoked_at          timestamptz NULL
created_at          timestamptz

notification_deliveries
────────────────────────────────────────────
id                  UUID PK
notification_id     UUID FK notifications
push_device_id      UUID FK push_devices
status              PENDING | PROCESSING | SENT | FAILED
attempt_count       integer
next_attempt_at     timestamptz
last_error          sanitized text NULL
created_at/updated_at timestamptz

UNIQUE(notification_id, push_device_id)
INDEX(status, next_attempt_at)

outbox_events
────────────────────────────────────────────
id                  UUID PK
aggregate_type      text                  # NOTIFICATION
aggregate_id        UUID                  # notification id
event_type          text                  # NOTIFICATION_CREATED
payload             text/json
status              PENDING | PROCESSING | PROCESSED | FAILED
dedupe_key          text UNIQUE NULL      # notification-delivery:<notificationId>
attempt_count       integer
available_at        timestamptz
processed_at        timestamptz NULL
last_error          sanitized text NULL
created_at           timestamptz
```

`User.notificationLocale` defaults to `VI`; `User.remindersEnabled` defaults to `true`.
The reminder flag is one shared opt-out for weekly registration and owner-only
same-day Staff check-in reminders, not for transactional event kinds.

### 18.2 Exact event matrix

| Kind                                          | Trigger/timing                                                                                                        | Recipient                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `REGISTRATION_OPENED`                         | First weekly-menu publish only; missing revisions initialized and `publishedAt` set. Repeat/concurrent publish no-op. | Every active Staff user, regardless of reminders.                                        |
| `REGISTRATION_REMINDER`                       | Sunday 10:00 `Asia/Ho_Chi_Minh`, next Monday-start published menu, one/user/week.                                     | Active Staff missing an enabled non-holiday `ACTIVE` registration and reminders enabled. |
| `PICKUP_REMINDER`                             | Daily 11:30 VN, today's `ACTIVE` unserved own registration.                                                            | Registration owner only; reminders enabled only.                                        |
| `REGISTERED_MENU_CHANGED`                     | Actual tracked edit to already-published menu date (content, meal type, holiday, enabled).                            | Active registrants of that date; no-op emits none.                                       |
| `NO_SHOW_PENALTY_CREATED`                     | No-show worker at 13:45 VN after service end 13:30.                                                                   | Registration owner.                                                                      |

Historical delegation/proxy rows remain readable with their original payload
shape but are not current triggers or owner actions.

First publish emits `REGISTRATION_OPENED`; an edit to an already-published registered date
emits `REGISTERED_MENU_CHANGED`, never another opened event. Admin account-disable
notification is future scope in the account-disable subsystem, not a dormant kind.

Payloads are strict and use UTC IDs/timestamps plus `YYYY-MM-DD` meal dates:
registration opened `{weekStart, weekEnd}`; registration reminder
`{weekStart, weekEnd, remainingMealDates}`; current pickup reminder
`{mealDate, registrationIds, registrationCount}` for the owner only; menu change
`{dailyMenuRevisionId, mealDate}`; no-show `{penaltyId, registrationId, mealDate, amount}`.
Historical delegation/proxy payloads remain read-only and are never emitted by
the current check-in flow.

Owner-scoped API surface is `GET /api/notifications` (cursor/limit 1–50, default 20),
`GET /api/notifications/:id`, and `PATCH /api/notifications/:id/read`.
Preferences are `GET/PATCH /api/notifications/preferences`. Device registration is
`POST /api/notifications/push-devices` with `{ token, platform: ios|android }`; device
revocation is `DELETE /api/notifications/push-devices` with `{ token }` only.
Detail/read never cross user ownership; missing and foreign IDs use `NOTIFICATION_NOT_FOUND`.

### 18.3 Owner activity read API

The self-service activity surface is session-only and always derives ownership from
`CurrentUser`; clients never provide a `userId`. `GET /api/registrations/history`
accepts strict offset pagination (`page` default 1, `limit` default 20, maximum 100),
returns `{ data, meta.pagination }`, and orders by `mealDate DESC, id DESC`. It
includes only registrations on or before the current `Asia/Ho_Chi_Minh` business
date. The projected status uses the same serving precedence as the weekly read:
`ACTIVE`, `CANCELLED`, `SERVED`, or `NO_SHOW`; no competing lifecycle projection is
allowed.

History rows preserve nullable immutable registration menu/location snapshots and
safe lifecycle timestamps (`registeredAt`, `cancelledAt`, `noShowAt`, `servedAt`,
`createdAt`, `updatedAt`). They never substitute current menu or roster values for
legacy null snapshots. Related penalty summaries are selected only when
`penalties.userId` equals the authenticated owner.

`GET /api/registrations/stats?month=YYYY-MM` defaults to the current Vietnam
business month and returns period `month`, `startDate`, and `endDate` metadata.
The selected month includes future dates: `booked` counts projected
`ACTIVE|SERVED|NO_SHOW`, `enjoyed` counts projected `SERVED`, and `CANCELLED` is
excluded from both. The bounded query applies the shared projection once.

`GET /api/penalties` uses the same deterministic page contract and newest order
(`createdAt DESC, id DESC`), with an optional canonical `PENDING|PAID|WAIVED`
filter. `GET /api/penalties/:id` is owner-scoped and returns the same not-found
response for a foreign or nonexistent ID. Penalty responses expose only safe
financial/timestamp fields and immutable registration/menu/location context when
the linked registration belongs to the same owner; malformed cross-owner links
produce `registration: null`. These routes have no mutation or admin permission
actions, and existing admin penalty routes remain separate.

### 18.4 Transactional publish and delivery


API publishers (menu and registration-cancellation) and worker publishers
(registration reminder, owner-only check-in reminder, no-show) render fixed
bilingual copy and insert the notification plus its `NOTIFICATION_CREATED`
outbox row in the same transaction. Historical delegation/pickup publishers
are disabled for current flow. Upsert by global notification dedupe key is
replay-safe and does not reset read/delivery state. Copy dates use
`Asia/Ho_Chi_Minh`; dispatch selects stored VI/EN copy from the owning user's
locale. Name fallback is name → email → neutral fallback; copy contains no
QR/auth/session.

The worker dispatch cron runs every 15 seconds:

1. Stage 1 claims due `PENDING` `NOTIFICATION_CREATED` rows with
   `FOR UPDATE SKIP LOCKED`, creates one delivery for each non-revoked device, and marks
   the outbox row `PROCESSED`.
2. Stage 2 claims due `PENDING` deliveries and `PROCESSING` deliveries older than five
   minutes, sends Expo chunks with `sound=default`, Android channel `imeal-default`, and
   data `imeal://notifications/<notificationId>`.
3. Accepted tickets become `SENT`. Device-not-registered revokes that device; permanent
   `MessageTooBig`, `MismatchSenderId`, and `InvalidCredentials` errors become `FAILED`.
4. Network/HTTP 429/5xx/`MessageRateExceeded` failures retry after 1, 5, and 15 minutes;
   after the fourth failed attempt they become `FAILED`. Errors are sanitized and logs
   contain only notification/delivery IDs, attempt, provider code, and sanitized error.

Inbox delivery remains correct when push fails, no device is registered, or OS permission
is denied. Mobile's one-time contextual explainer prompts only from `Enable`; `Not now`
marks seen, denial never auto-prompts, and Settings is the recovery CTA. Web does no
push-specific work and simulators explain physical-device requirement. Push taps validate
`imeal://notifications/<UUID>` opens owner-scoped detail; registration/menu
notifications open Calendar, the owner-only pickup reminder opens current Staff
Check-in, and historical delegation/proxy/no-show/legacy items remain readable
with no current action.

## 19. `job_runs`

```text
id            UUID PK
type          menu_lock | no_show | notification_dispatch | reconcile | ...
status        running | succeeded | failed | partially_succeeded
started_at
finished_at NULL
attempt
source        scheduler | admin | recovery
summary       jsonb
error_code NULL
error_message NULL
retry_of_id NULL
```

No-show domain eligibility is `server time >= 13:30` VN; the normal scheduler
first runs at 13:45 VN:

1. Select `ACTIVE` registrations for the target date in deterministic
   registration-ID order, excluding valid servings, cancelled rows and
   `ACCOUNT_DISABLED` rows.
2. For each candidate, lock the registration row first and re-check status,
   serving, account activity, meal date and the 13:30 eligibility.
3. Lock/create the penalty by unique `registration_id`, then atomically write
   `NO_SHOW`, `no_show_at`, the penalty, immutable audit, notification and
   `NO_SHOW_RECONCILED` outbox event.
4. A failure rolls back that candidate's entire transaction; later candidates
   may continue. A retry is a no-op and never reopens `PAID` or `WAIVED`.
5. Record sanitized `job_runs` summary; no client endpoint creates no-shows.

## 20. Generic audit

`audit_logs` for sensitive non-meal actions:

- `staff`/`kitchen` role add/remove and server-side Admin-role lifecycle;
- account enable/disable;
- mandatory previewed future-registration cancellation/delegation revocation after disable;
- menu publish/locked changes;
- penalty resolve;
- admin job trigger.

Fields: actor, action, entity type/id, before/after safe metadata, timestamp, request ID.

## 21. Data ownership

- Allowlist-A + OTP challenge state own production authentication eligibility.
- `auth_sessions` own opaque session hashes and revocation/expiry metadata.
- PostgreSQL `users/user_roles` own employee identity, current status and IMeal authorization.
- PostgreSQL `permissions/role_permissions/user_permissions` own sensitive capability grants.
- `locations/location_policies/employee_location_assignments` own the four approved
  locations, effective policies and fixed roster assignment.
- Registration owns reservation intent plus immutable effective
  location/assignment/name/address snapshots.
- Serving owns actual Staff self-check-in outcome, authenticated actor, own
  registration, check-in session, location and safe verification snapshots.
- Historical pickup/delegation rows own only retained compatibility/audit context;
  they do not authorize current check-in.
- Penalty owns financial resolution; events/audit are append-oriented evidence.
- OTP verifiers are retained only through challenge expiry/consumption and never
  clear codes; provider payloads are encrypted and delivery logs are redacted.
- Session records retain only hashes/minimized metadata for the configured idle
  and absolute lifetime; revocation/audit reasons remain safe and bounded.
- GPS evidence retains safe verification result, location ID, timestamp and
  accuracy only for the approved dispute/audit period; raw coordinates are not
  operational history.

## 22. Retention

Canonical history retention is **1 year** for meal lifecycle/business audit data, including menu revisions referenced by retained history, registrations, delegations, servings, penalties, notifications, `meal_events`, `job_runs` and `audit_logs`.

- Active user identity/authorization/configuration records are not age-purged solely because they are older than one year.
- Within the retention window, serving/audit evidence is immutable/append-oriented under normal operations.
- A scheduled retention cleanup must delete in foreign-key-safe order, be idempotent and record `job_runs`/audit evidence.

## 23. Security invariants

- Mobile cannot set `served_at`, role, account status, location assignment,
  presenter/receiver, penalty status or audit actor.
- New registration writes resolve and persist `menu_revision_id`,
  `owner_name_snapshot`, `employee_code_snapshot`, `menu_name_snapshot`,
  `menu_description_snapshot`, `menu_image_snapshot`,
  `service_location_id`, `service_location_assignment_id`,
  `service_location_code`, `service_location_name`,
  `service_location_address`, `service_location_effective_from` and
  `service_location_snapshot_at` atomically.
- Kitchen can obtain the stable shared QR and aggregate dashboard only with an
  active opaque session and `kitchen.serve`; Kitchen sends no GPS and cannot
  resolve/confirm an employee.
- Staff resolve/confirm derive ownership from the authenticated opaque session;
  clients cannot provide another user, delegation, multi-item intent or role.
- Shared QR activeFrom/expiresAt, session/date/location/window and registration
  eligibility are verified server-side.
- Fresh foreground GPS is required at both resolve and confirm; confirm must
  use a new sample. It cannot choose a different location or bypass
  authentication, authorization, registration, window or concurrency checks.
- GPS failure exposes only safe Retry/Refresh. Raw coordinates and clear OTP,
  session, QR or provider payloads never appear in routine logs.
- Incomplete legacy snapshots fail closed for registration reactivation/update
  and pickup/serving; no current location/menu fallback exists. A state-valid
  incomplete row remains visible to dashboard accounting rather than being
  silently dropped.
- `SERVED` without a serving, `NO_SHOW` with a serving, and `CANCELLED` with a
  serving fail closed under `registration_serving_consistency`; no automatic
  repair is allowed.
- Single-registration serving never partially commits; successful confirm is
  final and no reversal endpoint exists. Same idempotency key/body cannot
  double-serve.
- Worker has no independent business-write path; scheduled work uses the same
  application invariants and records sanitized `job_runs`.

## 24. Clean-slate provisioning

1. Confirm a disposable/staging target and a restorable database backup before
   any write; production must provide `DATABASE_URL` and the runtime secret
   contract in Technical Requirements §8.2. Never use the local public schema
   as a rollout target when preflight is dirty.
2. Deploy the additive
   `20260928000000_phase0_domain_correctness` migration and generate the
   matching Prisma client. It adds nullable fields, indexes, restrictive
   foreign keys and `NOT VALID` checks only; it does not insert operational
   rows or validate unresolved legacy data.
3. Run the read-only seven-check preflight and obtain an external approval
   record. The roster check must resolve exactly one active, date-effective
   assignment and exactly one active, date-effective location for each
   in-scope registration. Abort before backfill if any future ACTIVE snapshot
   is incomplete, status/serving mismatch exists, roster/location resolution
   is ambiguous or invalid, menu revision is unverified, or penalty mapping
   is ambiguous/duplicate.
   The rollout scope is explicit: a registration is operational when
   `status <> 'CANCELLED' OR meal_date >= current business date in
Asia/Ho_Chi_Minh`; only `CANCELLED` rows before that business date are
   legacy history permitted to retain nullable snapshots. The
   `registration_serving_mismatch` check still evaluates every status and
   always blocks.
4. Run `backfill.sql` only after the clean preflight and an independent
   approval record. Use the target-safe container wrapper: set the intended
   schema explicitly in the same `psql` session, assert `current_schema()` is
   that schema, pass `-v ON_ERROR_STOP=1`, then `-f backfill.sql`; never run
   against dirty `public`. It updates only exact one-to-one roster/location,
   verified immutable menu JSON and canonical menu snapshot mismatches tied to
   that immutable revision, plus documented penalty identities; it never
   invents migration timestamps, current values, rows or penalty merges.
5. Re-run the target-safe preflight, require operational checks to be zero,
   then validate `registration_lifecycle_snapshot_complete` and
   `registration_serving_consistency`. Keep unresolved legacy cancelled/history
   rows visible in the report and quarantined from pickup. If post-backfill
   preflight is nonzero or validation fails, cutover stays blocked: quarantine
   and remediate exact rows, or restore the approved backup under the named
   rollback authority and decision window recorded for the target.
6. Exercise focused/full contract, domain, API and worker suites before
   application cutover, then smoke the exact registration, pickup, dashboard
   and no-show paths. Emit no production sign-off from local-only evidence.
7. On any post-backfill or verification failure, retain the additive schema on
   staging while remediating (or discard only a disposable schema after
   evidence capture); do not pretend there is a safe down migration. The old
   compatible application and approved backup are the only rollback path, under
   the documented operator decision; there is no Firebase rollback path.
8. The local run below is **NOT COMPLETE / NO-GO**: it has no independent
   approval/audit record, staging target, backup rehearsal or controlled
   external artifact checksum.

   [Task 9 brief](../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-9-brief.md) · [Task 9 report](../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-9-report.md)

### Observed Phase 0 rollout gate — 2026-09-28

The following Step 2 evidence was executed at HEAD
`75a9d719deb511503dfc55a11b52a81ab6d049a6` and is local/disposable only; it
is not staging or production approval:

- Fresh target schema: `phase0_step2_20260928131738`. The public schema was
  not used for any write, backfill or validation.
- `DATABASE_URL='postgresql://postgres:postgres@localhost:5432/imeal?schema=phase0_step2_20260928131738' yarn workspace @imeal/core exec prisma migrate deploy`
  applied all eight checked-in migrations, including
  `20260928000000_phase0_domain_correctness`. `prisma generate` and
  `prisma validate` passed. Post-expand counts for registrations, daily menu
  revisions, meal days, meal servings and penalties were all zero.
- Target-safe preflight used explicit `search_path`, a `current_schema()`
  assertion and `ON_ERROR_STOP=1`:
  `docker exec develop-db-1 psql -U postgres -d imeal -v ON_ERROR_STOP=1 -P pager=off -c "SET search_path TO phase0_step2_20260928131738; DO \$assert\$ BEGIN IF current_schema() <> 'phase0_step2_20260928131738' THEN RAISE EXCEPTION 'target schema mismatch'; END IF; END \$assert\$;" -f /tmp/phase0-step2-preflight.sql`.
  All seven named checks and all four status counts returned zero.
- The same target-safe `backfill.sql` wrapper ran twice. Both runs returned
  `UPDATE 0`, `DO`, `UPDATE 0`, `UPDATE 0`, `COMMIT`; no operational row was
  inserted or merged. Post-backfill preflight again returned seven zero checks
  and four zero status counts.
- Target-safe validation passed both
  `registration_lifecycle_snapshot_complete` and
  `registration_serving_consistency`; both returned `convalidated=t`.
- Classification schema
  `phase0_step2_classification_20260928131738` contained synthetic rows only.
  Its target-safe preflight classified
  `roster_assignment_ambiguous=1` for
  `registration-step2-invalid-location` and
  `future_active_snapshot_incomplete=1` for
  `registration-step2-stale-menu`; the other five checks were zero. Because
  named checks were nonzero, no backfill or validation was run there.
- Previously observed local public schema evidence (not rerun or modified
  during fresh Step 2) remains a NO-GO data set under the conservative
  operational scope: 132 incomplete snapshots, 6 ambiguous/effectively
  invalid roster assignments, 132 incomplete menu revisions and 40 incomplete
  future ACTIVE rows; status counts ACTIVE 66, CANCELLED 16, SERVED 40,
  NO_SHOW 10. No backfill or validation was run there.
- Fresh Step 1 verification at HEAD `75a9d71` supersedes the historical
  pre-75 local failures: core focused 42/42; core full 93/93 with the
  intentional serial `--maxWorkers 1` caveat; API e2e 45/45 plus production
  concurrency 12/12; worker e2e 5/5; `yarn typecheck` and mobile tsc passed
  after `yarn install --immutable`.
- No staging target, production backup/restore rehearsal, secret/provider
  provisioning, or mobile device/UAT evidence was available. These remain
  release blockers; local migration success does not close the Phase 0 or
  production gate.

## 25. Backend acceptance criteria

- Unknown/disabled/non-allowlisted OTP attempts are indistinguishable and never
  create a session; OTP is hashed, one-use, throttled, expiry-bound and redacted.
- Production accepts only allowlist-A OTP and opaque/hash-backed sessions;
  `NODE_ENV=test` + `REQUIRE_AUTH=false` is the only non-production harness bypass.
- Exactly four real locations and approved roster assignments are imported before
  production; no fabricated location/employee data exists in source control.
- Registration and serving history retain fixed location/assignment/name/address
  snapshots; client claims cannot change role, status or location.
- Kitchen stable day/location QR contains no employee data and is reused within
  server `activeFrom`/`expiresAt`; no per-Staff rotation or Kitchen scanner.
- Staff resolves only the authenticated own registration with fresh foreground
  GPS, then confirms with a second fresh foreground GPS sample.
- Exact safe errors cover invalid/inactive QR/session, missing/canceled/already
  checked-in registration, window/location mismatch and GPS failures.
- Confirm is transactional and idempotent; concurrent/retried requests create
  at most one unique `MealServing.registrationId` outcome and return
  `CHECKED_IN` on success.
- `GET /api/me/check-in` reconciles lost responses; no local success is shown
  before server confirmation.
- Kitchen dashboard is aggregate-only and normally converges by
  focused/foreground 10-second polling within approximately 15 seconds; on
  refresh failure, retain the last good snapshot indefinitely with a stale
  indicator. No SSE/WebSocket or employee-level log is required.
- OTP/session/GPS evidence is minimized, access-controlled and audited; residual
  screenshot, compromised-device and GPS-spoofing risks are reduced, not removed.
- Weekly registration, menu, notification, no-show, backup/restore and
  migration/startup verification remain covered by their owning suites.
