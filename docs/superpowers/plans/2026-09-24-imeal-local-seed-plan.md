# IMeal Local Synthetic Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local/dev/test-only `@imeal/core` command that deterministically creates and idempotently reruns a complete synthetic IMeal dataset for 50 users, four cafeteria locations, menus, registrations, delegations, servings, and supporting history.

**Architecture:** Keep pure configuration, deterministic ID, and plan construction modules separate from a Prisma transaction writer. The CLI performs fail-closed environment checks, builds and validates a complete in-memory plan, then invokes one serializable transaction with deterministic upserts; `--dry-run` stops before Prisma client creation. Unit tests run in a Vitest config without the existing PostgreSQL setup, while disposable-database tests reuse the repository's migration setup and exercise reruns, constraints, rollback, and unrelated-row isolation.

**Tech Stack:** Yarn 4.18.0 workspaces; package folder `packages/domain` with package name `@imeal/core`; TypeScript ES2022/ESNext; Node.js >=18; Prisma 5.22/PostgreSQL; existing `ts-node` ESM runner; Vitest 4.1.11; existing `packages/domain/test/setup.ts` for disposable DB tests; existing Prisma schema/migrations.

**Spec:** `docs/superpowers/specs/2026-09-24-imeal-local-seed-design.md`

## Global Constraints

- The command is synthetic local/UAT data only. It MUST reject production, staging, preview, remote, and production-marked database targets before any write.
- `NODE_ENV` MUST be `development` or `test`; `IMEAL_LOCAL_SEED=1`; `IMEAL_LOCAL_SEED_CONFIRM=I_UNDERSTAND_LOCAL_ONLY`; and `DATABASE_URL` MUST use `localhost`, `127.0.0.1`, `::1`, or local Compose host `db`.
- Never add a production `prisma db seed` hook, migration insert, application startup seed, API endpoint, Admin Web action, or deploy step.
- Generate exactly 50 normalized emails: base local part plus the base and suffixes `-1` through `-49`; never use random email values.
- Use a fixed code-owned deterministic UUID namespace and entity/key seed strings; seed-owned rows MUST NOT use `randomUUID()`.
- Use canonical roles `staff`, `kitchen`, and `admin`; assigning `kitchen` MUST NOT assign `staff`; only explicit `staff` users own generated registrations.
- Generate exactly four clearly synthetic locations (`LOCAL-A` through `LOCAL-D`) and 50 effective assignments; never add real operational names, addresses, coordinates, employee data, scanner identifiers, or roster assignments.
- Preserve the current Prisma schema/migrations and current authorization policy. Do not silently correct the migration's `admin -> kitchen.serve` discrepancy or invent missing `allowlist.manage`, `location.manage`, or `roster.manage` permissions.
- Use UTC midnight for `@db.Date` values and `YYYY-MM-DD` meal-date keys; preserve `Asia/Ho_Chi_Minh`, cutoff 14:00 preceding day, serving window `[10:30,13:30)`, QR TTL 5 seconds/2-second skew, pickup-session TTL 30 seconds, and no-show time 13:45.
- Generate 126 registrations owned by the 42 staff-capable users: 60 `ACTIVE`, 40 `SERVED`, 16 `CANCELLED`, and 10 `NO_SHOW`; use `REGULAR`/`VEGETARIAN` deterministically and never duplicate `(userId, mealDate)`.
- `SERVED` registrations have one serving; `CANCELLED` and `NO_SHOW` registrations have no serving; no-show rows have one 50,000-VND pending penalty.
- Use one active assignment per user, immutable registration location snapshots, unique active employee codes, at most one active delegation per registration, and unique serving/delegation boundaries.
- All writes belong to one serializable Prisma transaction; retry only PostgreSQL serialization conflicts (`P2034`) up to three complete attempts; never swallow `P2002`, `P2003`, `P2025`, validation, or check-constraint errors.
- Reruns with identical base email/week/serve-date converge through deterministic upserts, do not grow row counts, and never delete or update rows outside the seed keyspace. A destructive reset command is not part of this plan.
- Do not log passwords, database query secrets, OTP values, session tokens, QR payloads, or raw coordinates. A successful CLI summary is explicitly marked `LOCAL/TEST ONLY`.
- `--help` may return usage before reading the write-path safety contract because it cannot create a Prisma client or mutate data; every dry-run and write path enforces the complete safety contract.
- Every implementation task follows red/green TDD and ends with a focused verification command and a small commit. This plan itself creates no code, tests, migrations, or seed rows.

---

## 1. File map and ownership

The folder is `packages/domain`; the Yarn workspace/package name is `@imeal/core`. All commands below use `yarn workspace @imeal/core`, not a guessed folder package name.

### Create

| File | Responsibility |
| --- | --- |
| `packages/domain/src/local-seed/types.ts` | Public internal types for validated config, deterministic plan rows, counts, writer options, and CLI results. |
| `packages/domain/src/local-seed/ids.ts` | Fixed-namespace UUID generation, seed keys, base-plus-suffix email generation, employee-code generation, and deterministic timestamp/hash helpers. |
| `packages/domain/src/local-seed/config.ts` | CLI/env parsing, date validation, email normalization, local/test/host/production-marker safety checks, redacted target summary, and `--help` text. |
| `packages/domain/src/local-seed/plan.ts` | Pure builders for users/roles, four locations/policies, 50 assignments, allowlists, seven-day menu, 126 registrations, delegations, penalties, verification/session/request rows, servings, events, and cross-reference/count validation. |
| `packages/domain/src/local-seed/writer.ts` | Deterministic Prisma upserts in one serializable transaction, canonical-role lookup, bounded `P2034` retry, result counts, and redacted write errors. |
| `packages/domain/src/local-seed/cli.ts` | `runLocalSeed()` API, `--help`/`--dry-run` behavior, Prisma lifecycle, summary/error output, and executable entrypoint. |
| `packages/domain/src/local-seed/index.ts` | Narrow exports for the CLI and focused tests; no API/mobile/Admin Web dependency. |
| `packages/domain/vitest.unit.config.ts` | Node Vitest config for pure local-seed unit tests without `test/setup.ts` or PostgreSQL. |
| `packages/domain/test/local-seed-config.unit.test.ts` | Safety, env/flag precedence, date/email validation, help text, and redacted-summary tests. |
| `packages/domain/test/local-seed-ids.unit.test.ts` | Email, UUID, seed-key, code, and deterministic timestamp/hash tests. |
| `packages/domain/test/local-seed-plan.unit.test.ts` | Exact counts, role inheritance, menus, statuses, meal choices, snapshots, delegations, servings, and plan validation tests. |
| `packages/domain/test/local-seed-cli.unit.test.ts` | Dry-run/no-Prisma behavior, safe error result, and successful dependency-injected summary tests. |
| `packages/domain/test/local-seed.db.test.ts` | Disposable PostgreSQL full-graph write, rerun convergence, constraints, rollback, and unrelated-row preservation tests. |

### Modify

| File | Responsibility after implementation |
| --- | --- |
| `packages/domain/package.json` | Add `seed:local` using the existing `ts-node` ESM dev dependency and `test:unit` using the unit Vitest config; preserve existing `test` DB behavior. |
| `package.json` | Include `yarn workspace @imeal/core test:unit` in the root `test:unit` chain; do not add a production seed script. |
| `docs/local-role-testing.md` | Document the explicit local-only environment contract, command, synthetic cohorts, rerun behavior, and disposable DB requirement. |
| `docs/README.md` | Add the local seed spec/plan and operator guide to the existing reading-order list. |

### Explicitly do not modify

`packages/domain/prisma/schema.prisma`, any Prisma migration, `apps/api`, `apps/worker`, `apps/mobile`, `apps/admin-web`, `.env.example`, deployment files, and production environment validation. `yarn.lock` should remain unchanged because the plan uses the already declared `ts-node` dependency; if the package runner cannot execute the existing ESM configuration, stop and resolve that package-runner issue as a separate approved dependency change rather than silently adding a dependency.

---

## 2. Interfaces and data contracts

The following signatures are the cross-task contract. Use `.js` import specifiers in the new ESM TypeScript modules so `ts-node --esm` and the built package agree on module resolution.

### `types.ts`

```ts
export type SeedRole = 'staff' | 'kitchen' | 'admin';
export type SeedMealChoice = 'REGULAR' | 'VEGETARIAN';
export type SeedRegistrationStatus =
  | 'ACTIVE'
  | 'CANCELLED'
  | 'SERVED'
  | 'NO_SHOW';

export interface LocalSeedConfig {
  baseEmail: string;
  weekStart: string; // YYYY-MM-DD, Monday
  serveDate: string; // YYYY-MM-DD inside weekStart..weekStart+6
  dryRun: boolean;
  databaseUrl: string;
  target: {
    nodeEnv: 'development' | 'test';
    host: string;
    database: string;
    schema: string | null;
  };
}

export interface SeedCounts {
  users: 50;
  userRoles: 56;
  locations: 4;
  locationPolicies: 4;
  assignments: 50;
  allowlists: 50;
  weeklyMenus: 1;
  dailyMenus: 7;
  mealDays: 7;
  menuRevisions: 7;
  registrations: 126;
  pendingDelegations: 4;
  acceptedDelegations: 4;
  completedDelegations: 8;
  penalties: 10;
  servingVerifications: 40;
  pickupSessions: 40;
  servingConfirmRequests: 40;
  mealServings: 40;
  mealEvents: 40;
  appSettings: 1;
}

export interface LocalSeedPlan {
  key: { baseEmail: string; weekStart: string; serveDate: string };
  counts: SeedCounts;
  users: readonly SeedUserRow[];
  userRoles: readonly SeedUserRoleRow[];
  locations: readonly SeedLocationRow[];
  locationPolicies: readonly SeedLocationPolicyRow[];
  assignments: readonly SeedAssignmentRow[];
  allowlists: readonly SeedAllowlistRow[];
  weeklyMenu: SeedWeeklyMenuRow;
  dailyMenus: readonly SeedDailyMenuRow[];
  mealDays: readonly SeedMealDayRow[];
  menuRevisions: readonly SeedMenuRevisionRow[];
  registrations: readonly SeedRegistrationRow[];
  delegations: readonly SeedDelegationRow[];
  penalties: readonly SeedPenaltyRow[];
  servingVerifications: readonly SeedServingVerificationRow[];
  pickupSessions: readonly SeedPickupSessionRow[];
  servingConfirmRequests: readonly SeedServingConfirmRequestRow[];
  mealServings: readonly SeedMealServingRow[];
  mealEvents: readonly SeedMealEventRow[];
  appSettings: readonly SeedAppSettingRow[];
}

export interface SeedWriteOptions {
  maxAttempts?: number; // default 3; only P2034 retries
  sleep?: (milliseconds: number) => Promise<void>; // deterministic test seam
}

export interface SeedWriteResult {
  created: number;
  updated: number;
  unchanged: number;
  counts: SeedCounts;
}

export type LocalSeedCliResult =
  | { kind: 'help'; text: string }
  | { kind: 'dry-run'; plan: LocalSeedPlan; summary: string }
  | { kind: 'written'; plan: LocalSeedPlan; result: SeedWriteResult; summary: string };
```

The row interfaces must use the existing Prisma field names and types. Date-only row values are `Date` objects at UTC midnight; instant values are `Date` objects with stable UTC timestamps; `resultServingIds` is a string array; JSON values use Prisma-compatible JSON input types. `SeedUserRow.roles` is not written as a User column; it is a plan convenience consumed to produce `userRoles`.

### `ids.ts`

```ts
export function normalizeSeedEmail(input: string): string;
export function generateSeedEmails(baseEmail: string): readonly string[];
export function stableSeedId(entity: string, seedKey: string): string;
export function stableSeedKey(baseEmail: string, weekStart: string, entity: string, ordinal: string | number): string;
export function seedEmployeeCode(ordinal: number): string; // LOCAL-EMP-0001..0050
export function seedInstant(seedKey: string): Date;
export function seedHash(seedKey: string): string;
```

`generateSeedEmails()` returns length 50, index 0 is the base address, and index 49 has the `-49` local-part suffix. `stableSeedId()` returns a deterministic UUID from one fixed namespace and never calls `randomUUID()`.

### `config.ts`

```ts
export class LocalSeedConfigError extends Error {
  readonly code:
    | 'MISSING_ARGUMENT'
    | 'INVALID_EMAIL'
    | 'INVALID_DATE'
    | 'INVALID_ENVIRONMENT'
    | 'INVALID_DATABASE_URL'
    | 'REMOTE_DATABASE'
    | 'PRODUCTION_MARKER'
    | 'CONFLICTING_INPUT';
}

export function parseLocalSeedConfig(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): LocalSeedConfig;

export function localSeedHelp(): string;
export function formatLocalSeedTarget(config: LocalSeedConfig): string;
```

`parseLocalSeedConfig()` gives CLI flags precedence only when no matching environment value conflicts; a conflicting flag and env value throws `CONFLICTING_INPUT`. `--help` is handled before this parser's write-path safety checks by `runLocalSeed()`.

### `plan.ts`

```ts
export function buildLocalSeedPlan(config: LocalSeedConfig): LocalSeedPlan;
export function assertLocalSeedPlan(plan: LocalSeedPlan): void;
```

`buildLocalSeedPlan()` is pure: the same normalized config produces deeply equal row values and IDs. `assertLocalSeedPlan()` checks exact counts, all foreign-key references within the plan, role inheritance, effective dates, menu/registration dates, status/serving/penalty relationships, sorted pickup arrays, and uniqueness before any writer call.

### `writer.ts`

```ts
import type { PrismaClient } from '@prisma/client';

export async function writeLocalSeed(
  prisma: PrismaClient,
  plan: LocalSeedPlan,
  options?: SeedWriteOptions,
): Promise<SeedWriteResult>;
```

The caller must pass a plan that has passed `assertLocalSeedPlan()`. `writeLocalSeed()` performs no broad delete and no role/permission creation. It looks up canonical roles by `name`, resolves their IDs inside the transaction, upserts every deterministic row, and returns aggregate created/updated/unchanged counts. It uses Prisma's `Serializable` transaction isolation and retries the entire transaction only for `P2034`, at most three attempts.

### `cli.ts`

```ts
import type { PrismaClient } from '@prisma/client';

export interface LocalSeedCliDeps {
  createPrisma: () => PrismaClient;
  buildPlan: (config: LocalSeedConfig) => LocalSeedPlan;
  writePlan: (
    prisma: PrismaClient,
    plan: LocalSeedPlan,
    options?: SeedWriteOptions,
  ) => Promise<SeedWriteResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export async function runLocalSeed(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  deps?: Partial<LocalSeedCliDeps>,
): Promise<LocalSeedCliResult>;
```

`runLocalSeed()` handles `--help` without constructing Prisma, parses/safely validates all other paths, builds and validates the plan, returns a dry-run result without constructing Prisma, or creates/disconnects Prisma around `writePlan()`. The executable entrypoint catches errors, writes redacted messages, and sets a non-zero exit code without printing secrets.

---

## 3. Task 1: Add isolated unit-test configuration, deterministic IDs, and safety parsing

**Files:**
- Create: `packages/domain/vitest.unit.config.ts`
- Create: `packages/domain/test/local-seed-ids.unit.test.ts`
- Create: `packages/domain/test/local-seed-config.unit.test.ts`
- Create: `packages/domain/src/local-seed/types.ts`
- Create: `packages/domain/src/local-seed/ids.ts`
- Create: `packages/domain/src/local-seed/config.ts`
- Modify: `packages/domain/package.json` (`test:unit` only)

**Interfaces:**
- Consumes: no local-seed modules; `config.ts` uses Node URL/date/crypto APIs and mirrors `AllowlistService.normalizeEmail` semantics without importing API code.
- Produces: the `types.ts`, `ids.ts`, and `config.ts` signatures above; later tasks import these modules.

- [ ] **Step 1: Write failing deterministic-ID and config tests.**

Add tests with these concrete assertions:

```ts
it('generates the base and exactly -1 through -49 addresses', () => {
  const emails = generateSeedEmails(' Seed@Example.test ');
  expect(emails).toHaveLength(50);
  expect(emails[0]).toBe('seed@example.test');
  expect(emails[49]).toBe('seed-49@example.test');
  expect(new Set(emails).size).toBe(50);
});

it('keeps IDs stable and entity/key-specific', () => {
  expect(stableSeedId('user', 'seed@example.test:0')).toBe(
    stableSeedId('user', 'seed@example.test:0'),
  );
  expect(stableSeedId('user', 'seed@example.test:0')).not.toBe(
    stableSeedId('user', 'seed@example.test:1'),
  );
  expect(stableSeedId('user', 'seed@example.test:0')).not.toBe(
    stableSeedId('location', 'seed@example.test:0'),
  );
});

it('requires every write-path safety value and accepts only local hosts', () => {
  const config = parseLocalSeedConfig([], {
    NODE_ENV: 'test',
    IMEAL_LOCAL_SEED: '1',
    IMEAL_LOCAL_SEED_CONFIRM: 'I_UNDERSTAND_LOCAL_ONLY',
    IMEAL_LOCAL_SEED_BASE_EMAIL: 'seed@example.test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/imeal?schema=test_seed',
  });
  expect(config.target.host).toBe('localhost');
  expect(config.weekStart).toBe('2026-09-28');
  expect(config.serveDate).toBe('2026-09-28');
});

it('rejects production, remote, missing-confirmation, and production-marked targets', () => {
  expect(() => parseLocalSeedConfig([], { NODE_ENV: 'production' })).toThrow('INVALID_ENVIRONMENT');
  expect(() => parseLocalSeedConfig([], {
    NODE_ENV: 'test', IMEAL_LOCAL_SEED: '1',
    IMEAL_LOCAL_SEED_CONFIRM: 'I_UNDERSTAND_LOCAL_ONLY',
    IMEAL_LOCAL_SEED_BASE_EMAIL: 'seed@example.test',
    DATABASE_URL: 'postgresql://u:p@db.example.test/imeal',
  })).toThrow('REMOTE_DATABASE');
  expect(() => parseLocalSeedConfig([], {
    NODE_ENV: 'test', IMEAL_LOCAL_SEED: '1',
    IMEAL_LOCAL_SEED_BASE_EMAIL: 'seed@example.test',
    DATABASE_URL: 'postgresql://u:p@localhost/imeal',
  })).toThrow('INVALID_ENVIRONMENT');
  expect(() => parseLocalSeedConfig([], {
    NODE_ENV: 'test', IMEAL_LOCAL_SEED: '1',
    IMEAL_LOCAL_SEED_CONFIRM: 'I_UNDERSTAND_LOCAL_ONLY',
    IMEAL_LOCAL_SEED_BASE_EMAIL: 'seed@example.test',
    DATABASE_URL: 'postgresql://u:p@localhost/imeal_production',
  })).toThrow('PRODUCTION_MARKER');
});
```

Also assert `formatLocalSeedTarget()` includes environment/host/database/week start but excludes the database password, `DATABASE_URL` query, and the confirmation string.

- [ ] **Step 2: Run the focused unit command and confirm red.**

Run:

```powershell
yarn workspace @imeal/core exec vitest run --config ./vitest.unit.config.ts test/local-seed-ids.unit.test.ts test/local-seed-config.unit.test.ts
```

Expected: FAIL because the new modules/config file do not exist; the existing DB setup MUST NOT load in this unit command.

- [ ] **Step 3: Implement the smallest pure modules and unit config.**

Create `vitest.unit.config.ts` with `globals: true`, `environment: 'node'`, and an include pattern for `test/local-seed.*.unit.test.ts` without `setupFiles`. Implement fixed namespace ID generation using Node `crypto` SHA-1 UUID-v5-compatible bytes, lower-case NFKC email normalization, strict `YYYY-MM-DD`/Monday/date-range validation, PostgreSQL URL parsing, approved-host checks, production-marker checks, flag/env conflict detection, fixed defaults (`2026-09-28` week start and serve date), and the redacted summary. Keep all errors typed as `LocalSeedConfigError` with stable codes and no secret-bearing messages.

- [ ] **Step 4: Run the focused unit command and confirm green.**

Run the same command from Step 2. Expected: PASS for all ID/config tests, including the remote/prod/missing-confirmation boundaries and no secret leakage assertion.

- [ ] **Step 5: Commit the focused foundation.**

```powershell
git add packages/domain/vitest.unit.config.ts packages/domain/test/local-seed-ids.unit.test.ts packages/domain/test/local-seed-config.unit.test.ts packages/domain/src/local-seed/types.ts packages/domain/src/local-seed/ids.ts packages/domain/src/local-seed/config.ts packages/domain/package.json
git commit -m "feat(core): add local seed config and deterministic ids"
```

---

## 4. Task 2: Build and validate the deterministic seed plan

**Files:**
- Create: `packages/domain/test/local-seed-plan.unit.test.ts`
- Create: `packages/domain/src/local-seed/plan.ts`
- Modify: `packages/domain/src/local-seed/types.ts` with concrete row interfaces and `SeedCounts`

**Interfaces:**
- Consumes: `LocalSeedConfig`, `stableSeedId()`, `stableSeedKey()`, `seedInstant()`, `seedHash()`, and `generateSeedEmails()` from Task 1.
- Produces: `buildLocalSeedPlan(config)` and `assertLocalSeedPlan(plan)` for writer/CLI/DB tests.

- [ ] **Step 1: Write failing plan-shape tests.**

Build a valid test config with base `seed@example.test`, week `2026-09-28`, serve date `2026-09-28`, then assert:

```ts
const plan = buildLocalSeedPlan(config);
expect(plan.users).toHaveLength(50);
expect(plan.locations.map(({ shortCode }) => shortCode)).toEqual([
  'LOCAL-A', 'LOCAL-B', 'LOCAL-C', 'LOCAL-D',
]);
expect(plan.assignments).toHaveLength(50);
expect(plan.registrations).toHaveLength(126);
expect(plan.registrations.filter((r) => r.status === 'ACTIVE')).toHaveLength(60);
expect(plan.registrations.filter((r) => r.status === 'SERVED')).toHaveLength(40);
expect(plan.registrations.filter((r) => r.status === 'CANCELLED')).toHaveLength(16);
expect(plan.registrations.filter((r) => r.status === 'NO_SHOW')).toHaveLength(10);
expect(plan.mealServings).toHaveLength(40);
expect(plan.penalties).toHaveLength(10);
expect(plan.dailyMenus).toHaveLength(7);
expect(plan.mealDays).toHaveLength(7);
expect(plan.menuRevisions).toHaveLength(7);
expect(plan.delegations.filter((d) => d.status === 'PENDING')).toHaveLength(4);
expect(plan.delegations.filter((d) => d.status === 'ACCEPTED')).toHaveLength(4);
expect(plan.delegations.filter((d) => d.status === 'COMPLETED')).toHaveLength(8);
```

Add assertions for 36 staff-only, 6 kitchen-only, 5 staff+kitchen, 2 admin-only, and 1 admin+staff; no kitchen-only user appears as a registration owner; `userRoles.length === 56`; every employee code is unique; `REGULAR`/`VEGETARIAN` follows `ordinal % 4 === 0`; every registration has the seven location snapshot fields; every served registration has one matching serving; every no-show has one 50,000 penalty; and all pickup arrays are sorted/unique.

- [ ] **Step 2: Run the plan test and confirm red.**

```powershell
yarn workspace @imeal/core exec vitest run --config ./vitest.unit.config.ts test/local-seed-plan.unit.test.ts
```

Expected: FAIL because `plan.ts` and the concrete row types are not implemented.

- [ ] **Step 3: Implement the pure plan builders.**

Implement these internal helpers in `plan.ts`:

```ts
function buildUsers(config: LocalSeedConfig): {
  users: readonly SeedUserRow[];
  userRoles: readonly SeedUserRoleRow[];
};
function buildLocations(config: LocalSeedConfig): {
  locations: readonly SeedLocationRow[];
  locationPolicies: readonly SeedLocationPolicyRow[];
  assignments: readonly SeedAssignmentRow[];
};
function buildMenu(config: LocalSeedConfig): {
  weeklyMenu: SeedWeeklyMenuRow;
  dailyMenus: readonly SeedDailyMenuRow[];
  mealDays: readonly SeedMealDayRow[];
  menuRevisions: readonly SeedMenuRevisionRow[];
};
function buildRegistrations(
  config: LocalSeedConfig,
  users: readonly SeedUserRow[],
  assignments: readonly SeedAssignmentRow[],
  menuRevisions: readonly SeedMenuRevisionRow[],
): {
  registrations: readonly SeedRegistrationRow[];
  delegations: readonly SeedDelegationRow[];
  penalties: readonly SeedPenaltyRow[];
  servingVerifications: readonly SeedServingVerificationRow[];
  pickupSessions: readonly SeedPickupSessionRow[];
  servingConfirmRequests: readonly SeedServingConfirmRequestRow[];
  mealServings: readonly SeedMealServingRow[];
  mealEvents: readonly SeedMealEventRow[];
};
```

Use exactly four synthetic location values from the spec, fixed effective instant `2026-01-01T00:00:00.000Z`, round-robin assignments, 42 owners, three dates per owner, ordinal status/meal-choice rules, 32 self/8 proxy serving rows, four pending/four accepted/eight completed delegations, and deterministic full verification/session/request history. Do not create `Role`, `Permission`, or `RolePermission` rows; resolve canonical migration rows in the writer. Build 50 active `OtpAllowlist` rows with `SESSION_LOGIN`, `ACTIVE`, normalized email, linked user, effective-from fixed before the generated week, and no challenge/token values.

`assertLocalSeedPlan()` must throw a stable `LocalSeedPlanError` with entity/key context for duplicate keys, out-of-plan foreign keys, wrong counts, invalid role inheritance, invalid status relationships, non-effective locations, unsorted pickup arrays, invalid enum values, or non-finite policy/evidence values.

- [ ] **Step 4: Run the plan tests and confirm green.**

Run the same command from Step 2. Expected: PASS with the exact 50/4/50/126/40/10 counts, status distribution, role matrix, snapshots, delegations, and all cross-reference assertions.

- [ ] **Step 5: Commit the pure plan builder.**

```powershell
git add packages/domain/src/local-seed/types.ts packages/domain/src/local-seed/plan.ts packages/domain/test/local-seed-plan.unit.test.ts
git commit -m "feat(core): build deterministic local seed plan"
```

---

## 5. Task 3: Implement the transactional Prisma writer and idempotency

**Files:**
- Create: `packages/domain/src/local-seed/writer.ts`
- Create: `packages/domain/test/local-seed.db.test.ts`

**Interfaces:**
- Consumes: `LocalSeedPlan`, `SeedWriteOptions`, `SeedWriteResult`, and `assertLocalSeedPlan()` from Tasks 1–2; `PrismaClient` from `@prisma/client`; canonical migration roles/permissions.
- Produces: `writeLocalSeed(prisma, plan, options?)` for the CLI and DB smoke tests.

- [ ] **Step 1: Write failing disposable-DB writer tests.**

Add a test that builds the fixed plan, calls `writeLocalSeed(prisma, plan)`, and queries the database. Assert:

```ts
expect(await prisma.user.count({ where: { email: { endsWith: '@example.test' } } })).toBe(50);
expect(await prisma.location.count()).toBe(4);
expect(await prisma.employeeLocationAssignment.count()).toBe(50);
expect(await prisma.registration.count()).toBe(126);
expect(await prisma.mealServing.count()).toBe(40);
expect(await prisma.penalty.count()).toBe(10);
expect(await prisma.registration.count({ where: { status: 'SERVED', mealServing: { isNot: null } } })).toBe(40);
expect(await prisma.registration.count({ where: { status: 'NO_SHOW', penalties: { some: { amount: 50000, status: 'PENDING' } } } })).toBe(10);
```

Add a second test that calls the writer twice and asserts the second result has no created rows, counts remain unchanged, and the sorted user/location/registration/serving IDs from both reads are identical. Add a third test that inserts an unrelated user/location with non-seed IDs, reruns the plan, and asserts both unrelated rows remain unchanged.

Add a rollback test that clones the validated plan, changes one serving's `registrationId` to a nonexistent ID after plan validation, calls `writeLocalSeed()`, expects a Prisma foreign-key failure, and asserts the user/location/registration counts remain at their pre-call values. This verifies the transaction rather than a plan-builder validation path.

- [ ] **Step 2: Run the focused DB test and confirm red.**

With the existing disposable PostgreSQL URL configured as required by `packages/domain/test/setup.ts`, run:

```powershell
yarn workspace @imeal/core exec vitest run --config ./vitest.config.ts test/local-seed.db.test.ts
```

Expected: FAIL because `writer.ts` does not exist. If PostgreSQL/DATABASE_URL is unavailable, record that infrastructure failure and do not replace the DB test with a mock claim.

- [ ] **Step 3: Implement canonical lookups and transaction writes.**

Implement a `writeTransaction(tx, plan)` helper that writes in this order:

1. Resolve `staff`, `kitchen`, and `admin` by unique `Role.name`; fail with a redacted schema/config error if a canonical role is missing.
2. Upsert users by deterministic `id`, updating only the declared synthetic profile fields.
3. Upsert `UserRole` by `(userId, roleId)`; do not delete other role links and do not create role/permission definitions.
4. Upsert locations and policies by deterministic IDs; allow unique-index errors to surface for an external short-code conflict.
5. Upsert assignments and allowlists by deterministic IDs; preserve the active employee-code/index guarantees.
6. Upsert the weekly menu, seven daily menus, seven meal days, seven revisions, and one serving-ready `AppSetting`.
7. Upsert registrations, delegations, and penalties with the declared status/serving relationships.
8. Upsert serving verifications, pickup sessions, confirmation requests, meal servings, and meal events in FK order; use `MealServing.registrationId` and non-null `delegationId` uniqueness to detect outside conflicts.

Use `prisma.$transaction(async (tx) => writeTransaction(tx, plan), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })`. Count creates/updates/unchanged deterministically from each upsert result; if Prisma cannot distinguish unchanged from update, return `updated` as the number of attempted existing-row updates and assert only no-growth/ID equality in tests.

Wrap the complete transaction in a bounded loop with default `maxAttempts=3`. Retry only when the caught Prisma error has code `P2034`; sleep `25 * attempt` milliseconds through the injected `sleep` function. Map all other Prisma errors to a concise `LocalSeedWriteError` with entity/key/code and no URL/password/token values. Always disconnect the CLI-owned client in a `finally` block.

- [ ] **Step 4: Run the focused DB test and confirm green.**

Run the same command from Step 2. Expected: PASS for full graph creation, exact statuses/relations, no-growth rerun, unrelated-row preservation, and transaction rollback. Also run the pure plan suite to ensure writer changes did not alter plan behavior:

```powershell
yarn workspace @imeal/core exec vitest run --config ./vitest.unit.config.ts test/local-seed-plan.unit.test.ts
```

- [ ] **Step 5: Commit the writer and DB invariants.**

```powershell
git add packages/domain/src/local-seed/writer.ts packages/domain/test/local-seed.db.test.ts
git commit -m "feat(core): persist local seed transactionally"
```

---

## 6. Task 4: Add the CLI, dry-run behavior, and package wiring

**Files:**
- Create: `packages/domain/src/local-seed/cli.ts`
- Create: `packages/domain/src/local-seed/index.ts`
- Create: `packages/domain/test/local-seed-cli.unit.test.ts`
- Modify: `packages/domain/package.json` (`seed:local`)
- Modify: `package.json` (root `test:unit` chain)

**Interfaces:**
- Consumes: `parseLocalSeedConfig()`, `formatLocalSeedTarget()`, `buildLocalSeedPlan()`, `assertLocalSeedPlan()`, and `writeLocalSeed()`.
- Produces: `runLocalSeed()` and the executable package script `yarn workspace @imeal/core seed:local`.

- [ ] **Step 1: Write failing CLI behavior tests.**

Use dependency injection through `LocalSeedCliDeps` so tests never need a real Prisma client. Assert:

```ts
it('prints help and never creates Prisma without environment configuration', async () => {
  const createPrisma = vi.fn(() => { throw new Error('must not create Prisma'); });
  const result = await runLocalSeed(['--help'], {}, { createPrisma });
  expect(result.kind).toBe('help');
  expect(createPrisma).not.toHaveBeenCalled();
  expect(result.kind === 'help' && result.text).toContain('IMEAL_LOCAL_SEED_CONFIRM');
});

it('builds a valid dry-run plan without creating Prisma or writing', async () => {
  const createPrisma = vi.fn(() => { throw new Error('must not create Prisma'); });
  const writePlan = vi.fn();
  const result = await runLocalSeed(
    ['--base-email', 'seed@example.test', '--dry-run'],
    {
      NODE_ENV: 'test',
      IMEAL_LOCAL_SEED: '1',
      IMEAL_LOCAL_SEED_CONFIRM: 'I_UNDERSTAND_LOCAL_ONLY',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/imeal?schema=test_seed',
    },
    { createPrisma, writePlan },
  );
  expect(result.kind).toBe('dry-run');
  expect(result.kind === 'dry-run' && result.plan.users).toHaveLength(50);
  expect(createPrisma).not.toHaveBeenCalled();
  expect(writePlan).not.toHaveBeenCalled();
});

it('returns a written result and disconnects the owned client', async () => {
  const disconnect = vi.fn(async () => undefined);
  const fakePrisma = { $disconnect: disconnect } as unknown as PrismaClient;
  const writePlan = vi.fn(async () => ({
    created: 1, updated: 0, unchanged: 0,
    counts: buildLocalSeedPlan(config).counts,
  }));
  const result = await runLocalSeed(validArgs, validEnv, {
    createPrisma: () => fakePrisma,
    writePlan,
  });
  expect(result.kind).toBe('written');
  expect(writePlan).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalledTimes(1);
});
```

Also assert an unsafe environment returns a typed config error before `createPrisma` is called and that the summary contains `LOCAL/TEST ONLY` but not the database password or confirmation string.

- [ ] **Step 2: Run the CLI unit test and confirm red.**

```powershell
yarn workspace @imeal/core exec vitest run --config ./vitest.unit.config.ts test/local-seed-cli.unit.test.ts
```

Expected: FAIL because `cli.ts` and `index.ts` do not exist.

- [ ] **Step 3: Implement CLI lifecycle and package scripts.**

Implement `runLocalSeed()` so `--help` returns usage first; all other paths call config parsing, plan building, and `assertLocalSeedPlan()`. For `dryRun=true`, return counts/target summary without `createPrisma()`. For a write, call `createPrisma()`, await `writePlan()`, and disconnect in `finally`. The process entrypoint catches `LocalSeedConfigError`, `LocalSeedPlanError`, and `LocalSeedWriteError`, writes only the stable code/message, and sets `process.exitCode=1`.

Use the existing ESM-compatible dev dependency rather than adding a package:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run --config ./vitest.unit.config.ts",
    "seed:local": "ts-node --esm src/local-seed/cli.ts"
  }
}
```

The root `package.json` `test:unit` becomes:

```json
"test:unit": "yarn workspace @imeal/core test:unit && yarn workspace @imeal/contracts test && yarn workspace @imeal/api test && yarn workspace @imeal/worker test"
```

Do not add a root `seed` script. If `ts-node --esm` cannot execute the new `.js`-specifier modules under the current package settings, stop at the package-runner failure and make the smallest separately reviewed module-runner adjustment; do not introduce an unplanned dependency or change package semantics silently.

- [ ] **Step 4: Run CLI unit and executable help/dry-run checks.**

Run:

```powershell
yarn workspace @imeal/core exec vitest run --config ./vitest.unit.config.ts test/local-seed-cli.unit.test.ts
yarn workspace @imeal/core seed:local --help
```

Expected: unit tests PASS; help exits 0, prints required variables, and does not require `DATABASE_URL` or construct Prisma. Then set the explicit local environment and run a dry-run:

```powershell
$env:NODE_ENV='test'
$env:IMEAL_LOCAL_SEED='1'
$env:IMEAL_LOCAL_SEED_CONFIRM='I_UNDERSTAND_LOCAL_ONLY'
$env:IMEAL_LOCAL_SEED_BASE_EMAIL='imeal.seed@example.test'
yarn workspace @imeal/core seed:local --dry-run
```

Expected: exit 0, `LOCAL/TEST ONLY` summary, counts `50 users / 4 locations / 50 assignments / 126 registrations / 40 servings`, and zero database writes.

- [ ] **Step 5: Commit CLI and script wiring.**

```powershell
git add packages/domain/src/local-seed/cli.ts packages/domain/src/local-seed/index.ts packages/domain/test/local-seed-cli.unit.test.ts packages/domain/package.json package.json
git commit -m "feat(core): add local seed cli"
```

---

## 7. Task 5: Complete disposable DB smoke coverage and failure boundaries

**Files:**
- Modify: `packages/domain/test/local-seed.db.test.ts`
- Modify: `packages/domain/test/local-seed-cli.unit.test.ts` only if a discovered CLI boundary needs a focused regression

**Interfaces:**
- Consumes: executable `seed:local`, `buildLocalSeedPlan()`, `writeLocalSeed()`, and the existing `packages/domain/test/setup.ts` disposable-schema lifecycle.
- Produces: repeatable evidence for DB counts, no-growth reruns, rollback, local safety, and complete relation graph.

- [ ] **Step 1: Add the failing smoke assertions before broad verification.**

Add DB assertions for every generated scope:

```ts
expect(await prisma.user.findMany({ orderBy: { email: 'asc' } })).toHaveLength(50);
expect(await prisma.location.findMany({ orderBy: { shortCode: 'asc' } })).toMatchObject([
  { shortCode: 'LOCAL-A', isActive: true, timeZone: 'Asia/Ho_Chi_Minh' },
  { shortCode: 'LOCAL-B', isActive: true, timeZone: 'Asia/Ho_Chi_Minh' },
  { shortCode: 'LOCAL-C', isActive: true, timeZone: 'Asia/Ho_Chi_Minh' },
  { shortCode: 'LOCAL-D', isActive: true, timeZone: 'Asia/Ho_Chi_Minh' },
]);
expect(await prisma.employeeLocationAssignment.count({ where: { isActive: true } })).toBe(50);
expect(await prisma.registration.count({ where: { serviceLocationId: { not: null }, serviceLocationAssignmentId: { not: null } } })).toBe(126);
expect(await prisma.mealServing.count({ where: { registration: { status: 'SERVED' } } })).toBe(40);
expect(await prisma.mealEvent.count({ where: { eventType: 'PICKUP_CONFIRMED' } })).toBe(40);
expect(await prisma.otpAllowlist.count({ where: { state: 'ACTIVE', purpose: 'SESSION_LOGIN' } })).toBe(50);
```

Assert no kitchen-only user appears as a registration owner, each proxy serving references a completed delegation, and all four location policy thresholds/coordinates are finite and valid. Query the unrelated row inserted by the test by its fixed non-seed email/code and assert its original values after rerun.

- [ ] **Step 2: Run the focused DB test and confirm red.**

```powershell
yarn workspace @imeal/core exec vitest run --config ./vitest.config.ts test/local-seed.db.test.ts
```

Expected: FAIL only until the complete writer/CLI graph and smoke assertions are implemented; infrastructure failures must be reported as unavailable PostgreSQL/DATABASE_URL rather than converted into passing mocks.

- [ ] **Step 3: Implement smoke setup and exact relation checks.**

Use the existing setup's random schema and migration deployment. Do not add a second cleanup strategy. Build the fixed config from `process.env.DATABASE_URL` after setup has selected the disposable schema, write the plan, query rows by deterministic IDs, rerun, mutate a seed-owned name/snapshot, rerun, and assert convergence. Insert an unrelated user/location before the second run and assert no change. For rollback, mutate only the post-validation serving reference as defined in Task 3 and assert all counts are unchanged after the expected FK error.

- [ ] **Step 4: Run the green DB smoke and the package unit suite.**

```powershell
yarn workspace @imeal/core exec vitest run --config ./vitest.config.ts test/local-seed.db.test.ts
yarn workspace @imeal/core test:unit
```

Expected: DB smoke passes against a disposable PostgreSQL schema; package unit tests pass without requiring a DB; root unit wiring includes the new package unit suite.

- [ ] **Step 5: Commit the completed smoke coverage.**

```powershell
git add packages/domain/test/local-seed.db.test.ts packages/domain/test/local-seed-cli.unit.test.ts

git commit -m "test(core): verify local seed reruns and rollback"
```

---

## 8. Task 6: Update non-production operator documentation

**Files:**
- Modify: `docs/local-role-testing.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: the final CLI/env names and counts from Tasks 1–5.
- Produces: operator documentation that cannot be mistaken for a production provisioning procedure.

- [ ] **Step 1: Write documentation checks before editing.**

Use a focused text assertion/review checklist (not a new product test): the docs must contain `seed:local`, `IMEAL_LOCAL_SEED=1`, `IMEAL_LOCAL_SEED_CONFIRM=I_UNDERSTAND_LOCAL_ONLY`, `NODE_ENV=test`, local-only PostgreSQL host guidance, the base-plus-`-1..-49` convention, exactly four synthetic locations, the 50-user role matrix, rerun/no-reset behavior, and the statement that real operational location data is never in source control. The docs must not contain a production seed command or a real employee/location example.

- [ ] **Step 2: Edit the non-production guide and index.**

Add a dedicated section to `docs/local-role-testing.md` after the prerequisites and before the test-harness matrix. Include the exact PowerShell invocation:

```powershell
$env:NODE_ENV='test'
$env:IMEAL_LOCAL_SEED='1'
$env:IMEAL_LOCAL_SEED_CONFIRM='I_UNDERSTAND_LOCAL_ONLY'
$env:IMEAL_LOCAL_SEED_BASE_EMAIL='imeal.seed@example.test'
yarn workspace @imeal/core seed:local --dry-run
yarn workspace @imeal/core seed:local
```

State that the command requires a disposable local database, never runs against production, creates synthetic `LOCAL-A`..`LOCAL-D` values, is idempotent for the same base/week/serve-date, and has no reset/delete mode. Add the design spec and implementation plan to the existing `docs/README.md` reading-order list near the local role guide.

- [ ] **Step 3: Review the docs for safety and scope.**

Run:

```powershell
git diff --check
yarn workspace @imeal/core exec prettier --check docs/local-role-testing.md docs/README.md
```

Expected: no whitespace errors and formatting passes. Manually verify `.env.example`, migrations, deployment docs, and production startup instructions are unchanged.

- [ ] **Step 4: Commit documentation only.**

```powershell
git add docs/local-role-testing.md docs/README.md
git commit -m "docs: document local synthetic seed workflow"
```

---

## 9. Task 7: Final implementation verification and review gate

**Files:**
- Review only: all files in the file map; no additional production files are in scope.

**Interfaces:**
- Consumes: complete implementation and docs from Tasks 1–6.
- Produces: verified local seed command and a review-ready change with no production seed path.

- [ ] **Step 1: Run pure unit, domain DB, type, and formatting checks.**

```powershell
yarn workspace @imeal/core test:unit
yarn workspace @imeal/core exec vitest run --config ./vitest.config.ts test/local-seed.db.test.ts
yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json
yarn workspace @imeal/core exec prettier --check src/local-seed test/local-seed-config.unit.test.ts test/local-seed-ids.unit.test.ts test/local-seed-plan.unit.test.ts test/local-seed-cli.unit.test.ts test/local-seed.db.test.ts
```

Expected: all focused tests, typecheck, and formatting pass; DB output explicitly identifies the disposable schema. Do not claim live DB success if PostgreSQL is unavailable.

- [ ] **Step 2: Run CLI safety and idempotency smoke on a disposable local database.**

Run `--help`, `--dry-run`, then two identical writes using the explicit local/test environment. Query counts and deterministic IDs between writes. Attempt one remote/prod-marked URL and one missing confirmation; assert each fails before a Prisma client/write. Confirm output never contains `postgresql://` credentials, OTP/session values, QR text, or raw coordinates.

- [ ] **Step 3: Review the final diff against the approved spec.**

Check every spec section: goal/non-goals; safety; emails; deterministic IDs; role inheritance and migration discrepancy; four synthetic locations/assignments; menu and registration matrix; delegation/serving graph; transaction/error handling; CLI/env contract; tests/smoke; docs; and module responsibilities. Use a targeted search over changed files for `TODO`, `TBD`, `FIXME`, `placeholder`, `--force-production`, `prisma db seed`, real domains/addresses, and secret-looking values. Resolve every hit before delivery.

- [ ] **Step 4: Verify no production integration was added.**

Review changed-file list and assert that no Prisma migration, `schema.prisma`, API/worker startup, deployment file, `.env.example`, mobile, or Admin Web file changed. Confirm root/package scripts expose only the names documented here: `@imeal/core test:unit` and `@imeal/core seed:local`.

- [ ] **Step 5: Prepare the implementation handoff.**

Report the exact files changed, focused commands run, disposable DB availability/result, generated counts, and any pre-existing authorization discrepancy. Do not claim production readiness or real location/roster provisioning. The final implementation change should be reviewed and merged separately from this plan.
