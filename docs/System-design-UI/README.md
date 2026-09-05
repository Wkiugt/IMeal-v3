# Meal Admin Design System

A design-system package generated from the OpenDesign source project **"Web Prototype"** (`d2b6b396-5427-4aab-928d-b5fbcd60ea02`). All tokens and components are read directly from the seven shipped HTML prototypes; see `context/provenance.md` for the exact source-to-artifact mapping.

## Product Overview

Meal Admin is the source product: an internal corporate canteen / meal-booking system that provides meal registration, QR-based check-in, and canteen-program administration. It offers three primary surfaces — an employee mobile app, a kitchen-staff mobile app, and a five-page admin console — described in detail below.

- **Employee mobile app** (`employee-meal-app.html`) — sign in with a work Microsoft account, view today's assigned lunch, toggle weekly meal registration on a calendar, show a QR ticket at the canteen, manage dietary preferences.
- **Kitchen staff mobile app** (`kitchen-staff-app.html`) — see today's total meal count and dietary breakdown, scan employee QR tickets at a viewfinder to check them in, track live check-in progress.
- **Admin console** (`admin-dashboard.html`, `admin-metrics.html`, `admin-users.html`, `admin-menu.html`, `admin-penalties.html`) — one responsive sidebar shell across five pages: program overview and attendance trend, department/dietary analytics, user management, the weekly menu editor with a publish flow, and penalty/invoicing tracking for unused booked meals.

Content and personas (Minh Anh, Pham Quang, Ngoc Phuong, Canteen A) indicate a Vietnam-based company deployment; all UI copy is English.

## Source &amp; context references

- Source project: **"Web Prototype"** (`d2b6b396-5427-4aab-928d-b5fbcd60ea02`) — see `context/source-context.md` for the original handoff metadata.
- Full source-to-artifact evidence map: `context/provenance.md`.

## Start here

1. **`DESIGN.md`** — the authoritative spec: source context, color, typography, spacing, layout, components, motion, voice, anti-patterns (10 sections, each citing its source evidence).
2. **`colors_and_type.css`** — paste this into the first `<style>` block of a new artifact, or `<link>` it directly, before writing any layout CSS.
3. **`preview/`** — seven focused review cards. Open any file directly in a browser.
4. **`ui_kits/app/`** — an applied interface kit: `index.html` fetches and mounts every file in `components/` into one composed layout, plus links out to the real preserved source screens.
5. **`SKILL.md`** — how an agent should use this system when generating new Meal Admin artifacts (when/how to apply it, hard rules, verification checklist).

## Preview manifest

| File                                | Covers                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `preview/colors-primary.html`       | Core surfaces/text, accent scale, status pairs, elevation                                                  |
| `preview/typography-specimens.html` | Font family roles, live type-scale samples                                                                 |
| `preview/spacing-tokens.html`       | Observed spacing step scale, card padding rhythm, page gutters                                             |
| `preview/radius-shadows.html`       | Four-step radius scale, three-step shadow scale                                                            |
| `preview/components-buttons.html`   | Buttons, pills, avatars, toggle, form field, bar meter, data table, card                                   |
| `preview/brand-assets.html`         | Brand mark + navigation icon set, loaded from `assets/icons/`                                              |
| `preview/applied-surfaces.html`     | Real rendered screenshots from `assets/screenshots/` showing tokens composed into finished product screens |

## Package contents

```
DESIGN.md                  Full design-system spec (10 sections, source-cited)
README.md                  This file
SKILL.md                   How an agent should use this system when generating new artifacts
colors_and_type.css        All color/type/spacing/radius/shadow tokens + shared component CSS

context/
  source-context.md        Original source-project handoff metadata
  provenance.md             Source → artifact evidence map

assets/
  icons/                    9 SVG icons extracted verbatim from source HTML (brand mark + 8 nav icons)
  screenshots/              6 real rendered PNG screenshots of the source prototypes

build/
  icon-sprite.svg           Compiled <symbol> sprite of all assets/icons/*.svg for runtime use

preview/                    7 focused review cards + README.md manifest (see table above)

ui_kits/app/
  index.html                Composed entry point — mounts components/*.html live, links to preserved source screens
  components/                7 modular component files (sidebar, app-shell, metric-card, activity-list, data-table, buttons-pills, form-field)
  README.md                  Applied-kit structure & reuse workflow

employee-meal-app.html      Preserved source: employee mobile app (5 screens)
kitchen-staff-app.html      Preserved source: kitchen staff mobile app (2 screens)
admin-dashboard.html        Preserved source: admin — overview
admin-metrics.html          Preserved source: admin — analytics
admin-users.html            Preserved source: admin — user management
admin-menu.html             Preserved source: admin — weekly menu editor
admin-penalties.html        Preserved source: admin — billing
```

## Reuse workflow

1. New Meal Admin screen requested → read `DESIGN.md`, then `SKILL.md` for the concrete apply steps.
2. Link/paste `colors_and_type.css`; do not redeclare any token with a different value.
3. Start from the closest existing page in `ui_kits/app/` or at the project root rather than building a shell from scratch.
4. Before delivering, diff the new screen against `preview/components-buttons.html`: same radius/shadow scale, one primary button, working focus rings.

## What's intentionally absent

- **`fonts/`** — the product uses only the native OS font stack (`-apple-system`/`Segoe UI`/`system-ui`); no webfont files exist in source, so none are fabricated here.
- **Dark mode** — every source file defines light-mode tokens only.

See `context/provenance.md` for the full reasoning behind every omission.
