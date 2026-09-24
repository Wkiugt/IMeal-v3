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
