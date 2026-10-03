# IMeal v2 — Re-platforming and Execution Plan

**Goal:** Chuyển IMeal sang mobile-first Staff self check-in với email OTP,
PostgreSQL/NestJS và Linux self-host: Staff đăng ký tuần, quét một QR Kitchen
ổn định theo ngày/địa điểm, gửi GPS foreground mới để resolve rồi xác nhận
chính đăng ký của mình bằng GPS mới lần hai; Kitchen chỉ hiển thị QR chung và
dashboard aggregate. Các bảng pickup/delegation lịch sử được giữ để tương
thích, không còn là flow active.

## Global constraints

- Scale baseline: 200–300 users.
- Business timezone: `Asia/Ho_Chi_Minh`.
- Week starts Monday; default service dates Monday–Friday.
- Cutoff mutation requires server time `< 14:00` ngày trước từng meal date; exactly 14:00 is locked.
- Serving window 10:30–13:30; no-show processing starts 13:45.
- One fixed meal per meal date, managed by Kitchen weekly.
- Production authentication is allowlist-A email OTP only; verification creates
  an opaque PostgreSQL-backed session and never auto-provisions a privileged
  role.
- Kitchen/Admin role manually assigned.
- Shared Kitchen QR is stable for one active day/location session; current
  Staff self check-in requires a fresh foreground GPS sample at resolve and a
  second fresh sample at confirm.
- `MealServing.registrationId` is unique canonical outcome; confirm is
  authenticated, own-user-only, transactional and idempotent.
- Kitchen dashboard is aggregate-only, polls every 10 seconds only while
  focused/foregrounded, normally converges within approximately 15 seconds
  under healthy polling, and on refresh failure retains the last good snapshot
  indefinitely with a stale indicator; no SSE/WebSocket dependency.
- No mandatory check-out in core v2.
- PostgreSQL is business source of truth; mobile never writes DB directly.
- Every no-show creates one 50,000 VND penalty; exceptions use audited waive.
- Clean slate: Firebase contains demo-pitching data only and is deleted/decommissioned at re-development kickoff; do not migrate, retain for v2, map, reconcile, dual-write or roll data back to Firebase.
- Meal lifecycle/business audit history retention is 1 year.
- Persisted notification inbox is mandatory; Expo Push is the default delivery provider.
- Staff reviews and confirms only the authenticated caller's own registration;
  current flow has no multi-item pickup intent or active proxy/delegation.

---

## 1. Delivery strategy

| Phase                                                                                          | Deliverable                                                           | Priority        |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------- |
| 0                                                                                              | Verify canonical policy + organization/OTP/provider/network ownership | P0              |
| 1                                                                                              | Repository/tooling + Linux dev/staging foundation                     | P0              |
| 2                                                                                              | PostgreSQL schema + domain/test safety net                            | P0              |
| 3                                                                                              | Allowlist-A email OTP + opaque sessions/RBAC                          | P0              |
| 4                                                                                              | Weekly menu + weekly registration                                     | P0              |
| 5                                                                                              | Historical delegation compatibility + current notifications            | P0              |
| 6                                                                                              | Staff self check-in + Kitchen shared QR/aggregate dashboard            | P0              |
| 7                                                                                              | No-show/penalty/admin/audit/jobs                                      | P0/P1           |
| 8                                                                                              | Clean-slate qualification + security/load/UAT                         | P0 release gate |
| 9                                                                                              | Production rollout + mobile distribution + operations                 | P0 release gate |
| Phases should be independently reviewable. No production rollout before Phase 8 exit criteria. |

---

# Phase 0 — Verify canonical policy and organizational prerequisites

## Task 0.1 — Verify canonical policy package

- [ ] Product/API/backend/UX docs agree on Monday week, cutoff, 10:30–13:30
      serving, 13:45 no-show and the Staff self check-in contract.
- [ ] One stable day/location Kitchen QR, Staff fresh GPS at resolve and a
      second fresh GPS at confirm are represented in contracts/tests.
- [ ] Own-user-only resolve/confirm, no manual-code recovery/bypass, unique
      `MealServing.registrationId` and idempotent final serving are consistent;
      no Kitchen employee scanner or active delegation flow remains.
- [ ] Persisted inbox + Expo Push, 50,000 VND penalty, 1-year history retention and permission model represented consistently.
- [ ] Firebase removal-at-redevelopment-start/no-migration policy appears in technical/backend/rollout sections.

## Task 0.2 — OTP/provider/organization prerequisites

Coordinate with the organization owner for allowlist-A provisioning and the
approved OTP provider. No federated identity provider, tenant/client/redirect
registration or local production login is part of the current contract:

- [ ] Approve the source and owner for exactly the active allowlist-A emails.
- [ ] Configure an HTTPS OTP provider URL, API key and sender identity outside
      source control.
- [ ] Confirm provider delivery, rate limits, expiry and support ownership.
- [ ] Record synthetic test addresses and role assignments without storing
      secrets or real employee data in docs.
- [ ] Approve the one-shot server-side first-Admin provisioning operation and
      its audit owner.

**Exit:** allowlist-A data, provider settings, role assignments and opaque
session behavior are provisioned and documented without secrets; staging OTP
request/verify is exercised at the authentication exit.

## Task 0.3 — Network/DNS/TLS topology

- [ ] Define public API hostname for Staff and Kitchen features.
- [ ] Configure HTTPS certificate trusted by target iOS/Android devices.
- [ ] Deny public/general LAN access to PostgreSQL port.
- [ ] Allow API outbound HTTPS to the approved OTP provider and chosen
      push/image providers.

**Exit:** HTTPS API reachability, authentication/permission boundaries and PostgreSQL isolation are documented and testable.

## Task 0.4 — Retire Firebase legacy at re-development kickoff

- [ ] Delete/decommission Firebase Auth/Firestore/Cloud Functions/Vercel Cron demo resources and remove their dependencies from the repository/runtime path.
- [ ] No Firebase export/import, UID mapping, dual-write or rollback mechanism is created.
- [ ] Legacy Firebase business data is not retained for v2; PostgreSQL is used from the first v2 development environment onward.
- [ ] Revoke/close obsolete Firebase runtime credentials/resources according to IEC account ownership.

**Exit:** developers cannot accidentally depend on Firebase for v2 behavior or data.

## Phase 0 Workstream A rollout gate — Task 9 evidence (2026-09-28)

This gate is explicitly **NOT COMPLETE / NO-GO**. It records local/disposable
evidence only and does not close the staging, production, mobile-release,
security, backup/restore or focused/foreground aggregate dashboard polling gates.

- [x] Fresh Step 2 expand at HEAD `75a9d719deb511503dfc55a11b52a81ab6d049a6`:
      `DATABASE_URL='postgresql://postgres:postgres@localhost:5432/imeal?schema=phase0_step2_20260928131738' yarn workspace @imeal/core exec prisma migrate deploy`
      applied all eight checked-in migrations. `prisma generate` and
      `prisma validate` passed; post-expand registrations, daily menu revisions,
      meal days, meal servings and penalties were all zero.
- [x] Read-only preflight (clean result; approval not evidenced): the
      target-safe wrapper asserted `current_schema()` for
      `phase0_step2_20260928131738`, passed `-v ON_ERROR_STOP=1`, and ran current
      `preflight.sql`. All seven named checks and all four status counts were zero.
- [x] Exact backfill after the clean local preflight (no independent approval
      evidence): the target-safe current `backfill.sql` wrapper ran twice; both
      runs returned `UPDATE 0`, `DO`, `UPDATE 0`, `UPDATE 0`, `COMMIT`.
- [x] Post-backfill validation: target-safe preflight remained all-zero; both
      `registration_lifecycle_snapshot_complete` and
      `registration_serving_consistency` returned `convalidated=true`.
- [x] Classification evidence: disposable schema
      `phase0_step2_classification_20260928131738` returned
      `roster_assignment_ambiguous=1` for
      `registration-step2-invalid-location` and
      `future_active_snapshot_incomplete=1` for
      `registration-step2-stale-menu`; the other five checks were zero. No
      backfill or validation was run because named checks were nonzero.
- [x] Fresh disposable sequence is GREEN; release status remains
      **CONDITIONAL / NO-GO** because no approved staging/representative target,
      independent approval, backup/restore rehearsal or production evidence exists.
- [x] Fresh Step 1 verification at HEAD `75a9d71` supersedes the historical
      pre-75 failures: core focused 42/42; core full 93/93 with the intentional
      serial `--maxWorkers 1` caveat; API e2e 45/45 plus production concurrency
      12/12; worker e2e 5/5; `yarn typecheck` and mobile tsc passed after
      `yarn install --immutable`.
- [x] Historical pre-75 failure and blocked-typecheck results remain retained
      in the Task 9 report for audit history and are not current status.
- [ ] Staging approval: no staging target or ambient `DATABASE_URL` was available. Previously observed local public evidence (not rerun or modified during fresh Step 2) remains dirty (132 incomplete snapshots under the conservative operational scope, 6 ambiguous/effectively invalid roster assignments, 132 incomplete menu revisions, 40 incomplete future ACTIVE rows); no backfill or validation was run there.

**Cutover order:** expand additive schema → target-safe read-only preflight →
independent approval record → exact deterministic backfill → target-safe
post-backfill preflight → validate named checks → focused/full verification →
application cutover. Approval is not inferred from a zero-row result.

Abort before backfill on any nonzero operational check, mismatch, ambiguity,
invalid effective location, invalid revision, duplicate penalty candidate,
migration failure or missing approval. If backfill completes and post-backfill
preflight is nonzero, named validation fails, or focused verification fails,
cutover remains blocked: quarantine/remediate exact rows, or restore the
approved backup under the named rollback authority and decision window recorded
for that target. The additive schema may be retained for diagnosis or the
disposable schema discarded; there is no destructive down migration or Firebase
rollback path.

Evidence links: [`task-9-brief.md`](../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-9-brief.md) and [`task-9-report.md`](../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-9-report.md). No external approval/audit artifact or checksum was observed.

The required runtime `DATABASE_URL`, OTP/session/provider/GPS/serving
configuration and secret provisioning remain governed by
`docs/02-technical-requirements.md §8.2` and `.env.example`; no secret,
staging, backup/restore or production result is inferred from this local run.

---

# Phase 1 — Repository and Linux foundation

## Task 1.1 — Create v2 workspace

Recommended:

```text
apps/mobile
apps/api
apps/admin-web
apps/worker
packages/contracts
packages/domain
infra/
```

- [ ] Configure TypeScript strict.
- [ ] Configure lint/format/test.
- [ ] Add environment validation.
- [ ] Add CI with clean install, lint, unit/integration/build.
- [ ] Prevent secrets from repository.

## Task 1.2 — Local Docker Compose

- [ ] PostgreSQL + PgBouncer.
- [ ] NestJS API (configured with Fastify Adapter).
- [ ] Worker process.
- [ ] Reverse proxy for local/staging parity where feasible.
- [ ] File/object storage adapter for optional menu images; database stores metadata/URL only.
- [ ] Health checks and restart policy.

## Task 1.3 — Staging Linux baseline

Recommended production-like staging:

```text
4 vCPU
8 GB RAM
100 GB SSD
Linux LTS
Docker Compose
```

- [ ] Create separate staging DB/credentials.
- [ ] Configure centralized logs/monitoring for API, worker/jobs and PostgreSQL; monitoring is mandatory, destination/retention can be finalized later.
- [ ] Configure backup target separate from primary disk.
- [ ] Run backup + restore rehearsal early.

## Task 1.4 — Shared contract foundation

- [ ] Versioned DTO/schema package consumed by mobile/Admin/API/worker.
- [ ] Success/error envelopes, stable error-code registry and cursor pagination.
- [ ] `X-Request-Id`, idempotency keys and aggregate dashboard snapshot
      envelope (`lastUpdated`, stale recovery); no SSE/WebSocket contract.
- [ ] Contract tests run in CI for every consumer.
- [ ] Requirement ID → task → test/evidence → approver matrix initialized.

**Exit Phase 1:** developer can boot API/DB locally and deploy staging without Firebase.

---

# Phase 2 — PostgreSQL schema and automated safety net

## Task 2.1 — Create core migrations

Create canonical tables:

- [ ] users/roles/user_roles/permissions/role_permissions/user_permissions.
- [ ] weekly_menus/daily_menus/daily_menu_revisions/meal_days.
- [ ] registrations and additive `check_in_sessions`.
- [ ] historical `pickup_delegations`/pickup context retained for compatibility.
- [ ] `meal_servings`/`meal_events` and idempotency claims.
- [ ] penalties.
- [ ] notifications (mandatory) and push_devices.
- [ ] job_runs/audit_logs.

Add constraints:

- [ ] `UNIQUE(user_id, meal_date)` registration.
- [ ] one daily menu per meal date.
- [ ] daily-menu check constraint represents enabled date with meal vs explicit disabled holiday without fake meal.
- [ ] `UNIQUE(registration_id)` final serving; no reversal/re-serve state.
- [ ] `UNIQUE(caller_user_id, idempotency_key)` request-level check-in confirm
      result.
- [ ] historical delegation rows remain linkable/readable but do not authorize
      current check-in.
- [ ] foreign keys and required indexes.

## Task 2.2 — Domain tests

- [ ] Cutoff before/at/after 14:00 VN.
- [ ] Registration transitions.
- [ ] Menu week/date rules.
- [ ] Canceled registration keeps immutable menu revision; active registration follows approved pre-cutoff revision.
- [ ] Staff own-user eligibility and current status/resolve/confirm boundaries.
- [ ] Check-in GPS freshness/accuracy/geofence and service-window errors.
- [ ] No-show/penalty idempotency.
- [ ] Exact 14:00, 10:30, 13:30, 13:45 boundaries.
- [ ] Cancel registration/account-disable cleanup preserves historical rows
      without making them current check-in eligible.
- [ ] Final serving and idempotent single-registration confirm.

## Task 2.3 — Database concurrency tests

- [ ] Concurrent register same user/date → one row.
- [ ] Concurrent confirms for one own registration → one serving.
- [ ] Wrong caller cannot resolve/confirm another user's registration.
- [ ] Resolve does not consume; retry same idempotency key replays result.
- [ ] Fresh GPS is required on both resolve and confirm.
- [ ] Successful confirm is immutable/final; duplicate or retry creates no second serving.

**Exit Phase 2:** DB invariants protect P0 correctness independent of UI.

---

# Phase 3 — Allowlist-A email OTP authentication and RBAC

## Task 3.1 — Mobile email OTP flow

- [ ] Request OTP with generic non-disclosure response for allowlisted,
      unknown and disabled addresses.
- [ ] Show OTP verification, expiry, attempt-limit, resend and provider-error
      states without revealing account existence.
- [ ] Store only the opaque session token in platform secure storage; never
      store an OTP or provider secret in the client.
- [ ] Handle logout, expiry, account disable, revocation and cold deep links.

## Task 3.2 — API OTP/session validation

- [ ] Normalize and resolve only administrator-provisioned allowlist-A emails.
- [ ] Hash OTPs; enforce single-use, expiry, attempt and address/client limits.
- [ ] Hash opaque sessions; enforce idle and absolute lifetimes.
- [ ] Re-resolve account status and permissions on every protected request.
- [ ] Return structured auth error codes without account enumeration.

## Task 3.3 — Account and roster provisioning

- [ ] Do not auto-provision accounts or privileged roles from login.
- [ ] Provision allowlist records, account status, roles and roster/location
      assignments through audited server-side/Admin operations.
- [ ] Disabled users receive `ACCOUNT_DISABLED`; active sessions are revoked.
- [ ] Keep role claims server-side; client requests never choose a role.

## Task 3.4 — Admin Web Staff/Kitchen role management

- [ ] Manage/grant/revoke `staff` and Kitchen in Admin Web.
- [ ] Admin Web exposes **no grant/revoke Admin action or endpoint**.
- [ ] Audit actor/time.
- [ ] Protect against unauthorized escalation.
- [ ] Admin-role lifecycle remains a separate audited server-side operation, not
      an Admin Web capability.
- [ ] Assign/revoke `penalty.read`, `penalty.resolve`.
- [ ] Seed canonical Admin role permissions; authorization still checks
      permission, never Admin bypass.
- [ ] Admin role alone does not grant Kitchen serving.
- [ ] Kitchen role does not grant Staff self check-in or own-registration
      mutation; dual-role users require explicit `staff + kitchen` where both
      surfaces are needed. No delegation permission is active.

## Task 3.5 — Admin bootstrap / server-side Admin lifecycle

- [ ] First Admin provisioning accepts an approved allowlist record and explicit
      server-side ownership; no email-domain matching.
- [ ] Admin-role creation/removal is unavailable from Admin Web.
- [ ] Refuses unsafe reuse unless an approved server-side recovery procedure is
      invoked.
- [ ] Records actor/time/request evidence without secrets.
- [ ] Exact IEC approval/ownership process may be filled after the responsible
      administrators are identified; do not hard-code an unverified two-person rule.

**Exit Phase 3:** synthetic staging addresses complete request/verify/logout
against the OTP provider; opaque sessions and PostgreSQL RBAC answer
authorization.

---

# Phase 4 — Weekly menu and registration

## Task 4.1 — Kitchen weekly menu API

- [ ] Create/edit weekly draft.
- [ ] One fixed meal per date.
- [ ] Optional description/image metadata.
- [ ] Publish menu on the preceding Saturday–Sunday; first publish creates immutable revision 1 transactionally.
- [ ] Monday-start service dates and explicit holiday disable.
- [ ] Pre-cutoff published revision preserves registrations and creates persisted notifications in the same transaction.
- [ ] Prevent unpublish/delete when active registrations exist.
- [ ] Lock/snapshot day at exactly 14:00 via idempotent worker.
- [ ] Audit Kitchen edits/publish.

## Task 4.2 — Kitchen menu UI

- [ ] Week navigation.
- [ ] One editor per day.
- [ ] Draft/published state.
- [ ] Image upload progress/error/retry; image field itself remains optional.
- [ ] Locked day read-only.

## Task 4.3 — Staff weekly registration API

- [ ] GET week returns published menus + own registered/editable state (Requires Traffic smoothing / caching with jitter).
- [ ] PUT batch tick/untick (Requires Eventual Consistency / Outbox pattern for partial success).
- [ ] Server-authoritative cutoff (Requires Optimistic Concurrency Control).
- [ ] Feature: Document/Application workflow to allow admins to change the cutoff time.
- [ ] Enforce strict "UTC everywhere" for `mealDate` and DB timestamps.
- [ ] Unique constraint protects duplicate, backed by a Composite Index `@@index([userId, mealDate])`.
- [ ] Cancel atomically marks the registration canceled and quarantines any
      retained historical delegation row with notifications/audit; it never
      grants current check-in eligibility.

## Task 4.4 — Staff weekly mobile UI

- [ ] Day cards with checkbox.
- [ ] `Chọn cả tuần` only editable days.
- [ ] Sticky save when draft exists.
- [ ] Partial failure retains failed draft.
- [ ] Mixed locked/editable week tested.

**Exit Phase 4:** Kitchen can publish one-meal-per-day menu and Staff can reliably register a week.

---

# Phase 5 — Historical delegation compatibility and notifications

The historical delegation/pickup schema and audit rows remain readable for
accounting and migration compatibility. They are not an active authorization,
mobile UI or Kitchen serving flow in the current cutover.

## Task 5.1 — Retain historical delegation data

- [ ] Preserve historical delegation/pickup tables, immutable rows and audit
      references during migration.
- [ ] Keep old records readable without exposing them as current
      check-in eligibility or dashboard counts.
- [ ] Ensure current status/resolve/confirm routes never accept a delegate,
      proxy, multi-registration intent or historical pickup session.

## Task 5.2 — Current owner notifications

- [ ] Persist menu-revision, cancellation, current Staff check-in reminder and
      no-show notifications in PostgreSQL.
- [ ] Read/unread support remains owner-scoped.
- [ ] Historical delegation/proxy notification rows remain readable but are not
      emitted by current check-in.
- [ ] Public cursor-paginated inbox API and owner-only mark-read API remain
      authorization-protected.

## Task 5.3 — Push transport

- [ ] Register device tokens.
- [ ] Use Expo Push as default provider.
- [ ] Retry safe failures and keep app correctness when push is not delivered.

**Exit Phase 5:** historical delegation data is retained/readable, while current
notifications are owner-scoped and no active delegation/proxy authorization or
UI remains.

---

# Phase 6 — Staff self check-in and Kitchen aggregate dashboard

## Task 6.1 — Stable Kitchen QR and Staff status

- [ ] `GET /api/kitchen/check-in/qr` requires authenticated
      `kitchen.serve`, resolves the caller's active location and lazily
      creates/reuses one stable day/location QR.
- [ ] QR contains no employee identity and does not rotate per Staff; server
      returns `date`, `location`, `activeFrom` and `expiresAt`.
- [ ] `GET /api/me/check-in` returns authoritative own-user status and action
      flags for reconciliation.
- [ ] No Kitchen employee scanner/search/list or Staff-generated QR remains.

## Task 6.2 — Staff resolve API

- [ ] `POST /api/me/check-in/resolve` accepts only the shared QR and a fresh
      foreground GPS sample `{ capturedAt, latitude, longitude, accuracyMeters }`.
- [ ] When eligible, persist a `VALID` `ServingVerification` and return an
      opaque signed `intentNonce` scoped to caller, own registration, session
      and location; return nonce nullable when `eligibility=false`.
- [ ] Authenticate the caller and return only that caller's normalized
      employee/menu/location/registration/eligibility.
- [ ] Revalidate QR/session, active roster location, 10:30–13:30 window and
      GPS freshness/accuracy/geofence.
- [ ] Resolve creates no `MealServing` and no serving event.
- [ ] Cover `INVALID_QR`, `INACTIVE_CHECKIN_SESSION`, `NO_REGISTRATION`,
      `REGISTRATION_CANCELLED`, `OUTSIDE_CHECKIN_WINDOW`, `LOCATION_MISMATCH`,
      `GPS_REQUIRED`, `GPS_STALE`, `GPS_INACCURATE` and `OUTSIDE_GEOFENCE`.

## Task 6.3 — Staff confirm transaction

- [ ] `POST /api/me/check-in/confirm` accepts `sessionId`, non-empty
      `intentNonce`, `idempotencyKey` and a **new** fresh foreground GPS sample.
- [ ] Validate nonce scope against caller/session/own registration/location.
- [ ] Lock the idempotency claim, `CheckInSession` and caller-owned
      registration; replay same caller/key/body and reject a different body.
- [ ] Revalidate session/date/location/window, account, own registration and
      GPS policy transactionally.
- [ ] Insert one unique `MealServing` linked to the check-in session and one
      Staff-owned canonical event; return `CHECKED_IN`, IDs and `servedAt`.
- [ ] Concurrent/retried confirm creates at most one serving; successful
      confirm is final and has no reversal endpoint/UI.
- [ ] Raw latitude/longitude never enters logs or retained operational evidence;
      retain only safe verification result/context required by policy.

## Task 6.4 — Staff self check-in UI

- [ ] Staff scans the shared Kitchen QR, sees only own registration/menu/location,
      and explicitly taps Confirm after reviewing it.
- [ ] Capture fresh foreground GPS on resolve and again on confirm; stop
      collection on blur, background, completion, cancellation or unmount.
- [ ] Denial/stale/inaccurate/outside-geofence states offer Retry/Refresh only.
- [ ] Timeout/lost response retries the same idempotency key or reconciles via
      `GET /api/me/check-in`; never show local success first.
- [ ] Current UI has no delegation/proxy selection, multi-item intent,
      manual-code bypass or Kitchen employee resolve/confirm.

## Task 6.5 — Kitchen aggregate dashboard

- [ ] `GET /api/kitchen/check-in/dashboard?date=YYYY-MM-DD` returns only
      `date`, `location`, `window`, `lastUpdated` and aggregate
      `registered`, `checkedIn`, `pending`, `noShow`, `regular`,
      `vegetarian` counts.
- [ ] Poll every 10 seconds only while focused and foregrounded; refresh
      immediately on re-entry.
- [ ] On temporary failure retain the last good snapshot and mark it stale
      until successful refresh; never reset to zero/empty. Under healthy
      polling, the visible snapshot normally converges within approximately
      15 seconds.
- [ ] Enforce `checkedIn + pending + noShow = registered` and
      `regular + vegetarian = registered`; exclude canceled/disabled rows.
- [ ] No SSE/WebSocket dependency, per-person list, employee log or delegation
      detail; multiple Kitchen displays converge through fresh snapshots.

## Task 6.6 — Migration compatibility

- [ ] `MealServing.registrationId` remains the unique canonical serving source.
- [ ] Additive `CheckInSession` and safe verification metadata do not create a
      second outcome table.
- [ ] Historical pickup/delegation tables and audit rows remain retained/readable
      but no longer authorize current check-in.

**Exit Phase 6:** authenticated Staff can resolve and explicitly confirm only
their own registration with fresh GPS twice; concurrent/retried confirm creates
at most one final `MealServing`, and Kitchen sees aggregate snapshots through
focused/foreground 10-second polling with stale-snapshot recovery.

---

# Phase 7 — No-show, penalties, Admin and operations

## Task 7.1 — No-show worker

- [ ] Run from 13:45 after 13:30 service end.
- [ ] Select active registrations without valid serving.
- [ ] Re-check transactionally.
- [ ] Mark no-show.
- [ ] Create penalty idempotently.
- [ ] Create exactly one 50,000 VND penalty; never reopen paid/waived.
- [ ] Persist job run summary.

## Task 7.2 — Penalty Admin

- [ ] Filter/search/date range.
- [ ] paid/waived transitions.
- [ ] Waive reason required.
- [ ] Actor/time audit.
- [ ] Export if required.

## Task 7.3 — Audit views

- [ ] Historical delegation lifecycle and receiver references remain readable
      as audit data; current audit shows authenticated Staff check-in actor,
      registration and immutable serving ID.
- [ ] Kitchen actor has no per-person serving authority in the current flow.
- [ ] Role changes and account status.

## Task 7.4 — Health/observability

- [ ] Structured request/job logs.
- [ ] Serving latency/error/duplicate metrics.
- [ ] Job failure/lag alerts.
- [ ] PostgreSQL/storage health.
- [ ] Health endpoints without secret leakage.

## Task 7.5 — Lifecycle workers and recovery

- [ ] Menu lock/snapshot at cutoff with retry and reconciliation.
- [ ] Historical delegation rows remain retained/readable; no active delegation
      expiry worker authorizes or mutates current check-in.
- [ ] Notification delivery/retry without losing inbox state.
- [ ] Reconciliation job compares authoritative DB-derived aggregate dashboard
      state.
- [ ] Every run writes `job_runs`; manual retry requires confirmed actor/date/scope.

## Task 7.6 — One-year retention cleanup

- [ ] Define the exact tables/relations covered by the 1-year meal lifecycle/business audit retention policy.
- [ ] Implement dependency-safe, idempotent purge of expired historical rows.
- [ ] Never age-purge active identity/configuration rows solely because they are older than one year.
- [ ] Record retention run summary in `job_runs` and monitor failures.

## Task 7.7 — Missing product surfaces

- [ ] Staff meal history and penalty list/detail.
- [ ] Public read-only `/me/history` and `/me/penalties` APIs with bounded pagination.
- [ ] Admin account enable/disable with future-commitment preview and mandatory confirmed cleanup using `ACCOUNT_DISABLED`; cleanup rows remain historical but never count toward Kitchen totals/no-show/penalty.
- [ ] Admin Jobs/Health run history and manual retry UI.
- [ ] Authorization, audit and acceptance tests for every surface.

**Exit Phase 7:** daily lifecycle is observable and financially/audit safe.

---

# Phase 8 — Clean-slate qualification, security and UAT

## Task 8.1 — Clean-slate provisioning rehearsal

- [ ] Create fresh database solely from checked-in migrations.
- [ ] Run audited first-Admin bootstrap.
- [ ] Provision synthetic allowlist-A test users and assign
      Kitchen/permissions explicitly; do not auto-provision from login.
- [ ] Prove Firebase has been absent from the v2 runtime/data path since re-development kickoff; no export/import/mapping/dual-write dependency exists.
- [ ] Restore a fresh environment from PostgreSQL backup.
- [ ] Follow the [staging readiness runbook](runbooks/staging-readiness.md) for
      target fingerprint, migration status, encrypted backup, approval, Phase 0
      validation, protected Compose, smoke, evidence, and rollback.

The repository's local staging-tool and Compose tests are implementation
evidence only. They do not close the staging target, restore, identity,
location, DNS/TLS, OTP, WAF/rate-limit, alert-delivery, or UAT gates.

## Task 8.2 — Synthetic staging dataset/load

- [ ] 300 users.
- [ ] Several weeks of menu/registration/historical-serving/no-show data; any
      retained delegation rows are compatibility fixtures only.
- [ ] Concurrent Staff confirm/retry test burst.
- [ ] Weekly registration burst near cutoff.
- [ ] Verify target P95 and zero duplicate serving.
- [ ] Tag synthetic accounts/data so production-safe cleanup is deterministic and audited.

## Task 8.3 — Security gate

- [ ] Unknown/disabled allowlist addresses receive the same generic response
      and cannot create a session.
- [ ] Staff cannot self-grant Kitchen/Admin.
- [ ] Staff cannot call any Kitchen-only mutation or self-check-in for another
      user.
- [ ] Kitchen QR/dashboard require authenticated `kitchen.serve`; Staff
      resolve/confirm require the authenticated own user.
- [ ] Forged, wrong-day/location or inactive shared QR denied.
- [ ] Stale/inaccurate GPS, stale check-in session and already-checked-in state
      cannot bypass current eligibility.
- [ ] Historical delegation cannot authorize current check-in.
- [ ] API rate/input validation tested.
- [ ] Disabled account denied across the API authorization matrix.
- [ ] Permission boundaries for Admin, independent Staff/Kitchen roles and penalties tested; no reversal endpoint exists.
- [ ] Approved edge WAF/rate-limit policy, TLS/DNS and trusted-proxy behavior
      verified on the real staging edge.
- [ ] Runtime integration observes actual hardening `/metrics` collectors and
      endpoints; absent collectors must fail closed and cannot be replaced by
      synthetic evidence.
- [ ] Alert route delivers to the named on-call destination and the result is
      retained as `observability-alert-test.json`.

## Task 8.4 — UAT

UAT remains an external gate. No native-device, approved identity/roster,
location, real OTP-provider, alert-delivery, or real staging evidence is
claimed by local tests.

Staff:

- [ ] Allowlist-A email OTP request/verify and opaque-session restore/logout.
- [ ] Weekly tick/untick/mixed cutoff.
- [ ] History and penalty detail.
- [ ] Pre-cutoff canceled registration still shows its immutable menu revision
      after later menu edit.
- [ ] `GET /api/me/check-in` returns own status before and after the flow.
- [ ] Staff scans the stable shared Kitchen QR and resolves with fresh
      foreground GPS; response contains only the caller's own registration.
- [ ] Staff confirms with a second fresh foreground GPS sample and an
      idempotency key; result is `CHECKED_IN` and one unique `MealServing`.
- [ ] Lost-response retry/reconciliation returns the same result with no
      duplicate serving.
- [ ] Exercise invalid QR, inactive session, no registration, cancellation,
      already checked-in, window/location and all canonical GPS errors.

Kitchen:

- [ ] Weekly menu draft/publish.
- [ ] `GET /api/kitchen/check-in/qr` returns a stable day/location QR with no
      employee identity.
- [ ] Dashboard returns aggregate-only counts and `lastUpdated`.
- [ ] Focused/foreground poll every 10 seconds, immediate re-entry refresh and
      normal convergence within approximately 15 seconds; on errors retain the
      stale last-good snapshot indefinitely until a successful refresh.
- [ ] No employee scanner/search/list/log, delegation/proxy action or SSE/
      WebSocket requirement.
- [ ] Concurrent/retried Staff confirms converge to one serving and dashboard
      invariants hold.

Admin:

- [ ] Independent Staff/Kitchen role assignment; verify Kitchen does not inherit Staff and no Admin-role grant control exists in Admin Web.
- [ ] Disable account through one preview + mandatory confirmed no-penalty cleanup workflow.
- [ ] Penalty resolve.
- [ ] Audit lookup.
- [ ] Job visibility.

Accessibility/device:

- [ ] Android/iOS representative devices.
- [ ] Kitchen tablet/phone displays the shared QR and aggregate dashboard;
      Staff devices provide camera and foreground-GPS permissions.
- [ ] Large text/reduced motion/screen reader critical flows.

Traceability gate:

- [ ] Every P0 requirement maps to implementation task, automated/manual evidence and named approver.
- [ ] Contract, authorization, worker retry, rollback/restore and accessibility suites pass.

**Exit Phase 8:** all mapped P0 tests/UAT/security/load/restore evidence approved with zero open P0 defect.

---

# Phase 9 — Production rollout

The operator sequence for staging qualification is the
[staging readiness runbook](runbooks/staging-readiness.md). It is the source
of truth for exact commands, protected secret manifest names, artifact
checksums, sign-off, abort, restore, and rollback. Current local checks do not
claim external staging or production evidence; Phase 9 remains blocked by the
missing hardening `/metrics` collectors/endpoints, approved WAF/rate-limit and
alert route, real staging DNS/TLS/OTP, backup restore, UAT, identity, and
location approvals.

## Task 9.1 — Production Linux provisioning

Recommended:

```text
4 vCPU
8 GB RAM
100 GB SSD
1 Gbps LAN
Linux LTS
```

- [ ] Docker Compose services.
- [ ] Reverse proxy/TLS.
- [ ] Public/general API routing.
- [ ] PostgreSQL not exposed publicly.
- [ ] Centralized server logging, health monitoring and alerting for API, worker/jobs and PostgreSQL.
- [ ] Finalize log retention and alert destination before rollout.
- [ ] Render both `docker-compose.yml` and `docker-compose.staging.yml` with
      the protected environment file and immutable image digest manifest.
- [ ] Run the pre-deploy exact digest security scan and retain deployed-image
      SBOM references before recording a security PASS.
- [ ] Keep runtime integration fail closed until actual hardening collectors and
      endpoints are deployed and observed.

## Task 9.2 — Backup/restore

- [ ] Scheduled PostgreSQL backups.
- [ ] Separate NAS/server/physical storage copy.
- [ ] Restore rehearsal from production-like backup.
- [ ] Document RPO/RTO and owner.
- [ ] Document rollback authority, decision window and application/schema rollback procedure.
- [ ] Prove database migrations remain backward-compatible for the rollback window.
- [ ] Retain `backup-manifest.json`, `restore-rehearsal.json`, checksums, and
      independent sign-off from the runbook evidence directory.
- [ ] No backup/restore PASS may be inferred from unit tests or a local volume.

## Task 9.3 — Mobile distribution (TBD before production release)

The project has not yet selected package/bundle IDs, signing ownership, minimum OS versions or distribution channel. These are intentionally deferred and must be resolved before production release, not during core domain implementation.

- [ ] Configure Android signing/package ID.
- [ ] OTP provider HTTPS URL/sender settings and opaque-session behavior match
      release configuration.
- [ ] Decide organization distribution channel (managed/internal store/public private listing as approved).
- [ ] Test upgrade path and deep links/push on release build.
- [ ] Define API/mobile compatibility matrix, minimum supported app version and pilot cohort.
- [ ] Define staged rollout hold points and distribution rollback.

## Task 9.4 — Clean-slate rollout

- [ ] Deploy API/worker/Admin Web.
- [ ] Provision fresh production PostgreSQL schema/config; Firebase has already been removed since re-development kickoff.
- [ ] Run audited server-side Admin bootstrap/lifecycle operation and assign Kitchen/permissions.
- [ ] Release mobile to pilot cohort, then staged organization rollout.
- [ ] Verify allowlist-A OTP request/verify, opaque-session restore/logout and
      current server-side role/status enforcement.
- [ ] Verify one tagged synthetic weekly registration.
- [ ] Verify tagged synthetic Staff own-registration check-in and audited
      synthetic cleanup; historical proxy/delegation rows are not exercised.
- [ ] Verify aggregate dashboard polling/stale recovery on controlled target.
- [ ] Verify no-show job on controlled staging/production-safe target.
- [ ] Monitor first complete meal lifecycle.

The rollout is not authorized while any external prerequisite is absent.
Specifically, missing hardening collectors/endpoints, edge WAF/rate-limit
approval, alert delivery, real staging DNS/TLS/OTP, restore rehearsal, UAT,
identity, location, or roster approval keeps the release **CONDITIONAL /
NO-GO**.

**Production exit:** first complete weekly registration + daily serving + no-show lifecycle reconciles in PostgreSQL with zero P0 defects; rollback hold point is formally released.

---

## Release blockers

Do not go live if any condition remains:

- Allowlist-A source/provider settings incomplete or OTP/session validation
  bypassable.
- Server-side role provisioning can grant a privileged role without audit.
- Weekly registration cutoff enforced only on client.
- Duplicate registration/serving reproduced under concurrency.
- Staff can resolve or confirm another user's registration, or confirm without
  fresh foreground GPS at both resolve and confirm.
- Kitchen QR rotates per Staff, contains employee data, or directly authorizes a
  serving without Staff's explicit confirm.
- Active delegation/proxy or multi-item serving can authorize a current
  check-in; historical tables must remain read-only compatibility data.
- Kitchen aggregate dashboard can permanently diverge from DB, reset to zero on
  a temporary poll error, or require SSE/WebSocket for correctness.
- Serving/check-in authorization can be bypassed without authenticated
  permissions and server-side registration, window, location and GPS validation.
- No-show/penalty retry can duplicate financial state.
- PostgreSQL backup exists but restore has never been tested.
- Server-side Admin bootstrap/lifecycle is unaudited/reusable or can leave the system without a controlled Admin recovery path.
- Single-registration confirm can partially commit a `MealServing`, event or
  idempotency result.
- Disabled account can call any protected API.
- Rollback authority/window, API/mobile compatibility or backward-compatible schema procedure is untested.
- Android/iOS release builds have not been tested against production-like OTP
  provider, opaque-session and permission configuration.

## Post-launch follow-up

After stable operation:

- Track registration vs served vs no-show trend per day/week.
- Add optional `prepared_count`/remaining-food metrics if Kitchen needs actual waste measurement.
- Review retained delegation/pickup history for migration/accounting anomalies;
  do not treat historical proxy rows as current authorization or a fraud signal.
- Evaluate forecasting only after enough trustworthy history exists; do not automatically under-prepare meals in MVP.
- Reassess server sizing from actual CPU/RAM/DB/latency metrics before introducing Redis, queue brokers or horizontal scaling.
