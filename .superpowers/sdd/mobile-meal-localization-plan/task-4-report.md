# Task 4 — Calendar grid geometry report

## Status

Complete. The calendar now uses a Monday-first, padded seven-cell grid with fixed 36 × 36 day markers, and only `EmployeeCalendarScreen` overrides `PrototypeFrame` bottom clearance to `0`.

## Focused test evidence

### RED (before implementation)

Command:

```text
corepack yarn workspace @imeal/mobile exec vitest run src/screens/employee/calendarGrid.test.ts
```

Result: failed during module loading because `./calendarGrid` did not exist (`Cannot find module './calendarGrid'`); 0 tests ran.

### GREEN (after implementation)

Command:

```text
corepack yarn workspace @imeal/mobile exec vitest run src/screens/employee/calendarGrid.test.ts
```

Result: 1 test file passed, 2 tests passed. September 2026 mapping is asserted as Monday-first (`[null, 1, 2, 3, 4, 5, 6]` through `[28, 29, 30, null, null, null, null]`), and every generated row is asserted to contain exactly seven cells.

## Files changed

- `apps/mobile/src/screens/employee/calendarGrid.ts` — added pure `buildMonthRows(month)` helper.
- `apps/mobile/src/screens/employee/calendarGrid.test.ts` — added focused RED/GREEN helper coverage.
- `apps/mobile/src/screens/employee/EmployeeCalendarScreen.tsx` — replaced percentage/wrapped calendar cells with seven flex tracks, fixed markers, centered day numbers, absolute booked dots, and `bottomClearance={0}`.

## Concerns

No project-wide validation or native/web visual smoke test was run, per Task 4 scope. Weekly registration state and copy remain unchanged intentionally; meal-choice selector work belongs to Task 5. The unrelated `flexWrap` in the weekly registration label row is retained and is not part of the calendar grid.
