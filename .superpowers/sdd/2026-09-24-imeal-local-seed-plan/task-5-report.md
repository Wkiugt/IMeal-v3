# Task 5 report

## Status

Implemented additive disposable-PostgreSQL smoke coverage in `packages/domain/test/local-seed.db.test.ts`.

No CLI test file change was needed: the existing DB-independent CLI/config suites already assert that missing configuration and unsafe production targets fail before Prisma construction or writes.

## Smoke coverage added

- Exact persisted graph counts for canonical roles, role links, users, locations, policies, assignments, allowlists, weekly/daily menus, meal days, revisions, settings, registrations, delegations, penalties, serving verifications, pickup sessions, confirmation requests, servings, and events.
- Exact location codes, active/time-zone values, finite policy coordinates and thresholds.
- One active assignment per user with unique employee codes and round-robin location relationships.
- Role cohort distribution and the invariant that kitchen-only users do not own registrations.
- Seven-day menu/revision/meal-day relationships and serving readiness on the selected date.
- Registration status distribution, complete immutable location snapshots, served/non-served serving relationships, and no-show penalties.
- Self versus proxy serving relationships, completed proxy delegations, kitchen serving context, verification/session/event links, and successful confirmation-request links.
- Active session-login allowlist count and serving-ready application setting.
- Full-graph ID snapshots and counts across an identical rerun; local edits to a seed-owned user name and registration location snapshot are restored without growth.
- Unrelated fixed user/location rows remain byte-for-byte unchanged across a rerun.
- Full-graph counts remain unchanged when a validated plan is mutated to reference a missing serving registration and the transaction returns `P2003`.

## Verification

Focused DB smoke command:

```text
corepack.cmd yarn workspace @imeal/core exec vitest run --config ./vitest.config.ts test/local-seed.db.test.ts
```

Result: unavailable before test collection. The existing disposable setup reports:

```text
Error: DATABASE_URL is not set in environment or .env.test
```

No PostgreSQL graph, rerun, unrelated-row, or rollback behavior is claimed as runtime-verified in this environment. No mock or alternate cleanup strategy was introduced.

DB-independent local-seed unit command:

```text
corepack.cmd yarn workspace @imeal/core exec vitest run --config ./vitest.unit.config.ts
```

Result: passed, 5 files and 41 tests. This includes the existing CLI safety assertions for missing `DATABASE_URL`, unsafe `NODE_ENV`, redacted failures, and no Prisma/write calls on rejected paths, plus the complete config safety matrix.

Package typecheck:

```text
corepack.cmd yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json
```

Result: passed with no diagnostics.

Formatting check:

```text
git diff --check -- packages/domain/test/local-seed.db.test.ts
```

Result: passed. Git emitted only the existing LF/CRLF working-copy warning.

## Concerns / limits

- A local PostgreSQL `DATABASE_URL` and disposable-schema migration run remain required to execute the new smoke assertions and verify the complete transaction against the current schema.
- The DB smoke setup still fails before collection when PostgreSQL configuration is absent, intentionally preserving infrastructure evidence rather than converting the test to a mock.
- Existing unrelated API roster/OTP working-tree changes were not modified.

## Review fix round 1

Addressed all five review findings in `packages/domain/test/local-seed.db.test.ts`:

- The unrelated-row test now captures complete user/location rows, reruns the writer, and queries only the fixed literals `unrelated@example.net` and `EXT-KEEP` for unchanged-row assertions.
- The smoke config now reads the disposable `process.env.DATABASE_URL` selected by `test/setup.ts` and derives host, database, and schema from that URL; it no longer hard-codes `test_seed`.
- Every proxy serving now asserts that the completed delegation's `delegateUserId` equals the persisted serving presenter.
- Penalty checks now load `userId`, match each reason to a distinct NO_SHOW registration, and assert the penalty owner equals that registration's owner.
- Assignment checks map persisted location codes to persisted location IDs and assert the expected round-robin location ID for all 50 assignments.

Review-fix DB smoke attempt:

```text
corepack.cmd yarn workspace @imeal/core exec vitest run --config ./vitest.config.ts test/local-seed.db.test.ts
```

Result: still unavailable before test collection with the exact setup failure:

```text
Error: DATABASE_URL is not set in environment or .env.test
```

Review-fix DB-independent verification:

```text
corepack.cmd yarn workspace @imeal/core exec vitest run --config ./vitest.unit.config.ts
corepack.cmd yarn workspace @imeal/core exec tsc --noEmit -p tsconfig.json
git diff --check -- packages/domain/test/local-seed.db.test.ts
```

Results: 5 unit-test files / 41 tests passed; TypeScript passed with no diagnostics; diff check passed with only the existing LF/CRLF warning.
