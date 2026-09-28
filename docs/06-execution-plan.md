# IMeal v2 — Re-platforming and Execution Plan

**Goal:** Chuyển IMeal từ web Next.js/Firebase/Firestore sang IMeal v2 mobile-first, sử dụng allowlist-A email OTP với opaque PostgreSQL-backed sessions, NestJS, PostgreSQL và Linux self-host, đồng thời redesign weekly menu/registration, delegation và Kitchen serving flow.

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
- QR TTL 5 seconds, clock skew 2 seconds, pickup session TTL 30 seconds.
- Serving/check-in requires authenticated Kitchen role/permission and server-side pickup validation.
- No mandatory check-out in core v2.
- PostgreSQL is business source of truth; mobile never writes DB directly.
- Every no-show creates one 50,000 VND penalty; exceptions use audited waive.
- Clean slate: Firebase contains demo-pitching data only and is deleted/decommissioned at re-development kickoff; do not migrate, retain for v2, map, reconcile, dual-write or roll data back to Firebase.
- Meal lifecycle/business audit history retention is 1 year.
- Persisted notification inbox is mandatory; Expo Push is the default delivery provider.
- Staff selects multi-item pickup intent before QR; Kitchen scans and confirms that exact set without per-item ticking/editing. Multi-item serving remains all-or-nothing and successful confirm is final; core v2 has no reversal.

---

## 1. Delivery strategy

| Phase | Deliverable | Priority |
| ----- | ----------- | -------- |
| 0 | Verify canonical policy + organization/OTP/provider/network ownership | P0 |
| 1 | Repository/tooling + Linux dev/staging foundation | P0 |
| 2 | PostgreSQL schema + domain/test safety net | P0 |
| 3 | Allowlist-A email OTP + opaque sessions/RBAC | P0 |
| 4 | Weekly menu + weekly registration | P0 |
| 5 | Delegation + notifications | P0 |
| 6 | Dynamic QR + Kitchen serving + realtime dashboard | P0 |
| 7 | No-show/penalty/admin/audit/jobs | P0/P1 |
| 8 | Clean-slate qualification + security/load/UAT | P0 release gate |
| 9 | Production rollout + mobile distribution + operations | P0 release gate |
Phases should be independently reviewable. No production rollout before Phase 8 exit criteria.

---

# Phase 0 — Verify canonical policy and organizational prerequisites

## Task 0.1 — Verify canonical policy package

- [ ] Product/API/backend/UX docs agree on Monday week, cutoff, 10:30–13:30 serving and 13:45 no-show.
- [ ] QR 5s/skew 2s/pickup session 30s represented in contracts/tests.
- [ ] Staff-side pickup intent, Kitchen scan→final-confirm flow, no manual-code
  recovery/bypass and all-or-nothing batch serving represented consistently; no
  Kitchen item-edit or reversal flow remains.
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

This gate records local/disposable evidence only. It does not close the
staging, production, mobile-release, security, backup/restore or realtime
client gates.

- [x] Expand: `DATABASE_URL=<disposable-local-url> yarn workspace @imeal/core exec prisma migrate deploy` applied all eight checked-in migrations, including `20260928000000_phase0_domain_correctness`; `prisma generate` and `prisma validate` passed. Counts for registrations, daily menu revisions, meal days, meal servings and penalties were zero after expansion.
- [x] Read-only approval gate: the containerized equivalent of `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/preflight.sql` returned seven named checks at zero and `ACTIVE`, `CANCELLED`, `SERVED`, `NO_SHOW` counts at zero on the disposable schema.
- [x] Exact backfill: only after the clean disposable report, `backfill.sql` ran twice and returned `UPDATE 0`, `DO`, `UPDATE 0`, `UPDATE 0`, `COMMIT` on both runs; no operational rows were inserted, merged or fabricated.
- [x] Post-backfill validation: preflight remained all-zero; both `registration_lifecycle_snapshot_complete` and `registration_serving_consistency` validated with `convalidated=true`.
- [x] Focused evidence: contracts 37 tests, domain migration/concurrency 29 tests, API units 219 tests, worker units 56 tests, API PostgreSQL e2e 76 tests and worker PostgreSQL e2e 6 tests passed.
- [ ] Full domain suite: `yarn workspace @imeal/core exec vitest run` had five failures in local-seed/concurrency expectations; this is not a rollout approval.
- [ ] Workspace typecheck: `yarn typecheck` is blocked by mobile `expo-location`, an implicit-any `nextLocation` callback and stale `menuRevisionId` test fixtures.
- [ ] Staging approval: no staging target or ambient `DATABASE_URL` was available. The existing local public schema is dirty (116 incomplete snapshots, 6 ambiguous roster assignments, 132 incomplete menu revisions, 40 incomplete future ACTIVE rows); no backfill or validation was run there.

**Cutover order:** expand additive schema → read-only preflight and external
approval → exact deterministic backfill → post-backfill preflight → validate
named checks → focused/full verification → application cutover. Abort before
backfill or validation on any nonzero operational check, mismatch, ambiguity,
invalid revision, duplicate penalty candidate, migration failure or failed
verification. Rollback uses the approved database backup and old compatible
application only under the documented operator decision; there is no
destructive down migration or Firebase rollback path.

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
- [ ] `X-Request-Id`, `Idempotency-Key` and realtime event envelope.
- [ ] Contract tests run in CI for every consumer.
- [ ] Requirement ID → task → test/evidence → approver matrix initialized.

**Exit Phase 1:** developer can boot API/DB locally and deploy staging without Firebase.

---

# Phase 2 — PostgreSQL schema and automated safety net

## Task 2.1 — Create core migrations

Create canonical tables:

- [ ] users/roles/user_roles/permissions/role_permissions/user_permissions.
- [ ] weekly_menus/daily_menus/daily_menu_revisions/meal_days.
- [ ] registrations.
- [ ] pickup_delegations.
- [ ] serving_confirm_requests/meal_servings/meal_events.
- [ ] penalties.
- [ ] notifications (mandatory) and push_devices.
- [ ] job_runs/audit_logs.

Add constraints:

- [ ] `UNIQUE(user_id, meal_date)` registration.
- [ ] one daily menu per meal date.
- [ ] daily-menu check constraint represents enabled date with meal vs explicit disabled holiday without fake meal.
- [ ] `UNIQUE(registration_id)` final serving; no reversal/re-serve state.
- [ ] `UNIQUE(caller_user_id, idempotency_key)` request-level serving confirm result.
- [ ] one active delegation per registration.
- [ ] foreign keys and required indexes.

## Task 2.2 — Domain tests

- [ ] Cutoff before/at/after 14:00 VN.
- [ ] Registration transitions.
- [ ] Menu week/date rules.
- [ ] Canceled registration keeps immutable menu revision; active registration follows approved pre-cutoff revision.
- [ ] Delegation state machine.
- [ ] Serving eligibility self/proxy.
- [ ] No-show/penalty idempotency.
- [ ] Exact 14:00, 10:30, 13:30, 13:45 boundaries.
- [ ] Cancel registration atomically revokes active delegation.
- [ ] Account-disable preview + mandatory confirmed no-penalty future-commitment cleanup.
- [ ] Final serving and all-or-nothing multi-item serving.

## Task 2.3 — Database concurrency tests

- [ ] Concurrent register same user/date → one row.
- [ ] Two scanners same registration → one serving.
- [ ] Owner vs delegate simultaneous serving → one serving.
- [ ] Revoke vs serve race → one deterministic outcome.
- [ ] Retry same idempotency key → original result/no duplicate.
- [ ] Multi-item batch with one stale item → zero servings committed.
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
- [ ] Kitchen role does not grant Staff registration/QR/delegation; dual-role
  users require explicit `staff + kitchen`.

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
- [ ] Cancel atomically revokes pending/accepted delegation with notifications/audit (Implement strict modular boundaries / Domain-Driven Design).

## Task 4.4 — Staff weekly mobile UI

- [ ] Day cards with checkbox.
- [ ] `Chọn cả tuần` only editable days.
- [ ] Sticky save when draft exists.
- [ ] Partial failure retains failed draft.
- [ ] Mixed locked/editable week tested.

**Exit Phase 4:** Kitchen can publish one-meal-per-day menu and Staff can reliably register a week.

---

# Phase 5 — Delegation and notifications

## Task 5.1 — Delegation API

- [ ] Owner request delegate.
- [ ] Delegate accept/decline.
- [ ] Owner revoke.
- [ ] Prevent self-delegate.
- [ ] Prevent delegation chain.
- [ ] One active delegation per registration.
- [ ] No create/revoke after serving.

## Task 5.2 — Delegation mobile UX

- [ ] Owner search by employee/name.
- [ ] Pending/accepted/declined state.
- [ ] Incoming requests screen.
- [ ] Deep-link from notification.
- [ ] Reconcile serve/revoke race outcomes.

## Task 5.3 — Notification inbox

- [ ] Persist delegation, menu-revision, cancellation and proxy-serving notifications in PostgreSQL.
- [ ] Read/unread support.
- [ ] Notify owner on proxy serving.
- [ ] Public cursor-paginated inbox API and owner-only mark-read API.

## Task 5.4 — Push transport

- [ ] Register device tokens.
- [ ] Use Expo Push as default provider.
- [ ] Dispatch delegation events.
- [ ] Retry safe failures.
- [ ] App remains correct when push not delivered.

**Exit Phase 5:** A→B authorization requires explicit B consent and is visible/auditable on both devices.

---

# Phase 6 — QR, Kitchen serving and realtime dashboard

## Task 6.1 — Dynamic QR + Staff pickup intent

- [ ] Server-signed QR.
- [ ] 5-second TTL and 2-second maximum skew.
- [ ] `GET /me/pickup-options` returns own + accepted-delegation eligible items.
- [ ] One eligible item is selected automatically; multiple eligible items are selected by Staff before QR presentation.
- [ ] `POST /me/qr` validates the selected registration IDs and issues/refreshes the signed QR.
- [ ] Automatic mobile refresh preserves pickup intent.
- [ ] Wrong date/expired/forged/stale-intent tests.
- [ ] QR identifies presenter + signed pickup intent; intent never overrides DB eligibility.

## Task 6.2 — Pickup resolve API

Authenticated Kitchen role/permission required.

- [ ] Verify QR TTL/signature.
- [ ] Load presenter own active registration + accepted proxy registrations.
- [ ] Revalidate every registration in Staff-selected pickup intent.
- [ ] Exclude served/revoked/ineligible registrations and reject stale intent without silent substitution.
- [ ] Enforce 10:30–13:30 service window.
- [ ] Return 30-second pickup session with validated intended items.

## Task 6.3 — Pickup confirm transaction

- [ ] Accept selected registration IDs only.
- [ ] Row lock registration/delegation.
- [ ] Revalidate current eligibility.
- [ ] Insert serving + immutable event.
- [ ] Consume delegation for proxy.
- [ ] Enforce unique/idempotency constraints.
- [ ] Store one request-level idempotency/result record linked to all batch serving rows.
- [ ] Return existing serving on duplicate attempt.
- [ ] Entire multi-item batch rolls back if any item changed.
- [ ] Disabled owner/receiver/actor rejected after DB status lookup.

## Task 6.4 — Kitchen scanner UI

- [ ] Large scanner surface.
- [ ] Resolved self/proxy intended-item list with prominent total count.
- [ ] No per-item checkbox or item-edit action; Kitchen verifies the Staff-selected set and uses one big final-confirm CTA.
- [ ] Big confirm CTA includes count.
- [ ] Expired pickup session recovery requires scanning a fresh QR and resolving
  the exact presenter-selected set again.
- [ ] Duplicate serving warning includes receiver/time.

## Task 6.5 — Realtime dashboard

- [ ] Initial `served/total/remaining` snapshot.
- [ ] Recent log.
- [ ] `Đã nhận / Chưa nhận / Tất cả` lists.
- [ ] After reconciliation, distinct `Vắng mặt` count/list; never label absence before service closes.
- [ ] WebSocket/SSE updates after DB commit.
- [ ] Two+ Kitchen devices stay consistent.
- [ ] Reconnect re-fetches snapshot.

## Task 6.6 — Serving finality

- [ ] Kitchen confirms only the server-revalidated Staff-selected set.
- [ ] Confirm CTA explains the displayed count and is enabled only while the pickup session is valid.
- [ ] Successful confirm is immutable/final; no Kitchen/Admin reversal endpoint or UI exists.
- [ ] Operational guidance requires Kitchen to complete any temporarily missing trays physically rather than rewriting serving history.

**Exit Phase 6:** concurrent/retried confirm creates at most one immutable final serving, and all serving is authenticated, permission-protected and realtime-visible.

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

- [ ] Registration owner.
- [ ] Delegation lifecycle.
- [ ] Receiver.
- [ ] Kitchen actor/time/source.
- [ ] Role changes and account status.

## Task 7.4 — Health/observability

- [ ] Structured request/job logs.
- [ ] Serving latency/error/duplicate metrics.
- [ ] Job failure/lag alerts.
- [ ] PostgreSQL/storage health.
- [ ] Health endpoints without secret leakage.

## Task 7.5 — Lifecycle workers and recovery

- [ ] Menu lock/snapshot at cutoff with retry and reconciliation.
- [ ] Delegation expiry after service end.
- [ ] Notification delivery/retry without losing inbox state.
- [ ] Reconciliation job compares authoritative DB-derived dashboard state.
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

## Task 8.2 — Synthetic staging dataset/load

- [ ] 300 users.
- [ ] Several weeks of menu/registration/delegation/serving/no-show data.
- [ ] Concurrent scan test burst.
- [ ] Weekly registration burst near cutoff.
- [ ] Verify target P95 and zero duplicate serving.
- [ ] Tag synthetic accounts/data so production-safe cleanup is deterministic and audited.

## Task 8.3 — Security gate
- [ ] Unknown/disabled allowlist addresses receive the same generic response
  and cannot create a session.
- [ ] Staff cannot self-grant Kitchen/Admin.
- [ ] Staff cannot call Kitchen serving mutation.
- [ ] Kitchen serving requires authenticated Kitchen role/permission and all server-side pickup invariants.
- [ ] Forged/expired QR denied.
- [ ] Delegation cannot be accepted by wrong user.
- [ ] Stale pickup session cannot bypass revoke/already-served state.
- [ ] API rate/input validation tested.
- [ ] Disabled account denied across the API authorization matrix.
- [ ] Permission boundaries for Admin, independent Staff/Kitchen roles and penalties tested; no reversal endpoint exists.

## Task 8.4 — UAT

Staff:

- [ ] Allowlist-A email OTP request/verify and opaque-session restore/logout.
- [ ] Weekly tick/untick/mixed cutoff.
- [ ] History and penalty detail.
- [ ] Pre-cutoff canceled registration still shows its immutable menu revision after later menu edit.
- [ ] QR refresh.
- [ ] Delegation request/accept/revoke.
- [ ] Proxy serving notification.

Kitchen:

- [ ] Weekly menu draft/publish.
- [ ] Self pickup.
- [ ] Proxy pickup.
- [ ] Staff preselects multiple pickup items; Kitchen scan shows the intended set/count without requiring item ticking.
- [ ] One stale intended item rolls back entire multi-item batch.
- [ ] 20 consecutive self/proxy/duplicate scans retain scanner context and use the scan→confirm happy path.
- [ ] Unselected eligible registrations are never served; any pre-confirm
  change requires refreshed presenter intent and QR re-resolve.
- [ ] Duplicate scan.
- [ ] Two-device realtime dashboard.
- [ ] Serving resolve/confirm works for valid Kitchen callers regardless of client network location.

Admin:

- [ ] Independent Staff/Kitchen role assignment; verify Kitchen does not inherit Staff and no Admin-role grant control exists in Admin Web.
- [ ] Disable account through one preview + mandatory confirmed no-penalty cleanup workflow.
- [ ] Penalty resolve.
- [ ] Audit lookup.
- [ ] Job visibility.

Accessibility/device:

- [ ] Android/iOS representative devices.
- [ ] Kitchen tablet/phone camera.
- [ ] Large text/reduced motion/screen reader critical flows.

Traceability gate:

- [ ] Every P0 requirement maps to implementation task, automated/manual evidence and named approver.
- [ ] Contract, authorization, worker retry, rollback/restore and accessibility suites pass.

**Exit Phase 8:** all mapped P0 tests/UAT/security/load/restore evidence approved with zero open P0 defect.

---

# Phase 9 — Production rollout

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

## Task 9.2 — Backup/restore

- [ ] Scheduled PostgreSQL backups.
- [ ] Separate NAS/server/physical storage copy.
- [ ] Restore rehearsal from production-like backup.
- [ ] Document RPO/RTO and owner.
- [ ] Document rollback authority, decision window and application/schema rollback procedure.
- [ ] Prove database migrations remain backward-compatible for the rollback window.

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
- [ ] Verify tagged synthetic self/proxy final serving and audited synthetic cleanup.
- [ ] Verify realtime dashboard.
- [ ] Verify no-show job on controlled staging/production-safe target.
- [ ] Monitor first complete meal lifecycle.

**Production exit:** first complete weekly registration + daily serving + no-show lifecycle reconciles in PostgreSQL with zero P0 defects; rollback hold point is formally released.

---

## Release blockers

Do not go live if any condition remains:

- Allowlist-A source/provider settings incomplete or OTP/session validation
  bypassable.
- Server-side role provisioning can grant a privileged role without audit.
- Weekly registration cutoff enforced only on client.
- Duplicate registration/serving reproduced under concurrency.
- QR scan directly marks serving without Kitchen confirmation.
- Delegation can be used without delegate acceptance.
- Serving authorization can be bypassed without authenticated Kitchen permission and server-side business validation.
- Realtime dashboard can permanently diverge from DB without recovery.
- No-show/penalty retry can duplicate financial state.
- PostgreSQL backup exists but restore has never been tested.
- Server-side Admin bootstrap/lifecycle is unaudited/reusable or can leave the system without a controlled Admin recovery path.
- Multi-item serving can partially commit.
- Disabled account can call any protected API.
- Rollback authority/window, API/mobile compatibility or backward-compatible schema procedure is untested.
- Android/iOS release builds have not been tested against production-like OTP
  provider, opaque-session and permission configuration.

## Post-launch follow-up

After stable operation:

- Track registration vs served vs no-show trend per day/week.
- Add optional `prepared_count`/remaining-food metrics if Kitchen needs actual waste measurement.
- Review proxy pickup frequency for operational anomalies without treating proxy use itself as fraud.
- Evaluate forecasting only after enough trustworthy history exists; do not automatically under-prepare meals in MVP.
- Reassess server sizing from actual CPU/RAM/DB/latency metrics before introducing Redis, queue brokers or horizontal scaling.
