# Admin users and account lifecycle design

**Date:** 2026-10-02

**Status:** Backend/shared-contract implementation basis. Admin Web and mobile clients consume the contracts but are outside this workstream.

## 1. Decision summary

Add a dedicated `apps/api/src/admin/users` Nest module and a shared
`packages/contracts/src/v1/admin-users.ts` contract module. The API keeps both
existing administrative route conventions:

```text
/v1/admin/users/**
/admin/users/**
```

All user mutations require the canonical `user.manage` permission. They do not
use an Admin-role shortcut, client claims, roster role text, allowlist state, or
an in-memory lock. The API remains authoritative for identity, managed roles,
account status, sessions, registrations, delegations, audit and safe location
summaries.

Authentication remains opaque-token based: a successful OTP creates only an
opaque token, PostgreSQL stores only its hash and minimized metadata, and every
protected request uses `SessionService.resolve` to reload current account
status, roles and permissions. Session issuance acquires the shared lifecycle
lock and re-reads `User.isActive`, so a disabled account cannot complete OTP
login; if issuance commits first, disable revokes that newly active session.
Role changes become visible to the next request on every existing session; no JWT
is introduced, minted, or invalidated by role changes.

`staff` and `kitchen` are the only roles exposed to this Admin Web lifecycle.
`admin` and any unknown role are never accepted in a managed-role request.
Replacing the managed set changes only `UserRole` rows for `staff` and `kitchen`
and preserves `admin` and every other existing role. `EmployeeLocationAssignment.role`
and `isActive` remain roster facts, and `OtpAllowlist.state` remains an
independent login-eligibility fact; neither is inferred from nor rewritten by
UserRole/account lifecycle operations.

Disable is one transaction. It re-reads and locks the target user and all
candidate registration rows, re-checks `mealServing` after each registration
row lock, cancels only actionable current/future commitments, revokes both
outgoing and incoming actionable delegations, revokes active sessions, writes a
safe actor/target audit event, and sets `User.isActive=false`. A registration
with `status=ACTIVE` **and a `mealServing` relation is already served** and MUST
not be cancelled or have its serving changed. `SERVED` is only a legacy status
projection; checking `status != SERVED` is insufficient.

Enable is idempotent and only sets `User.isActive=true` when needed plus a safe
audit event for a real transition. It never restores cancelled registrations,
revoked delegations, sessions, penalties, meals, or allowlist state. Revoke-all
is idempotent, uses `ADMIN_REVOKED`, and leaves the account active.

## 2. Repository findings and existing boundaries

### 2.1 Branch/worktree evidence

Research was performed without resetting, fetching, committing, or pushing:

- Worktree is `deploy/develop` at `cd38659be9e95fd491a1758fa5d64905e4bf4664`.
- `git ls-remote origin refs/heads/deploy/develop` returned the same SHA.
- `git status --porcelain=v1` was empty; the branch was clean before these two
  documentation files were created.
- The target worktree is isolated from the separate local `master` worktree.

### 2.2 API module surface

There is no current `apps/api/src/admin/users` module. Existing admin modules
use Nest controllers, `SessionGuard`, `PermissionsGuard`,
`@RequirePermission(...)`, injected `PrismaService`, strict Zod parsing at the
controller boundary, and dual route decorators. `app.module.ts` imports admin
weekly-menu and penalty modules; the new users module must be added there and
must import `AuthModule` (and the existing notifications/domain collaborator
only where required).

There is no current API audit export controller. `AuditLog.userId` is the actor
field by convention; target IDs and safe counts are stored in structured JSON
`details`, matching existing penalty, roster and session audit patterns.

### 2.3 Persistence facts

The current Prisma schema has:

- `User(id,email,name,isActive,...)` and direct `UserRole` composite rows.
- Canonical `Role` rows (`staff`, `kitchen`, `admin`) and
  `RolePermission`/`UserPermission` authorization data.
- `EmployeeLocationAssignment(userId, normalizedEmail, employeeCode, role,
isActive, locationId, effectiveFrom/effectiveTo, ...)`; its `role` is not a
  UserRole and is not an authorization grant.
- `OtpAllowlist.state` independent of `User.isActive`.
- `AuthSession` with `tokenHash`, created/last-used/idle/absolute expiry,
  revoked timestamp/reason and hashed device/IP/user-agent metadata.
- `Registration(status, mealDate,...)` with optional `mealServing` and optional
  penalties.
- `PickupDelegation.status` with a partial unique index for active
  `PENDING|ACCEPTED` rows per registration.
- `AuditLog(userId, action, details, createdAt)` with no target column.

The existing canonical migration provisions roles and permissions, and the local
synthetic seed deliberately resolves canonical roles rather than creating role
definitions. `user.manage` must be added through the same authoritative
role/permission provisioning path and assigned to the canonical `admin` role;
there must be no API startup upsert, local-only bootstrap, or competing
permission mechanism.

### 2.4 Session behavior to preserve

`SessionService` currently hashes the opaque token before lookup, checks revoked
and both expiry boundaries, re-reads nested UserRole/RolePermission and
UserPermission on every resolve, refreshes idle expiry, and returns a principal
with current `roles` and `permissions`. Disabled users are rejected and the
session is marked `ACCOUNT_DISABLED`. The new module must call the same database
session tables and revocation reason enum. It must not expose `tokenHash` or
raw token values in any response, audit detail, log, or test fixture assertion.

### 2.5 Lifecycle behavior already present

The old partial `disableUserAccount` helper in
`packages/domain/src/RegistrationService.ts` has been removed. The API
`AdminUsersService.disable` transaction is the sole supported account-disable
cleanup path; it owns preview-confirmed registration cleanup, incoming and
outgoing delegation scope, active-session revocation, advisory recovery locking,
and idempotent lifecycle/audit results. Ordinary registration cancellation still
uses `RegistrationService.cancelRegistration`, which is not an account-disable
entry point.

Kitchen dashboard and no-show processing already treat `mealServing` as the
served projection and select no-show candidates with `status=ACTIVE`, active
user, and `mealServing=null`. Those downstream predicates are part of the
acceptance proof; disable must not create a cancellation that enters
preparation totals or no-show/penalty processing.

## 3. Contract and route design

The new contract file is the single shared source for API/Admin Web/mobile
transport types. Every object is strict. Timestamps are UTC ISO strings ending
in `Z`; dates are canonical `YYYY-MM-DD`; IDs follow existing project ID
constraints (`z.string().min(1)` is acceptable for compatibility fixtures).
Responses below are the direct JSON payloads returned by the controller. There
is no additional `data` envelope for these endpoints.

### 3.1 Shared role, status, location and audit primitives

```ts
export const AdminManagedRoleSchema = z.enum(['staff', 'kitchen']);
export type AdminManagedRole = z.infer<typeof AdminManagedRoleSchema>;

export const AdminUserStatusFilterSchema = z.enum([
  'ALL',
  'ACTIVE',
  'DISABLED',
]);
export const AdminUserRoleFilterSchema = z.enum([
  'ALL',
  'staff',
  'kitchen',
  'admin',
  'unmanaged',
]);

export const AdminSafeLocationSummarySchema = z
  .object({
    id: z.string().min(1),
    shortCode: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();

export const AdminUserAuditActionSchema = z.enum([
  'USER_ROLES_UPDATED',
  'USER_DISABLED',
  'USER_ENABLED',
  'USER_SESSIONS_REVOKED',
]);
```

A safe location summary contains no coordinates, geofence policy, scanner IDs,
private contacts, raw operational JSON, or GPS evidence. `managedRoles` always
comes from current `UserRole` rows for `staff`/`kitchen`; an assignment's
`rosterRole` is displayed separately and never merged into this array.

### 3.2 List

```ts
export const AdminUserListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(100).optional(),
    status: AdminUserStatusFilterSchema.default('ALL'),
    role: AdminUserRoleFilterSchema.default('ALL'),
  })
  .strict();

export const AdminUserListItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().email(),
    isActive: z.boolean(),
    managedRoles: z.array(AdminManagedRoleSchema),
    employeeCode: z.string().nullable(),
    effectiveServiceLocation: AdminSafeLocationSummarySchema.nullable(),
    activeSessionCount: z.number().int().nonnegative(),
  })
  .strict();

export const AdminUserListResponseSchema = z
  .object({
    items: z.array(AdminUserListItemSchema),
    pagination: PagePaginationMetaSchema,
  })
  .strict();
```

Search is bounded and server-side over normalized name/email plus a resolvable
employee code. Employee code resolution must account for existing assignment
rows that identify a user by `userId` or normalized email. The effective
assignment is evaluated for the current Vietnam business date and is null when
none or more than one effective active assignment can be safely selected.
`activeSessionCount` counts sessions that are not revoked and are before both
absolute and idle expiry at the server's captured `now`; it does not mutate
expired rows.

Role filtering uses UserRole only: `admin` is a filter, not a manageable input;
`unmanaged` means no `staff`/`kitchen` UserRole. A roster `role='KITCHEN'`
assignment alone MUST NOT make the user pass the `kitchen` filter.

### 3.3 Detail

```ts
export const AdminUserDetailSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().email(),
    isActive: z.boolean(),
    managedRoles: z.array(AdminManagedRoleSchema),
    allRoles: z.array(z.string().min(1)),
    employeeCode: z.string().nullable(),
    effectiveServiceLocation: AdminSafeLocationSummarySchema.nullable(),
    rosterAssignment: z
      .object({
        id: z.string().min(1),
        employeeCode: z.string().min(1),
        rosterRole: z.string().min(1),
        isActive: z.boolean(),
        effectiveTo: UtcDateTimeSchema.nullable(),
        serviceLocation: AdminSafeLocationSummarySchema.nullable(),
      })
      .strict()
      .nullable(),
    allowlist: z
      .object({
        state: z.enum(['ACTIVE', 'DISABLED']),
        effectiveFrom: UtcDateTimeSchema,
        effectiveTo: UtcDateTimeSchema.nullable(),
      })
      .strict()
      .nullable(),
    sessions: z
      .object({
        activeCount: z.number().int().nonnegative(),
        totalCount: z.number().int().nonnegative(),
      })
      .strict(),
    lifecycle: z
      .object({
        createdAt: UtcDateTimeSchema,
        updatedAt: UtcDateTimeSchema,
        lastRoleChangeAt: UtcDateTimeSchema.nullable(),
        lastDisableAt: UtcDateTimeSchema.nullable(),
        lastEnableAt: UtcDateTimeSchema.nullable(),
        lastSessionRevokeAt: UtcDateTimeSchema.nullable(),
      })
      .strict(),
    auditSummary: z
      .object({
        recent: z.array(AdminUserAuditEntrySchema).max(25),
        actionCounts: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strict(),
  })
  .strict();
```

`allRoles` is the complete current UserRole set, including `admin` and future
server-side roles. It is read-only in this Admin Web surface. Audit entries are
serialized by an allowlisted safe formatter; arbitrary persisted text is not
returned merely because it is in `AuditLog.details`.

### 3.4 Role replacement

```ts
export const AdminUserRolesUpdateRequestSchema = z
  .object({
    roles: z
      .array(AdminManagedRoleSchema)
      .max(2)
      .superRefine((roles, ctx) => {
        if (new Set(roles).size !== roles.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Duplicate role',
          });
        }
      }),
  })
  .strict();

export const AdminUserRolesUpdateResponseSchema = z
  .object({
    userId: z.string().min(1),
    managedRoles: z.array(AdminManagedRoleSchema),
    allRoles: z.array(z.string().min(1)),
    changed: z.boolean(),
    updatedAt: UtcDateTimeSchema,
  })
  .strict();
```

The API rejects `admin`, unknown strings, duplicate entries, non-array input,
and extra keys before opening a transaction. In the transaction it locks the
user row, reads current role names, deletes only current `staff`/`kitchen`
relations not in the desired set, and inserts missing desired relations. The
admin relation and all other roles are preserved. A same-set request returns
`changed:false` and does not write an audit row. A changed request writes
`USER_ROLES_UPDATED` with actor in `AuditLog.userId` and JSON details containing
only `{targetUserId, previousManagedRoles, nextManagedRoles}`. Unmanaged roles
are preserved but are not copied into this lifecycle detail. No session is
revoked or token minted.

### 3.5 Disable preview and mutation

```ts
export const AdminUserDisablePreviewItemSchema = z
  .object({
    id: z.string().min(1),
    mealDate: MealDateSchema,
    serviceLocation: AdminSafeLocationSummarySchema.nullable(),
  })
  .strict();

export const AdminUserDisablePreviewResponseSchema = z
  .object({
    userId: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().email(),
    isActive: z.boolean(),
    managedRoles: z.array(AdminManagedRoleSchema),
    allRoles: z.array(z.string().min(1)),
    activeSessionCount: z.number().int().nonnegative(),
    actionableFromDate: MealDateSchema,
    generatedAt: UtcDateTimeSchema,
    registrations: z
      .object({
        count: z.number().int().nonnegative(),
        items: z.array(AdminUserDisablePreviewItemSchema).max(25),
      })
      .strict(),
    outgoingDelegations: z
      .object({
        count: z.number().int().nonnegative(),
        items: z
          .array(
            z
              .object({
                id: z.string().min(1),
                registrationId: z.string().min(1),
                mealDate: MealDateSchema,
                status: z.enum(['PENDING', 'ACCEPTED']),
              })
              .strict(),
          )
          .max(25),
      })
      .strict(),
    incomingDelegations: z
      .object({
        count: z.number().int().nonnegative(),
        items: z
          .array(
            z
              .object({
                id: z.string().min(1),
                registrationId: z.string().min(1),
                mealDate: MealDateSchema,
                status: z.enum(['PENDING', 'ACCEPTED']),
              })
              .strict(),
          )
          .max(25),
      })
      .strict(),
  })
  .strict();

export const AdminUserDisableRequestSchema = z
  .object({
    confirm: z.literal(true),
  })
  .strict();

export const AdminUserDisableResponseSchema = z
  .object({
    userId: z.string().min(1),
    isActive: z.literal(false),
    changed: z.boolean(),
    affected: z
      .object({
        registrationsCancelled: z.number().int().nonnegative(),
        delegationsRevoked: z.number().int().nonnegative(),
        sessionsRevoked: z.number().int().nonnegative(),
      })
      .strict(),
    auditCreated: z.boolean(),
    completedAt: UtcDateTimeSchema,
  })
  .strict();
```

Preview captures one server `now` and derives `actionableFromDate` with the
existing `getBusinessDate()`/`parseMealDate()` Vietnam helpers. It includes
only current/future registrations whose current row is actionable:
`status=ACTIVE`, no `mealServing`, and no existing penalty record. This is a
relation check, not an enum check. Thus an `ACTIVE` row with a `mealServing`
relation is excluded even though its legacy status is not `SERVED`. Today's
still-unserved ACTIVE row is included. Past rows, `NO_SHOW`, legacy `SERVED`,
cancelled rows, rows with `mealServing`, and rows with an existing penalty
record are excluded.

Outgoing delegations are active `PENDING|ACCEPTED` rows on the target user's
own actionable registrations. Incoming delegations are active `PENDING|ACCEPTED`
rows where the target is delegate and another user owns the actionable
registration. Declined, revoked, completed and served/finalized history is not
previewed or revoked.

Disable requires exactly `confirm:true`. The transaction re-reads all facts;
it never trusts a count from preview. It reports counts of rows changed by this
request, not historical totals. If the user is already disabled, it returns
`changed:false`, all zero counts, and writes no new audit or lifecycle rows.
A successful active-to-disabled transition writes one `USER_DISABLED` event
with actor in `AuditLog.userId`, target in details, safe counts and completion
instant. The actor/target IDs are opaque IDs only; no token, hash, OTP, raw GPS,
or arbitrary exception text is persisted.

### 3.6 Enable

```ts
export const AdminUserEnableRequestSchema = z.object({}).strict();
export const AdminUserEnableResponseSchema = z
  .object({
    userId: z.string().min(1),
    isActive: z.literal(true),
    changed: z.boolean(),
    auditCreated: z.boolean(),
    completedAt: UtcDateTimeSchema,
  })
  .strict();
```

Enable locks and re-reads the user. It sets `isActive=true` only when disabled,
then writes `USER_ENABLED` with actor/target safe details. A repeated enable has
no historical write and never restores anything disabled previously. It does
not touch `OtpAllowlist`, `EmployeeLocationAssignment`, registrations,
delegations, penalties, or sessions.

### 3.7 Session list and revoke-all

```ts
export const AdminUserSessionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    includeRevoked: z.coerce.boolean().default(true),
  })
  .strict();

export const AdminUserSessionSchema = z
  .object({
    id: z.string().min(1),
    createdAt: UtcDateTimeSchema,
    lastUsedAt: UtcDateTimeSchema.nullable(),
    idleExpiresAt: UtcDateTimeSchema.nullable(),
    absoluteExpiresAt: UtcDateTimeSchema,
    revokedAt: UtcDateTimeSchema.nullable(),
    revokedReason: z
      .enum([
        'LOGOUT',
        'ACCOUNT_DISABLED',
        'COMPROMISED',
        'OTP_REPLAY',
        'ADMIN_REVOKED',
        'EXPIRED',
      ])
      .nullable(),
    isActive: z.boolean(),
  })
  .strict();

export const AdminUserSessionsResponseSchema = z
  .object({
    items: z.array(AdminUserSessionSchema),
    pagination: PagePaginationMetaSchema,
  })
  .strict();

export const AdminUserRevokeAllRequestSchema = z.object({}).strict();
export const AdminUserRevokeAllResponseSchema = z
  .object({
    userId: z.string().min(1),
    isActive: z.boolean(),
    revokedCount: z.number().int().nonnegative(),
    reason: z.literal('ADMIN_REVOKED'),
    changed: z.boolean(),
    auditCreated: z.boolean(),
    completedAt: UtcDateTimeSchema,
  })
  .strict();
```

Session serialization explicitly selects only safe metadata. It never selects or
returns `tokenHash`, device/client/user-agent hashes, bearer tokens, OTP values,
provider payloads, or database request metadata. `isActive` is calculated from
revocation and expiry at one captured server time. Revoke-all uses a transaction
and `updateMany({where:{userId,revokedAt:null},data:{revokedAt,revokedReason:'ADMIN_REVOKED'}})`;
the returned count is the actual new count. It writes a
`USER_SESSIONS_REVOKED` audit only when count > 0 and leaves the account status
unchanged. A later protected request sees `SESSION_INVALID`.

### 3.8 Audit

```ts
export const AdminUserAuditQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    action: AdminUserAuditActionSchema.optional(),
    from: UtcDateTimeSchema.optional(),
    to: UtcDateTimeSchema.optional(),
  })
  .strict();

export const AdminUserAuditEntrySchema = z
  .object({
    id: z.string().min(1),
    action: AdminUserAuditActionSchema,
    actorUserId: z.string().min(1).nullable(),
    targetUserId: z.string().min(1),
    createdAt: UtcDateTimeSchema,
    details: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
  })
  .strict();

export const AdminUserAuditResponseSchema = z
  .object({
    items: z.array(AdminUserAuditEntrySchema),
    pagination: PagePaginationMetaSchema,
  })
  .strict();
```

The `GET /:userId/audit` route returns only lifecycle actions whose structured
details pass an allowlist serializer. `targetUserId` is extracted from details
for response shape, while persistence keeps the existing actor `AuditLog.userId`
convention. The response is bounded and paginated; it is not an unbounded data
dump.

## 4. Authorization and error behavior

Every controller uses `SessionGuard` then `PermissionsGuard`, and each route is
annotated with `@RequirePermission('user.manage')`. The guard must therefore
observe a role/permission change through the existing `SessionService.resolve`
path on the very next protected request. Admin Web route visibility is not a
security boundary.

The implementation should add stable machine-readable lifecycle errors to the
shared error code union as needed by existing exception mapping:

- `ADMIN_USER_NOT_FOUND`
- `ADMIN_USER_ROLE_INVALID`
- `ADMIN_DISABLE_CONFIRMATION_REQUIRED`
- `ADMIN_SELF_DISABLE_FORBIDDEN`
- `ADMIN_LAST_ACTIVE_ADMIN`
- `ADMIN_USER_STATE_CONFLICT`
- `ADMIN_AUDIT_EXPORT_INVALID`

Unknown target IDs should not disclose unrelated account information. A role
body containing `admin`, an unknown role, duplicates, or extra keys fails before
writes. Disable without `confirm:true` fails before opening the transaction.
Self-disable is rejected. Disabling the last active admin is rejected even when
the target is a different account and even under concurrent disable requests.

## 5. Transaction and concurrency design

### 5.1 Common user lock

Role replacement, enable, disable and all-admin lifecycle checks use a real
PostgreSQL transaction and the same row-lock convention:

```sql
SELECT id, is_active
FROM users
WHERE id = $targetUserId
FOR UPDATE;
```

The row is re-read after lock; no pre-transaction object or preview count is
trusted. No process-local mutex is permitted.

### 5.2 Disable lock order and served race

To preserve the lock order used by serving confirmation (registration rows,
then account rows), disable MUST:

1. Capture `now`, derive the Vietnam business date, and begin a transaction.
2. Acquire the global recovery-path advisory lock using the existing
   `pg_advisory_xact_lock(hashtextextended(...))` convention. This lock is held
   for the transaction and serializes active-admin recovery checks across
   distinct target accounts.
3. Select and lock all target-owned current/future `ACTIVE` registration rows
   (including rows that currently have `mealServing` or penalties), ordered by
   `(meal_date,id)`, with `FOR UPDATE OF registrations`.
4. Select and lock rows containing incoming active delegations on another
   user's actionable registration, in deterministic registration/delegation ID
   order. Lock registration rows before delegation rows.
5. Lock and re-read the target user using the common user lock.
6. If target is actor, reject self-disable. If target has `admin`, count active
   admin users while the global lock is held; reject if it is the last active
   admin. This check includes concurrent requests because every disable uses the
   same advisory key.
7. Re-read each locked registration including `mealServing` and penalties.
   Cancel only `status=ACTIVE`, `mealServing IS NULL`, non-finalized rows with
   `cancelReason=ACCOUNT_DISABLED`, actor and timestamp fields. An
   `ACTIVE+mealServing` row is skipped, never deleted, never status-rewritten,
   and never has its immutable serving altered.
8. Revoke only `PENDING|ACCEPTED` delegations attached to those cancelled
   registrations or incoming to the target on actionable registrations. Keep
   delegation rows on existing-penalty/served registrations unchanged. Use
   existing notification and outbox dedupe behavior for newly revoked
   delegations where required.
9. Set `User.isActive=false`, revoke every active session with
   `ACCOUNT_DISABLED`, create the lifecycle audit, and commit all writes
   atomically.

If serving wins the registration lock first, disable waits and then observes
`mealServing` and skips that row. If disable wins first, serving confirmation
waits and then rejects the cancelled row. This gives exactly one durable outcome
without cancelling a served commitment. Tests MUST include an `ACTIVE` row with
an existing `mealServing` relation and both lock acquisition orders.

### 5.3 Roles, enable and revoke-all races

Role update and enable use the user row lock and re-read current state. Repeated
same-state requests perform no historical writes. Revoke-all locks the target
user row before `updateMany`, making account lifecycle ordering deterministic;
its session rows are updated only where they are currently active (not revoked
and before both absolute and idle expiry).

Role updates do not lock or modify registrations, sessions, roster assignments,
or allowlist rows. Enable does not resurrect any cancellation or delegation.

## 6. Downstream invariants

The implementation must verify, and patch only if a focused regression proves a
gap, that:

- Kitchen preparation/dashboard excludes valid `CANCELLED` rows and disabled
  users, while retaining immutable served history. It must continue deriving
  served state from `mealServing`, including `status=ACTIVE+mealServing`.
- No-show candidates remain `ACTIVE`, active user, `mealServing IS NULL`; an
  `ACCOUNT_DISABLED` cancellation cannot receive a new penalty.
- Registration history and serving snapshots remain immutable. Disable does not
  remove `MealServing`, rewrite owner/location/menu snapshots, or alter
  `SERVED` history.
- Enable keeps `ACCOUNT_DISABLED` cancellation and `REVOKED` delegation states,
  keeps penalties unchanged, and does not re-enable an independently disabled
  OTP allowlist row.
- Roster assignment role/isActive and UserRole are separately reported and
  independently mutable.

## 7. Required test matrix

Focused unit/controller tests plus real-DB integration/e2e tests are required;
mock-only forwarding tests are not sufficient.

### Authorization and contracts

- Staff/kitchen principals receive 403; an authorized principal with
  `user.manage` succeeds.
- Strict Zod requests reject `admin`, unknown and duplicate managed roles,
  extra keys, invalid filters, unbounded limits, and missing disable confirm.
- Both route prefixes resolve identically.
- Contract privacy rejects session hashes/tokens and unsafe audit details.

### Roles and sessions

- All transitions: unmanaged → staff, kitchen, both; staff ↔ kitchen; both →
  one; both → unmanaged; admin-only remains admin; admin+staff preserves admin;
  unknown future role is preserved.
- `EmployeeLocationAssignment.role/isActive` changes do not grant/revoke
  UserRole, in both directions.
- Existing session observes a role update on its next request and loses Kitchen
  403 immediately when `kitchen`/permission is removed; no token changes.
- Sessions list exposes only explicit safe metadata and computed activity.
- Revoke-all returns actual new count, `ADMIN_REVOKED`, is idempotent, and keeps
  account active.

### Preview/disable/enable

- Preview uses Vietnam business today, includes today's and future actionable
  registrations, excludes finalized history, no-show, cancelled and
  `ACTIVE+mealServing` rows.
- Preview contains both outgoing owner delegations and incoming delegate
  delegations, only `PENDING|ACCEPTED`.
- Disable is atomic: user status, cancellation fields, both delegation
  directions, sessions and audit either all commit or none do.
- Returned counts are actual newly affected counts. Repeated disable produces no
  additional historical audit/notifications/penalties.
- Served/history, immutable `MealServing`, completed/revoked delegations and
  existing penalties are unchanged; no new penalty is created.
- Old session resolves to `SESSION_INVALID`; OTP request/verify remains denied
  by independent disabled allowlist/account rules as applicable.
- Enable preserves cancelled/revoked/penalty history, does not restore sessions
  or meals, and does not modify allowlist state.
- Self-disable is rejected; last-active-admin recovery path is rejected.
- Two concurrent disables of distinct admin accounts cannot both remove the
  final recovery admin. Concurrent disable/serve races preserve the
  `ACTIVE+mealServing` invariant.

### Audit

- Every real role/disable/enable/revoke-all transition has an actor-safe audit
  with target ID in structured details.
- No-op retries do not create historical audit rows.
- The `GET /:userId/audit` response is bounded, paginated, action-filterable,
  and redacts secrets, tokens, hashes, OTP/GPS/provider content and arbitrary
  details.

## 8. Non-goals

- No JWT changes, token format changes, refresh-token design, federated auth, or
  alternate login path.
- No Admin Web/mobile edits in this backend/contract workstream.
- No admin-role grant/revoke API; admin lifecycle remains an external/server-only
  operation.
- No roster import redesign or role inference from CSV.
- No allowlist/account coupling beyond existing authentication checks.
- No unbounded audit/export endpoint, production seed data, fabricated roster,
  location, coordinate, employee or secret.
