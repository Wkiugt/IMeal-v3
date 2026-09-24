# IMeal local synthetic seed final fix report

**Date:** 2026-09-25
**Base:** `f6c7e51`
**Status:** Final-review findings I-1 through I-4 addressed; PostgreSQL smoke remains blocked by missing disposable `DATABASE_URL`.

## Scope

The initial fix wave addressed the three findings recorded in the prior Task 7 report. The final reviewer fix wave is recorded below.

1. `config.ts` now resolves the selected week before applying the implicit serve-date default. An omitted serve date follows an explicit `--week-start` or `IMEAL_LOCAL_SEED_WEEK_START`; when week-start is omitted, both remain the fixed default `2026-09-28`. Regression coverage includes flag and environment week-start inputs, the fixed default, and explicit serve-date input.
2. `writer.ts` now reads each deterministic row with its scalar fields, compares the seed-owned update payload before calling the existing upsert, and reports `unchanged` for an exact match. Comparison handles `Date`, arrays, and JSON objects and ignores fields Prisma would omit (`undefined`). Changed seed-owned rows still use the deterministic update path; no delete or external-row adoption was added. The fake-transaction regression confirms unchanged rows issue no upsert and return `created=0`, `updated=0`, and the expected `unchanged` count.
3. `index.ts` now renders every `SeedCounts` entry as a redacted `label=value` count in the `LOCAL/TEST ONLY` summary. CLI unit coverage asserts all 21 graph count labels and values.

## TDD evidence

The new regressions were run before the production fixes and failed for the expected reasons:

```text
local-seed-config.unit.test.ts: custom week without serve date -> INVALID_DATE
local-seed-cli.unit.test.ts: expected users=50 -> summary only contained the five old counts
local-seed-writer.unit.test.ts: expected unchanged=2 -> result was updated=2
```

After implementation, the focused suite passed:

```text
corepack yarn workspace @imeal/core exec vitest run --config ./vitest.unit.config.ts \
  test/local-seed-config.unit.test.ts \
  test/local-seed-cli.unit.test.ts \
  test/local-seed-writer.unit.test.ts

Test Files  3 passed (3)
Tests       28 passed (28)
```

## Verification

```text
corepack yarn workspace @imeal/core test:unit
Test Files  5 passed (5)
Tests       44 passed (44)
```

```text
corepack yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json
(no diagnostics)
```

Executable smoke checks:

- `corepack yarn workspace @imeal/core seed:local --help` exited successfully and printed usage plus the safety contract without constructing Prisma.
- A custom-week dry-run with `--week-start 2026-10-05` exited successfully and printed `weekStart=2026-10-05 serveDate=2026-10-05`, the `LOCAL/TEST ONLY` marker, and all generated counts:

```text
counts: users=50 userRoles=56 locations=4 locationPolicies=4 assignments=50 allowlists=50 weeklyMenus=1 dailyMenus=7 mealDays=7 menuRevisions=7 registrations=126 pendingDelegations=4 acceptedDelegations=4 completedDelegations=8 penalties=10 servingVerifications=40 pickupSessions=40 servingConfirmRequests=40 mealServings=40 mealEvents=40 appSettings=1
```

The summary remained redacted; it did not print the database password, confirmation token, OTP/session values, QR payloads, or raw coordinates.

## Infrastructure gaps and concerns

The disposable PostgreSQL suite was attempted with:

```text
corepack yarn workspace @imeal/core exec vitest run --config ./vitest.config.ts test/local-seed.db.test.ts
```

It failed before test collection because `DATABASE_URL` is not set in the environment or `.env.test`. Therefore this fix report does **not** claim PostgreSQL graph persistence, identical-rerun `@updatedAt` preservation, manual-edit convergence against a real database, rollback, unrelated-row isolation, or serialization-conflict behavior.

Prettier was unavailable in the environment, so formatting remains unverified. The existing migration authorization discrepancy (`admin -> kitchen.serve`, and missing controller-required `allowlist.manage`, `location.manage`, and `roster.manage`) remains a separate prerequisite and was not changed.

- `packages/domain/src/local-seed/config.ts`
- `packages/domain/src/local-seed/index.ts`
- `packages/domain/src/local-seed/writer.ts`
- `packages/domain/test/local-seed-config.unit.test.ts`
- `packages/domain/test/local-seed-cli.unit.test.ts`
- `packages/domain/test/local-seed-writer.unit.test.ts`
- `docs/local-role-testing.md`
- `docs/superpowers/specs/2026-09-24-imeal-local-seed-design.md`
- `docs/superpowers/plans/2026-09-24-imeal-local-seed-plan.md`
- `.superpowers/sdd/2026-09-24-imeal-local-seed-plan/task-7-report.md`
- `.superpowers/sdd/2026-09-24-imeal-local-seed-plan/final-fix-report.md`

No schema, migration, API, worker, deployment, or `.env.example` file was modified by this fix wave.

## Final reviewer fix wave (I-1 through I-4)

- **I-1:** `docs/local-role-testing.md` now states that the CLI reads the current process environment only and does not load `.env`. The PowerShell invocation explicitly sets every required safety variable, including the synthetic local placeholder `postgresql://postgres:postgres@localhost:5432/imeal_local?schema=public`.
- **I-2:** The approved spec, implementation plan constraints, and operator guide now correct the keyspace contract. The exact 50-email, `LOCAL-A`..`LOCAL-D`, and `LOCAL-EMP-0001`..`LOCAL-EMP-0050` values require a separate disposable database/schema for a different base or week. Same-database conflicts are expected to fail closed through unique constraints; the writer never adopts or deletes rows outside deterministic IDs. No namespacing was added.
- **I-3:** `writer.ts#errorCode()` now maps both Prisma request `code` and initialization `errorCode` while preserving redacted errors. A focused fake-client test proves an initialization `P1001` is reported as `P1001` without its connection message.
- **I-4:** Every update mapper now includes its declared deterministic `createdAt` field, and User creation now includes its declared deterministic `updatedAt`. Prisma-managed `@updatedAt` values are intentionally excluded from update comparisons/payloads so unchanged reruns preserve the stored timestamp and a real correction refreshes it once. Fake writer coverage now proves an unchanged row with a preserved `updatedAt` skips updates and a manually changed `createdAt` converges.

Final reviewer-wave verification:

| Command | Result |
| --- | --- |
| focused writer regression (`test/local-seed-writer.unit.test.ts`) | Red: 2 expected failures before the fixes; green: 1 file, 12 tests passed |
| `corepack yarn workspace @imeal/core test:unit` | 5 files, 46 tests passed |
| `corepack yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json` | Passed with no diagnostics |
| executable help/custom-week dry-run/safety smoke | Passed; help and redacted complete dry-run succeeded, custom `serveDate=weekStart` observed, production `NODE_ENV` rejected with `INVALID_ENVIRONMENT` |
| `git diff --cached --check` | Passed on the staged final wave |

The disposable PostgreSQL suite was attempted again and still failed before collection because `DATABASE_URL` is absent from the environment and `.env.test`. No PostgreSQL graph, same-database conflict, rerun timestamp, rollback, unrelated-row, or serialization result is claimed. Prettier remains unavailable. The existing migration authorization discrepancy remains a separate prerequisite.
