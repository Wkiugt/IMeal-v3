---
name: meal-admin-design-system
description: Design system for the Meal Admin corporate canteen product — employee meal registration, kitchen staff QR check-in, and the admin console (users, weekly menu, penalties, metrics). Use when creating or extending any screen for this product so color, type, spacing, components, motion, and voice stay consistent with the source prototypes.
user-invocable: true
---

# SKILL: Generating with the Meal Admin design system

## What is inside

- `DESIGN.md` — the authoritative spec: product context, color, typography, spacing, layout, components, motion, voice, anti-patterns (10 sections, each citing its source evidence).
- `colors_and_type.css` — every color/type/spacing/radius/shadow token plus shared component CSS (`.card`, `.pill`, `.btn`, `.avatar`, `.toggle`, `.field-input`, `.data-table`, bar/progress meters).
- `preview/` — 7 focused review cards (colors, typography, spacing, radius/shadows, components, brand assets, applied UI surfaces).
- `assets/icons/` + `build/icon-sprite.svg` — 9 line-SVG icons extracted verbatim from source, plus a compiled runtime sprite.
- `assets/screenshots/` — 6 real rendered PNGs of the source prototypes.
- `ui_kits/app/` — an applied interface kit: `index.html` fetches and mounts every modular file in `components/` into one composed layout, plus links out to the real preserved source screens.
- The 7 preserved source prototypes at the project root (`employee-meal-app.html`, `kitchen-staff-app.html`, `admin-*.html` ×5) — the primary evidence, kept in place and unmodified.
- `context/provenance.md` — exact source-file → generated-artifact evidence map.

## Source context

Extracted from the OpenDesign source project **"Web Prototype"** (`d2b6b396-5427-4aab-928d-b5fbcd60ea02`): a corporate canteen / meal-booking system with three real surfaces — an employee mobile app (register lunch, check in by QR), a kitchen-staff mobile app (scan tickets, track prep counts), and a five-page admin console (users, weekly menu, penalties, metrics). Every token and component rule below is read directly out of the seven shipped HTML prototypes; see `context/provenance.md` for the line-by-line mapping.

## When to use

Use this design system whenever you are creating or extending a screen for the Meal Admin product — a new employee-app screen, a new kitchen-staff flow, or a new admin console page. Also use it as the reference when auditing an existing Meal Admin screen for consistency drift (wrong radius, off-palette color, a second primary button, etc).

## How to use

1. Read `DESIGN.md` in full before writing any layout CSS — it is the authoritative spec.
2. Paste the entire contents of `colors_and_type.css` into the first `<style>` block of the new artifact (or `<link>` it if the artifact supports external stylesheets). Do not redeclare any `--token` with a different value.
3. Check `ui_kits/app/index.html` and `ui_kits/app/components/` for a directly reusable pattern before building a new one — most screens are compositions of `.card`, `.pill`, `.btn`, `.avatar`, `.toggle`, `.field-input`, and `.data-table`.
4. Pick the right shell:
   - **New mobile-app screen** (employee or kitchen staff persona): use the `.device` / `.statusbar` / `.screen` / `.bottom-nav` pattern from `employee-meal-app.html` or `kitchen-staff-app.html`. Screens are absolutely-positioned panels toggled via a `.screen.active` class and a matching `.nav-item.active` — no real router.
   - **New admin page**: copy the shared shell markup (`.admin-shell`, `.sidebar`, `.sidebar-nav`, `.admin-topbar`, `.admin-main`) byte-for-byte from any existing `admin-*.html` file, add the new nav item to `.sidebar-nav` in every admin page for consistency, and build the page content inside `.admin-main` using `.card` sections.
5. Reuse icons from `assets/icons/*.svg` or the `<symbol>` refs in `build/icon-sprite.svg` before drawing a new one.

## Design-system highlights

- **One accent hue, three depths** (`--accent`/`--accent-deep`/`--accent-soft`/`--accent-tint`), one primary button per view — verified with zero exceptions across all 7 source files.
- **Four-step radius scale** (`--radius-sm/--radius/--radius-lg/--radius-pill`) and **three-step shadow scale** (`--shadow-sm/--shadow-md/--shadow-lg`) — never an arbitrary value outside these.
- **Status colors travel as tint+deep pairs** (good/warn/bad) — never mix a tint from one pair with a deep from another.
- **No webfonts** — native OS font stack only (`-apple-system`/`Segoe UI`/`system-ui`), confirmed absent from every source `<link>`/`@font-face`.
- **Icons are 1.6–1.8px stroke line SVGs**, rounded joins, no emoji, no filled style.
- **Copy convention**: concrete numbers over adjectives ("184 meals," "+12 this month"), Vietnamese full name + department/role always paired, empty/draft states named plainly rather than hidden.

## Hard rules (full list in `DESIGN.md` §9)

- Never invent metrics, names, or activity copy. If a new screen needs sample data, follow the existing convention and label anything genuinely unknown as an honest placeholder.
- Preserve `:focus-visible` rings and the `@media (prefers-reduced-motion: reduce)` guard on every new interactive element.

## Verifying a new artifact

Before delivering, open it next to `preview/components-buttons.html` and confirm: no new hex colors, no new radius/shadow values, one primary button per view, hover states only change background (never lighten text), and every interactive element has a visible focus ring.
