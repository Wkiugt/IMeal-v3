# Task 2 report

## Changed files

- `apps/api/package.json` — pinned `@dqcai/vn-lunar` to `1.0.1`.
- `yarn.lock` — resolved the pinned lunar package and API workspace dependency.
- `apps/api/src/common/vietnamese-lunar.ts` — date-only Vietnamese lunar conversion and lunar day 1/15 meal-choice availability, with explicit 1200–2199 range errors.
- `apps/api/src/common/vietnamese-lunar.spec.ts` — conversion fixtures, lunar day availability, invalid-date, and supported-range boundary tests.
- `apps/api/src/registrations/registrations.service.ts` — seven-day server-authoritative lunar metadata, UTC serialization and strict response parsing; typed invalid-date errors; meal-choice enforcement; fixed batch precedence, transaction isolation, idempotency, versioning, finalized protection, and cancellation outbox behavior.
- `apps/api/src/registrations/registrations.service.spec.ts` — focused RED/GREEN coverage for week metadata, menu/date serialization, cutoff precedence, partial results, choice availability, state transitions, finalized rows, idempotency, and transaction failures.
- `apps/api/test/registrations.e2e-spec.ts` — updated API fixtures and strict batch request/result cases for meal choices and seven-day windows.

Task 1's contract tests already cover the strict v1 schemas; no contract source changes were needed in this task.

## RED/GREEN evidence

- RED utility: `corepack yarn workspace @imeal/api exec vitest run src/common/vietnamese-lunar.spec.ts` — failed because `./vietnamese-lunar.js` did not exist (`0` tests).
- GREEN utility: same command after implementation — `1` file passed, `15/15` tests.
- RED registration service: `corepack yarn workspace @imeal/api exec vitest run src/registrations/registrations.service.spec.ts` — `15` expected behavior failures against the old service (including missing result codes, missing lunar metadata, old upsert semantics, and non-typed invalid-date handling).
- GREEN focused API (after final namespace typing fix): `corepack yarn workspace @imeal/api exec vitest run src/common/vietnamese-lunar.spec.ts src/registrations/registrations.service.spec.ts` — `2` files passed, `32/32` tests.
- Contracts focused: `corepack yarn workspace @imeal/contracts exec vitest run test/contracts.test.ts` — `1` file passed, `19/19` tests.
- Narrow API typecheck: `corepack yarn workspace @imeal/api exec tsc --noEmit --pretty false -p tsconfig.json` — completed with no errors.
- Registration e2e command attempted: `corepack yarn workspace @imeal/api exec vitest run --config ./vitest.config.e2e.ts test/registrations.e2e-spec.ts`; setup stopped before collection because `DATABASE_URL` was not configured.

## Decisions

- Lunar conversion uses `parseMealDate` and passes UTC date parts directly to `getLunarDate`; lunar day `1` or `15` enables both `REGULAR` and `VEGETARIAN`, including leap months.
- Week generation validates all seven dates before database reads, so a valid-format week that crosses the supported range returns HTTP 400 with `{ code: 'INVALID_MEAL_DATE' }` instead of a 500.
- The registration window top-level `cutoffAt` is the first day's cutoff; every day also carries its own cutoff, editability, lunar date, and available choices.
- Batch processing captures one server time, runs one transaction per valid item, and checks cutoff before finalized state, availability, and mutation. Existing active rows with the same choice are true no-ops; choice changes/reactivation increment version; cancellation emits the existing delegation outbox event only for active-to-cancelled transitions.
- Week menu and registration Prisma dates are converted to date keys/UTC strings before `WeekRegistrationResponseSchema.parse`; no Prisma `Date` values reach the wire.

## Concerns

- Full registration e2e execution requires the repository's PostgreSQL test environment (`DATABASE_URL`); it could not run in this workspace. E2e reruns stopped before collection with `DATABASE_URL is not set in environment or .env.test`.
- Prisma client regeneration was blocked by a Windows `EPERM` rename while an existing API watch process held the query engine. The narrow API typecheck completed with no errors, and focused tests use the updated contracts build.

## Review follow-up

- Added a focused race regression: if a concurrent create wins between the initial read and create, the `P2002` transaction is retried in a fresh transaction and the now-existing same-choice ACTIVE row is treated as an idempotent no-op.
- Updated the e2e success fixture to use lunar-eligible `2026-09-25` for `VEGETARIAN`, and added an HTTP route assertion for the typed `MEAL_CHOICE_UNAVAILABLE` partial result on ordinary `2026-09-24`.
- Review-fix GREEN: `corepack yarn workspace @imeal/api exec vitest run src/registrations/registrations.service.spec.ts` — `1` file passed, `18/18` tests.
- Review-fix typecheck: `corepack yarn workspace @imeal/api exec tsc --noEmit --pretty false -p tsconfig.json` — completed with no errors.
