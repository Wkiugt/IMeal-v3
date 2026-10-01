# IMeal v2 — Backend Structure

## 1. Backend overview

IMeal v2 dùng backend server-authoritative:

- Allowlist-A email OTP is the sole production authentication method.
- NestJS consumes/atomically verifies OTP challenges and resolves opaque
  PostgreSQL-backed sessions before enforcing business rules.
- PostgreSQL is the source of truth for identity, allowlist, account status,
  authorization, roster/location, registration and serving data.
- Mobile/Admin Web never write the database directly; serving/check-in mutations
  go through the authenticated Kitchen API path.
- WebSocket/SSE phục vụ realtime dashboard sau database commit.

```mermaid
flowchart TB
    MOB[Mobile]
    ADM[Admin Web]
    RP[Reverse Proxy]
    API[NestJS API]
    PG[(PostgreSQL)]
    OTP[OTP delivery outbox/provider]
    JOB[Worker/Cron]
    PUSH[Notification Provider]

    MOB -->|HTTPS + opaque session| RP
    ADM -->|HTTPS + opaque session| RP
    RP --> API
    API --> PG
    API --> OTP
    JOB -->|outbox/session-aware worker| PG
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
| `pickup_delegations`            | A→B receive-on-behalf authorization                                       |
| `pickup_sessions`               | Exact QR intent, presenter/GPS verification and 30-second session         |
| `serving_verifications`         | Safe presenter GPS verification result; no raw coordinate history         |
| `serving_confirm_requests`      | Request-level idempotency and result for batch confirm                    |
| `meal_servings`                 | Immutable final serving; at most one per registration                     |
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
    REGISTRATION ||--o{ PICKUP_DELEGATION : delegates
    PICKUP_SESSION ||--o{ SERVING_CONFIRM_REQUEST : confirms
    PICKUP_SESSION ||--o{ SERVING_VERIFICATION : verifies
    SERVING_CONFIRM_REQUEST ||--o{ MEAL_SERVING : creates
    USER ||--o{ PICKUP_DELEGATION : delegate
    REGISTRATION ||--o| MEAL_SERVING : served_by
    USER ||--o{ MEAL_SERVING : receiver
    USER ||--o{ MEAL_SERVING : kitchen_actor
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

`staff` and `kitchen` are independent. Assigning `kitchen` never grants Staff registration/QR/delegation capabilities; a Kitchen employee who also eats must hold both roles.

### 5.1 Account disable transaction

1. Preview active roles plus every unserved registration and active delegation
   from the current business date onward.
2. Admin confirms the named account and affected commitment count.
3. In one transaction, lock the user/registration/delegation/session rows, set
   `users.status=disabled`, revoke every active `auth_session`, cancel each
   affected registration with `cancel_reason=account_disabled`, revoke
   `pending|accepted` delegations, and insert audit/notifications.
4. Already served rows remain historical and are not rewritten.
5. `account_disabled` cancellations are excluded from Kitchen preparation/dashboard totals and no-show/penalty selection.
6. If the preview became stale, return a conflict with a refreshed preview; never apply a partial cleanup.

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

Presenter GPS is an additional serving-time signal only. The API evaluates a
fresh foreground presenter fix against the effective policy and persists only
safe verification result, timestamp, accuracy and location ID. It does not
collect owner GPS for proxy pickup. GPS failure returns only safe `Retry` or
`Refresh`; Kitchen sends no GPS.

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
For future `ACTIVE` rows, rollout eligibility is the same complete snapshot
predicate used by pickup: required text is non-null and non-blank after
trimming; `registered_at`, location effective/snapshot timestamps and all
location/assignment references are valid; the immutable revision belongs to
the same menu date; `menu_name_snapshot` equals the exact verified stored
revision name (after non-blank validation, without silently trimming or
accepting a mismatch); and nullable description/image snapshots use
`IS NOT DISTINCT FROM` equality
with the immutable revision. Any mismatch remains a reported remediation or
quarantine row and does not weaken pickup's fail-closed behavior.

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
Final serving/no-show history is never rewritten. An `ACTIVE` meal-choice
update preserves its existing immutable snapshots; reactivation resolves and
records a new lifecycle snapshot.

Legacy rows with incomplete snapshots cannot be made pickup-eligible:
registration reactivation/update fails with `REGISTRATION_FAILED`, pickup
options/resolve/confirm fail with `PICKUP_INTENT_CONFLICT`, and no current
location/menu/name/address value is substituted. A state-valid row remains in
dashboard totals so historical counts are not silently understated.

One API request captures server time once, resolves the effective roster
assignment/location and verified menu revision in each transaction, writes all
snapshots atomically, and returns per-date results. Cancellation locks the
registration, revokes `PENDING|ACCEPTED` delegations, and writes audit and
notifications in the same transaction.

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

`canActivate` is the only action that requires current published-menu and
effective-location authority. `canCancel` and `canChangeMealChoice` operate
on the existing registration lifecycle and remain available for complete
historical rows even when current menu or roster authority is unavailable.
Any linked `meal_servings` row is projected as `SERVED` (including legacy
`ACTIVE + meal_serving` rows), while finalized serving/no-show/penalty history
blocks lifecycle mutations. The reason arrays are machine-readable contract
values (`HOLIDAY`, `DISABLED`, `NO_PUBLISHED_MENU`, `LOCATION_UNAVAILABLE`,
`LOCATION_AMBIGUOUS`, `CUTOFF_PASSED`, `REGISTRATION_FINALIZED`,
`ALREADY_ACTIVE`, `NOT_ACTIVE`, and `NO_ALTERNATIVE_MEAL_CHOICE`).

## 9. `pickup_delegations`

```text
id                  UUID PK
registration_id     UUID FK
owner_user_id       UUID FK
 delegate_user_id   UUID FK
status              pending | accepted | declined | revoked | consumed | expired
requested_at        timestamptz
responded_at        timestamptz NULL
accepted_at         timestamptz NULL
revoked_at          timestamptz NULL
consumed_at         timestamptz NULL
expired_at          timestamptz NULL
updated_at          timestamptz
```

Application/database constraints:

- `owner_user_id` must equal registration owner.
- owner != delegate.
- At most one `pending|accepted` delegation per registration.
- No delegation after serving.
- Delegate must be active user.
- Delegate cannot re-delegate because delegation API only allows registration owner to create.

A partial unique index enforces one active delegation per registration.

`active delegation` means `pending|accepted`. Registration cancellation atomically transitions it to `revoked`; cancel/accept/revoke/serve races lock the same registration/delegation rows and return a canonical conflict to the losing transaction.

## 10. Dynamic QR, presenter GPS and pickup session

### 10.1 QR and exact pickup intent

QR identifies the presenter and a short-lived exact pickup intent, not a new
entitlement:

```text
imeal:v2:{presenterUserId}:{mealDate}:{sortedRegistrationIds}:{exp}:{nonce}:{sig}
```

`GET /me/pickup-options` returns the presenter's eligible own/delegated items.
Exactly one item is auto-selected; multiple items require explicit selection on
the presenter device. `POST /me/qr` accepts only a sorted, unique, non-empty set
plus fresh presenter evidence and signs that exact set.

- TTL is exactly 5 seconds; accepted clock skew is at most 2 seconds.
- Refresh repeats the same exact set only after a fresh foreground presenter fix.
- Selection, focus, eligibility, delegation or GPS-state changes clear the QR.
- Wrong date, malformed order, invalid signature, expired/future-abnormal expiry
  and stale/ineligible intent are rejected without replacement.

### 10.2 Presenter-only GPS verification

The server resolves the employee's fixed effective roster location and policy.
Only a foreground presenter fix is evaluated for freshness, accuracy and
geofence. The result stores location ID, safe result, verification timestamp
and accuracy; raw coordinates are not retained as history. Owner GPS is never
collected merely because a delegation exists. Kitchen resolve/confirm sends no
GPS.

Unavailable, denied, stale, inaccurate and outside-geofence outcomes expose only
safe `Retry`/`Refresh` recovery. GPS never grants entitlement, chooses a site or
bypasses session, QR, delegation, registration, window or concurrency checks.

### 10.3 Pickup session

Because Kitchen confirmation may take longer than 5 seconds, resolve creates an
opaque 30-second session:

```text
pickup_session
  id, presenter_user_id, meal_date
  exact_sorted_registration_ids, intent_hash, qr_nonce
  serving_verification_id, location_id, issued_at, expires_at
```

Resolve accepts only QR plus an authenticated Kitchen session. It revalidates
the exact set and stores immutable presenter/location/verification context.
Confirm accepts only `pickupSessionId` and an idempotency key; Kitchen cannot
re-select, add or remove registrations. Confirm re-queries current database
state and fails the entire batch if any item, delegation, account, location,
verification, serving-window or session condition changed.

## 11. `meal_servings`

### 11.1 `serving_confirm_requests`

One pickup confirm request may create multiple serving rows, so idempotency is stored once at request level:

```text
id                    UUID PK
caller_user_id        UUID FK
idempotency_key       UUID/string
request_hash          text
status                processing | succeeded | rejected
result_payload        jsonb NULL
locked_until          timestamptz
created_at
finished_at           timestamptz NULL

UNIQUE(caller_user_id, idempotency_key)
```

Claim workflow:

1. In a short transaction, insert or lock by `(caller_user_id, idempotency_key)` and compare `request_hash`.
2. Existing `succeeded|rejected` returns `result_payload`; another hash returns `IDEMPOTENCY_CONFLICT`.
3. Existing unexpired `processing` returns retryable `REQUEST_IN_PROGRESS`; an expired lease may be recovered by the worker/API instance.
4. Main transaction locks the claim and all domain rows, validates every item, then either inserts every serving and updates claim to `succeeded`, or inserts zero servings and updates claim to deterministic `rejected`; result and domain writes commit atomically.
5. Transient infrastructure failure rolls back the main transaction, leaving the prior `processing` lease to expire/recover; it is not persisted as a deterministic domain rejection.

### 11.2 `meal_servings`

```text
id                       UUID PK
registration_id          UUID FK UNIQUE
owner_user_id            UUID NULL FK
owner_email_snapshot     text NULL
owner_name_snapshot      text NULL
presenter_user_id        UUID NULL FK
receiver_type            SELF | PROXY NULL
kitchen_user_id          UUID NULL FK
kitchen_permission_context text NULL
scanner_device_id        text NULL
location_id              UUID NULL FK
location_short_code      text NULL
location_name_snapshot   text NULL
location_address_snapshot text NULL
meal_date                date NULL
menu_revision_id         UUID NULL FK
menu_name_snapshot       text NULL
menu_description_snapshot text NULL
menu_image_snapshot      text NULL
request_id               text NULL
pickup_session_id        UUID NULL FK
intent_hash              text NULL
verification_outcome     text NULL
serving_verification_id  UUID NULL FK
delegation_id            UUID NULL UNIQUE FK
served_at                timestamptz NOT NULL DEFAULT now()

UNIQUE(registration_id)
```

New serving writes copy the registration's immutable owner, employee,
location and menu snapshots plus serving/session/verification context in the
same transaction. They leave registration status `ACTIVE`; a valid
`meal_servings` row is the canonical served projection. Nullable fields above
retain legacy read compatibility and do not authorize current-value fallback.
Serving is immutable evidence; raw coordinates, OTP values, session tokens and
QR payloads are not included in normal logs or operational dashboards.

## 12. Serving transaction

Pseudo-flow:

```text
BEGIN
  lock serving_confirm_request by caller + idempotency key
  compare request hash; replay same result or return IDEMPOTENCY_CONFLICT
  lock pickup session and exact registration/delegation rows in deterministic order
  verify session TTL, exact intent hash/nonce, presenter verification and location
  verify current actor/account permissions and 10:30–13:30 serving window
  verify every registration remains eligible and has no serving
  if any deterministic conflict:
      roll back request claim and every serving/delegation write
      return PICKUP_INTENT_CONFLICT; client must resolve again
  insert every meal_serving with owner/receiver/Kitchen/location snapshots
  insert immutable SERVED meal_events
  mark accepted proxy delegations consumed
  update request = succeeded + result
COMMIT
```

The batch is all-or-nothing. A stale/ineligible item rolls back the request
claim, all serving/delegation writes, and returns `PICKUP_INTENT_CONFLICT`;
Kitchen must resolve again. Successful serving is final, and only the same
idempotency key/body for a committed success returns the stored result without
a duplicate serving. Realtime events are published only after commit.

## 13. Concurrency cases

### 13.1 Two Kitchen devices same registration

```text
Device A ─┐
          ├─ row lock + UNIQUE final serving
Device B ─┘
```

Exactly one inserts. The other returns `ALREADY_SERVED` with existing serving metadata.

### 13.2 Owner and delegate at different counters

Both target the same registration. Same lock/unique rule → exactly one receives the serving.

### 13.3 Revoke vs proxy serve

- Revoke locks/updates accepted delegation.
- Serving locks registration/delegation and revalidates.
- Whichever valid transaction commits first determines outcome; the second returns a conflict state.

### 13.4 Client retry after lost response

Same `idempotency_key` returns/recovers original result, not a duplicate serving.

## 14. `meal_events`

Immutable ledger:

```text
id                  UUID PK
registration_id     UUID FK
meal_date           date
event_type          SERVED | SERVED_PROXY | NO_SHOW | ...
owner_user_id       UUID FK
receiver_user_id    UUID FK NULL
actor_user_id       UUID FK NULL
source              text
metadata             jsonb
created_at           timestamptz
```

Never update/delete historical events during normal operations. Meal lifecycle/audit history is retained for **1 year**, after which the retention process may purge expired rows in dependency-safe order.

## 15. Kitchen dashboard queries

For meal date `D`, load one consistent registration set with
`status IN (ACTIVE, SERVED, NO_SHOW)` plus `CANCELLED` rows carrying a serving
only long enough to detect the forbidden invariant. Then validate
`registration_serving_consistency` before excluding cancelled and
`ACCOUNT_DISABLED` rows from the projection.

```text
totalRegistered = valid ACTIVE rows (pending or served)
                  + valid legacy SERVED rows with a serving
                  + NO_SHOW rows without a serving
servedTotal     = rows with a meal_serving
remaining       = pending.length
noShowTotal     = NO_SHOW rows without a meal_serving
pending         = ACTIVE and no meal_serving
served          = any row with a meal_serving
noShow          = NO_SHOW and no meal_serving
all             = pending ∪ served ∪ noShow, once each, deterministic order
regularTotal + vegetarianTotal = totalRegistered
```

`CANCELLED` and account-disabled rows are not counted or listed. A served row
must not disappear merely because it remains `ACTIVE` in storage. `SERVED`
without a serving, `NO_SHOW` with a serving, or `CANCELLED` with a serving
returns the generic `INTERNAL_SERVER_ERROR` envelope with a request ID and no
partial counters or sensitive row details; the operator diagnostic is
internal-only.

At 200–300 rows/day, PostgreSQL direct aggregate queries are sufficient. Do not
introduce denormalized counters unless profiling proves need.

Recommended indexes:

```text
registrations(meal_date, status)
meal_servings(registration_id)
meal_servings(served_at)
pickup_delegations(delegate_user_id, status)
pickup_delegations(registration_id, status)
```

## 16. Realtime architecture

- Initial GET returns the canonical snapshot and recent log.
- Kitchen clients subscribe to WebSocket/SSE by meal date.
- `SERVING_CONFIRMED` and `REGISTRATION_CHANGED` are emitted only after the
  committing transaction succeeds.
- No-show writes `NO_SHOW_RECONCILED` to the transactional `outbox_events`
  table with dedupe key `kitchen:no-show:{registrationId}`; a worker does not
  call the API's in-memory event service.
- Client reconnect fetches the snapshot again; DB state wins over
  missed/duplicated realtime messages.

For a single NestJS instance at baseline scale, no distributed broker is
required. Client realtime/reconnect implementation remains a separate scope
and is not claimed by this backend cutover.

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

Kinds are exactly `LEGACY_MESSAGE`, `REGISTRATION_OPENED`, `REGISTRATION_REMINDER`,
`PICKUP_REMINDER`, `DELEGATION_REQUESTED`, `DELEGATION_ACCEPTED`, `DELEGATION_DECLINED`,
`DELEGATION_REVOKED`, `PROXY_PICKUP_COMPLETED`, `REGISTERED_MENU_CHANGED`, and
`NO_SHOW_PENALTY_CREATED`. `LEGACY_MESSAGE` preserves migrated rows for read-only display;
new application publishers must not create it.

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
The reminder flag is one shared opt-out for weekly registration and same-day pickup
reminders, not for transactional event notification kinds.

### 18.2 Exact event matrix

| Kind                                          | Trigger/timing                                                                                                        | Recipient                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `REGISTRATION_OPENED`                         | First weekly-menu publish only; missing revisions initialized and `publishedAt` set. Repeat/concurrent publish no-op. | Every active Staff user, regardless of reminders.                                        |
| `REGISTRATION_REMINDER`                       | Sunday 10:00 `Asia/Ho_Chi_Minh`, next Monday-start published menu, one/user/week.                                     | Active Staff missing an enabled non-holiday `ACTIVE` registration and reminders enabled. |
| `PICKUP_REMINDER`                             | Daily 11:30 VN, today's `ACTIVE` unserved registrations.                                                              | Accepted delegate else owner; grouped by recipient/date, reminders enabled only.         |
| `DELEGATION_REQUESTED`                        | Pending request created.                                                                                              | Delegate.                                                                                |
| `DELEGATION_ACCEPTED` / `DELEGATION_DECLINED` | Delegate decision committed.                                                                                          | Registration owner.                                                                      |
| `DELEGATION_REVOKED`                          | Owner revoke or registration cancellation auto-revokes active delegation.                                             | Delegate; payload reason `OWNER_REVOKED` or `REGISTRATION_CANCELLED`.                    |
| `PROXY_PICKUP_COMPLETED`                      | Accepted delegated serving commits and pickup user differs from owner.                                                | Owner only; self pickup emits no item.                                                   |
| `REGISTERED_MENU_CHANGED`                     | Actual tracked edit to already-published menu date (content, meal type, holiday, enabled).                            | Active registrants of that date; no-op emits none.                                       |
| `NO_SHOW_PENALTY_CREATED`                     | No-show worker at 13:45 VN after service end 13:30.                                                                   | Registration owner.                                                                      |

First publish emits `REGISTRATION_OPENED`; an edit to an already-published registered date
emits `REGISTERED_MENU_CHANGED`, never another opened event. Admin account-disable
notification is future scope in the account-disable subsystem, not a dormant kind.

Payloads are strict and use UTC IDs/timestamps plus `YYYY-MM-DD` meal dates:
registration opened `{weekStart, weekEnd}`; registration reminder
`{weekStart, weekEnd, remainingMealDates}`; pickup reminder
`{mealDate, registrationIds, registrationCount}`; delegation lifecycle
`{delegationId, registrationId, mealDate, counterpartName}` plus revoked `reason`;
proxy completion `{servingId, registrationId, mealDate, delegateName}`; menu change
`{dailyMenuRevisionId, mealDate}`; no-show `{penaltyId, registrationId, mealDate, amount}`.
The pickup count equals the ID array length and revoked reason is enum constrained.

Owner-scoped API surface is `GET /api/notifications` (cursor/limit 1–50, default 20),
`GET /api/notifications/:id`, and `PATCH /api/notifications/:id/read`.
Preferences are `GET/PATCH /api/notifications/preferences`. Device registration is
`POST /api/notifications/push-devices` with `{ token, platform: ios|android }`; device
revocation is `DELETE /api/notifications/push-devices` with `{ token }` only.
Detail/read never cross user ownership; missing and foreign IDs use `NOTIFICATION_NOT_FOUND`.

### 18.3 Transactional publish and delivery

API publishers (menu, delegation, registration-cancellation, pickup) and worker publishers
(registration reminder, pickup reminder, no-show) render fixed bilingual copy and insert the
notification plus its `NOTIFICATION_CREATED` outbox row in the same transaction. Upsert by
global notification dedupe key is replay-safe and does not reset read/delivery state. Copy
dates use `Asia/Ho_Chi_Minh`; dispatch selects stored VI/EN copy from the owning user's
locale. Name fallback is name → email → neutral fallback; copy contains no QR/auth/session.

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
`imeal://notifications/<UUID>` and open owner-scoped detail; registration/menu → Calendar,
pickup reminder → Pickup Intent, delegation → Delegation, while proxy-completion, no-show,
and legacy items remain readable with no CTA.

## 19. `job_runs`

```text
id            UUID PK
type          menu_lock | delegation_expiry | no_show | notification_dispatch | reconcile | ...
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
- Serving owns actual handover evidence, presenter/receiver, Kitchen actor,
  delegation, exact intent/session, location and safe verification snapshots.
- Daily menu owns meal description for future dates; meal-day snapshot preserves historical display.
- Delegation owns authorization to receive on behalf of owner.
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
- Kitchen can serve only with an active opaque session, `kitchen.serve`
  permission and all server-side pickup validation. Kitchen sends no GPS.
- Public callers cannot create accepted delegation on behalf of B; B must accept.
- Owner cannot delegate someone else's registration; no self-delegation, chain or
  delegate re-delegation.
- QR signature/expiry, exact sorted intent, 2-second skew and 30-second session
  are verified server-side.
- Presenter GPS is foreground-only and additional. It cannot grant entitlement,
  select a different location or bypass authentication, authorization,
  registration, delegation, window or concurrency checks.
- GPS failure exposes only safe Retry/Refresh. Raw coordinates and clear OTP,
  session, QR or provider payloads never appear in routine logs.
- Incomplete legacy snapshots fail closed for registration reactivation/update
  and pickup/serving; no current location/menu fallback exists. A state-valid
  incomplete row remains visible to dashboard accounting rather than being
  silently dropped.
- `SERVED` without a serving, `NO_SHOW` with a serving, and `CANCELLED` with a
  serving fail closed under `registration_serving_consistency`; no automatic
  repair is allowed.
- Multi-item serving never partially commits; successful confirm is final and no
  reversal endpoint exists. Same idempotency key/body cannot double-serve.
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
- Presenter-only foreground GPS is evaluated at QR generate/refresh; owner GPS is
  not collected for proxy pickup; Kitchen resolve/confirm sends no GPS.
- GPS failures expose only Retry/Refresh. QR exact sorted intent, TTL 5, skew 2,
  resolved session 30 and 10:30–13:30 serving window are server-enforced.
- Stale/ineligible intent rejects without substitution; confirm cannot alter the
  resolved set. Delegation acceptance/no-chain/no-self and revoke/serve races are
  deterministic.
- Multi-item confirm is atomic and idempotent; duplicate/concurrent retry cannot
  double-serve. Successful serving is final and immutable.
- OTP/session/GPS evidence is minimized, access-controlled and audited; residual
  screenshot, compromised-device and GPS-spoofing risks are reduced, not removed.
- Weekly registration, menu, notification, no-show, backup/restore and
  migration/startup verification remain covered by their owning suites.
