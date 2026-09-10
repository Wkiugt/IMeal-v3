# Task 4 — Registration transport report

## Changed files

- `packages/contracts/src/v1/registrations.ts`
  - Adds `RegistrationStatusSchema`, semantically validated `BatchRegistrationItemSchema`, request/result/response schemas, and inferred types.
  - Meal dates require `YYYY-MM-DD` syntax and reject normalized invalid calendar dates such as `2026-02-30`.
- `packages/contracts/src/v1/index.ts`
  - Exports registration contracts while preserving the existing pickup export.
- `packages/contracts/test/contracts.test.ts`
  - Covers successful batch results, per-date rejection reasons, invalid date syntax/calendar dates, and invalid status.
- `apps/api/src/registrations/registrations.controller.ts`
  - Moves controller routes to `api/registrations`.
  - Replaces the DTO body with `ZodValidationPipe(v1.BatchRegistrationRequestSchema)` and forwards the parsed registration array.
- `apps/api/src/registrations/dto/batch-register.dto.ts`
  - Removed obsolete DTO after the Zod contract cutover.
- `apps/api/test/registrations.e2e-spec.ts`
  - Adds service-override e2e coverage for the `/api` GET and PUT routes, parsed batch forwarding/per-date results, malformed requests returning 400, and the old unprefixed batch route returning 404.
- `apps/mobile/src/api/registrationAPI.ts`
  - Uses `API_BASE` for both registration endpoints.
  - Reuses the v1 registration status/result types and validates successful batch response JSON, rejecting empty/invalid bodies with `The registration response is invalid`.
- `apps/mobile/src/screens/employee/EmployeeCalendarScreen.tsx`
  - Converts native `TypeError` fetch failures into the actionable connection message while retaining optimistic rollback, cutoff refresh, and authoritative server reasons.

## Focused checks

- `corepack yarn workspace @imeal/contracts test`
  - Exit code 0; 16 tests passed.
- `corepack yarn workspace @imeal/contracts build`
  - Exit code 0; declarations rebuilt for consuming workspaces.
- `corepack yarn workspace @imeal/api test -- src/registrations/registrations.service.spec.ts`
  - Exit code 0; API suite completed with 13 files and 77 tests passing under the repository test configuration.
- `corepack yarn workspace @imeal/api exec tsc --noEmit -p tsconfig.json`
  - Exit code 0; no output.
- `corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json`
  - Exit code 0; no output.
- `git diff --check -- [Task 4 files]`
  - Exit code 0; no whitespace errors.
- `corepack yarn workspace @imeal/api test:e2e -- test/registrations.e2e-spec.ts`
  - Could not execute tests because the configured `packages/domain/test/setup.ts` requires `DATABASE_URL` and the workspace has no `.env.test`/database available; Vitest aborted all e2e suites before test collection with `DATABASE_URL is not set in environment or .env.test`.

## Self-review

- The contracts index retains Task 3's pickup export and adds registrations without replacing unrelated exports.
- The controller's route cutover has no compatibility alias; the e2e test explicitly asserts the old batch path is 404.
- Request validation happens before the service call, including strict object shape, allowed statuses, date syntax, and semantic calendar-date validity.
- The mobile batch path validates only successful response bodies, preserving existing generic non-2xx handling and server per-date reasons.
- No retry, artificial delay, fake success, or registration state behavior was introduced.
- Existing optimistic rollback and cutoff-specific refresh behavior remains intact.
- Preexisting user edits in README/docs and Task 3 changes were not staged.

## Concerns

- Registration e2e behavior is covered in source but could not be run in this workspace because the repository's shared e2e setup requires a reachable PostgreSQL test database and `DATABASE_URL`.
- No mobile runtime surface was launched; mobile and API focused typechecks passed.
