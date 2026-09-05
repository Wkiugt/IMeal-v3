# Meal Admin — applied UI kit

This README documents the applied kit structure, its component files, the usage workflow, design notes, and the source basis for every pattern below.

## Structure

| Path          | Purpose                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`  | Composed entry point — loads `../../colors_and_type.css`, fetches every file in `components/`, and mounts each one's `#component-root` markup into a live composed admin layout (Sidebar + metric-card + activity-list + data-table + buttons-pills + form-field) plus a mounted App shell. Below the composition it also links out to the seven full preserved source screens. |
| `components/` | Modular component files, one per reusable pattern (see table below)                                                                                                                                                                                                                                                                                                             |
| `README.md`   | This file                                                                                                                                                                                                                                                                                                                                                                       |

Every file in `components/` and `index.html` loads `colors_and_type.css` from the project root — no inline token duplication.

## Component Files

Each file in `components/` is a standalone, previewable HTML document whose reusable markup lives inside a `<div id="component-root">` — `index.html` fetches the file and mounts exactly that node, so opening a component file directly (for review) and mounting it inside the composed interface render identically.

Buttons, pills, and the form field also have a matching PreviewCard one level up in `../../preview/components-buttons.html` — that card shows every state (default/hover/focus) side by side, while the files here show only the composable, mountable markup.

| File                            | Component                                                               | Extracted from                                     |
| ------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| `components/sidebar.html`       | **Sidebar** — admin nav rail (brand mark, 5 nav items, identity footer) | `admin-dashboard.html`                             |
| `components/app-shell.html`     | **App** shell — mobile device frame, status bar, bottom nav             | `employee-meal-app.html`, `kitchen-staff-app.html` |
| `components/metric-card.html`   | Metric-card grid (gradient tile, icon, value, delta)                    | `admin-dashboard.html`                             |
| `components/activity-list.html` | Activity row list (icon + title/sub + timestamp)                        | `admin-dashboard.html`                             |
| `components/data-table.html`    | Data table (mono headers, right-aligned numeric columns)                | `admin-metrics.html`                               |
| `components/buttons-pills.html` | Button variants + status pill variants                                  | `admin-*.html` (shared shell CSS)                  |
| `components/form-field.html`    | Labeled form field pair                                                 | `admin-menu.html`                                  |

## Usage Workflow

1. Open `index.html` to see every component mounted together in one composed admin layout, plus the mounted App shell for the mobile surfaces.
2. Open any file in `components/` directly to review or copy that one pattern in isolation, or open the matching PreviewCard in `../../preview/` for the same pattern shown across every interaction state.
3. To build a new screen: copy the relevant `#component-root` markup from the matching `components/*.html` file, `<link>` `../../colors_and_type.css` (or the correct relative path from the new file's location), and follow `../../SKILL.md` for which shell (mobile device frame vs. admin sidebar shell) to wrap it in.
4. To add a new reusable pattern to this kit: create `components/<name>.html` following the same shape (a full HTML document, linking `colors_and_type.css`, with the reusable markup inside `#component-root`), then add a `["mount-<name>", "components/<name>.html"]` entry to the `mounts` array in `index.html`'s script and a matching `<div id="mount-<name>">` slot in the layout.

## Design Notes

- Metric cards use the `linear-gradient(150deg, var(--accent-tint), var(--accent-soft))` tile treatment — reserved for small stat tiles, never a full-page background (see `../../DESIGN.md` §9 anti-patterns).
- The Sidebar and App shell are the two structural components everything else nests inside; both share the same `.card`/`.pill`/`.btn`/`.avatar` primitives so a new admin page or a new mobile screen never needs to invent a new container.
- `index.html`'s mount script fails soft per-slot: if a fetch fails, that slot shows a labeled error pill with the file path instead of leaving the layout silently blank.

## Source Basis

Every component file traces back to the preserved source prototypes at the project root (`admin-dashboard.html`, `admin-metrics.html`, `admin-menu.html`, `employee-meal-app.html`, `kitchen-staff-app.html`) — markup was copied and trimmed to the reusable pattern, not redrawn from memory. See `../../context/provenance.md` for the complete evidence map.
