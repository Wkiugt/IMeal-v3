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