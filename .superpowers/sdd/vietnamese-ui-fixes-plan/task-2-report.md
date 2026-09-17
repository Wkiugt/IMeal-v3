# Task 2: Kitchen Dashboard status and row fixes

## Files changed

- `apps/mobile/src/screens/kitchen/KitchenDashboardScreen.tsx`
  - Changed the unserved registration row status from `t('kitchen.pending')` to `t('common.pending')`.
  - Kept the check-in legend interpolation unchanged as `t('kitchen.pending', { count: counters.remaining })`.
  - Changed `listCopy` to `{ flex: 1, minWidth: 0, gap: 3 }`.
- No shared primitive, translation/catalog, API/domain, or unrelated source files were changed.

## Behavior

Pending registration rows now use the plain `Đang chờ` translation and no longer invoke the count-required `kitchen.pending` key without interpolation. The check-in legend still renders its remaining count through the existing interpolation contract. The list text column can shrink safely while retaining the existing horizontal row, 36x36 avatar, and shared `Pill`; no truncation or ellipsis behavior was added. Existing Logs status calls remain unchanged.

## Checks

- `corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json`
  - Exit 0; no output.
- `corepack yarn workspace @imeal/mobile test`
  - Exit 0; 15 test files passed, 38 tests passed.
- Source inspection confirmed:
  - counted legend remains `t('kitchen.pending', { count: counters.remaining })`;
  - unserved row uses `t('common.pending')`;
  - no uncounted `t('kitchen.pending')` call remains.

## Concerns

No implementation concerns. Runtime viewport/screenshot verification was not run in this narrow task check; the source change is limited to the audited row translation and shrink-safe local style.

## Commits

- `2e57343` — `fix mobile kitchen pending row layout`
