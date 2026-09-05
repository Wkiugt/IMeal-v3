# Meal Admin Design System

> Category: Project Design System
> Surface: web (mobile-frame prototype + responsive admin console)

Extracted from the OpenDesign source project **"Web Prototype"** (`d2b6b396-5427-4aab-928d-b5fbcd60ea02`), a corporate canteen / meal-booking product with three real surfaces: an employee mobile app, a kitchen-staff mobile app, and a five-page admin console. All tokens, components, and copy below are read directly from the seven shipped HTML prototypes — nothing is invented.

## 0. Source Context

**Product:** an internal corporate canteen / meal-booking system. Employees register lunch and check in by QR; kitchen staff scan tickets and track prep counts; admins manage users, weekly menus, penalties, and program metrics.

**Source evidence (7 files, 53KB–39KB each, all inspected in full):**

| File                     | Surface                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `employee-meal-app.html` | Employee mobile app — login, dashboard, calendar/booking, ticket, profile |
| `kitchen-staff-app.html` | Kitchen staff mobile app — prep dashboard, QR scanner                     |
| `admin-dashboard.html`   | Admin — overview metrics, attendance chart, activity feed                 |
| `admin-metrics.html`     | Admin — department/dietary analytics, data table                          |
| `admin-users.html`       | Admin — user management list, search, empty state                         |
| `admin-menu.html`        | Admin — weekly menu editor, publish flow                                  |
| `admin-penalties.html`   | Admin — outstanding penalties, pay/waive actions                          |

Cross-checked against 6 real rendered screenshots (`assets/screenshots/`): `preview-login.png`, `preview-dashboard.png`, `preview-booking.png`, `preview-profile.png`, `admin-dashboard-check.png`, `preview-polish-check.png`. Full evidence mapping: `context/provenance.md`.

## 1. Visual Theme & Atmosphere

_Source: product copy and screen content across all 7 files; visual mood cross-checked against `assets/screenshots/preview-dashboard.png` and `admin-dashboard-check.png`._

A corporate internal tool for company canteens: employees register lunch, kitchen staff check people in by QR, and admins run the program (users, weekly menus, penalties, metrics). The visual language is calm, functional, and trustworthy — a single confident blue accent on a near-white ground, generous corner radii, soft shadows, and no decoration that doesn't carry information. It reads as "well-run internal software," not a consumer app: legible data, honest states (draft/published, checked-in/pending, paid/outstanding), and zero marketing flourish.

Two device contexts share one token system: a 390×844 phone frame for the employee and kitchen-staff apps, and a 248px-sidebar responsive console for admins. Names and content (Minh Anh, Pham Quang, Ngoc Phuong, Canteen A) are Vietnamese, suggesting a Vietnam-based company deployment; all UI copy is English.

## 2. Color

_Source: identical `:root` custom-property block present in all 7 source files; status-color pairs merged from `kitchen-staff-app.html` (good/bad) and `admin-*.html` (good/warn/bad)._

All colors are defined in `oklch()` and layered from six base roles plus status pairs. Never hardcode hex — reference these custom properties (see `colors_and_type.css`).

| Token           | Value                                            | Role                                                                                          |
| --------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `--bg`          | `oklch(100% 0 0)`                                | Page background (apps blend it with 3–4% `--fg` via `color-mix` for a faint off-white canvas) |
| `--surface`     | `oklch(100% 0 0)`                                | Card / panel background                                                                       |
| `--fg`          | `oklch(27% 0.025 255)`                           | Primary text                                                                                  |
| `--muted`       | `oklch(44% 0.022 255)`                           | Secondary text, captions, placeholders                                                        |
| `--border`      | `oklch(92% 0.014 240)`                           | Hairlines, dividers, input borders                                                            |
| `--accent`      | `oklch(80% 0.085 250)`                           | Raw accent hue reference (rarely used directly)                                               |
| `--accent-deep` | `oklch(42% 0.135 250)`                           | Primary actions, active nav, links, icon accents, chart lines                                 |
| `--accent-soft` | `oklch(93% 0.035 250)`                           | Active/selected backgrounds, pill fills                                                       |
| `--accent-tint` | `oklch(97% 0.016 250)`                           | Faint accent wash — progress tracks, input backgrounds, gradients                             |
| `--fg-soft`     | `color-mix(in oklch, var(--fg) 5%, transparent)` | Neutral hover background                                                                      |

**Status pairs** (tint = fill, deep = text/icon on that fill — always used together, never mixed across pairs):

| Status         | Tint                  | Deep                  |
| -------------- | --------------------- | --------------------- |
| Good / success | `oklch(94% 0.05 155)` | `oklch(38% 0.11 155)` |
| Warn / draft   | `oklch(95% 0.05 85)`  | `oklch(42% 0.13 85)`  |
| Bad / overdue  | `oklch(94% 0.045 25)` | `oklch(40% 0.15 25)`  |

**Elevation** (shadows are tinted with `--fg`, not black, to stay warm-neutral):
`--shadow-sm: 0 1px 2px color-mix(in oklch, var(--fg) 7%, transparent)`
`--shadow-md: 0 10px 28px color-mix(in oklch, var(--fg) 10%, transparent)`
`--shadow-lg: 0 20px 48px color-mix(in oklch, var(--fg) 14%, transparent)`

**Rule:** one accent (`--accent-deep`), applied to exactly one primary action per view plus active-state indicators (nav, calendar "today," toggles-on). Everything else is neutral. Gradients are restricted to `metric-card` tiles (`--accent-tint` → `--accent-soft`, 150° diagonal) — never applied to full-page backgrounds.

## 3. Typography

_Source: `--font-body`/`--font-display`/`--font-mono` declarations plus every `h1/h2/h3`, `.eyebrow`, `.stat-num`, `.metric-value`, `.kitchen-total-num` rule across all 7 source files._

No webfonts are loaded — the system deliberately uses native OS type for performance and platform-native feel:

- **Display** (`--font-display`): `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif` — all `h1/h2/h3`, metric numbers, screen titles.
- **Body** (`--font-body`): `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif` — paragraphs, labels, buttons.
- **Mono** (`--font-mono`): `ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace` — eyebrows, IDs, timestamps, chart axis labels, data-table numeric columns, stat numbers.

Scale observed in source (see `.od-*` classes in `colors_and_type.css`):

| Class            | Size / weight                                            | Used for                                     |
| ---------------- | -------------------------------------------------------- | -------------------------------------------- |
| `.od-display-xl` | 52px / 700                                               | Kitchen "total meals" hero number            |
| `.od-display-lg` | 34px / 700                                               | Admin metric-card values                     |
| `.od-title-lg`   | 24px / 700                                               | Greeting names, profile identity             |
| `.od-title`      | 20px / 700                                               | Screen / section titles                      |
| `.od-title-sm`   | 17px / 700                                               | Card headings                                |
| `.od-body`       | 14px / 400                                               | Default body                                 |
| `.od-body-sm`    | 13px / 400, `--muted`                                    | Subtext under titles                         |
| `.eyebrow`       | 12px / 600 mono, `0.07em` tracking, uppercase, `--muted` | Section labels ("TOTAL MEALS ORDERED TODAY") |
| `.od-caption`    | 12px / 400, `--muted`                                    | Fine print, meta                             |

Headings use `letter-spacing: -0.01em` to `-0.02em` (tighter at larger sizes) and `text-wrap: balance`; body copy uses `text-wrap: pretty`. Line height is `1.5` globally.

## 4. Spacing

_Source: `--radius-sm/--radius/--radius-lg/--radius-pill` custom properties plus every literal padding/gap value in source CSS (no named spacing token exists in source; the scale below is observed, not declared)._

No numeric spacing scale variable exists in source — spacing is applied as literal px values that cluster around an approximate 4px rhythm: **2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32px**, with page-level gutters at **32px** (desktop admin), **20px** (tablet), **14–16px** (mobile). Card interior padding is consistently **24px** (18–22px for denser metric/penalty cards). Vertical rhythm between stacked cards is **16–18px**.

**Radius** (four steps, used consistently — never an arbitrary value):

| Token           | Value | Used for                                                                           |
| --------------- | ----- | ---------------------------------------------------------------------------------- |
| `--radius-sm`   | 14px  | Inputs, small note/tag boxes                                                       |
| `--radius`      | 20px  | Nav items, icon wraps, calendar nav buttons                                        |
| `--radius-lg`   | 28px  | Cards, buttons' containers, device frame corners (52px literal on the phone shell) |
| `--radius-pill` | 999px | Buttons, pills, avatars, toggles, bottom-nav, progress tracks                      |

## 5. Layout & Composition

_Source: `.device`/`.statusbar`/`.screen`/`.bottom-nav` rules (`employee-meal-app.html`, `kitchen-staff-app.html`); `.admin-shell`/`.sidebar`/`.admin-topbar`/`.admin-main` rules, byte-identical across all 5 `admin-*.html` files._

Two distinct shells, one token system:

**Mobile app shell** (`employee-meal-app.html`, `kitchen-staff-app.html`): a centered 390×844 device frame (`--device-w`/`--device-h`) with rounded 52px corners and a fake status bar, simulating iOS. Screens are absolutely-positioned panels swapped via a `.screen.active` class (JS tab switching, no real routing). A floating pill-shaped bottom nav (`position: absolute; inset from edges: 16px`) sits above content with `backdrop-filter: blur(10px)`. Below 480px viewport width the frame goes full-bleed (`100vw`/`100dvh`, radius removed) for real-device use.

**Admin console shell** (`admin-*.html`, all five pages share identical shell CSS): fixed-width sticky sidebar (`--sidebar-w: 248px`) + fluid main column, `max-width: 1280px` (1120px on the menu page) centered. Topbar is `position: sticky` with `backdrop-filter: blur(10px)` translucent background. Below 900px the sidebar becomes an off-canvas drawer (`transform: translateX(-100%)` → `.open`) with a scrim backdrop and a hamburger trigger; below 560px page padding and title size step down again. Content itself is single-column stacked cards, occasionally split into a responsive `two-col` grid (`1.3fr 1fr` or `1fr 1fr`, collapsing to one column under 860px).

Both shells share the same primitives (`.card`, `.pill`, `.btn`, `.avatar`) so an admin building a new admin page or a new mobile screen should reuse them rather than inventing new containers.

## 6. Components

_Source: `.card`, `.pill*`, `.btn*`, `.avatar`, `.toggle`, `.field*`, `.data-table`, `.metric-card`, `.chart-*`, `.bar-*`, `.activity-row`, `.user-row`, `.penalty-card` rules — one component family per source page, cataloged in `context/provenance.md`._

**Cards** — `.card`: white surface, 1px `--border`, `--radius-lg`, `--shadow-sm`, 24px padding. The single building block for every content grouping.

**Pills / status chips** — `.pill` base + variant: `pill-soft` (accent, default "informational" chip), `pill-outline` (neutral, e.g. "Not registered"), `pill-solid` (accent-deep fill, rare), `pill-good`/`pill-warn`/`pill-bad` (status pairs — "Confirmed check-in," "Draft," "Overdue").

**Buttons** — `.btn-primary` (accent-deep fill, one per view), `.btn-secondary` (outlined neutral), `.btn-ghost` (text-only, low emphasis), `.btn-icon` (36px circular icon button, `.danger` modifier flips to bad-status colors on hover). All buttons are pill-radius.

**Avatar** — 40px (46px in mobile app, 64px `.avatar-lg` on profile) circular initials badge, accent-soft fill / accent-deep text. Always two-letter initials, never photos.

**Toggle switch** — 50×30px pill track, `role="switch"` + `aria-checked`, thumb slides 20px on activation, track fills `--accent-deep` when on. Used for weekly meal registration and preference switches.

**Metric card** — gradient tile (`--accent-tint` → `--accent-soft`, 150°), icon-wrap circle, `.metric-label` (13px muted), `.metric-value` (display, 30–34px), optional `.metric-delta` (good/flat color-coded trend line with arrow icon).

**Chart card** — inline SVG line chart (grid lines in `--border`, stroke `--accent-deep` 2.5px, 8% opacity area fill, mono axis labels) or horizontal bar list (`.bar-row` / `.bar-track` / `.bar-fill`, fill width set inline per value, color intensity stepped via `color-mix` for rank).

**Data table** — `.data-table`: mono uppercase 11px headers, 1px border-bottom rows, numeric columns right-aligned in mono. Wrapped in a horizontally-scrollable `.table-wrap` on narrow viewports.

**List row patterns** — `.activity-row` (icon + title/sub + timestamp), `.user-row` (identity/dept/role/actions grid, collapses to a 2-column stacked layout under 720px via `grid-template-areas`), `.penalty-card` (identity + amount + status pill + pay/waive actions, stacks vertically under 640px).

**Form field** — `.field` label (11.5px uppercase bold mono-adjacent) + `.field-input` (accent-tint fill, border on rest, accent-deep border + 3px accent-soft ring on focus, surface fill on focus).

**QR / ticket motifs** — perforated ticket card with dashed divider and cut-out circles (meal ticket), camera viewfinder with animated scanline and corner brackets (kitchen scanner) — distinctive to this product's check-in flow; reuse only for genuinely similar QR/scan features.

**Sidebar nav** — icon + label row, `--radius`, active state = accent-soft background + accent-deep text/icon; identical pattern reused for the mobile bottom-nav (icon stacked over label, same active treatment).

## 7. Motion & Interaction

_Source: `transition`/`animation`/`@keyframes scan-sweep`/`:active`/`:focus-visible`/`@media (prefers-reduced-motion: reduce)` rules and the scan-simulation `<script>` block in `kitchen-staff-app.html`._

- Buttons/rows: `:active { transform: scale(0.98) }` (or `0.94` for compact nav items) for tactile press feedback; hover states shift background only (`--fg-soft` or `--accent-soft`), never darken text.
- Standard transition timing: `0.15s ease` for color/background/border, `0.08s ease` for press transforms, `0.18s–0.22s ease` for toggles and the sidebar drawer slide.
- Progress fills animate via `transform: scaleX(var(--progress))` with `cubic-bezier(0.2, 0, 0, 1)` easing (~0.45s) — never animate `width` directly.
- The kitchen scanner viewfinder has a looping 2.4s scanline sweep (`ease-in-out infinite`); the "last scanned" card plays a one-shot 220ms translateY+fade via the Web Animations API on each scan.
- `:focus-visible` is a 2px `--accent-deep` outline with 2px offset and 6px corner radius, applied globally — never removed.
- `prefers-reduced-motion: reduce` is respected everywhere: all transition/animation durations collapse to `0.001ms`, and the JS-driven scan animation swaps to a plain opacity fade with 1ms duration.

## 8. Voice & Brand

_Source: literal copy strings in source HTML body content — greetings, eyebrows, activity feed entries, empty-state copy, publish-bar messaging._

- **Product name in-shell:** "Meal Admin" (admin console brand mark); the employee app is untitled chrome-side, referred to in page `<title>` as "Meal · Employee meal registration."
- **Copy tone:** short, operational, present-tense. Section labels are terse eyebrows in ALL CAPS mono ("TOTAL MEALS ORDERED TODAY," "DIETARY PREFERENCES"). Body copy is plain and specific ("Toggle a day on to register lunch," "Employees will see it immediately in the meal app once published").
- **Numbers over adjectives:** the product prefers a concrete number + short label ("184 meals," "126 / 184," "+12 this month") to descriptive praise.
- **Names/roles:** realistic Vietnamese full names paired with a department ("Pham Quang · Admin," "Tran My · Design") — always name + role/department together, never a bare name.
- **Dates/times:** written as "Tue, Aug 25 2026," "Aug 24–28, 2026," "2h ago" — human-readable dates, relative timestamps for activity feeds, 24h ranges for meal windows ("12:00–13:00").
- **Empty/draft states are named plainly**, not hidden: "Not yet planned — add dishes for each weekday," a `pill-warn` "Draft" badge before publish.

## 9. Anti-patterns

_Source: inferred from consistent constraints observed across all 7 files (single accent hue, restricted gradient usage, consistent radius/shadow scale, no webfonts, no emoji) — a pattern present with zero exceptions across the full source set counts as a rule._

- Do not introduce a second accent hue or a purple/pink gradient — one blue accent, used sparingly, is the entire brand color story.
- Do not apply the metric-card gradient wash to full sections or backgrounds; it is a small-tile treatment only.
- Do not swap the system font stack for a webfont (Inter, Roboto, etc.) — the native-OS feel is intentional.
- Do not use emoji as icons; all icons are 1.6–1.8px stroke-weight line SVGs with rounded joins, no fills except tiny accent dots.
- Do not soften hover text to gray/lighter — hover changes background only, text/icon color stays same or gets stronger (`--fg`).
- Do not stack multiple solid `.btn-primary` buttons in one view; one primary action per screen, everything else secondary/ghost.
- Do not invent new corner-radius values outside the four-step scale, or new shadow values outside the three-step elevation scale.
- Do not fabricate metrics, names, or activity — if new data is needed, label it honestly as a placeholder rather than inventing a precise-looking fake number.
- Do not remove `:focus-visible` rings or the `prefers-reduced-motion` guard when reusing these patterns.
