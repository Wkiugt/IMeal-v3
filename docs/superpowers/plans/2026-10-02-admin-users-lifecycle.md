# Admin users and account lifecycle implementation plan

> **Execution:** TDD in the current `deploy/develop` worktree. No commits, pushes,
> resets, fetch cutovers, or destructive Git commands. Preserve unrelated user
> changes. This plan covers the API/contracts workstream only; Admin Web/mobile
> consumers are separate.

**Spec:** `docs/superpowers/specs/2026-10-02-admin-users-lifecycle-design.md`

**Contract handoff:** `packages/contracts/src/v1/admin-users.ts` (already published
and exported from `packages/contracts/src/v1/index.ts`).

## 1. Required public surface

Use both route prefixes in one controller:

```text
GET    /v1/admin/users                    GET    /admin/users
GET    /v1/admin/users/:userId            GET    /admin/users/:userId
PUT    /v1/admin/users/:userId/roles      PUT    /admin/users/:userId/roles
POST   /v1/admin/users/:userId/disable/preview
POST   /admin/users/:userId/disable/preview
POST   /v1/admin/users/:userId/disable    POST   /admin/users/:userId/disable
POST   /v1/admin/users/:userId/enable     POST   /admin/users/:userId/enable
GET    /v1/admin/users/:userId/sessions   GET    /admin/users/:userId/sessions
POST   /v1/admin/users/:userId/sessions/revoke-all
POST   /admin/users/:userId/sessions/revoke-all
GET    /v1/admin/users/:userId/audit      GET    /admin/users/:userId/audit
```

Every handler uses `SessionGuard`, `PermissionsGuard`, and
`@RequirePermission('user.manage')`. The role request is exactly
`{ roles: ['staff'|'kitchen'] }`; `admin` is a list/detail filter but is never a
valid mutation role. The normal bounded audit route is `/audit`, not `/audit/export`.

Preview sample arrays are capped at **25 items per category** by the shared
contract. `count` is the complete server count; `items` is a deterministic first
25 sample ordered by meal date/ID or delegation ID. Mutation counts are always
complete actual newly changed counts, never sample counts.

## 2. File map

### Shared contracts

- Modify: `packages/contracts/src/v1/admin-users.ts` (done early; fix/query and
  preview-cap tests included).
- Modify: `packages/contracts/src/v1/index.ts` (export new module).
- Test: `packages/contracts/test/admin-users.test.ts`.
- Modify: `packages/contracts/src/v1/errors.ts` with lifecycle error codes only
  when the API exception surface requires them; preserve existing codes.

Exports to keep stable:

```text
AdminManagedRoleSchema / AdminManagedRole
AdminUserStatusFilterSchema / AdminUserRoleFilterSchema
AdminUserListQuerySchema / AdminUserListItemSchema / AdminUserListResponseSchema
AdminUserDetailSchema
AdminUserRolesUpdateRequestSchema / AdminUserRolesUpdateResponseSchema
AdminUserDisablePreviewResponseSchema
AdminUserDisableRequestSchema / AdminUserDisableResponseSchema
AdminUserEnableRequestSchema / AdminUserEnableResponseSchema
AdminUserSessionsQuerySchema / AdminUserSessionSchema / AdminUserSessionsResponseSchema
AdminUserRevokeAllRequestSchema / AdminUserRevokeAllResponseSchema
AdminUserAuditQuerySchema / AdminUserAuditEntrySchema / AdminUserAuditResponseSchema
```

`AdminUserSessionsQuerySchema` MUST parse query strings explicitly: `'false'`
becomes false, `'true'` becomes true, and any other string is rejected. Do not
use `z.coerce.boolean()` because it treats every non-empty string as true.

### API module

- Create: `apps/api/src/admin/users/admin-users.module.ts`.
- Create: `apps/api/src/admin/users/admin-users.controller.ts`.
- Create: `apps/api/src/admin/users/admin-users.service.ts`.
- Create: `apps/api/src/admin/users/admin-users.service.spec.ts`.
- Create: `apps/api/src/admin/users/admin-users.controller.spec.ts`.
- Modify: `apps/api/src/app.module.ts` to import `AdminUsersModule`.
- Modify: `packages/domain/prisma/migrations/<next>_admin_user_manage/migration.sql`
  to provision the canonical `user.manage` permission and grant it to the
  canonical `admin` role using the existing migration convention. Do not add
  runtime permission upserts, local-seed role creation, or a second bootstrap.

### Focused DB/e2e coverage

- Extend or create `apps/api/test/admin-users.e2e-spec.ts` for real Nest route,
  auth/permission and response privacy coverage.
- Extend `apps/api/test/production-concurrency.e2e-spec.ts` or create a focused
  lifecycle race suite for registration/serving and concurrent final-admin
  disable races, reusing disposable Prisma clients and existing setup.
- Extend `packages/domain/test/registration.test.ts` only when the existing
  compatibility disable helper needs a shared regression; do not duplicate
  lifecycle logic in a second domain service.
- Add a downstream regression only if focused tests demonstrate Kitchen/no-show
  semantics need a patch. Existing code already excludes cancelled/disabled
  rows and uses `mealServing=null` for no-show candidates.

## 3. TDD execution sequence

### Task 1 — Contract hardening (complete before API code)

1. Run the new contract tests red for explicit boolean parsing and bounded
   preview arrays.
2. Implement the query boolean union and `.max(25)` sample caps.
3. Run:

   ```powershell
   yarn workspace @imeal/contracts exec vitest run test/admin-users.test.ts
   ```

4. Add strict tests for every request/response shape, `admin` role rejection,
   duplicate role rejection, session privacy, audit unsafe-key rejection, and
   complete-count/sample-cap semantics.

### Task 2 — Permission migration and module/controller RED tests

Write failing controller tests before implementation:

- Staff/kitchen/no-permission requests return 403; a principal with
  `user.manage` reaches the service.
- Both route prefixes are registered.
- `PUT :userId/roles` forwards `{roles}` only after strict Zod parsing.
- `POST disable` rejects a body without `confirm:true`.
- Session/audit query parsing rejects invalid boolean/date/limit values.

Write a migration test/assertion using the repository's migration/bootstrap
inspection convention that `user.manage` exists once and is assigned to
`admin`; the migration must not create roles or rewrite existing mappings.
Run the focused controller/contract tests and observe the expected missing-module
failures before creating the module/controller.

### Task 3 — Read/list/detail service

Implement `AdminUsersService` list/detail first with one captured `now` per call.
Use injected `PrismaService`; no new PrismaClient and no in-memory caches.

List behavior:

- Parse `page/limit` with max 100.
- Search normalized name/email and resolvable employee code, bounded to the
  request string max 100. Resolve assignment rows by `userId` or normalized
  email where necessary; do not let a roster role grant UserRole.
- Apply status and UserRole-only role filters. `admin` is readable; `unmanaged`
  means no `staff`/`kitchen` UserRole.
- Select current UserRole names, at most one effective active assignment/location
  for Vietnam business date (null on none/ambiguous), and active session count
  using both idle and absolute expiry.
- Order stable by `name/email/id` (or existing documented user order), return
  `PagePaginationMetaSchema`.

Detail behavior:

- Return all current UserRole names plus `managedRoles`.
- Return roster assignment role/isActive/employeeCode and safe location summary,
  separate from managed roles.
- Return allowlist state/effective dates without coupling it to account status.
- Return safe active/total session counts and lifecycle audit summary. Parse and
  allowlist audit detail keys; never expose hashes, tokens, OTP, GPS, provider
  payloads, raw coordinates or arbitrary exception text.

RED/green proof: service unit tests with a Prisma boundary mock must assert
observable returned data and privacy, not only method forwarding. Use real DB
integration for at least one list/detail fixture when PostgreSQL is available.

### Task 4 — Transactional managed-role replacement

Write failing service tests first for all role transitions: unmanaged→staff,
kitchen-only, staff-only, both, removals, admin-only preservation,
admin+staff preservation, and preservation of unknown future roles. Add tests for
same-set no-op and existing session re-resolution through `SessionService`.

Implement `replaceManagedRoles(userId, roles, actorId)`:

1. Strictly validate shared contract at controller boundary; service also checks
   only `staff|kitchen` and uniqueness.
2. Start `$transaction` and lock target user with
   `SELECT id FROM users WHERE id=$userId FOR UPDATE`.
3. Re-read all current role names and canonical managed role IDs.
4. Delete only managed relations absent from desired set; create only missing
   desired relations. Never delete `admin` or unknown roles.
5. If changed, write `USER_ROLES_UPDATED` with actor in `AuditLog.userId` and
   structured `{targetUserId, previousManagedRoles, nextManagedRoles}`. Same set
   returns `changed:false` without audit/session changes.
6. Return current all roles and managed roles from the transaction.

No session is revoked or token minted. The next request's `SessionService.resolve`
must observe the new roles/permissions from DB.

### Task 5 — Preview and transactional disable

Write failing unit tests and, when DB is available, integration tests before
implementation. Include:

- Vietnam business date boundary and future dates.
- Today's still-active registration.
- Past, cancelled, NO_SHOW, legacy SERVED, rows with an existing penalty
  record, and completed history excluded.
- `status=ACTIVE` with `mealServing` relation excluded and immutable.
- Outgoing owner delegations and incoming delegate delegations, only
  `PENDING|ACCEPTED`; final/revoked history unchanged.
- Preview counts complete while each item sample is at most 25 and stable.
- `confirm:true` required and stale preview does not cause partial cleanup.
- Self-disable and last-active-admin errors.

Preview implementation:

- Capture `now` and `actionableFromDate=getBusinessDate(now)` once.
- Query target identity/current roles, active session count, active registrations
  from date onward, and both delegation directions.
- Define actionable registration as `status=ACTIVE`, `mealServing=null`, and no
  existing penalty record. Re-check this predicate before adding it to the
  complete count. Return first 25 item summaries per category, but full counts.
- For incoming delegations require registration owner != target and the same
  actionable predicate. Preserve existing-penalty and other historical rows.

Disable implementation (single `$transaction`):

1. Acquire the shared `imeal:user-lifecycle` PostgreSQL transaction advisory
   lock before any registration or user row lock. Disable, registration batch
   creation, and delegation create/accept all use this same transaction lock,
   so a writer cannot hold a registration row while waiting for the target user.
   No process-local mutex.
2. Capture/lock all target-owned current/future ACTIVE registration rows,
   including rows with serving/penalty, ordered by date/id. Lock incoming
   registration rows deterministically too; preserve serving confirmation's
   registration-before-account order.
3. Lock and re-read the target user using the common user `FOR UPDATE` convention.
4. Reject actor==target. If target has `admin`, verify at least one other
   recovery-eligible active admin remains. Repository rules require an active
   allowlist record for production OTP eligibility; use the same active
   allowlist/effective-date predicate if that rule is present in the selected
   bootstrap path, otherwise document the observed fallback to `User.isActive`.
   This check is serialized globally for distinct admin targets.
5. Re-read every locked registration with `mealServing` and penalties. Cancel
   only actionable rows with `ACCOUNT_DISABLED`, actor/time fields and existing
   version increment. `ACTIVE+mealServing` MUST be skipped; never delete or
   rewrite `MealServing`.
6. Revoke PENDING/ACCEPTED delegations for newly cancelled owner rows and
   incoming actionable rows. Keep completed/revoked rows and existing-penalty
   history. Preserve existing notification/outbox dedupe and avoid new penalty
   writes.
7. Set user inactive, revoke every active auth session with `ACCOUNT_DISABLED`,
   write one `USER_DISABLED` audit with actor field and target/count details, and
   commit atomically.
8. Return actual newly changed registration/delegation/session counts. If already
   disabled, return zeros and no historical audit/notification writes.

Verify shared advisory-lock ordering against real DB: lifecycle writes acquire
`imeal:user-lifecycle` before registration/user row locks, while serving keeps
its existing registration-before-account order. Serving wins means disable skips
the new serving; disable wins means serving fails against cancelled registration.

### Task 6 — Enable, sessions and audit

Write failing tests first for:

- enable active no-op, disabled transition, and preservation of all cancelled /
  revoked / penalty / allowlist states;
- safe sessions metadata and no secret fields;
- revoke-all active account, actual count, `ADMIN_REVOKED`, idempotent zero retry;
- audit action persistence and bounded safe `/audit` filtering/pagination.

Implement all mutations with target user row lock. Enable never restores
registrations, delegations, sessions, meals, penalties or allowlist. Revoke-all
updates only unrevoked sessions and audits only when at least one new session was
revoked. Audit serializer returns only the lifecycle action allowlist and scalar
safe detail keys.

### Task 7 — API wiring and real e2e

Wire `AdminUsersModule` in `app.module.ts`, add controller dual route decorator,
strict shared schema parsing and stable Nest exceptions. Build a real Nest e2e
fixture using synthetic users/roles/permissions and a disposable DB when
available. Cover:

- 403 staff/kitchen and authorized admin;
- role update reflected on same session and Kitchen 403;
- disable preview/confirm/counts/privacy;
- old session `SESSION_INVALID`, OTP denial, enable non-restoration;
- session/audit privacy and both route prefixes.

Do not replace these with a controller mock-only echo suite.

### Task 8 — Documentation and downstream verification

After runtime smoke (not before), update canonical backend docs only:

- `docs/02-technical-requirements.md` Admin user routes/permission and disable
  semantics;
- `docs/05-backend-structure.md` role/assignment separation, row/advisory lock
  order, `ACTIVE+mealServing` projection, safe sessions/audit;
- `docs/README.md` only if the reading-order/domain glossary needs a concise
  lifecycle clarification.

Do not modify Admin Web/mobile or UI/UX docs in this workstream. Keep design/spec
and this plan synchronized with the actual route (`PUT roles`, `/audit`), sample
caps, and active-admin eligibility evidence.

## 4. Verification gates

Run focused red/green tests after each task. At final integration, use Yarn only:

```powershell
yarn workspace @imeal/contracts test
yarn workspace @imeal/api exec vitest run test/admin-users.e2e-spec.ts src/admin/users
# Real DB suites when DATABASE_URL/PostgreSQL is available:
yarn workspace @imeal/core test
yarn workspace @imeal/api test:e2e
# Scoped formatting only, then static checks:
yarn prettier --write packages/contracts/src/v1/admin-users.ts packages/contracts/src/v1/index.ts packages/contracts/test/admin-users.test.ts apps/api/src/admin/users apps/api/test/admin-users.e2e-spec.ts
yarn workspace @imeal/contracts exec tsc --noEmit -p tsconfig.json
yarn workspace @imeal/api exec tsc --noEmit -p tsconfig.json
yarn workspace @imeal/api lint
```

Run the repository's broader practical suites only once siblings are integrated;
do not claim pass if PostgreSQL/Docker/OTP prerequisites are missing. Inspect
real package scripts before choosing test flags.

Runtime smoke is required beyond tests: launch the real Nest API against a
synthetic disposable PostgreSQL schema, issue an authorized session request to
list/detail, mutate roles, confirm same-session permission change, preview and
disable a user with today/future/history/delegation fixtures, verify old session
failure, enable non-restoration, revoke-all idempotency, and inspect audit/session
responses for secrets. Remove any throwaway harness after proof.

Final report must list exact commands, exit codes, test/pass/fail counts, runtime
smoke observations, DB/infrastructure blockers, and changed files. No commit or
push is part of this workstream.
