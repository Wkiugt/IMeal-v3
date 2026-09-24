# IMeal Local Synthetic Seed Design

**Date:** 2026-09-24  
**Status:** Approved local/dev/test-only design for implementation planning  
**Scope:** A deterministic, idempotent, synthetic Prisma dataset containing 50 users, roles, roster/location assignments, menus, registrations, delegations, servings, and supporting history.  
**Production boundary:** This design MUST never create or import production operational data.

## 1. Goal and non-goals

### Goal

Provide one explicit local/UAT-only command that creates a useful end-to-end IMeal dataset in a disposable PostgreSQL database:

- exactly 50 deterministic synthetic users;
- independent `staff`, `kitchen`, and `admin` role assignments, including a visible staff+kitchen cohort;
- exactly four synthetic cafeteria locations and effective location policies;
- one effective roster assignment per synthetic user;
- a published seven-day lunch menu with revisions and one serving-ready day;
- varied registrations with valid meal choices, status/serving relationships, and immutable location snapshots;
- self and proxy serving history, delegation history, no-show penalties, events, and enough auth allowlist data for local OTP/session smoke tests;
- safe reruns that converge to the same rows without duplicates or changes outside the seed's deterministic keyspace.

The seed is a fixture generator for local development, UAT, screenshots, API smoke checks, and isolated database tests. It is not an organization-provisioning workflow.

### Non-goals

The implementation MUST NOT:

- run in production or in an environment whose purpose, database host, or runtime mode is production;
- add a production `prisma db seed` hook, migration insert, startup hook, API endpoint, Admin Web action, or deploy step;
- invent real employees, addresses, cafeteria names, coordinates, scanner identifiers, roster assignments, or operational policy values;
- create clear OTP codes, reusable session tokens, production secrets, or production-like credentials;
- change Prisma models, migrations, API authorization, menu/registration/serving business rules, or role-permission policy;
- overwrite rows that the seed did not create, broadly truncate a database, or provide a destructive reset command;
- emulate real production volume, financial reporting, or real GPS evidence.

Real organization locations and roster data remain an administrator-approved import prerequisite outside source control. Every location value in this design is explicitly synthetic and local-only.

## 2. Canonical boundaries and existing behavior

The implementation uses the existing Prisma schema in `packages/domain/prisma/schema.prisma`; it does not add a parallel persistence convention.

Relevant current models are `User`, `Role`, `UserRole`, `Permission`, `RolePermission`, `UserPermission`, `WeeklyMenu`, `DailyMenu`, `DailyMenuRevision`, `MealDay`, `Registration`, `PickupDelegation`, `ServingConfirmRequest`, `MealServing`, `MealEvent`, `Penalty`, `PickupSession`, `ServingVerification`, `Location`, `LocationPolicy`, `EmployeeLocationAssignment`, `OtpAllowlist`, and `AppSetting`.

The seed must preserve these invariants:

- `User.email`, `Location.shortCode`, `WeeklyMenu.startDate`, `DailyMenu.date`, `(User, mealDate)`, `MealServing.registrationId`, and the relevant composite role/permission keys remain unique.
- `Registration.mealDate`, menu date fields, assignment effective dates, and location effective dates are `@db.Date`/UTC-date values where applicable. Wire dates remain `YYYY-MM-DD`.
- `Registration.status` is one of `ACTIVE`, `CANCELLED`, `SERVED`, or `NO_SHOW`; `mealChoice` is `REGULAR` or `VEGETARIAN`.
- A `SERVED` registration has exactly one `MealServing`; `CANCELLED` and `NO_SHOW` registrations do not have a serving. An `ACTIVE` registration has no serving unless a later application operation is deliberately exercising a known dashboard behavior.
- Only one `PENDING` or `ACCEPTED` delegation may exist for a registration. A proxy serving consumes the accepted delegation as `COMPLETED`; a self serving uses `SELF` and no delegation.
- A valid location/policy/assignment is effective when `effectiveFrom <= at` and `effectiveTo` is null or strictly greater than `at`.
- A valid `ServingVerification` has finite, non-negative accuracy; a `VALID` verification requires non-null accuracy.
- The latest migration's database checks and partial unique indexes are authoritative, including the active employee-code uniqueness index and the active-delegation index.

The existing production rules remain unchanged: cutoff is strictly before 14:00 on the preceding day in `Asia/Ho_Chi_Minh`; serving is `[10:30, 13:30)` Vietnam time; QR lifetime is 5 seconds with 2 seconds maximum skew; resolved pickup sessions last 30 seconds; and no-show processing starts at 13:45 Vietnam time.

The seed writes fixture rows directly through Prisma rather than calling API services. It therefore performs its own complete preflight validation and must not claim that it exercised API authorization or the live QR flow.

## 3. Production safety contract

Safety is fail-closed and checked before creating a Prisma client transaction. All conditions below are required:

1. `NODE_ENV` MUST be exactly `development` or `test`; missing, `staging`, `preview`, `production`, and any other value are rejected.
2. `IMEAL_LOCAL_SEED` MUST equal `1`.
3. `IMEAL_LOCAL_SEED_CONFIRM` MUST equal `I_UNDERSTAND_LOCAL_ONLY`.
4. `DATABASE_URL` MUST be present, parse as PostgreSQL, and use a local-only host: `localhost`, `127.0.0.1`, `::1`, or the local Compose service host `db`. Any other host is rejected.
5. The command MUST reject an explicit production marker in `APP_ENV`, `RUNTIME_ENV`, or `DEPLOYMENT_ENV` when its value is `production` (case-insensitive), even if `NODE_ENV` is non-production.
6. The command MUST reject a database URL containing an explicit production marker (`production`, `prod`, or `live`) in the database name or schema component. This is defense in depth, not a substitute for environment ownership.
7. The command MUST print a redacted target summary (environment, host, database/schema, base email, week start) and require the confirmation flag; passwords, query secrets, OTP data, and token data MUST never be printed.
8. There MUST be no `--force-production`, unsafe override, or environment value that bypasses these checks.

The safety gate returns a non-zero exit status before any write on failure. The implementation MUST not rely only on a human warning, a README instruction, or the caller's current working directory. `.env.example` MUST NOT enable this command or contain seed credentials; local operators set the explicit values in an ignored `.env` or command environment.

## 4. Deterministic identity and email generation

### 4.1 Base email contract

The CLI requires `IMEAL_LOCAL_SEED_BASE_EMAIL` or `--base-email`. It must be a valid email address with a non-empty local part and domain. The value is normalized with the same NFKC/trim/lowercase behavior used by `AllowlistService`.

From normalized `seed@example.test`, generate exactly these 50 addresses in ordinal order:

```text
seed@example.test
seed-1@example.test
seed-2@example.test
...
seed-49@example.test
```

The base address is ordinal 0; suffixes are `-1` through `-49`. Suffixes are appended to the local part immediately before `@`. The generator MUST reject a base whose resulting local part or address fails the email contract. It MUST not use random values, timestamps, plus-addressing, or a different suffix convention.

Suggested local invocation base: `imeal.seed@example.test`. This is synthetic; it is not a real employee address.

### 4.2 Stable IDs and ownership

Every generated row that has a string ID receives a deterministic UUID derived from a fixed, code-owned UUID namespace and a key of the form `imeal-local-seed:<entity>:<seedKey>`. The namespace is fixed in code and is not an environment secret. The seed key includes the normalized base email, target week start, and entity ordinal where relevant.

The implementation MUST use one helper for stable IDs and MUST use the same ID on every rerun. IDs MUST NOT be generated with `randomUUID()` for seed-owned rows. Generated emails, IDs, employee codes, location codes, menu dates, registration dates, delegation IDs, serving IDs, and event IDs are therefore reproducible from the same arguments.

Seed-owned rows are identified by their deterministic IDs. Rerunning with the same base email and week-start arguments upserts the same rows. The exact 50-email, `LOCAL-A`..`LOCAL-D`, and `LOCAL-EMP-0001`..`LOCAL-EMP-0050` contracts are global schema keys, so a different base email or week MUST use a separate disposable database/schema. Conflicting arguments in an already-seeded database MUST fail closed through the existing unique constraints; the writer MUST NOT adopt or delete rows outside its deterministic IDs. A reset/purge command is deliberately out of scope.

## 5. Role distribution and authorization

Use the canonical lower-case role names already inserted by `20260827000000_manual_constraints`: `staff`, `kitchen`, and `admin`. The 50-user distribution is:

| Cohort | Count | Role assignments | Meal-owner eligibility |
| --- | ---: | --- | --- |
| Staff only | 36 | `staff` | Yes |
| Kitchen only | 6 | `kitchen` | No |
| Staff + Kitchen | 5 | `staff`, `kitchen` | Yes |
| Admin only | 2 | `admin` | No |
| Admin + Staff | 1 | `admin`, `staff` | Yes |
| **Total** | **50** |  | **42 owners** |

A kitchen assignment MUST NOT create a `staff` `UserRole`. A kitchen-only user MUST not own generated registrations. A dual-role user receives both explicit assignments; the seed must never infer staff access from kitchen. Admin-only and admin+staff users are not assigned the `kitchen` role.

The checked-in migration currently maps `admin` to `kitchen.serve`, despite canonical product docs saying Admin does not imply Kitchen serving. The seed MUST NOT silently rewrite this mapping or claim to fix it. It must report this existing repository discrepancy in implementation verification. The seed only assigns roles; it does not manufacture missing permissions. In particular, current migrations seed `menu.manage`, `kitchen.serve`, `registration.cutoff.manage`, `penalty.read`, and `penalty.resolve`, but not the controller-required `allowlist.manage`, `location.manage`, or `roster.manage` permissions. Admin route smoke tests must account for that separate prerequisite.

All 50 users receive `isActive=true`, a synthetic name, and default notification settings. Role assignment rows use deterministic IDs only where the schema permits IDs; composite `UserRole` keys are upserted by `(userId, roleId)`. No client claim, employee code, GPS value, or email suffix authorizes a role.

## 6. Synthetic cafeteria locations and roster assignments

### 6.1 Locations

Create exactly four synthetic locations, stable across reruns:

| Code | Display name | Synthetic-only address | Policy coordinate |
| --- | --- | --- | --- |
| `LOCAL-A` | `Synthetic Cafeteria A` | `LOCAL-ONLY synthetic address A` | `(1.000000, 1.000000)` |
| `LOCAL-B` | `Synthetic Cafeteria B` | `LOCAL-ONLY synthetic address B` | `(2.000000, 2.000000)` |
| `LOCAL-C` | `Synthetic Cafeteria C` | `LOCAL-ONLY synthetic address C` | `(3.000000, 3.000000)` |
| `LOCAL-D` | `Synthetic Cafeteria D` | `LOCAL-ONLY synthetic address D` | `(4.000000, 4.000000)` |

These values are intentionally synthetic and MUST never be presented as approved operational sites. Each `Location` row sets:

- stable deterministic `id` and unique uppercase `shortCode`;
- required `displayName`, `servingPointName` (`Synthetic Counter <code>`), `address`, `building` (`SYNTHETIC`), `floor` (`0`), `roomOrCounter`, and `localContact` (`local-seed-only`);
- `timeZone='Asia/Ho_Chi_Minh'`, `isActive=true`, `effectiveFrom=2026-01-01T00:00:00.000Z`, `effectiveTo=null`;
- synthetic metadata/capacity/accessibility/emergency/kitchen/network notes and a synthetic scanner ID only if a UI smoke test needs them;
- `approvedScannerDeviceIds=[]` by default, because scanner authorization is not part of this seed.

Each location gets one deterministic active `LocationPolicy` with `accuracySource='synthetic-local-seed'`, `geofenceRadiusMeters=150`, `maxFixAgeSeconds=30`, `maxAccuracyMeters=100`, the coordinate in the table, and the same effective interval. The policy values satisfy the database coordinate/threshold checks and match the local GPS smoke contract without representing real coordinates.

### 6.2 Assignments

Create one active `EmployeeLocationAssignment` for every user (50 rows), distributed round-robin A/B/C/D by user ordinal. Each row contains:

- linked `userId`, lower-case `normalizedEmail`, and the exact synthetic `employeeName`;
- unique active `employeeCode` `LOCAL-EMP-0001` through `LOCAL-EMP-0050`;
- `isActive=true` and a capability string derived from the cohort (`STAFF`, `KITCHEN`, `ADMIN`, or `STAFF_KITCHEN`);
- matching uppercase `serviceLocationCode` and `locationId`;
- `effectiveFrom=2026-01-01T00:00:00.000Z`, `effectiveTo=null`;
- deterministic `rosterImportBatchId`/`auditEventId` only if those supporting rows are included by the implementation.

There is exactly one current assignment per user, avoiding `findFirst` ambiguity in `RegistrationService`. Active employee codes are unique across all assignments. The assignment role string is descriptive roster data; it does not replace `UserRole` authorization.

## 7. Menu and registrations

### 7.1 CLI date inputs

`IMEAL_LOCAL_SEED_WEEK_START` or `--week-start` is a valid Monday in `YYYY-MM-DD` form. The default is the fixed synthetic date `2026-09-28`, so the default dataset is reproducible. `IMEAL_LOCAL_SEED_SERVE_DATE` or `--serve-date` defaults to the week start and must be one of the seven generated dates. A live serving smoke may override both values to a current business week/date; the output remains deterministic for those explicit arguments.

All date-only database values use UTC midnight (`YYYY-MM-DDT00:00:00.000Z`). The builder MUST reject invalid dates, a non-Monday week start, a serve date outside the week, and a week whose date arithmetic crosses an invalid calendar boundary.

### 7.2 Weekly and daily menu graph

Create or upsert one `WeeklyMenu` for the selected week, with `startDate` and `endDate=startDate+6`, and a non-null deterministic `publishedAt` before the week start. Create exactly seven unique `DailyMenu` rows, one per date, each with `isHoliday=false` and `isEnabled=true`. For each daily menu create exactly one `MealDay` with `mealType='LUNCH'`; set `isServingReady=true` only for `serveDate` and false for the other six dates.

Create one deterministic `DailyMenuRevision` per daily menu with synthetic text such as `Local synthetic menu <YYYY-MM-DD>`. This is content for fixture rendering only. No real menu, nutrition, or organization information is implied.

Also upsert `AppSetting` key `isServingReady:<serveDate>` with value `true` so the current pickup service's readiness path can be exercised. The implementation must not change unrelated settings.

### 7.3 Registration matrix

Use only the 42 staff-capable owners from the role table. Generate three registrations per owner on the first three dates of the selected week, for exactly 126 registrations. Iterate owners in ordinal order and day offsets `0,1,2`; `ordinal = ownerOrdinal * 3 + dayOffset` determines the following deterministic status distribution:

| Global ordinal range | Count | Status | Related rows |
| --- | ---: | --- | --- |
| 0–59 | 60 | `ACTIVE` | no serving |
| 60–99 | 40 | `SERVED` | one serving each |
| 100–115 | 16 | `CANCELLED` | no serving |
| 116–125 | 10 | `NO_SHOW` | one 50,000-VND penalty each |
| **Total** | **126** |  |  |

Set `mealChoice='VEGETARIAN'` when `ordinal % 4 === 0`; otherwise set `REGULAR`. This gives a fixed mixed choice distribution and uses no random generator. Every `(userId, mealDate)` pair is unique.

Every registration row intended for pickup or historical serving MUST contain the immutable assignment snapshot copied from its owner assignment: `serviceLocationId`, `serviceLocationAssignmentId`, `serviceLocationCode`, `serviceLocationName`, `serviceLocationAddress`, `serviceLocationEffectiveFrom`, and `serviceLocationSnapshotAt`. `serviceLocationSnapshotAt` is a deterministic seed instant derived from the selected week (the week start at 00:00Z), not a moving `now` value. The referenced location and assignment are effective for the meal date.

`NO_SHOW` rows receive exactly one `Penalty` with `amount=50000`, `status=PENDING`, and reason `NO_SHOW_PENALTY_<date>_<registrationId>`. `CANCELLED` rows have no serving. `SERVED` rows receive a complete serving graph as described below. The seed does not call the no-show worker and does not claim to have waited for the 13:45 boundary; it materializes the valid resulting state directly.

## 8. Delegations, serving history, and supporting rows

Create eight deterministic delegation examples attached to distinct registrations:

- four `PENDING` delegations on active registrations;
- four `ACCEPTED` delegations on active registrations;
- the eight proxy-served historical registrations use separate delegations with `COMPLETED` status.

No generated delegation targets its owner, creates a delegation chain, or creates more than one active `PENDING`/`ACCEPTED` row for a registration. `COMPLETED` is a Prisma enum value even though the current delegation transport contract omits it; the seed uses it only for historical proxy-serving rows.

For the 40 `SERVED` registrations, create:

- 32 self servings: `ownerUserId=presenterUserId`, `receiverType=SELF`, `delegationId=null`;
- 8 proxy servings: owner and presenter are distinct staff-capable users, `receiverType=PROXY`, and `delegationId` points to that serving's unique completed delegation;
- one deterministic Kitchen user from the kitchen-only cohort as `kitchenUserId`, with `kitchenPermissionContext='kitchen.serve'`;
- owner email/name snapshots, presenter/kitchen IDs, location short-code/name/address snapshots, `mealDate`, `menuRevisionId`, deterministic `requestId`, deterministic `intentHash`, `servingVerificationId`, `pickupSessionId`, and `servedAt` values derived from the selected date/ordinal;
- one `MealEvent` per serving with `eventType='PICKUP_CONFIRMED'`.

For a fully API-shaped local fixture, also create one unique `ServingVerification`, `PickupSession`, and successful `ServingConfirmRequest` per historical serving. The verification uses `result=VALID`, `safeVerificationCode='GPS_VALID'`, finite accuracy `5`, `locationPolicyId` for the owner location, and a deterministic retention date. The consumed historical pickup session has matching `registrationIds`/`intentRegistrationIds` arrays containing the sorted serving registration IDs, matching deterministic `intentHash`/`qrHash`/`intentNonce`/verification ID relationships, `consumedAt=servedAt`, and `expiresAt=servedAt+30s`. The request uses a unique caller/key pair, `status=SUCCESS`, result serving IDs, and a deterministic completed timestamp. These historical rows are not valid live QR payloads and must not contain a real QR or token.

A smaller implementation may omit historical sessions/verifications/requests while retaining the required `MealServing` snapshots; if it does, the smoke plan must distinguish database/dashboard history from the live QR/confirm path. The default design favors the complete graph so serving audit and relation views have useful data.

## 9. Idempotency, transaction, and error handling

### Preflight

The command parses CLI arguments and environment, applies all safety checks, builds the complete in-memory plan, validates counts and date/status relationships, and checks that every generated reference resolves within the plan. No database write occurs before preflight succeeds.

### Transaction

The writer executes the complete plan in one Prisma `$transaction` with serializable isolation. It upserts only deterministic seed-owned IDs/keys. The transaction includes users, role links, locations/policies, assignments, allowlists, menus/revisions/meal days, registrations, delegations, penalties, serving evidence/sessions/requests, servings, events, and the serving-ready setting. If any write fails, the transaction rolls back all seed changes.

If PostgreSQL reports a serialization conflict (`P2034`), retry the whole transaction a bounded three times with short deterministic backoff. Do not retry validation, safety, foreign-key, or unique-key errors caused by data outside the seed keyspace. Surface a concise actionable error containing the entity/key and Prisma error code without secrets.

A `P2002` outside the deterministic keyspace means the local database already contains conflicting data; fail closed rather than adopting or deleting the conflicting row. A `P2003`, `P2025`, invalid enum, or check-constraint failure is a seed-plan defect or incompatible schema and must roll back with a non-zero exit. No `catch` path may report success after a partial write.

### Rerun semantics

The same command and arguments produce the same row IDs, counts, field values, and relationships. An already-converged rerun reports `created=0`, `updated=0`, and the expected counts (or an equivalent no-op summary). Rerunning after a local manual edit restores only seed-owned rows to the declared synthetic plan. A different base email or week requires a separate disposable database/schema because the exact email, `LOCAL-A`..`LOCAL-D`, employee-code, menu-date, and setting-key contracts are globally unique; same-database conflicts fail closed through unique constraints without adopting or deleting rows.

## 10. CLI and environment contract

The later implementation exposes a package command named `seed:local` from `@imeal/core` and a direct CLI entrypoint for local operators. The command accepts:

| Input | Required/default | Validation |
| --- | --- | --- |
| `--base-email` / `IMEAL_LOCAL_SEED_BASE_EMAIL` | Required | Valid normalized email; generates base + `-1..-49` |
| `--week-start` / `IMEAL_LOCAL_SEED_WEEK_START` | `2026-09-28` | Monday `YYYY-MM-DD` |
| `--serve-date` / `IMEAL_LOCAL_SEED_SERVE_DATE` | Week start | Within generated seven-day week |
| `--dry-run` | Off | Prints counts/target summary and performs no writes |
| `--help` | N/A | Prints usage without opening a transaction |
| `NODE_ENV` | Required | `development` or `test` only |
| `IMEAL_LOCAL_SEED` | Required | Must be `1` |
| `IMEAL_LOCAL_SEED_CONFIRM` | Required | Must be `I_UNDERSTAND_LOCAL_ONLY` |
| `DATABASE_URL` | Required | PostgreSQL URL with approved local host and no production marker |

CLI flags take precedence over their matching `IMEAL_LOCAL_SEED_*` value. Conflicting flag/env values are an error rather than silently choosing one. `--dry-run` still performs all safety and plan validation, but never creates a Prisma client transaction or writes a database.

The success summary includes generated counts and an explicit `LOCAL/TEST ONLY` marker. It does not print OTPs, session tokens, database passwords, QR payloads, or raw coordinates. Exit status is zero only after commit succeeds; safety, validation, conflict, or transaction errors return non-zero.

## 11. Verification and smoke plan

The implementation plan must add focused tests and a disposable-database smoke path; this design document itself adds no code or tests.

### Pure/unit coverage

- Base plus suffix email generation yields exactly 50 normalized addresses, ordinal 0 base, ordinal 49 `-49`, and rejects invalid bases.
- Stable IDs are repeatable and distinct by entity/key; changing base or week-start changes the intended keyspace only.
- Role distribution totals 50, kitchen-only users have no staff role, dual users have explicit staff+kitchen, and only staff-capable users own registrations.
- Four location codes, 50 unique active employee codes, one assignment per user, and policy thresholds/coordinates satisfy preflight checks.
- Seven menu dates, one meal day/revision per date, deterministic meal choices, exact registration status counts, and no duplicate `(userId, mealDate)` are produced.
- Served/cancelled/no-show relationships, proxy delegation relationships, penalty reasons/amounts, and immutable location snapshots are internally consistent.
- All unsafe environment/host/production-marker combinations fail before any Prisma operation.

### Disposable PostgreSQL smoke

Using an isolated local schema/database and the existing migration setup:

1. Run `--dry-run`; verify the complete count summary and zero database writes.
2. Run the seed once; query the expected 50 users, four locations, 50 assignments, 126 registrations, 40 servings, delegation/penalty/menu counts, and no unexpected operational rows.
3. Run the identical command again; verify no count growth, stable IDs, stable field values, and an idempotent/no-op summary.
4. Mutate one seed-owned display name or snapshot, rerun, and verify convergence; insert an unrelated row and verify it is untouched.
5. Inject a deterministic failure in a later write and verify the transaction leaves no new seed rows from that run.
6. Attempt production mode, a remote host, a missing confirmation, and a production-marked database; verify each fails before writes.
7. For API smoke only, use an explicitly local/test environment with a serve date equal to the current Vietnam business date, set serving readiness, authenticate through the local test contract, and exercise registration/history/dashboard/read-only serving surfaces. A live QR/confirm smoke must use the complete verification/session graph, an active `kitchen.serve` principal, a fresh valid presenter evidence timestamp, sorted exact IDs, and a clock inside `[10:30,13:30)` Asia/Ho_Chi_Minh. Do not treat the direct historical rows as proof of API authorization.

The existing kitchen dashboard currently filters its counters/lists to `Registration.status='ACTIVE'` while the production confirm path changes served registrations to `SERVED`. Verification must record this current behavior; it must not create an invalid `ACTIVE`+serving state merely to make counters look served.

## 12. Documentation and update scope

This spec is the design source for the later local seed implementation. Implementation should update only non-production documentation:

- `docs/local-role-testing.md`: add the command, required safety variables, deterministic cohorts, disposable database requirement, and rerun/rollback expectations;
- `docs/README.md`: add this spec/implementation entry to the documented reading order if the repository's index convention requires it;
- this spec: update only if the approved implementation intentionally changes the contract.

Do not add seed variables, sample accounts, operational location values, or coordinates to `.env.example`, production deployment docs, production migrations, or screenshots. Do not update the canonical role policy to hide the existing migration discrepancy; if that discrepancy is fixed later, it requires a separate authorization design/change with its own tests and review.

## 13. Exact implementation responsibilities

The later implementation should keep pure planning separate from database writes:

| File/module | Responsibility |
| --- | --- |
| `packages/domain/src/local-seed/types.ts` | Typed seed options, normalized plan, planned row groups, counts, and result summary. |
| `packages/domain/src/local-seed/config.ts` | Parse CLI/env values, normalize base email, enforce local/test safety gates, redact target summaries, and return validated options. |
| `packages/domain/src/local-seed/ids.ts` | Fixed-namespace deterministic UUID helper and deterministic seed keys; no random/time-based IDs. |
| `packages/domain/src/local-seed/plan.ts` | Pure builders for 50 users/roles, four locations/policies, assignments, menu graph, registrations, delegations, penalties, serving graph, and allowlist rows; perform cross-reference/count validation. |
| `packages/domain/src/local-seed/writer.ts` | Accept a Prisma client, write the complete plan in one serializable transaction, use deterministic upserts, retry only serialization conflicts, and return counts. |
| `packages/domain/src/local-seed/cli.ts` | `seed:local` entrypoint, dry-run/success/error output, signal/exit handling, and Prisma disconnect after a successful or failed transaction. |
| `packages/domain/src/local-seed/index.ts` | Narrow export surface for tests and the CLI; no API/application dependency. |
| `packages/domain/package.json` | Add the local-only command wiring without adding a production migration/startup seed hook. |
| `packages/domain/test/local-seed.test.ts` | Pure deterministic generation, safety parsing, role/status/location invariants, and plan validation tests. |
| `packages/domain/test/local-seed-db.test.ts` | Disposable PostgreSQL rerun, uniqueness/FK/check, rollback, and untouched-unrelated-row tests using the existing DB setup. |
| `docs/local-role-testing.md` | Non-production operator instructions and safety warning. |
| `docs/README.md` | Documentation index update only if needed. |

The implementation MUST NOT modify `packages/domain/prisma/schema.prisma`, Prisma migrations, API controllers/services, worker jobs, mobile clients, Admin Web, or production environment validation merely to support this seed. Any required schema or authorization correction is a separate change.

## 14. Self-review decisions

- **No placeholders:** all required environment names, confirmation text, role counts, email suffixes, location codes, date defaults, status counts, and module responsibilities are specified.
- **No production contradiction:** the command has multiple fail-closed environment/database gates, and every location/address/coordinate is marked synthetic local-only; no operational data is invented.
- **Role consistency:** Kitchen never implies Staff in generated `UserRole` rows; dual capability is explicit. Admin is not assigned Kitchen, while the existing migration's Admin permission discrepancy remains visible rather than silently rewritten.
- **Rerun consistency:** deterministic IDs and a single serializable transaction provide convergence without broad deletion; alternate base/week arguments use a separate disposable database/schema and same-database conflicts fail closed.
- **Schema consistency:** registrations use valid enum values and meal choices, one row per user/date, required location snapshots for pickup history, one serving per served registration, valid delegation states, and penalties only for no-shows.
- **Scope consistency:** this is a design document only. It does not implement code, tests, migrations, seed data, or operational imports.
