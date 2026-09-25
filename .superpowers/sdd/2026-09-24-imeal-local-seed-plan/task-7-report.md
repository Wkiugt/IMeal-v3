# Fresh Docker-backed DB smoke (2026-09-25)

## Status

**PASS for the requested DB-backed smoke; PARTIAL overall because the repository Prettier executable remains unavailable.**

The Docker-backed disposable schema was migrated, seeded, rerun, queried, manually converged, checked for unrelated-row preservation, and covered by the existing rollback/failure-boundary suite. No source, test, production, or documentation file was changed. Database credentials were read from the ignored root `.env` only in process memory; they were not printed or added to any file.

## Docker/Compose setup

The repository Compose file was inspected. Its `db` service is `postgres:15-alpine`; `pgbouncer` depends on the healthy `db` service. To avoid the host's existing 5432 listener and the root `.env` PgBouncer port, the disposable services were started with alternate local ports while retaining the ignored `.env` credentials:

```text
POSTGRES_PORT=55432 PGBOUNCER_PORT=56432 docker compose up -d db pgbouncer
```

Exit 0. Compose created the network and started:

```text
Container wkiugt-develop-db-1 Started
Container wkiugt-develop-db-1 Healthy
Container imeal_pgbouncer Started
```

Health/readiness verification:

```text
POSTGRES_PORT=55432 PGBOUNCER_PORT=56432 docker compose ps
```

Exit 0:

```text
imeal_pgbouncer       edoburu/pgbouncer:latest   Up ... (healthy)  0.0.0.0:56432->5432/tcp
wkiugt-develop-db-1   postgres:15-alpine         Up ... (healthy)  0.0.0.0:55432->5432/tcp
```

```text
pg_isready -h localhost -p 55432
localhost:55432 - accepting connections

pg_isready -h localhost -p 56432
localhost:56432 - accepting connections
```

The disposable schema used for direct smoke was `task7_20260925` in the local Compose database. A safe in-memory wrapper read the ignored `.env` values, constructed a URL for `localhost:55432` with that schema, and passed it only to child processes. The URL/password never appeared in output.

## Migration/setup

The wrapper first ran a parameterized `psql` command equivalent to:

```text
psql -h localhost -p 55432 -U <ignored-.env-user> -d <ignored-.env-database> -v ON_ERROR_STOP=1 -c 'CREATE SCHEMA IF NOT EXISTS "task7_20260925";'
```

Exit 0: `CREATE SCHEMA`.

It then ran the exact child command below with the safely constructed `DATABASE_URL`:

```text
corepack yarn workspace @imeal/core exec prisma migrate deploy
```

Exit 0. Prisma reported 7 migrations found and all 7 successfully applied to database `imeal`, schema `task7_20260925`:

```text
20260827000000_manual_constraints
20260904000000_add_served_status
20260915000000_add_registration_meal_choice
20260918000000_structured_notifications
20260924000000_email_otp_presenter_gps
20260924103000_otp_delivery_claim_ownership
20260924150000_bind_serving_verification_nonce
```

## Seed write and identical rerun

The child command was:

```text
corepack yarn workspace @imeal/core seed:local
```

with process-only values `NODE_ENV=test`, `IMEAL_LOCAL_SEED=1`, `IMEAL_LOCAL_SEED_CONFIRM=I_UNDERSTAND_LOCAL_ONLY`, `IMEAL_LOCAL_SEED_BASE_EMAIL=imeal.seed@example.test`, and the safely constructed local schema URL.

The first write exited 0:

```text
LOCAL/TEST ONLY environment=test host=localhost database=imeal schema=task7_20260925 weekStart=2026-09-28 serveDate=2026-09-28 baseEmail=imeal.seed@example.test
WRITE COMPLETE
counts: users=50 userRoles=56 locations=4 locationPolicies=4 assignments=50 allowlists=50 weeklyMenus=1 dailyMenus=7 mealDays=7 menuRevisions=7 registrations=126 pendingDelegations=4 acceptedDelegations=4 completedDelegations=8 penalties=10 servingVerifications=40 pickupSessions=40 servingConfirmRequests=40 mealServings=40 mealEvents=40 appSettings=1
write: created=589 updated=0 unchanged=0
```

The identical rerun exited 0:

```text
write: created=0 updated=0 unchanged=589
```

The summary contained the `LOCAL/TEST ONLY` marker and no password, OTP/session value, QR payload, or raw coordinate.

## Exact persisted graph counts and relations

An in-memory `pg` query harness queried the migrated schema before and after the no-op rerun. Initial and no-op counts were identical:

```json
{
  "roles": 3,
  "user_roles": 56,
  "users": 50,
  "locations": 4,
  "location_policies": 4,
  "employee_location_assignments": 50,
  "otp_allowlists": 50,
  "weekly_menus": 1,
  "daily_menus": 7,
  "meal_days": 7,
  "daily_menu_revisions": 7,
  "app_settings": 1,
  "registrations": 126,
  "pickup_delegations": 16,
  "penalties": 10,
  "serving_verifications": 40,
  "pickup_sessions": 40,
  "serving_confirm_requests": 40,
  "meal_servings": 40,
  "meal_events": 40
}
```

Relation/status/choice queries observed:

```json
{
  "registrationStatus": {"ACTIVE": 60, "CANCELLED": 16, "SERVED": 40, "NO_SHOW": 10},
  "registrationMealChoice": {"REGULAR": 94, "VEGETARIAN": 32},
  "delegationStatus": {"PENDING": 4, "ACCEPTED": 4, "COMPLETED": 8},
  "servingReceiverType": {"SELF": 32, "PROXY": 8},
  "assignmentLocation": {"LOCAL-A": 13, "LOCAL-B": 13, "LOCAL-C": 12, "LOCAL-D": 12},
  "assignmentRole": {"ADMIN": 2, "KITCHEN": 6, "STAFF": 37, "STAFF_KITCHEN": 5},
  "mealEventType": {"PICKUP_CONFIRMED": 40},
  "penaltyStatus": {"PENDING": 10},
  "locationCodes": ["LOCAL-A", "LOCAL-B", "LOCAL-C", "LOCAL-D"],
  "servedMissingServing": 0,
  "nonServedWithServing": 0,
  "noShowPenaltyRows": 10,
  "activeDelegations": 8,
  "completedDelegations": 8,
  "servingEvidenceComplete": 40
}
```

The post-unrelated-row totals were `users=51` and `locations=5`; every seed-scoped count above remained unchanged. The extra rows were explicitly synthetic preservation fixtures (`task7-unrelated@example.test` and `EXT-KEEP`), not operational data.

## Deterministic IDs and timestamp/no-op evidence

The query harness compared all deterministic key rows across the first persisted graph and the identical rerun:

```text
initial idDigest=7a1391af22f603e865eda367ee3e316f5ba369b7d0481e69150835aa3f0741a3
no-op    idDigest=7a1391af22f603e865eda367ee3e316f5ba369b7d0481e69150835aa3f0741a3
idsStable=true

initial timeDigest=465b6e99ccbcb6a5c96e8744453cfabf7e09c24549c10ebc33d4a3ff56cc9184
no-op    timeDigest=465b6e99ccbcb6a5c96e8744453cfabf7e09c24549c10ebc33d4a3ff56cc9184
timestampsStable=true
```

Representative persisted IDs/timestamps included:

```text
imeal.seed@example.test
  id=0df5502a-8d2e-5e1b-8629-917611bbb957
  created_at=2026-01-02T17:00:37.682Z
  updated_at=2026-09-24T18:10:37.440Z

imeal.seed-49@example.test
  id=029de442-abaa-5c71-b871-bbf27aaebe13

LOCAL-A
  id=ff2944a8-2018-5436-b05a-27f0844a94e6
LOCAL-B
  id=45d97ee1-dd38-5c46-acbb-772d1e035305
LOCAL-C
  id=fadefd42-7189-59f4-8915-d5f99dd79040
LOCAL-D
  id=ae1e4d60-3cfd-5e88-9898-0df21e6d03b9

weeklyMenu id=d54dda79-ae95-512d-9c05-7daa35177def
```

## Manual edit convergence

The seed-owned base user's name was changed directly to `MANUAL_EDIT_TASK7`. The query observed the mutation, then the identical seed command exited 0 with:

```text
write: created=0 updated=1 unchanged=588
```

The same deterministic user ID was restored to:

```json
{"id":"0df5502a-8d2e-5e1b-8629-917611bbb957","email":"imeal.seed@example.test","name":"Local Seed User 001","updated_at":"2026-09-24T18:10:37.440Z"}
```

This verifies seed-owned field convergence and deterministic identity. The expected `updated_at` changed from the direct SQL manual-edit timestamp to the declared seed value during correction; the no-op rerun before mutation preserved all timestamp values.

## Unrelated-row preservation

The harness inserted one unrelated user and one unrelated location, captured complete rows, reran the seed, and compared complete JSON rows:

```text
[unrelated] preserved=true
```

The final seed ID subset remained stable (`seedIdsStable=true`). The complete-snapshot comparison reported only the intentionally manually corrected seed user as changed relative to the pre-manual baseline; no unrelated row changed, and no seed row was missing. Final total rows were 51 users and 5 locations, with the expected 50/4 seed keyspace intact.

## Existing rollback/failure-boundary smoke

The repository's existing DB suite was run with a safely constructed local `DATABASE_URL` (the test setup selected a fresh disposable schema and applied migrations):

```text
corepack yarn workspace @imeal/core exec vitest run --config ./vitest.config.ts test/local-seed.db.test.ts
```

Child exit 0. Exact observed result:

```text
✓ test/local-seed.db.test.ts (4 tests)
  ✓ persists the complete deterministic graph with required statuses and relations
  ✓ reruns without creating rows, restores edits, and keeps deterministic IDs stable
  ✓ preserves unrelated rows across a seed rerun
  ✓ rolls back all seed writes when a later serving foreign key fails

Test Files  1 passed (1)
Tests       4 passed (4)
```

This directly exercised the requested persisted graph, rerun/ID stability, unrelated-row isolation, and later-write foreign-key rollback boundary.

## Focused current-HEAD rechecks

After the DB smoke, the focused unit suite was rerun:

```text
corepack yarn workspace @imeal/core test:unit
Exit 0 — Test Files 5 passed (5), Tests 46 passed (46)

corepack yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json
Exit 0 — no diagnostics

corepack yarn workspace @imeal/core seed:local --help
Exit 0 — usage and safety contract printed
```

Safety rechecks returned the expected failures before writes:

```text
NODE_ENV=production ... seed:local --dry-run
Exit 1 — INVALID_ENVIRONMENT

NODE_ENV=test with IMEAL_LOCAL_SEED_CONFIRM omitted ... seed:local --dry-run
Exit 1 — INVALID_ENVIRONMENT

DATABASE_URL=postgresql://...@db.example.com:5432/... ... seed:local --dry-run
Exit 1 — REMOTE_DATABASE
```

The prior exact Prettier check remains unavailable (`prettier` not recognized, exit 127); this is the only remaining verification limitation recorded here. No active shutdown was cancelled; the process registry was checked and no pending shutdown was shown.

# Fresh current-HEAD smoke verification (2026-09-25)

## Current status

**Overall: BLOCKED for the required disposable-PostgreSQL gate; PARTIAL for DB-independent verification.**

The current HEAD fix waves were re-verified without changing source, tests, docs, or production files. The focused unit suite (46 tests), TypeScript check, executable help, documented dry-run, safety failures, and final diff whitespace check passed. PostgreSQL is listening on local port 5432, but the available credentials are not valid; the configured `.env` target is an unavailable PgBouncer port 6432, `DATABASE_URL` is unset in the process, `.env.test` is absent, and Docker Desktop is not running. No seed write committed, so no database counts/IDs/timestamps, convergence, rollback, or unrelated-row preservation can be claimed.

## Current environment and implementation inspection

Command:

```text
git status --short && node --version && corepack yarn --version && corepack yarn workspace @imeal/core exec tsc --version
```

Observed:

```text
 M apps/api/src/admin/roster/roster-import.service.ts
 M apps/api/src/otp/otp-outbox.service.spec.ts
 M apps/api/src/otp/otp-outbox.service.ts
v24.18.1
4.18.0
Version 5.9.3
```

Those three API changes are pre-existing working-tree changes and were not touched. Current source inspection confirmed that `config.ts` resolves an omitted serve date from the selected week start, `index.ts` renders all 21 count labels/values, and the package still exposes `test:unit` and `seed:local`.

Safe environment inspection reported:

```text
node -e "...DATABASE_URL..."
DATABASE_URL=<unset>

.env: DATABASE_URL=<set>, protocol=postgresql:, host=localhost, port=6432,
     database=imeal, schema=public
packages/domain/.env.test: <missing>
packages/domain/.env: <missing>
```

Credentials were not printed.

## Current focused verification

The exact brief commands using bare `yarn` still fail because `yarn` is not on PATH:

```text
yarn workspace @imeal/core test:unit
Exit 127: command not found: yarn

yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json
Exit 127: command not found: yarn
```

Corepack fallback unit suite:

```text
corepack yarn workspace @imeal/core test:unit
```

Exit 0. Observed:

```text
Test Files  5 passed (5)
Tests       46 passed (46)
```

Only the existing Vite CommonJS/ESM config warning was emitted.

Corepack fallback typecheck:

```text
corepack yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json
```

Exit 0, no diagnostics.

Executable help:

```text
corepack yarn workspace @imeal/core seed:local --help
```

Exit 0. The usage and complete local safety contract printed; no Prisma client was constructed.

Documented synthetic dry-run:

```text
NODE_ENV=test IMEAL_LOCAL_SEED=1 IMEAL_LOCAL_SEED_CONFIRM=I_UNDERSTAND_LOCAL_ONLY IMEAL_LOCAL_SEED_BASE_EMAIL=imeal.seed@example.test DATABASE_URL=postgresql://postgres:postgres@localhost:5432/imeal_local?schema=public corepack yarn workspace @imeal/core seed:local --dry-run
```

Exit 0. Application output:

```text
LOCAL/TEST ONLY environment=test host=localhost database=imeal_local schema=public weekStart=2026-09-28 serveDate=2026-09-28 baseEmail=imeal.seed@example.test
DRY-RUN: no database writes
counts: users=50 userRoles=56 locations=4 locationPolicies=4 assignments=50 allowlists=50 weeklyMenus=1 dailyMenus=7 mealDays=7 menuRevisions=7 registrations=126 pendingDelegations=4 acceptedDelegations=4 completedDelegations=8 penalties=10 servingVerifications=40 pickupSessions=40 servingConfirmRequests=40 mealServings=40 mealEvents=40 appSettings=1
```

The redacted output contained no database password, OTP/session value, QR payload, or raw coordinate.

Safety failures:

| Check | Exit/output |
| --- | --- |
| `NODE_ENV=production` with otherwise safe inputs | Exit 1, `INVALID_ENVIRONMENT` |
| Missing `IMEAL_LOCAL_SEED_CONFIRM` | Exit 1, `INVALID_ENVIRONMENT` |
| `DATABASE_URL=postgresql://postgres:postgres@db.example.com:5432/imeal_local?schema=public` | Exit 1, `REMOTE_DATABASE` |

Each failed before a Prisma client/write. The current CLI also retained the previously verified conflict and unsafe-override behavior (`CONFLICTING_INPUT` and `MISSING_ARGUMENT` respectively) in the passing unit suite.

Formatting check:

```text
corepack yarn workspace @imeal/core exec prettier --check src/local-seed test/local-seed-config.unit.test.ts test/local-seed-ids.unit.test.ts test/local-seed-plan.unit.test.ts test/local-seed-cli.unit.test.ts test/local-seed.db.test.ts
```

Exit 127:

```text
'prettier' is not recognized as an internal or external command,
operable program or batch file.
command not found: prettier
```

Final implementation diff check:

```text
git diff --check 9bb2b01656a9afb232090f488c7aef7a590f708a..HEAD
```

Exit 0 with no output.

## Disposable PostgreSQL/Docker attempt

Listener and Docker checks:

```text
docker version --format '{{.Server.Version}}' && docker compose ps
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine;
check if the path is correct and if the daemon is running:
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
Exit 1

pg_isready -h localhost -p 5432
localhost:5432 - accepting connections
Exit 0

pg_isready -h localhost -p 6432
localhost:6432 - no response
Exit 2
```

The process environment has no `DATABASE_URL`; the DB test setup therefore fails before collection:

```text
corepack yarn workspace @imeal/core exec vitest run --config ./vitest.config.ts test/local-seed.db.test.ts
Exit 1
Error: DATABASE_URL is not set in environment or .env.test
Tests       no tests
```

The existing PostgreSQL listener does not accept the documented local credentials:

```text
PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'select version();'
psql: error: connection to server at "localhost" (::1), port 5432 failed:
FATAL:  password authentication failed for user "postgres"
Exit 2
```

Migration/setup with the same explicit local target was attempted:

```text
NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5432/imeal_local?schema=public corepack yarn workspace @imeal/core exec prisma migrate deploy
```

Exit 1:

```text
Datasource "db": PostgreSQL database "imeal_local", schema "public" at "localhost:5432"
Error: P1000: Authentication failed against database server at `localhost`,
the provided database credentials for `postgres` are not valid.
```

One seed write and an identical second write were attempted with the explicit local target. Both exited 1 before commit with the current redacted error:

```text
P1000: Local seed write failed for transaction local-seed (P1000)
```

No migration, seed row, count query, deterministic-ID query, timestamp query, manual-edit convergence test, unrelated-row preservation test, rollback test, or serialization-conflict test ran. This is an infrastructure/authentication block, not a DB pass.

## Shutdown status

The process registry was inspected without cancelling anything. It showed no active pending 60-second shutdown; the listed `task2-db` service was already **failed**, and the other listed services were exited. No shutdown/cancellation command was issued.

## Current changed-file scope

`git diff --name-status 9bb2b01656a9afb232090f488c7aef7a590f708a..HEAD` currently reports 24 paths: the local-seed source/tests/package wiring, operator/docs/spec/plan updates, prior SDD reports, and this verification artifact. It contains no `schema.prisma`, Prisma migration, API/worker startup, deployment, `.env.example`, mobile, or Admin Web path. The three pre-existing API working-tree modifications listed above are outside this implementation diff and remain untouched.

The current focused artifact search retains the prior result: no production seed hook, `prisma db seed`, `--force-production`, or unresolved TODO/FIXME in the local-seed implementation; synthetic `.test`/`example` domains and fake secrets occur only in test/redaction fixtures. Coordinates are the explicit synthetic `(1,1)` through `(4,4)` values and are not emitted by CLI output.

## Fresh conclusion

**PARTIAL** for local unit/type/CLI/safety verification; **BLOCKED** for the required disposable-PostgreSQL smoke and therefore not a full PASS. The exact blocker is PostgreSQL authentication/configuration: `.env.test` and process `DATABASE_URL` are absent, Docker is unavailable, configured `.env` port 6432 is down, and the available 5432 listener rejects `postgres`/`postgres`. Do not claim generated persisted counts, IDs, timestamps, idempotency, convergence, rollback, or production readiness from this run.

# Task 7 verification report

**UPDATED / CONDITIONAL:** The initial three findings and final reviewer findings I-1 through I-4 are addressed in sections 7 and 8. PostgreSQL-backed graph/rerun/rollback behavior and formatting remain unverified because the disposable `DATABASE_URL` and Prettier executable are unavailable in this environment.

The earlier Task 7 observations and limitations remain historical evidence; sections 7–8 record the current fix waves and gaps.

## 1. Focused commands

The exact commands from `task-7-brief.md` were attempted first. `yarn` is not available on PATH; each exact command exited 127:

| Command | Exit/result |
| --- | --- |
| `yarn workspace @imeal/core test:unit` | Exit 127: `command not found: yarn` |
| `yarn workspace @imeal/core exec vitest run --config ./vitest.config.ts test/local-seed.db.test.ts` | Exit 127: `command not found: yarn` |
| `yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json` | Exit 127: `command not found: yarn` |
| `yarn workspace @imeal/core exec prettier --check src/local-seed test/local-seed-config.unit.test.ts test/local-seed-ids.unit.test.ts test/local-seed-plan.unit.test.ts test/local-seed-cli.unit.test.ts test/local-seed.db.test.ts` | Exit 127: `command not found: yarn` |

Corepack was available, so equivalent fallback commands were run:

### Unit suite

```text
corepack yarn workspace @imeal/core test:unit
```

Exit 0. Output reported a Vite CommonJS/ESM configuration warning, then:

```text
Test Files  5 passed (5)
Tests       41 passed (41)
```

This exercised the five local-seed unit files, including deterministic IDs/config safety, plan invariants, CLI boundaries, and writer retry/error boundaries. The generated plan assertions observed the expected full count shape: 50 users, 56 role links, 4 locations, 4 policies, 50 assignments, 50 allowlists, 1 weekly menu, 7 daily menus, 7 meal days, 7 revisions, 126 registrations, 4 pending delegations, 4 accepted delegations, 8 completed delegations, 10 penalties, 40 serving verifications, 40 pickup sessions, 40 serving-confirm requests, 40 servings, 40 meal events, and 1 app setting.

### Disposable DB suite

```text
corepack yarn workspace @imeal/core exec vitest run --config ./vitest.config.ts test/local-seed.db.test.ts
```

Exit 1 before test collection. Observed output:

```text
stdout | test/local-seed.db.test.ts
◇ injected env (0) from .env.test

FAIL test/local-seed.db.test.ts
Error: DATABASE_URL is not set in environment or .env.test
  at test/setup.ts:14:9

Test Files  1 failed (1)
Tests       no tests
```

No disposable PostgreSQL schema was created, no migration was applied, and no persisted generated counts, IDs, rerun comparison, rollback, or unrelated-row result was observed.

### Typecheck

```text
corepack yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json
```

Exit 0 with no output/diagnostics.

### Formatting

```text
corepack yarn workspace @imeal/core exec prettier --check src/local-seed test/local-seed-config.unit.test.ts test/local-seed-ids.unit.test.ts test/local-seed-plan.unit.test.ts test/local-seed-cli.unit.test.ts test/local-seed.db.test.ts
```

Exit 127. Observed output:

```text
'prettier' is not recognized as an internal or external command,
operable program or batch file.
command not found: prettier
```

Formatting is therefore **unverified**, not a pass.

## 2. CLI help, dry-run, write, and safety smoke

All CLI smoke commands below used the explicit local URL `postgresql://localhost:5432/imeal_local?schema=public`, synthetic base `imeal.seed@example.test`, and Corepack. Corepack emitted the same Node deprecation warning (`[DEP0180] fs.Stats constructor is deprecated`) on each invocation.

### Help

```text
corepack yarn workspace @imeal/core seed:local --help
```

Exit 0. Output included the usage line, required `NODE_ENV`, `IMEAL_LOCAL_SEED`, `IMEAL_LOCAL_SEED_CONFIRM`, `DATABASE_URL`, and the approved local hosts. No Prisma connection was attempted.

### Dry-run

```text
NODE_ENV=development IMEAL_LOCAL_SEED=1 IMEAL_LOCAL_SEED_CONFIRM=I_UNDERSTAND_LOCAL_ONLY DATABASE_URL=postgresql://localhost:5432/imeal_local?schema=public IMEAL_LOCAL_SEED_BASE_EMAIL=imeal.seed@example.test corepack yarn workspace @imeal/core seed:local --dry-run
```

Exit 0. Exact application output:

```text
LOCAL/TEST ONLY environment=development host=localhost database=imeal_local schema=public weekStart=2026-09-28 serveDate=2026-09-28 baseEmail=imeal.seed@example.test
DRY-RUN: no database writes
counts: 50 users / 4 locations / 50 assignments / 126 registrations / 40 servings
```

Observed CLI counts were 50 users, 4 locations, 50 assignments, 126 registrations, and 40 servings. The output contained no PostgreSQL credentials, OTP/session values, QR payload, or raw coordinates. The full graph counts listed in the unit section were observed through unit plan assertions, not a database write.

### Two identical writes

First write:

```text
NODE_ENV=development IMEAL_LOCAL_SEED=1 IMEAL_LOCAL_SEED_CONFIRM=I_UNDERSTAND_LOCAL_ONLY DATABASE_URL=postgresql://localhost:5432/imeal_local?schema=public IMEAL_LOCAL_SEED_BASE_EMAIL=imeal.seed@example.test corepack yarn workspace @imeal/core seed:local
```

Exit 1:

```text
UNKNOWN: Local seed write failed for transaction local-seed (UNKNOWN)
```

Second identical write: same command and same result, exit 1:

```text
UNKNOWN: Local seed write failed for transaction local-seed (UNKNOWN)
```

Because PostgreSQL/DATABASE_URL was unavailable, these were connection attempts that did not reach a committed write. They are not an idempotency pass and provide no count or ID comparison.

### Safety/conflict checks

| Check | Command variation | Exit/output |
| --- | --- | --- |
| Missing confirmation | Omitted `IMEAL_LOCAL_SEED_CONFIRM` | Exit 1, `INVALID_ENVIRONMENT` |
| Production `NODE_ENV` | `NODE_ENV=production` | Exit 1, `INVALID_ENVIRONMENT` |
| Production deployment marker | `APP_ENV=production` with `NODE_ENV=development` | Exit 1, `INVALID_ENVIRONMENT` |
| Remote host | `DATABASE_URL=postgresql://db.example.com:5432/imeal_local?schema=public` | Exit 1, `REMOTE_DATABASE` |
| Production-marked DB | `DATABASE_URL=postgresql://localhost:5432/imeal_prod?schema=public` | Exit 1, `PRODUCTION_MARKER` |
| Flag/env conflict | env base `imeal.seed@example.test`, flag `--base-email other.seed@example.test` | Exit 1, `CONFLICTING_INPUT` |
| Unsafe override | Added `--force-production` | Exit 1, `MISSING_ARGUMENT` |

These failures occurred during CLI parsing/safety handling and did not construct a Prisma client. Unit tests independently passed the injected no-Prisma safety boundaries.

## 3. Unresolved behavioral findings

### 3.1 Custom week start does not default serve date to the selected week

The approved contract says `serveDate` defaults to `weekStart`. `config.ts` instead has a fixed `DEFAULT_SERVE_DATE = '2026-09-28'`. This was reproduced through the CLI:

```text
NODE_ENV=development IMEAL_LOCAL_SEED=1 IMEAL_LOCAL_SEED_CONFIRM=I_UNDERSTAND_LOCAL_ONLY DATABASE_URL=postgresql://localhost:5432/imeal_local?schema=public IMEAL_LOCAL_SEED_BASE_EMAIL=imeal.seed@example.test corepack yarn workspace @imeal/core seed:local --dry-run --week-start 2026-10-05
```

Exit 1, exact application output: `INVALID_DATE`.

A valid Monday other than the fixed default must succeed with its own week start as the implicit serve date. This is an implementation/spec mismatch in the CLI date contract.

### 3.2 Rerun result accounting is not a no-op summary

`writer.ts` `upsertRow()` performs an update for every existing row and increments `updated` whenever `findUnique()` returns a row; it never increments `unchanged`. Consequently, a converged rerun would report all existing rows as updated rather than `created=0, updated=0` with the expected counts or an equivalent no-op result. The DB was unavailable, so this finding is from source review rather than a persisted rerun observation.

The same update path may also advance Prisma `@updatedAt` columns on reruns, which conflicts with the spec requirement that identical reruns preserve field values. This needs a disposable-DB verification/fix before treating idempotency as complete.

### 3.3 CLI summary is not a complete generated-count summary

`formatSummary()` prints only `users`, `locations`, `assignments`, `registrations`, and `mealServings`. The approved smoke contract asks for a complete count summary covering role links, policies, allowlists, menus/revisions/meal days, delegation statuses, penalties, serving evidence/sessions/requests, events, and the setting. Unit tests pin only the five displayed categories. This is a static review gap; the DB smoke could not assess operator output after a successful write.

## 4. Spec-section review

| Spec section | Verification result |
| --- | --- |
| Goal/non-goals | Pure local-seed modules, synthetic labels, and local-only docs are present. No production readiness or real provisioning is claimed. DB behavior remains unverified. |
| Canonical boundaries/existing behavior | Typecheck passed; no schema or migration change is in the implementation diff. Existing API/business rules were not modified. |
| Production safety | Help, dry-run, missing confirmation, production env, deployment marker, remote host, production DB marker, conflict, and unsafe-override checks returned non-zero as required. |
| Deterministic IDs/emails | Unit suite passed; no `randomUUID`, `Date.now`, or `Math.random` hits in local-seed source/tests. Full persisted stability is unverified. |
| Roles/authorization | Unit plan assertions passed for the 50-user/56-role-link matrix and kitchen-only/staff-capable ownership rules. The known repository discrepancy remains intentionally unmodified: the existing migration maps `admin` to `kitchen.serve`, while controller-required `allowlist.manage`, `location.manage`, and `roster.manage` permissions are not created by this seed. |
| Locations/assignments | Unit assertions passed for four synthetic codes, policies, round-robin assignments, and 50 employee codes. DB constraints and persisted uniqueness are unverified. |
| Menus/registrations | Unit assertions passed for seven dates, menu graph, 126 registrations, statuses, choices, and snapshots. Custom-week implicit serve-date behavior is a concrete unresolved CLI gap. |
| Delegations/serving/supporting rows | Unit assertions passed for active/completed delegation relationships and the 40-row serving graph. No DB write, FK/check, or query result was observed. |
| Transaction/error handling | Writer unit tests passed for serializable transaction invocation, bounded P2034 retry, non-retryable errors, redaction, role absence, and external short-code conflict. Actual rollback/serialization behavior is unverified without PostgreSQL. |
| CLI/env contract | Help, dry-run, safety failures, conflict, and redacted output were exercised. Writes failed before commit due missing DB. Date default and incomplete count summary remain unresolved. |
| Tests/smoke | Unit and typecheck passed only through Corepack fallback; DB suite failed before collection due missing DATABASE_URL; Prettier unavailable. |
| Documentation/update scope | `docs/local-role-testing.md` and `docs/README.md` contain the local-only command and reading-order entries. Documentation Prettier was not available. |
| Module responsibilities | The planned `types`, `config`, `ids`, `plan`, `writer`, `cli`, `index`, unit config, focused tests, package scripts, and docs are present. |

## 5. Changed-file scope and forbidden-file review

Implementation diff reviewed as `git diff 9bb2b01656a9afb232090f488c7aef7a590f708a..HEAD` contained these 20 paths:

```text
.superpowers/sdd/2026-09-24-imeal-local-seed-plan/task-5-report.md
.superpowers/sdd/2026-09-24-imeal-local-seed-plan/task-6-report.md
docs/README.md
docs/local-role-testing.md
package.json
packages/domain/package.json
packages/domain/src/local-seed/cli.ts
packages/domain/src/local-seed/config.ts
packages/domain/src/local-seed/ids.ts
packages/domain/src/local-seed/index.ts
packages/domain/src/local-seed/plan.ts
packages/domain/src/local-seed/types.ts
packages/domain/src/local-seed/writer.ts
packages/domain/test/local-seed-cli.unit.test.ts
packages/domain/test/local-seed-config.unit.test.ts
packages/domain/test/local-seed-ids.unit.test.ts
packages/domain/test/local-seed-plan.unit.test.ts
packages/domain/test/local-seed-writer.unit.test.ts
packages/domain/test/local-seed.db.test.ts
packages/domain/vitest.unit.config.ts
```

No Prisma migration, `packages/domain/prisma/schema.prisma`, API/worker startup code, deployment file, `.env.example`, mobile file, or Admin Web file is in that implementation diff. Root/package scripts expose the expected `@imeal/core test:unit` and `@imeal/core seed:local` wiring; no production `prisma db seed` hook was added.

The working tree also had pre-existing unrelated modifications, recorded by the SDD ledger and left untouched:

```text
apps/api/src/admin/roster/roster-import.service.ts
apps/api/src/otp/otp-outbox.service.spec.ts
apps/api/src/otp/otp-outbox.service.ts
```

### Targeted forbidden-content search

- No `TODO`, `FIXME`, `--force-production`, or `prisma db seed` was found in the new local-seed implementation/tests.
- Search hits for `TBD` in `docs/README.md` and generic `placeholders` in the existing local-role guide are pre-existing unrelated documentation context, not introduced by the seed diff.
- `imeal.seed@example.test`, `seed@example.test`, `db.example.test`, and `remote.example` are synthetic/test-only domains used by the implementation tests and safety fixtures.
- `super-secret`/`secret` strings occur only as deliberate fake credentials in redaction tests; those tests assert that the values do not appear in output/errors. No real credential was observed.
- Coordinates `(1,1)` through `(4,4)` are the explicitly synthetic values from the approved spec and were not emitted by the CLI summary. OTP/session/QR terms are schema/fixture fields or redaction assertions; no clear values were printed.

## 6. Required handoff limitations

- No PostgreSQL-backed write, query, rerun, generated-ID comparison, rollback, unrelated-row preservation, or transaction-conflict smoke can be claimed.
- No Prettier result can be claimed because the executable is unavailable/resolution failed.
- The existing migration authorization discrepancy must remain a separately documented prerequisite; this seed does not fix or hide it.
- The three actionable static findings are resolved in section 7; PostgreSQL smoke still requires an explicit local `DATABASE_URL` before database-backed behavior can be claimed.

## 7. Final fix wave

The final fix wave addressed every actionable static finding from this report:

- `config.ts` now defaults `serveDate` to the resolved `weekStart`. The fixed `2026-09-28` week remains the default when no week-start input is supplied. Unit coverage exercises omitted serve dates with both `--week-start` and `IMEAL_LOCAL_SEED_WEEK_START`, while the existing explicit serve-date coverage remains.
- `writer.ts` now reads each deterministic row before upserting, compares the complete seed-owned update field set (including dates, arrays, and JSON values), skips unchanged rows, and reports `unchanged` rather than `updated`. Changed seed-owned rows still use the existing deterministic upsert path. The DB-independent fake-transaction regression proves unchanged rows issue no upsert and report no-op counts.
- `index.ts` now renders every `SeedCounts` label/value in the redacted `LOCAL/TEST ONLY` summary. CLI unit coverage asserts all 21 generated graph count labels and values.

Fresh verification:

| Command | Result |
| --- | --- |
| `corepack yarn workspace @imeal/core exec vitest run --config ./vitest.unit.config.ts test/local-seed-config.unit.test.ts test/local-seed-cli.unit.test.ts test/local-seed-writer.unit.test.ts` | 3 files, 28 tests passed |
| `corepack yarn workspace @imeal/core test:unit` | 5 files, 44 tests passed |
| `corepack yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json` | Passed with no diagnostics |
| `corepack yarn workspace @imeal/core seed:local --help` | Passed; usage and safety contract printed without Prisma construction |
| custom-week executable dry-run (`--week-start 2026-10-05`) | Passed; `serveDate=2026-10-05`, complete count summary, and `LOCAL/TEST ONLY` marker printed |

Current gaps remain unchanged: the disposable PostgreSQL suite cannot collect without an explicit `DATABASE_URL`, so no PostgreSQL graph, rerun, `@updatedAt`, rollback, unrelated-row, or serialization result is claimed. Prettier remains unavailable. The existing migration authorization discrepancy (`admin -> kitchen.serve`, plus missing controller-required admin permissions) remains outside this fix.

## 8. Final reviewer fix wave

The final reviewer findings were addressed in one additional fix wave:

- **I-1 documented `.env` path:** `docs/local-role-testing.md` now states that the seed CLI reads only the current process environment and does not load `.env`. The command block explicitly sets every required safety variable, including a synthetic local `DATABASE_URL` placeholder.
- **I-2 keyspace contract:** the approved spec, implementation plan constraints, and operator guide now state that the exact 50-email, `LOCAL-A`..`LOCAL-D`, and fixed employee-code keyspaces require a separate disposable database/schema for a different base/week. Same-database conflicts fail closed through unique constraints; no namespacing, adoption, or deletion was added. The operator guide records this as the expected smoke assertion.
- **I-3 initialization error code:** `writer.ts#errorCode()` now reads both Prisma request `code` and initialization `errorCode`. The focused fake-client test observes `P1001` while still redacting the connection message.
- **I-4 timestamp/manual convergence:** all update mappers include declared deterministic `createdAt`; User creation includes its declared deterministic `updatedAt`. Prisma-managed `@updatedAt` values remain out of update comparison/payloads so no-op reruns preserve them and real corrections refresh them once. Fake writer tests cover both no-op timestamp preservation and manual `createdAt` convergence.

Fresh final-wave verification:

| Command | Result |
| --- | --- |
| focused writer regression | Red: 2 expected failures before fixes; green: 1 file, 12 tests passed |
| `corepack yarn workspace @imeal/core test:unit` | 5 files, 46 tests passed |
| `corepack yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json` | Passed with no diagnostics |
| executable help/custom-week dry-run/safety smoke | Passed; complete redacted summary and `serveDate=weekStart` observed; production mode rejected with `INVALID_ENVIRONMENT` |
| disposable PostgreSQL suite | Failed before collection because `DATABASE_URL` is absent from the environment and `.env.test`; no database result is claimed |

Prettier remains unavailable. The existing migration authorization discrepancy remains a separate prerequisite. No schema, migration, API, worker, deployment, or `.env.example` file was modified.