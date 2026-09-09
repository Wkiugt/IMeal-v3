# Regression task report: real-guard serving authorization

## Implementation

Updated `apps/api/test/pickup.e2e-spec.ts` so the public-source serving regression uses an isolated Nest application with the production `JwtAuthGuard` and `PermissionsGuard`, rather than overriding either guard.

The regression now:

- Saves `AUTH_MODE`, `REQUIRE_AUTH`, and `LOCAL_AUTH_JWT_SECRET`, sets local-auth test values, and restores each original value (or deletes it when originally absent) in `finally`.
- Registers `InternalPickupController` with a single mocked `PickupService.resolvePickup`, a mocked `AuthService.getPrincipal`, the real `JwtAuthGuard`, the real `PermissionsGuard`, and `Reflector`.
- Returns complete authenticated principals from the `AuthService` mock: kitchen receives the `kitchen` role and `kitchen.serve` permission; staff receives the `staff` role and no permissions.
- Signs local JWTs with `JwtService` and the configured local test secret.
- Enables Express `trust proxy` before application initialization and sends `X-Forwarded-For: 203.0.113.10` with every request.
- Proves the three authorization boundaries on `POST /api/serving/resolve`:
  1. Kitchen bearer token from a public source returns `201` and the mocked resolved payload.
  2. Missing bearer token returns `401` and does not call `resolvePickup`.
  3. Staff bearer token without `kitchen.serve` returns `403` and does not call `resolvePickup`.
- Closes the isolated Nest application in `finally`.

## Files changed

- Product/test change: `apps/api/test/pickup.e2e-spec.ts`
- Required task artifact (not staged or committed): `.superpowers/sdd/pr4-local-wip-reconciliation-plan/task-regression-report.md`

No other product file was modified.

## Verification command and output

Command:

```text
corepack yarn workspace @imeal/api exec vitest run --config ./vitest.config.e2e.ts test/pickup.e2e-spec.ts -t "public source IP|bearer token|kitchen.serve"
```

Final result:

```text
Test Files  1 passed (1)
Tests       1 passed | 7 skipped (8)
Duration    3.95s
Wall time   4.92s
```

The repository did not expose `DATABASE_URL` to the test process, and `.env` was not read. A disposable PostgreSQL container with an explicit test-only connection was used for the focused run and stopped afterward. The first cold migration attempt exceeded the setup hook's 10-second timeout; the fresh final rerun completed successfully. Vitest also emitted the existing advisory that Vite can replace `vite-tsconfig-paths` with native `resolve.tsconfigPaths`; this is unrelated to the regression.

## Self-review

- Confirmed there are no guard overrides in the public-source regression.
- Confirmed the real JWT guard performs bearer verification and principal lookup.
- Confirmed the real permissions guard reads controller metadata for `kitchen.serve`.
- Confirmed all three requests use the same public forwarded source IP.
- Confirmed the service mock is cleared before each denial request, making each `not.toHaveBeenCalled()` assertion independently meaningful.
- Confirmed the application close and all three environment restorations are protected by `finally`.
- Confirmed only the exact test file will be staged for the requested commit; the report remains an untracked task artifact by instruction.
