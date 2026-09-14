# Task 5 implementation report

## Scope

Updated `docs/04-ui-ux-design.md` only. No application source, tests, or unrelated product rules were changed.

## Documented rules

- Added `3.5 Loading and transitions` immediately after the existing touch/geometry guidance. It now specifies that initial asynchronous data or permission loads use `BrandLoader` for at least 2,000 ms before successful content is revealed, while known initial errors and recovery states bypass that minimum immediately. It also states that revalidation and mutation flows receive no artificial loading delay and that static/session-only screens are not gated.
- Added the global bottom-navigation geometry rule beside the existing Global navigation guidance. The outer backing must use the screen background, and the floating pill must remain at least `theme.spacing.navInset` (16px) from the available physical edge, using the OS bottom inset when that inset is larger.
- Added the weekly registration pending-feedback rule under `7.3 Feedback`. Only the day currently being saved receives pending opacity and toggle animation. Other days may be interaction-disabled while requests serialize, but they must not receive the visual saving state.

## Self-review and verification

- Re-read the edited sections after insertion to confirm all required clauses are present and the surrounding headings/spacing remain coherent.
- Reviewed the documentation diff: 10 insertions and no deletions, limited to `docs/04-ui-ux-design.md`.
- No formatter, linter, or project-wide test suite was run because this is a documentation-only change; there is no executable behavior to smoke-test in this slice.
