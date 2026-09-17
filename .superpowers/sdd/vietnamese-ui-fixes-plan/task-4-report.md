# Task 4 report: Admin menu multiline layout and responsive CSS

## Status

Implemented and committed the Admin Web multiline Weekly Menu description and shrink-safe responsive row layout.

## Files changed

- `apps/admin-web/src/main.ts`
  - Replaced the Weekly Menu description `<input>` with a `textarea.meal-description`.
  - Set `rows = 3`, preserved `contentInput.value = day.content || ''`, retained the `Mô tả món ăn` placeholder, and added the required date-specific `aria-label`.
  - Kept the update payload exactly `{ content: contentInput.value }`, without trimming or transforming the value.
  - Changed only the menu action container to `row-actions menu-actions`; penalty action containers remain `row-actions`.
- `apps/admin-web/src/styles.css`
  - Included `textarea` in the inherited-font selector.
  - Made shared `.row` styles top-aligned and shrink-safe with `min-width: 0` and `align-items: flex-start`.
  - Made `.row-main` shrink and wrap long content with `flex: 1 1 180px`, `min-width: 0`, and `overflow-wrap: anywhere`.
  - Preserved wrapping `.row-actions` behavior and added `min-width: 0`.
  - Added the menu-only three-column grid, full-span multiline description styling, and full-width wrapping menu buttons.
  - At `max-width: 720px`, retained column layout and set `.row-main, .row-actions` to `width: 100%`; the menu grid remains three equal columns and the textarea spans all columns.
  - No horizontal-overflow hiding workaround was added.

## Layout rationale

Menu descriptions now have native multiline editing space and can wrap long Vietnamese content without clipping. The menu action group owns its three-column grid, so the textarea spans the full row while `Lưu món`, state toggle, and holiday toggle remain distinct, full-width grid actions. Shared row changes allow long penalty names/reasons/dates to shrink and wrap without changing penalty mappings or action containers. The mobile media rule gives both row columns the available width while preserving the audited three-column menu grid.

## Protocol preservation

The PUT request remains unchanged: `{ content: contentInput.value }`. No API/domain schema, enum value, penalty display mapping, penalty action, user/server data, permission code, path, header, or session key was changed.

## Verification

Command:

```sh
corepack yarn workspace @imeal/admin-web build
```

Output:

```text
vite v8.2.2 building client environment for production...
transforming...
✓ 15 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                  0.50 kB │ gzip:  0.32 kB
dist/assets/index-IWy2VTJh.css   2.78 kB │ gzip:  1.16 kB
dist/assets/index-DV891wJB.js   64.93 kB │ gzip: 16.28 kB

✓ built in 82ms
```

## Concerns

- Runtime fixture, screenshot, breakpoint, and geometry checks are intentionally deferred to the plan's integration/runtime-proof task; this scoped task ran the required Admin production build only.
- Existing internal invariant diagnostics and server-provided error messages remain governed by Task 3 and were not altered.

## Commit

Implementation commit: `d358793` (`fix(admin): make weekly menu descriptions multiline`)
