# Task 1 — Public-source pickup integration regression

## Change

Added `allows a Kitchen caller to resolve pickup from a public source IP` to `apps/api/test/pickup.e2e-spec.ts`.

The test creates and closes a minimal Nest application inside the test, temporarily sets `REQUIRE_AUTH` to `true`, restores the prior value in `finally`, overrides the JWT and permission guards, enables Express `trust proxy`, and posts the public source address `203.0.113.10` through `X-Forwarded-For` to `/api/serving/resolve`. It asserts HTTP `201` and the exact mocked session/items response. Existing `/internal/api/v1/pickup/resolve` and `/internal/api/v1/pickup/confirm` cases remain unchanged.

No production code was changed.

## Focused verification

### Pre-fix regression (isolated config, before production edits)

Command:

```text
corepack yarn workspace @imeal/api exec dotenv -e ../../.env -- vitest run --config ./vitest.config.pickup.temp.ts test/pickup.e2e-spec.ts -t "allows a Kitchen caller to resolve pickup from a public source IP"
```

Result: **failed as expected with HTTP 403** from the still-present `InternalIpGuard`:

```text
❯ test/pickup.e2e-spec.ts (8 tests | 1 failed | 7 skipped) 410ms
     × allows a Kitchen caller to resolve pickup from a public source IP 407ms

AssertionError: expected 403 to be 201 // Object.is equality
- Expected
+ Received
- 201
+ 403
❯ test/pickup.e2e-spec.ts:184:26
```

The temporary no-database Vitest config used for this focused pre-fix run was removed and is not part of the change.

### Repository e2e setup attempt

Command:

```text
corepack yarn workspace @imeal/api test:e2e pickup.e2e-spec.ts -t "allows a Kitchen caller to resolve pickup from a public source IP"
```

Result: the configured domain setup stopped before test execution because this worktree has no `DATABASE_URL` or `packages/domain/.env.test`:

```text
Error: DATABASE_URL is not set in environment or .env.test
```

A second run with the repository `.env` loaded reached the setup hook but timed out connecting to PostgreSQL on `localhost:6432`; the isolated run above bypassed only that database setup and exercised the new HTTP regression to the expected pre-fix `403`.

## Scope

No formatters, linters, broad suites, or production edits were performed.
