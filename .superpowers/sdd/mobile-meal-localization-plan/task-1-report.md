# Task 1 Implementation Report — Contracts and Persistence

## Status

Implemented the meal-choice transport contracts and Prisma persistence foundation for the mobile meal localization plan.

## Files changed

- `packages/contracts/src/v1/registrations.ts`
  - Added `MealChoiceSchema` and `MealChoice` (`REGULAR | VEGETARIAN`).
  - Replaced the batch item with a strict `status` discriminated union: ACTIVE requires `mealChoice`; CANCELLED rejects an extra choice.
  - Added the exact registration failure-code enum and strict success/failure result union while preserving ordered batch responses.
  - Added strict registration-record, lunar-date, registration-window, weekly-menu, daily-menu, and direct week-response schemas/types.
  - Enforced canonical `YYYY-MM-DD` dates and UTC ISO-8601 timestamps ending in `Z` at the wire boundary.
- `packages/contracts/test/contracts.test.ts`
  - Added focused coverage for meal-choice/status branches, strict failure/result fields, ordered partial results, seven-day week responses, UTC timestamp requirements, and strict response objects.
- `packages/domain/prisma/schema.prisma`
  - Added Prisma enum `MealChoice { REGULAR VEGETARIAN }`.
  - Added `Registration.mealChoice` with `@default(REGULAR)` and `@map("meal_choice")`.
  - Preserved `MealDay.mealType` and the `(userId, mealDate)` unique key.
- `packages/domain/prisma/migrations/20260915000000_add_registration_meal_choice/migration.sql`
  - Creates the PostgreSQL `MealChoice` enum.
  - Adds a non-null `meal_choice` column with database default `REGULAR`, backfilling existing registrations.
- `docs/README.md`
- `docs/01-product-requirements.md`
- `docs/03-product-flows.md`
- `docs/04-ui-ux-design.md`
- `docs/05-backend-structure.md`
  - Updated the business descriptions to state that normal service dates allow only `REGULAR`, while lunar day 1 or 15, including leap months, allow `REGULAR` or `VEGETARIAN`; registration remains unique per user/date and stores the choice.
- `.superpowers/sdd/mobile-meal-localization-plan/task-1-report.md`
  - This report.

## Design decisions

- Transport schemas use strict objects throughout the new contracts so unknown fields cannot silently cross the v1 boundary.
- ACTIVE and CANCELLED mutation payloads intentionally have different shapes; there is no compatibility default for a missing ACTIVE `mealChoice`.
- Success and failure results discriminate on literal `success`, with failure `code` and `reason` required only on the failure branch.
- Week responses expose date-only fields as canonical date strings and timestamp fields as UTC `Z` strings; Prisma `Date` values are not part of the wire type.
- The weekly menu schema mirrors the current Prisma `WeeklyMenu` and `DailyMenu` scalar fields and the `dailyMenus` relation.
- `mealChoice` is preparation category data, not a menu variant, and does not alter serving-window `MealDay.mealType` semantics or registration uniqueness.

## Verification

RED proof before production contract changes:

```text
corepack yarn workspace @imeal/contracts exec vitest run test/contracts.test.ts
5 failed, 14 passed (19 tests)
```

Focused GREEN test:

```text
corepack yarn workspace @imeal/contracts exec vitest run test/contracts.test.ts
1 passed (1 file), 19 passed (19 tests)
```

Additional scoped checks:

```text
corepack yarn workspace @imeal/contracts exec tsc --noEmit -p tsconfig.json
(no output; passed)

corepack yarn workspace @imeal/core exec prisma validate --schema prisma/schema.prisma
The schema at prisma\\schema.prisma is valid
```

No formatter, linter, or project-wide test suite was run.

## Concerns

The migration SQL was not applied to a live PostgreSQL instance in this focused contract/persistence slice; Prisma schema validation passed and the migration is a straightforward enum-plus-non-null-default alteration. The later database verification step should apply it and confirm existing rows are backfilled to `REGULAR`.
