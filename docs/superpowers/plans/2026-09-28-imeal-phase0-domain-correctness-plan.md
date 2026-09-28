# IMeal Workstream A — Phase 0 Domain Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Phase 0 domain-correctness cutover so registration snapshots, pickup/serving, Kitchen dashboard projections, and no-show penalties remain authoritative and race-safe with real data.

**Architecture:** PostgreSQL remains the source of truth. Additive schema/migration work preserves legacy rows without fabricating facts; new registration writes resolve menu revision and roster/location snapshots in one transaction. `meal_servings` is the canonical served projection, dashboard reads one consistent registration/serving state set, and each no-show transaction locks its registration before creating one unique penalty and its post-commit outbox event.

**Tech Stack:** NestJS/Fastify + TypeScript, Prisma 5.22/PostgreSQL, Zod shared contracts, Vitest, `@imeal/core` domain tests, API/worker e2e tests, PostgreSQL `FOR UPDATE`/unique indexes, transactional `OutboxEvent`.

**Spec:** `docs/superpowers/specs/2026-09-28-imeal-phase0-domain-correctness-design.md`

## Global Constraints

- Follow the approved spec and canonical docs in this order: `docs/README.md`, `docs/01-product-requirements.md`, `docs/03-product-flows.md`, `docs/05-backend-structure.md`, `docs/02-technical-requirements.md`.
- `Asia/Ho_Chi_Minh` is the business timezone; serving is `10:30–13:30`; no-show domain eligibility is `server time >= 13:30`, while the normal worker scheduler first runs at `13:45`. Do not make the worker cron process at 13:30 unless the existing explicit `force` path is used.
- `SERVED` is derived from an immutable `meal_servings` row. Keep the existing Prisma enum value only for legacy reads/wire compatibility; new serving writes MUST NOT create a duplicate registration `status='SERVED'`. Legacy `status='SERVED'` is valid only with a serving.
- `ACTIVE + mealServing` is a valid served projection. `SERVED + mealServing=null`, `NO_SHOW + mealServing`, and `CANCELLED + mealServing` fail closed with the existing `INTERNAL_SERVER_ERROR` envelope and operator-only diagnostics; do not invent a new public error code.
- New writes resolve menu revision, owner/employee snapshots, roster assignment, and location server-side. Client requests MUST NOT supply `locationId`, menu revision, employee code, status `SERVED`, status `NO_SHOW`, or penalty authority.
- Existing routes remain exact: `PUT /api/registrations/batch`; `POST /internal/api/v1/pickup/resolve`, `/v1/internal/pickup/resolve`, `/api/serving/resolve`; `POST /internal/api/v1/pickup/confirm`, `/v1/internal/pickup/confirm`, `/api/serving/confirm`; `GET /v1/kitchen/days/:date/dashboard` and `/api/kitchen/days/:date/dashboard`.
- Preserve the server-authoritative success/error envelopes, `X-Request-Id`, stable error codes, exact sorted pickup intent, and `(callerUserId,idempotencyKey,requestBodyHash)` serving idempotency. Do not add a registration or penalty create route.
- Legacy null or ambiguous snapshots fail closed for registration reactivation and pickup/serving. Backfill only from exact one-to-one evidence; never use current assignment/menu/location to fabricate history and never insert real operational rows.
- `Penalty.registrationId` is the database uniqueness authority. No-show registration, penalty, audit, notification, and dashboard outbox writes are all-or-nothing per registration.
- Realtime client work is out of scope. This plan changes only backend event types, post-commit emission, and transactional outbox rows required by the approved spec.
- Do not run tests, builds, migrations, or formatters while writing this plan. The commands below are for the later implementation execution, not for this planning session.
- Do not commit as part of this plan; the implementation owner will use the repository’s approved integration workflow after all gates pass.

---

## File structure and responsibility map

### Database and migration

- **Modify:** `packages/domain/prisma/schema.prisma:10-15,217-269,271-299,316-385,398-417,497-512`
  - Retain current enum names for compatibility.
  - Add registration lifecycle/menu/owner snapshots, complete menu revision fields, MealDay lock/menu snapshots, serving menu snapshots, and penalty registration identity.
- **Create:** `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/migration.sql`
  - Add only nullable columns, indexes, FKs, and `NOT VALID` lifecycle checks; do not mutate existing rows or insert operational data.
- **Create:** `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/preflight.sql`
  - Read-only report for incomplete snapshots, ambiguous assignments/revisions, status/serving mismatches, and duplicate penalty candidates. It must never mutate rows.
- **Create:** `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/backfill.sql`
  - Idempotent exact-one-to-one backfill statements run only after the expanded schema is deployed and the preflight report is approved; never infer unknown history.
- **Modify:** `packages/domain/test/emailOtpLocationServing.test.ts`
  - Assert the new persistence fields, legacy-null policy, restrictive serving relation, and unique penalty identity.

### Shared contracts

- **Modify:** `packages/contracts/src/v1/registrations.ts:30-119,154-186`
  - Keep batch request authority unchanged; add server-returned `menuRevisionId`, menu content fields, and legacy-null representation.
- **Modify:** `packages/contracts/src/v1/kitchen.ts:40-77`
  - Add `state: 'PENDING'|'SERVED'|'NO_SHOW'` to list items while retaining `isServed` during this cutover.
- **Modify:** `packages/contracts/src/v1/penalties.ts:6-22`
  - Add nullable legacy-aware `registrationId` and `mealDate` response fields.
- **Do not modify:** `packages/contracts/src/v1/pickup.ts:117-164`
  - Keep exact sorted intent, QR input, resolved session input, and idempotency key unchanged.
- **Test:** `packages/contracts/test/contracts.test.ts`
  - Parse strict new response fields and reject client-supplied authority.

### API registration and pickup

- **Modify:** `apps/api/src/registrations/registrations.service.ts:237-428`
  - Add transaction-local menu/assignment/location resolution and immutable snapshot writes to `batchRegister`.
- **Test:** `apps/api/src/registrations/registrations.service.spec.ts:235-458`
  - Cover create, update, reactivation, cancellation, cutoff, missing authority, and raced unique create.
- **Modify:** `apps/api/src/admin/weekly-menus/weekly-menus.service.ts:60-176,179-247`
  - Populate complete revision/MealDay snapshots and update only eligible active registration revisions inside the existing menu-publish transaction.
- **Test:** `apps/api/src/admin/weekly-menus/weekly-menus.service.spec.ts:1-160`
  - Prove revision numbering, active-registration revision updates, and exclusion of final/cancelled rows.
- **Modify:** `apps/api/src/admin/weekly-menus/weekly-menus.controller.ts:41-53`
  - Pass the authenticated admin actor ID into menu update/publish service calls without adding a route or changing the URL.
- **Modify:** `apps/api/src/admin/weekly-menus/dto/weekly-menus.schema.ts:16-21`
  - Accept server-validated revision content fields required for complete new immutable revisions; do not change pickup/registration client authority.
- **Modify:** `apps/api/src/pickup/pickup.service.ts:287-470,951-1646`
  - Enforce complete snapshot reads, remove historical fallbacks, copy registration snapshots into serving, preserve all-or-nothing confirmation, and stop writing duplicate `status='SERVED'`.
- **Test:** `apps/api/src/pickup/pickup.service.spec.ts`
  - Cover stale snapshots, exact intent, serving snapshot copy, idempotency, race, rollback, and post-commit events.
- **Keep route declarations:** `apps/api/src/pickup/internal-pickup.controller.ts:11-33`
  - Only map new internal failures into the existing envelope; do not add aliases.

### API dashboard and backend events

- **Modify:** `apps/api/src/kitchen/kitchen-dashboard.service.ts:31-249`
  - Replace ACTIVE-only selection with the canonical projection and generic `INTERNAL_SERVER_ERROR` fail-closed behavior.
- **Test:** `apps/api/src/kitchen/kitchen-dashboard.service.spec.ts:42-274`
  - Cover all state/list/counter boundaries and post-commit event timing.
- **Modify:** `apps/api/src/kitchen/kitchen-events.service.ts:6-94`
  - Add `NO_SHOW_RECONCILED` and `REGISTRATION_CHANGED` event types while preserving `{eventId,eventType,mealDate,occurredAt,requestId,payload}`.

### Worker and penalty administration

- **Modify:** `apps/worker/src/no-show-worker.service.ts:43-213`
  - Retain the 13:45 cron gate; process candidates one registration transaction at a time with row locks, unique penalty identity, rollback, retry, and outbox writes.
- **Test:** `apps/worker/src/no-show-worker.service.spec.ts:69-426`
  - Replace reason-based mock idempotency with registration-key behavior and add 13:30/13:45, rollback, retry, and paid/waived tests.
- **Modify:** `apps/api/src/admin/penalties/penalties.service.ts:133-281`
  - Map new relation fields and keep only row-locked `PENDING -> PAID|WAIVED` mutations; admin does not create no-show penalties.

### Cross-layer and rollout tests/docs

- **Modify:** `packages/domain/test/concurrency.test.ts:16-402`
  - Update serving expectations to the derived projection and add registration/no-show/serving/cancel/delegation races against real PostgreSQL.
- **Modify:** `apps/api/test/registrations.e2e-spec.ts`, `apps/api/test/pickup.e2e-spec.ts`, `apps/api/test/kitchen-dashboard.e2e-spec.ts`
  - Preserve exact routes/envelopes and add consumer-visible snapshot, projection, and fail-closed scenarios.
- **Modify:** `docs/05-backend-structure.md:257-326,353-405,623-679`, `docs/03-product-flows.md:176-258`, `docs/06-execution-plan.md` Phase 0 checklist, and the P0 rows in `docs/imeal-production-readiness-assessment.md`
  - Record the implemented state model, migration gate, timing distinction, and evidence only after implementation verification.

---

## Task 1: Additive Prisma schema, read-only preflight, and safe migration

**Files:**
- Modify: `packages/domain/prisma/schema.prisma:247-299,341-417`
- Create: `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/preflight.sql`
- Create: `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/backfill.sql`
- Create: `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/migration.sql`
- Test: `packages/domain/test/emailOtpLocationServing.test.ts`

**Interfaces and data fields:**

- Add nullable legacy-compatible `Registration` fields: `menuRevisionId`, `ownerNameSnapshot`, `employeeCodeSnapshot`, `menuNameSnapshot`, `menuDescriptionSnapshot`, `menuImageSnapshot`, `registeredAt`, `cancelledAt`, `cancelReason`, `cancelledByUserId`, `noShowAt`.
- Add `DailyMenuRevision.revision`, `mealName`, `description`, `imageUrl`, `createdByUserId`, plus unique `(dailyMenuId, revision)`; retain legacy `content` for rows that cannot be proven complete.
- Add `MealDay.menuNameSnapshot`, `menuDescriptionSnapshot`, `menuImageSnapshot`, `lockedAt`, `serviceStartAt`, `serviceEndAt`.
- Add `MealServing.menuNameSnapshot`, `menuDescriptionSnapshot`, `menuImageSnapshot`.
- Add nullable `Penalty.registrationId` FK with `onDelete: Restrict` and `mealDate`; create a partial unique index on non-null `registration_id`.
- Add restrictive `Registration.menuRevisionId -> DailyMenuRevision.id` and its relation/index. Preserve the current location relation delete behavior; historical location snapshot columns, not a new delete policy, are the source of pickup validation. Keep `RegistrationStatus.SERVED` readable but do not make it the serving authority.

**Preflight SQL output contract:** emit a first result set with one row per named check and columns `check_name`, `affected_count`, and `sample_ids`; every `sample_ids` value is built with `ARRAY(SELECT ... ORDER BY id LIMIT 20)` and therefore contains at most 20 IDs. Emit a second result set with `registration_status` and `row_count` for `ACTIVE`, `CANCELLED`, `SERVED`, and `NO_SHOW`. Never include names, emails, addresses, coordinates, or other sensitive values.

The named checks are exactly:

- `registration_snapshot_incomplete`: non-cancelled registration missing any required lifecycle/menu/location/owner snapshot.
- `registration_serving_mismatch`: `SERVED` without serving, `NO_SHOW` with serving, or `CANCELLED` with serving.
- `roster_assignment_ambiguous`: registration date/user maps to zero or more than one active effective roster assignment.
- `menu_revision_incomplete`: registration revision is missing, missing from `daily_menu_revisions`, or lacks a verified required menu field.
- `penalty_registration_mapping_ambiguous`: legacy penalty has no exact one-to-one registration/date mapping.
- `penalty_registration_duplicate_candidate`: two legacy penalties resolve to one registration identity.
- `future_active_snapshot_incomplete`: a future `ACTIVE` row remains incomplete after exact approved backfill.

Use this bounded-query shape for each check (the CTE predicate is replaced by that check’s exact predicate):

```sql
WITH affected AS (
  SELECT r.id
  FROM registrations AS r
  WHERE r.status <> 'CANCELLED'
    AND (r.menu_revision_id IS NULL OR r.owner_name_snapshot IS NULL)
),
summary AS (
  SELECT count(*)::int AS affected_count,
         ARRAY(SELECT id FROM affected ORDER BY id LIMIT 20)::text[] AS sample_ids
  FROM affected
)
SELECT 'registration_snapshot_incomplete' AS check_name,
       affected_count,
       sample_ids
FROM summary;
```

For the status/serving check, use the same `affected`/`summary` shape with a `LEFT JOIN meal_servings` and predicate `(r.status = 'SERVED' AND ms.id IS NULL) OR (r.status IN ('NO_SHOW','CANCELLED') AND ms.id IS NOT NULL)`. For legacy penalty mapping, recognize only `^NO_SHOW_PENALTY_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9a-fA-F-]{36}$` and return non-matching or multi-matching rows as affected. The final SQL must include the same bounded shape for all seven named checks; it must not delete, merge, or fabricate a row.


- [ ] **Step 1: Add schema fields and relations without changing legacy enum names.**
  - Update Prisma model declarations exactly as listed above.
  - Keep new fields nullable during the expand phase so the migration can inspect real legacy rows before enforcement.
  - Add the partial unique index and restrictive FKs in the migration SQL, not a Prisma `@@unique` that would reject multiple legacy nulls. Name the new checks `registration_lifecycle_snapshot_complete` and `registration_serving_consistency`.

- [ ] **Step 2: Write the read-only preflight SQL.**
  - Use `SET TRANSACTION READ ONLY` and `SET LOCAL statement_timeout = '30s'`.
  - Return the seven named check rows with bounded IDs and the separate four-status count result set; never update/insert/delete.
  - Include the 13:30 serving-end/no-show eligibility only as a report label; do not mark rows no-show in preflight.

- [ ] **Step 3: Write exact backfill statements in `backfill.sql`, not in the Prisma migration.**
  - Fill location/owner values only where one assignment and one location match the registration user and meal-date effective range.
  - Fill menu fields only from a verified immutable revision whose legacy `content` parses all required values.
  - Fill `Penalty.registrationId`/`mealDate` only where the existing reason contains an exact registration/date identity and the match is one-to-one.
  - Make every statement idempotent and leave `snapshotAt`, `registeredAt`, revision numbers, names, addresses, coordinates, and employee data null when historical evidence is absent.

- [ ] **Step 4: Add enforcement checks after the additive migration.**
  - Create `registration_lifecycle_snapshot_complete` as a `NOT VALID` check whose predicate treats `registered_at IS NULL` as legacy and otherwise requires every lifecycle/menu/location/owner snapshot; new API writes must always set `registeredAt`. Create `registration_serving_consistency` as a `NOT VALID` check for `SERVED` without serving, `NO_SHOW` with serving, and `CANCELLED` with serving.
  - Validate both named checks with `ALTER TABLE registrations VALIDATE CONSTRAINT registration_lifecycle_snapshot_complete` and `ALTER TABLE registrations VALIDATE CONSTRAINT registration_serving_consistency` only after the external preflight is clean and exact backfill has completed; unresolved legacy rows with `registered_at IS NULL` remain reportable rather than fabricated.

- [ ] **Step 5: Add persistence tests.**
  - Add test names `requires_complete_registration_snapshots_for_new_operational_rows`, `retains_legacy_null_snapshots_without_fabricating_values`, `rejects_duplicate_penalty_registration_id`, and `rejects_served_status_without_meal_serving` to `emailOtpLocationServing.test.ts`.
  - Assert `meal_servings.registration_id` remains unique and a valid `ACTIVE + mealServing` row is permitted as the canonical projection.

- [ ] **Step 6: Verify only this task’s migration/persistence surface.**
  - Run: `yarn workspace @imeal/core exec prisma validate`
  - Run: `yarn workspace @imeal/core exec prisma generate`
  - Run: `yarn workspace @imeal/core exec vitest run test/emailOtpLocationServing.test.ts`
  - On a disposable staging database, first run `yarn workspace @imeal/core exec prisma migrate deploy`, then run `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/preflight.sql`, then run `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/backfill.sql` only when the report is approved, and finally validate the two named checks.
  - Expected: expanded migration is additive and row-preserving; preflight IDs are bounded; persistence tests prove uniqueness and no fabricated backfill.


## Task 2: Update shared response contracts without adding authority inputs

**Files:**
- Modify: `packages/contracts/src/v1/registrations.ts:101-119,154-186`
- Modify: `packages/contracts/src/v1/kitchen.ts:40-77`
- Modify: `packages/contracts/src/v1/penalties.ts:6-22`
- Test: `packages/contracts/test/contracts.test.ts`
- Do not modify: `packages/contracts/src/v1/pickup.ts:117-164`

**Interfaces:** Extend the existing declarations in place; do not introduce new exported schema names. `MealDateSchema` is the existing exported schema at `registrations.ts:5-18`, `RegistrationRecordSchema` and `WeekDailyMenuSchema` already exist at `registrations.ts:111-164`, `KitchenRegistrationItemSchema` already exists at `kitchen.ts:40-50`, and `PenaltyItemDtoSchema` already exists at `penalties.ts:6-22`. `UtcDateTimeSchema` is the existing module-private value at `registrations.ts:20-25`; reuse it within that file and do not import or export a new symbol.

```ts
export const RegistrationRecordSchema = z
  .object({
    id: z.string(),
    mealDate: MealDateSchema,
    status: RegistrationRecordStatusSchema,
    mealChoice: MealChoiceSchema,
    menuRevisionId: z.string().nullable(),
  })
  .strict();

export const WeekDailyMenuSchema = z
  .object({
    id: z.string(),
    weeklyMenuId: z.string(),
    date: MealDateSchema,
    isHoliday: z.boolean(),
    isEnabled: z.boolean(),
    menuRevisionId: z.string().nullable(),
    mealName: z.string().nullable(),
    description: z.string().nullable(),
    imageUrl: z.string().nullable(),
    createdAt: UtcDateTimeSchema,
  })
  .strict();

export const KitchenRegistrationItemSchema = z
  .object({
    registrationId: z.string(),
    userId: z.string(),
    userName: z.string(),
    mealChoice: MealChoiceSchema,
    userEmail: z.string(),
    state: z.enum(['PENDING', 'SERVED', 'NO_SHOW']),
    isServed: z.boolean(),
    servedAt: z.string().nullable().optional(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.isServed !== (item.state === 'SERVED')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isServed'],
        message: 'isServed must match the dashboard state',
      });
    }
  });
```

Add `registrationId: z.string().nullable()` and `mealDate: MealDateSchema.nullable()` to `PenaltyItemDtoSchema`. New no-show rows return both values; legacy rows return `null`. Keep `BatchRegistrationItemSchema`, `ResolvePickupSchema`, and `ConfirmPickupSchema` exactly server-authoritative. Do not add `DASHBOARD_DATA_INCONSISTENT`; state mismatch uses the existing `INTERNAL_SERVER_ERROR` envelope.

- [ ] **Step 1: Add failing contract examples.**
  - Add cases named `parses_dashboard_pending_served_and_no_show_states`, `parses_legacy_nullable_menu_and_penalty_metadata`, and `rejects_client_registration_location_or_menu_fields`.
  - Add a case that rejects `isServed: false` with `state: 'SERVED'` in a dashboard item.

- [ ] **Step 2: Implement the strictness-preserving schema changes.**
  - Preserve `.strict()` on registration and kitchen objects; add the `superRefine` invariant shown above.
  - Keep the existing non-strict policy of `PenaltyItemDtoSchema` while adding nullable `registrationId` and `mealDate`; do not broaden any request schema.
  - Keep the batch input union limited to `ACTIVE|CANCELLED`; response-only fields must not appear in input schemas.

- [ ] **Step 3: Verify contracts.**
  - Run: `yarn workspace @imeal/contracts exec vitest run test/contracts.test.ts`
  - Expected: new response fields parse, mismatched state/boolean is rejected, pickup exact intent and idempotency schemas remain unchanged.

## Task 3: Make registration writes resolve and persist immutable snapshots

**Files:**
- Modify: `apps/api/src/registrations/registrations.service.ts:237-428`
- Modify: `apps/api/src/admin/weekly-menus/weekly-menus.service.ts:60-176,179-247`
- Test: `apps/api/src/registrations/registrations.service.spec.ts:235-458`
- Test: `apps/api/src/admin/weekly-menus/weekly-menus.service.spec.ts:1-160`
**Interfaces and transaction helpers:**

Define a private transaction result used by `batchRegister`:

```ts
type RegistrationSnapshotResolution = {
  menuRevisionId: string;
  menuNameSnapshot: string;
  menuDescriptionSnapshot: string | null;
  menuImageSnapshot: string | null;
  ownerNameSnapshot: string;
  employeeCodeSnapshot: string;
  serviceLocationId: string;
  serviceLocationAssignmentId: string;
  serviceLocationCode: string;
  serviceLocationName: string;
  serviceLocationAddress: string;
  serviceLocationEffectiveFrom: Date;
  serviceLocationSnapshotAt: Date;
};

private async resolveRegistrationSnapshot(
  tx: Prisma.TransactionClient,
  userId: string,
  mealDate: Date,
  at: Date,
): Promise<RegistrationSnapshotResolution>;
```

The helper must select one published/enabled daily menu and one immutable revision for `mealDate`, then one active `EmployeeLocationAssignment` whose effective range covers `mealDate`, then its active/effective `Location`. It throws an internal domain error that `batchRegister` maps to existing `REGISTRATION_FAILED`; it never accepts client location/menu values.

The existing admin signatures become `updateDailyMenu(dateStr: string, data: UpdateDailyMenuInput, actorUserId: string)` and `publishWeeklyMenu(weekStartStr: string, actorUserId: string)`. Define `UpdateDailyMenuInput` in `apps/api/src/admin/weekly-menus/dto/weekly-menus.schema.ts` as `z.infer<typeof UpdateDailyMenuSchema>` and export that type. `weekly-menus.controller.ts` passes `@CurrentUser().id`; this changes no route or URL. Extend `UpdateDailyMenuSchema` with `mealName: z.string().trim().min(1).optional()`, `description: z.string().nullable().optional()`, and `imageUrl: z.string().url().nullable().optional()` so a new revision has verified content without inventing values.

- [ ] **Step 1: Extend the service test doubles for resolution.**
  - Add `dailyMenu`, `dailyMenuRevision`, `employeeLocationAssignment`, and `location` transaction mocks with deterministic return rows containing every snapshot field.
  - Add `mealServing`/snapshot fields to existing registration fixtures so same-choice no-op tests distinguish complete from legacy-incomplete rows.

- [ ] **Step 2: Add failing registration tests.**
  - `creates_registration_with_menu_owner_assignment_and_location_snapshots`: assert `registration.create.data` includes all fields in `RegistrationSnapshotResolution`, `status:'ACTIVE'`, `version:1`, and `registeredAt`.
  - `rejects_registration_when_menu_revision_is_missing`: assert the per-date result is `{success:false, code:'REGISTRATION_FAILED'}` and no create occurs.
  - `rejects_registration_when_effective_assignment_is_missing_or_ambiguous`: assert no registration write and no fallback location.
  - `keeps_complete_snapshots_when_active_choice_is_unchanged`: assert no update and no snapshot rewrite.
  - `updates_choice_without_replacing_active_snapshots`: assert only `mealChoice`/`version` changes.
  - `reactivates_cancelled_row_with_new_snapshot_and_cancellation_audit`: assert old cancellation metadata is audited and new menu/location/owner fields are written.
  - `rejects_reactivation_when_serving_or_penalty_exists`: assert `REGISTRATION_FINALIZED`/`REGISTRATION_FAILED` without mutation.
  - `cancels_and_revokes_delegation_with_reason_and_actor_atomically`: assert `cancelReason`, cancellation timestamps/actor, delegation revoke, notification, and audit are all in the same transaction.
  - `uses_server_cutoff_13_59_59_and_rejects_exact_14_00_00`: retain the existing boundary and assert resolution is never attempted after cutoff.

- [ ] **Step 3: Implement `resolveRegistrationSnapshot`.**
  - Query the published/enabled daily menu for `mealDate`, then select the current immutable revision deterministically by `revision DESC, id DESC`; reject zero or ambiguous candidates.
  - Query assignment by `userId`/effective date with `ORDER BY id`; reject zero or multiple active matches.
  - Query location by assignment ID and effective date; reject inactive/expired/mismatched location.
  - Set `serviceLocationSnapshotAt` to the transaction’s server time for new lifecycle writes only; do not assign it during uncertain legacy backfill.

- [ ] **Step 4: Implement menu publication in the existing transaction.**
  - In `updateDailyMenu`, create the next integer `DailyMenuRevision.revision` with verified `mealName`, `description`, `imageUrl`, and `createdByUserId`; update `MealDay` lock/service/menu snapshot fields in the same transaction.
  - When the day is already published and the revision changes, lock and update only `ACTIVE` registrations without a serving/no-show/penalty to the new revision/menu snapshots, and write audit/notification rows before commit.
  - In `publishWeeklyMenu`, create revision `1` with the complete fields for each daily menu and initialize MealDay service boundaries; never overwrite a cancelled, no-show, or served lifecycle snapshot.

- [ ] **Step 5: Add menu-publish lifecycle tests.**
  - `published_revision_updates_active_registration_snapshot_in_same_transaction`.
  - `published_revision_does_not_rewrite_served_no_show_or_cancelled_history`.
  - `published_revision_increments_per_daily_menu_and_populates_meal_day_lock_fields`.

- [ ] **Step 6: Integrate the helper into `batchRegister`.**
  - Capture one `serverNow` for the batch as the current method does.
  - Keep per-date transactions and the existing one-retry `P2002` create race behavior.
  - Lock the existing registration row before checking serving/penalty/final state.
  - On create, write every resolved snapshot.
  - On complete ACTIVE update, preserve snapshots; on legacy-incomplete ACTIVE update, populate only after a successful exact resolution.
  - On CANCELLED reactivation, write the new lifecycle snapshot and clear cancellation fields.
  - On cancel, set the cancellation reason/actor/time and revoke `PENDING|ACCEPTED` delegations in deterministic ID order before audit/notification writes. The existing account-disable workflow must use the same transition with `cancelReason='ACCOUNT_DISABLED'`; no new account-disable route is added.
  - Extend `getWeekData` select/mapping so `RegistrationRecordSchema` returns `menuRevisionId` and `WeekDailyMenuSchema` returns revision/name/description/image fields; these response fields remain nullable only for legacy rows.

- [ ] **Step 7: Verify registration and menu-publication behavior.**
  - Run: `yarn workspace @imeal/api exec vitest run src/registrations/registrations.service.spec.ts src/admin/weekly-menus/weekly-menus.service.spec.ts`
  - Expected: all new snapshot, missing-authority, reactivation, cancellation, menu-publish, race, and cutoff tests pass; response remains the existing per-date array/envelope path.



## Task 4: Enforce pickup snapshot reads and serving snapshot writes

**Files:**
- Modify: `apps/api/src/pickup/pickup.service.ts:287-470,894-947,951-1646`
- Test: `apps/api/src/pickup/pickup.service.spec.ts`
- Keep: `apps/api/src/pickup/internal-pickup.controller.ts:11-33`

**Interfaces and invariants:**

Define one internal predicate and use it in options, resolve, and confirm:

```ts
function hasCompleteRegistrationSnapshot(registration: {
  ownerNameSnapshot: string | null;
  employeeCodeSnapshot: string | null;
  serviceLocationId: string | null;
  serviceLocationAssignmentId: string | null;
  serviceLocationCode: string | null;
  serviceLocationName: string | null;
  serviceLocationAddress: string | null;
  serviceLocationEffectiveFrom: Date | null;
  serviceLocationSnapshotAt: Date | null;
  menuRevisionId: string | null;
  menuNameSnapshot: string | null;
  menuDescriptionSnapshot: string | null;
  menuImageSnapshot: string | null;
}): boolean;
```

`menuDescriptionSnapshot` and `menuImageSnapshot` may legitimately be null when the verified revision has no description/image; completeness requires a non-null `menuRevisionId`, `menuNameSnapshot`, and a matching immutable revision row whose nullable content fields were copied. An eligible pickup item is `status='ACTIVE'`, has no `mealServing`, matches today’s meal date, has a complete snapshot, and is owned or has an accepted delegation. All selected rows must share one `serviceLocationId`. A null/ambiguous snapshot maps to existing `PICKUP_INTENT_CONFLICT`; no current location/menu fallback is allowed.

- [ ] **Step 1: Add failing pickup read tests.**
  - `getPickupOptions_excludes_legacy_registration_with_null_snapshot`.
  - `resolvePickup_rejects_missing_name_address_or_menu_snapshot`.
  - `confirmPickup_rejects_snapshot_changed_after_resolve`.
  - `selected_items_must_share_one_snapshot_location`.
  - `pickup_does_not_accept_client_location_or_registration_aliases` (retain existing controller coverage).

- [ ] **Step 2: Implement complete snapshot selection.**
  - Extend own/delegated `select` projections in `getPickupOptions` with all snapshot columns and filter complete rows before constructing `PickupOption`.
  - Extend `loadRegistrationContexts` and its returned type with owner/menu revision/name/description/image and all location snapshot columns.
  - In `resolveIntentLocation`, reject any incomplete row before calling `LocationsService.resolveEffectiveLocation`; use current location policy only for serving-time GPS, never for historical name/address substitution.

- [ ] **Step 3: Add failing serving snapshot/idempotency tests.**
  - `confirmPickup_copies_registration_location_and_menu_snapshots_without_fallback`.
  - `confirmPickup_creates_serving_and_leaves_registration_status_as_active_projection`.
  - `same_caller_same_key_same_body_returns_stored_result_without_duplicate_serving`.
  - `same_key_different_body_returns_IDEMPOTENCY_CONFLICT`.
  - `stale_item_rolls_back_every_serving_and_delegation_transition`.
  - `no_show_or_cancel_winning_registration_lock_rejects_confirm_without_penalty_or_serving_side_effect`.
  - `serving_event_is_emitted_only_after_transaction_commit` (retain existing post-commit assertion).

- [ ] **Step 4: Implement confirm changes without changing route input.**
  - Keep claim insertion/lock by `(callerUserId,idempotencyKey)` and request body hash exactly as current `confirmPickup`.
  - Keep lock order `serving_confirm_request -> pickup_session -> registration IDs sorted -> delegation IDs sorted -> participant accounts sorted -> servings`.
  - Add menu/location/owner snapshot fields to `LockedRegistration` and require them before serving creation. Change `assertServingReadyInTransaction(tx, mealDateKey, confirmationTime)` to return `Promise<{ currentMenuRevisionId: string; serviceStartAt: Date; serviceEndAt: Date }>`; reject the confirmation if any locked registration’s immutable `menuRevisionId` differs from `currentMenuRevisionId`.
  - Copy `ownerUserId`, `ownerEmailSnapshot`, `ownerNameSnapshot`, `presenterUserId`, `receiverType`, `kitchenUserId`, `locationId`, location snapshots, `mealDate`, `menuRevisionId`, menu snapshots, pickup session/intent/request/verification fields, and delegation identity into `MealServing.create.data`; remove every `?? location.shortCode/displayName/address` fallback.
  - Use the registration’s immutable menu revision/snapshots for serving history while still checking current `MealDay` readiness and the 10:30–13:30 window.
  - Create `mealServing`, audit/event/notification, consume pickup session, and mark idempotency request success atomically; remove `tx.registration.update({data:{status:'SERVED'}})` for new writes.

- [ ] **Step 5: Verify pickup and serving behavior.**
  - Run: `yarn workspace @imeal/api exec vitest run src/pickup/pickup.service.spec.ts`
  - Run: `yarn workspace @imeal/api exec vitest run test/pickup.e2e-spec.ts`
  - Expected: exact existing routes/schemas remain valid; missing snapshots fail closed; same idempotency key replays one stored result; successful serving retains snapshots and does not write duplicate SERVED status.

## Task 5: Replace ACTIVE-only Kitchen dashboard with a canonical projection

**Files:**
- Modify: `apps/api/src/kitchen/kitchen-dashboard.service.ts:31-189`
- Test: `apps/api/src/kitchen/kitchen-dashboard.service.spec.ts:42-274`
- Modify: `packages/contracts/src/v1/kitchen.ts` as completed in Task 2

**Projection interface:**
Build all counters/lists from one registration query for `mealDate` with operational `status IN ('ACTIVE','SERVED','NO_SHOW')`, including `mealServing` and user/snapshot data. Add `OR (status='CANCELLED' AND mealServing IS NOT NULL)` solely to the same query so the forbidden cancelled/serving invariant can be detected before valid cancelled rows are excluded. Load invariant rows regardless of `user.isActive`; validate state mismatches first, then apply `user.isActive = true` when constructing the projection set. Interpret valid rows as:

```ts
type DashboardState = 'PENDING' | 'SERVED' | 'NO_SHOW';

const state = row.mealServing
  ? 'SERVED'
  : row.status === 'NO_SHOW'
    ? 'NO_SHOW'
    : 'PENDING';
```

The implementation must reject `SERVED` without serving, `NO_SHOW` with serving, and `CANCELLED` with serving using `throw new InternalServerErrorException('Kitchen dashboard state invariant violated')`; the existing controller/filter turns this into the `INTERNAL_SERVER_ERROR` response envelope with a request ID. It must not expose row IDs in the public message. `totalRegistered` includes pending, served projection, and no-show. `servedTotal` counts serving rows. `remaining` equals pending list length. Choice totals count the same total set.

- [ ] **Step 1: Add projection fixtures and failing tests.**
  - Replace the two-query ACTIVE/no-show fixture with one query containing `ACTIVE` pending, `ACTIVE+mealServing`, legacy `SERVED+mealServing`, `NO_SHOW`, and `CANCELLED` rows; add one account-disabled ACTIVE fixture that the query excludes.
  - Add test names `keeps_served_rows_in_total_and_served_list`, `counts_no_show_without_pending_membership`, `excludes_cancelled_and_account_disabled_rows`, `sets_state_and_isServed_consistently`, and `rejects_state_serving_mismatch_with_internal_error_envelope`.
  - Assert `totalRegistered = servedTotal + pending.length + noShowTotal`, `regularTotal + vegetarianTotal = totalRegistered`, and `remaining = pending.length`.

- [ ] **Step 2: Implement one-query projection.**
  - Query operational statuses plus only `CANCELLED` rows with a serving, in deterministic `createdAt ASC, id ASC` order, and derive lists from that array.
  - Remove the separate `noShowRegistrations` query and use the same source set for totals and lists.
  - Validate invariant rows first, then exclude cancelled/account-disabled rows from every projection list.
  - Populate `state` and `isServed` consistently for `served`, `pending`, `all`, and `noShow`.
  - Keep recent serving log query but use `mealServing.ownerNameSnapshot`, `locationNameSnapshot`, `locationAddressSnapshot`, and menu snapshots when non-null; use current registration/user fields only for legacy rows that have no serving snapshot.

- [ ] **Step 3: Implement fail-closed mismatch handling.**
  - Import and throw `InternalServerErrorException` directly with the exact non-sensitive message above; do not defer to an unspecified mapper.
  - Log/metric only a redacted aggregate count or internal row identifier; never include raw QR, GPS, session, or employee data in the response.

- [ ] **Step 4: Verify the projection.**
  - Run: `yarn workspace @imeal/api exec vitest run src/kitchen/kitchen-dashboard.service.spec.ts`
  - Run: `yarn workspace @imeal/api exec vitest run test/kitchen-dashboard.e2e-spec.ts`
  - Expected: served rows remain visible after serving; pending/no-show membership and counters match the approved definitions; mismatch uses existing `INTERNAL_SERVER_ERROR` envelope.

## Task 6: Make no-show and penalty processing per-registration, lock-safe, and retryable

**Files:**
- Modify: `apps/worker/src/no-show-worker.service.ts:43-213`
- Test: `apps/worker/src/no-show-worker.service.spec.ts:69-426`
- Modify: `apps/api/src/admin/penalties/penalties.service.ts:133-281`

**Interfaces and lock order:**

Add a private worker helper:

```ts
private async processRegistrationNoShow(
  registrationId: string,
  dateStr: string,
  now: Date,
): Promise<'PROCESSED' | 'SKIPPED'>;
```

Inside its transaction, lock in this order:

```text
registration FOR UPDATE -> mealServing check -> penalty(registration_id) ->
registration NO_SHOW update -> audit/notification/outbox
```

The helper may transition only an `ACTIVE` registration whose joined user is still `isActive=true`, with no serving, and `now >= 13:30` VN. The normal `processNoShows` gate still rejects today’s run before `13:45` unless `force=true`; the helper’s 13:30 predicate protects forced/manual recovery from running too early. Account-disabled rows are excluded from candidate discovery and rechecked under the registration lock.

- [ ] **Step 1: Add worker mock fields and failing time tests.**
  - Add `$queryRaw`, penalty `findUnique`, `create`, and outbox event mocks to `no-show-worker.service.spec.ts`.
  - Add `rejects_processing_today_before_13_45_without_force`, `allows_force_after_13_30_but_not_before_13_30`, `runs_normal_processing_at_13_45`, and `skips_future_date_without_force`.
  - Assert the 13:30 domain predicate and 13:45 scheduler gate are separate conditions.

- [ ] **Step 2: Add failing transaction/idempotency tests.**
  - `locks_registration_before_checking_serving` with a `FOR UPDATE` query assertion.
  - `creates_one_penalty_by_registration_id_and_marks_no_show_atomically` with `registrationId`, `mealDate`, amount `50000`, and reason `NO_SHOW`.
  - `uses_no_show_notification_dedupe_key` with exact key `no-show-penalty:${userId}:${registrationId}`.
  - `retry_after_commit_is_a_no_op_for_registration_penalty_notification_and_audit`.
  - `preserves_paid_or_waived_penalty_status_on_retry`.
  - `disabled_account_is_skipped_without_penalty_or_status_transition`.
  - `rolls_back_registration_penalty_notification_audit_and_outbox_on_side_effect_failure`.
  - `serving_wins_race_without_penalty` and `no_show_wins_race_so_confirm_rejects_without_serving`.

- [ ] **Step 3: Implement per-registration candidate processing.**
  - Keep candidate discovery constrained to target date, `status:'ACTIVE'`, `user.isActive:true`, and no serving; sort IDs ascending.
  - Invoke `processRegistrationNoShow` in its own Prisma transaction for each candidate, increment `processedCount` only after that transaction commits.
  - Re-read the registration and joined user with `FOR UPDATE`; if status is no longer ACTIVE, the user is disabled, a serving exists, or the date is invalid, return `SKIPPED` without writes.

- [ ] **Step 4: Implement unique penalty and atomic side effects.**
  - Read `tx.penalty.findUnique({where:{registrationId}})` after the registration lock.
  - If absent, create `{registrationId,userId,mealDate,amount:50000,reason:'NO_SHOW',status:'PENDING'}`.
  - If present, verify owner/date/amount/reason; preserve `PAID`/`WAIVED` and fail closed on mismatch.
  - Update `status:'NO_SHOW'` and `noShowAt: now` only in the same transaction as audit and notification publication through the existing `WorkerNotificationPublisher` with dedupe key `no-show-penalty:${userId}:${registrationId}`.
  - Upsert `OutboxEvent` with `aggregateType:'REGISTRATION'`, `aggregateId:registrationId`, `eventType:'NO_SHOW_RECONCILED'`, JSON payload, and dedupe key `kitchen:no-show:${registrationId}`.
  - Keep `JobRun` operational bookkeeping separate from per-registration business uniqueness; a duplicate cron run must not duplicate domain rows.

- [ ] **Step 5: Preserve admin penalty transitions.**
  - Include `registrationId`/`mealDate` in list mapping when non-null.
  - Keep `markAsPaid` and `waivePenalty` transaction/row-lock behavior and audit actor/time/reason.
  - Do not permit admin methods to create, reopen, or change no-show registration state.

- [ ] **Step 6: Verify worker and penalty behavior.**
  - Run: `yarn workspace @imeal/worker exec vitest run src/no-show-worker.service.spec.ts`
  - Run: `yarn workspace @imeal/api exec vitest run src/admin/penalties/penalties.service.spec.ts`
  - Expected: one penalty per registration, all-or-nothing side effects, preserved paid/waived status, explicit 13:30/13:45 distinction, and retry-safe outbox dedupe.

## Task 7: Publish only committed dashboard events

**Files:**
- Modify: `apps/api/src/kitchen/kitchen-events.service.ts:6-94`
- Modify: `apps/api/src/pickup/pickup.service.ts:1634-1643`
- Modify: `apps/api/src/registrations/registrations.service.ts` cancellation/reactivation commit path
- Modify: `apps/worker/src/no-show-worker.service.ts` outbox write from Task 6
- Test: `apps/api/src/kitchen/kitchen-dashboard.service.spec.ts`, `apps/api/src/pickup/pickup.service.spec.ts`, `apps/worker/src/no-show-worker.service.spec.ts`

**Event interface:**

```ts
type KitchenRealtimeEventType =
  | 'SERVING_CONFIRMED'
  | 'KITCHEN_SIGNAL_CHANGED'
  | 'DASHBOARD_SNAPSHOT'
  | 'NO_SHOW_RECONCILED'
  | 'REGISTRATION_CHANGED'
  | 'HEARTBEAT';

type KitchenRealtimeEvent = {
  eventId: string;
  eventType: KitchenRealtimeEventType;
  mealDate: string;
  occurredAt: string;
  requestId?: string;
  payload: unknown;
};
```

- [ ] **Step 1: Add event-type and payload contract tests.**
  - `serving_confirmed_event_contains_projection_payload_after_commit`.
  - `no_show_outbox_has_stable_dedupe_key_and_registration_payload`.
  - `registration_changed_event_is_not_visible_when_registration_transaction_rolls_back`.
  - `duplicate_event_id_is_dropped_by_KitchenEventsService` (retain the existing bounded dedup set behavior).

- [ ] **Step 2: Keep serving emission after `$transaction`.**
  - Preserve the existing `confirmPickup` pattern: emit `SERVING_CONFIRMED` only after `transactionResult` resolves successfully.
  - Use stable event ID `serving:${sortedServingIds.join(',')}` where `sortedServingIds` is the ascending list of committed serving IDs, and include `mealDate`, request ID, served count, and serving IDs; do not include QR payloads, session tokens, raw GPS, or employee-sensitive data.

- [ ] **Step 3: Emit registration events only after lifecycle commit.**
  - Return the committed audit ID, event type, meal date, and registration ID from the cancellation/reactivation transaction.
  - Call `KitchenEventsService.emitEvent` after the transaction with stable event ID `registration:${auditId}`, never inside it; failure to emit must not roll back committed registration data.

- [ ] **Step 4: Persist worker no-show event in the business transaction.**
  - Keep `OutboxEvent` insertion inside the no-show transaction and use the stable dedupe key from Task 6; the outbox row ID is the event ID consumed by the publisher/API bridge.
  - Do not call the in-memory API `KitchenEventsService` from the worker process. No SSE, polling consumer, broker, reconnect, or client/UI infrastructure is added; the separate realtime workstream consumes the committed outbox row.

- [ ] **Step 5: Verify event timing.**
  - Run: `yarn workspace @imeal/api exec vitest run src/kitchen/kitchen-dashboard.service.spec.ts src/pickup/pickup.service.spec.ts`
  - Run: `yarn workspace @imeal/worker exec vitest run src/no-show-worker.service.spec.ts`
  - Expected: no event/outbox row represents a rolled-back transaction; successful serving/cancel/no-show produces one committed event identity; no realtime client code changes are present.

## Task 8: Prove cross-transaction concurrency and all-or-nothing behavior on PostgreSQL

**Files:**
- Modify: `packages/domain/test/concurrency.test.ts:16-402`
- Modify: `packages/domain/test/emailOtpLocationServing.test.ts`
- Modify: `apps/api/test/registrations.e2e-spec.ts`
- Modify: `apps/api/test/pickup.e2e-spec.ts`
- Modify: `apps/api/test/kitchen-dashboard.e2e-spec.ts`

**Concrete scenarios:**

- [ ] **Step 1: Update existing serving expectations to the derived projection.**
  - Change the assertions that currently require `dbReg.status === 'SERVED'` at `concurrency.test.ts:88-92`, `:163-168`, `:337-343`, and `:398-401` to assert one unique `mealServing`, no `CANCELLED`/`NO_SHOW` conflict, and the dashboard projection state. Legacy `status:'SERVED'` rows remain covered by a dedicated compatibility fixture.

- [ ] **Step 2: Add real PostgreSQL registration and menu-staleness races.**
  - `concurrent_registration_create_persists_one_complete_snapshot` runs three `batchRegister`-equivalent writes for one user/date and asserts one row with every required snapshot.
  - `concurrent_cancel_and_reactivate_has_one_final_lifecycle` asserts one row lock winner and no partial delegation/notification side effects.
  - `menu_roster_change_does_not_rewrite_existing_active_snapshot_but_reactivation_resolves_new_values` changes assignment/menu after registration, confirms pickup/serving retain the old immutable snapshot, and confirms a new reactivation resolves the new effective values.

- [ ] **Step 3: Add real serving/no-show/cancel races.**
  - `serving_and_no_show_same_registration_have_one_winner` runs serving confirm and no-show transactions concurrently and asserts either one serving/no penalty or one no-show/one penalty, never both.
  - `serving_and_cancel_same_registration_have_one_winner` asserts the loser returns finalized/conflict and creates no partial side effect.
  - `two_workers_same_registration_create_one_penalty` runs two no-show transactions concurrently and asserts one `Penalty.registrationId` row.
  - `paid_or_waived_penalty_is_not_reopened_by_worker_retry` asserts status remains unchanged after retry.

- [ ] **Step 5: Add route/envelope/contract integration scenarios.**
  - `PUT /api/registrations/batch` returns per-date success/failure with snapshot resolution failures as existing `REGISTRATION_FAILED` results.
  - Pickup resolve/confirm routes reject client aliases/location fields and preserve `PICKUP_INTENT_CONFLICT`/`IDEMPOTENCY_CONFLICT` envelopes.
  - Dashboard routes return the state field and `INTERNAL_SERVER_ERROR` envelope for mismatches on both `/v1/kitchen` and `/api/kitchen` aliases.

- [ ] **Step 6: Run focused PostgreSQL/API verification.**
  - Run: `yarn workspace @imeal/core exec vitest run test/concurrency.test.ts test/emailOtpLocationServing.test.ts`
  - Run: `yarn workspace @imeal/api exec vitest run test/registrations.e2e-spec.ts test/pickup.e2e-spec.ts test/kitchen-dashboard.e2e-spec.ts`
  - Expected: real row locks and unique constraints prove one deterministic winner; all route aliases preserve their existing request/response authority boundaries.

## Task 9: Execute migration rollout gates and update canonical documentation

**Files:**
- Modify: `docs/05-backend-structure.md:257-326,353-405,623-679`
- Modify: `docs/03-product-flows.md:176-258`
- Modify: `docs/06-execution-plan.md` Phase 0 gate/checklist
- Modify: `docs/imeal-production-readiness-assessment.md` P0 findings and Phase 0 gate

**Rollout procedure:**

- [ ] **Step 1: Deploy the expand-only migration on staging.**
  - Run: `yarn workspace @imeal/core exec prisma migrate deploy`
  - Run: `yarn workspace @imeal/core exec prisma generate`
  - Confirm the migration inserted no Location, employee, roster, menu, penalty, or registration seed row and did not validate unresolved legacy checks.

- [ ] **Step 2: Run the read-only preflight after expansion.**
  - Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/preflight.sql > phase0-preflight-$(date +%Y%m%d%H%M%S).txt`
  - Store the report outside source control with access control and an audit reference.
  - Stop the rollout if any future ACTIVE row is incomplete, any status/serving mismatch exists, any effective assignment is ambiguous, any required menu revision is invalid, or any penalty mapping is duplicate/ambiguous.

- [ ] **Step 3: Apply only approved deterministic backfills.**
  - Run only after the preflight report is approved: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/backfill.sql`
  - Re-run the preflight report and require all seven checks to be zero for operational rows; unresolved legacy cancelled/history rows remain explicitly reported.
  - Do not infer current location/menu/name/address/employee values and do not merge/delete/reopen penalties.

- [ ] **Step 4: Validate checks and application behavior.**
  - Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER TABLE registrations VALIDATE CONSTRAINT registration_lifecycle_snapshot_complete; ALTER TABLE registrations VALIDATE CONSTRAINT registration_serving_consistency;"`
  - Exercise a legacy null-snapshot registration: registration update/reactivation returns `REGISTRATION_FAILED`; pickup options omit it; resolve/confirm return `PICKUP_INTENT_CONFLICT`; dashboard totals do not silently undercount a state-valid row; no-show can process only its owner/registration facts.
  - Exercise a mismatch row: dashboard returns generic `INTERNAL_SERVER_ERROR` envelope with a request ID and no row details.

- [ ] **Step 5: Run the complete Phase 0 verification set.**
  - Run: `yarn workspace @imeal/contracts exec vitest run`
  - Run: `yarn workspace @imeal/core exec vitest run`
  - Run: `yarn workspace @imeal/api exec vitest run`
  - Run: `yarn workspace @imeal/worker exec vitest run`
  - Run: `yarn workspace @imeal/api exec vitest run --config ./vitest.config.e2e.ts`
  - Run: `yarn workspace @imeal/worker exec vitest run --config ./vitest.config.e2e.ts`
  - Expected: all focused and e2e gates pass; no realtime client or transport infrastructure is implemented.

- [ ] **Step 6: Update canonical docs only from observed evidence.**
  - In `docs/05-backend-structure.md`, document derived `SERVED`, complete snapshot fields, penalty unique registration identity, dashboard projection, and 13:30/13:45 distinction.
  - In `docs/03-product-flows.md`, document pending/served/no-show list membership, fail-closed legacy behavior, and the unchanged exact pickup/idempotency routes.
  - In `docs/06-execution-plan.md` and `docs/imeal-production-readiness-assessment.md`, mark only the three Workstream A P0 findings closed after migration, focused tests, race tests, and staging preflight evidence are attached. Do not mark infrastructure/security/realtime-client work complete.

## Completion checklist

- [ ] The schema/migration is additive, deterministic, and contains no fabricated operational data.
- [ ] Preflight evidence reports zero unresolved future ACTIVE snapshot gaps and zero status/serving or penalty uniqueness conflicts before the pilot gate.
- [ ] Contracts expose state/snapshot metadata only as server responses; no client authority input was added.
- [ ] Registration create/update/reactivation/cancel behavior preserves immutable lifecycle snapshots and delegation atomicity.
- [ ] Pickup reads fail closed on incomplete snapshots and serving records use registration/menu snapshots without current-value fallback.
- [ ] Dashboard totals/lists include served projections and no-show rows without ACTIVE-only disappearance; mismatch errors use `INTERNAL_SERVER_ERROR` envelopes.
- [ ] No-show uses 13:30 eligibility, 13:45 normal scheduling, registration row locks, unique `Penalty.registrationId`, all-or-nothing side effects, and retry-safe outbox dedupe.
- [ ] Serving idempotency and all-or-nothing race behavior remain intact.
- [ ] Post-commit backend events are covered; no realtime client code was added.
- [ ] Focused unit, contract, domain concurrency, API e2e, worker e2e, migration/preflight, and rollout documentation gates are complete.
