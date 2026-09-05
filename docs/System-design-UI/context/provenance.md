# Provenance

Every token, component rule, and copy convention in `DESIGN.md` was read directly out of the seven copied prototype files below — nothing in this design system was invented or guessed. This file maps each generated artifact back to the exact source evidence it was extracted from.

## Source → artifact map

| Generated artifact                                         | Extracted from                                                                                                                                                                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `colors_and_type.css` tokens (`:root` block)               | Identical `:root` block present in all 7 source files; status colors merged from `kitchen-staff-app.html` (good/bad) and `admin-*.html` (good/warn/bad)                                                               |
| `DESIGN.md` §2 Color                                       | Same `:root` blocks, cross-checked against rendered screenshots `preview-dashboard.png`, `admin-dashboard-check.png`                                                                                                  |
| `DESIGN.md` §3 Typography                                  | `--font-body`/`--font-display`/`--font-mono` declarations + every `h1/h2/h3`, `.eyebrow`, `.stat-num`, `.metric-value` rule across source files                                                                       |
| `DESIGN.md` §4 Spacing / radius                            | `--radius-sm/--radius/--radius-lg/--radius-pill` custom properties + literal padding/gap values throughout source CSS                                                                                                 |
| `DESIGN.md` §5 Layout                                      | `.device`/`.statusbar`/`.bottom-nav` rules (`employee-meal-app.html`, `kitchen-staff-app.html`); `.admin-shell`/`.sidebar`/`.admin-topbar`/`.admin-main` rules (all 5 `admin-*.html` files, byte-identical shell CSS) |
| `DESIGN.md` §6 Components                                  | `.card`, `.pill*`, `.btn*`, `.avatar`, `.toggle`, `.field*`, `.data-table`, `.metric-card`, `.chart-*`, `.bar-*`, `.activity-row`, `.user-row`, `.penalty-card` rules, one component per source page                  |
| `DESIGN.md` §7 Motion                                      | `transition`/`animation`/`@keyframes scan-sweep`/`:active`/`:focus-visible`/`@media (prefers-reduced-motion: reduce)` rules, all source files                                                                         |
| `DESIGN.md` §8 Voice                                       | Literal copy strings in source HTML body content (greetings, eyebrows, activity feed, empty-state copy)                                                                                                               |
| `ui_kits/app/index.html` + `ui_kits/app/components/*.html` | Modular component files with markup copied from the source screens, fetched and mounted live by `index.html` into a composed layout, plus direct links to the preserved source screens                                |
| `preview/applied-surfaces.html`                            | `preview-login.png`, `preview-dashboard.png`, `preview-booking.png`, `preview-profile.png`, `admin-dashboard-check.png`, `preview-polish-check.png` (real rendered screenshots of the source prototypes)              |
| `assets/icons/*.svg`                                       | Inline `<svg>` markup copied verbatim out of source HTML (brand mark, nav icons, status icons)                                                                                                                        |

## Preserved source files (unmodified, kept at project root)

These are the original copied prototype screens — the primary evidence. They are left in place rather than duplicated so they remain the single source of truth:

- `employee-meal-app.html` — employee mobile app: login, dashboard, calendar/booking, ticket, profile (5 screens, JS tab-switched)
- `kitchen-staff-app.html` — kitchen staff mobile app: dashboard, QR scanner (2 screens)
- `admin-dashboard.html` — admin overview: metrics, attendance chart, activity feed
- `admin-metrics.html` — admin analytics: department/dietary breakdowns, data table
- `admin-users.html` — admin user management: searchable/filterable user list, empty state
- `admin-menu.html` — admin weekly menu editor: per-day dish fields, publish flow
- `admin-penalties.html` — admin billing: outstanding penalties, pay/waive actions

## Screenshots (real renders, preserved in `assets/screenshots/`)

- `preview-login.png`, `preview-dashboard.png`, `preview-booking.png`, `preview-profile.png` — employee app screens
- `admin-dashboard-check.png` — admin dashboard, full desktop render
- `preview-polish-check.png` — polish/QA pass render

## Gaps in source evidence (documented, not invented)

- **No custom webfont files** — the product intentionally uses the OS system-font stack (`-apple-system`/`Segoe UI`/`system-ui`). `fonts/` is therefore intentionally omitted rather than populated with an unrelated typeface.
- **No standalone logo/wordmark asset** — the only brand mark is the inline SVG "fork + steam" glyph used at 18–32px inside a circular badge (`.brand-mark`, `.login-mark`). Extracted to `assets/icons/brand-mark.svg`; no separate wordmark file exists in source.
- **No dark-mode tokens** — every source file defines only a light theme; this design system documents light mode only and does not invent dark-mode values.
