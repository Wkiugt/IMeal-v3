# Source Project Context

This design-system workspace was created from an existing OpenDesign project. Treat the copied project files as the primary source evidence for the generated design system.

## Source project

- Source project id: d2b6b396-5427-4aab-928d-b5fbcd60ea02
- Source project name: Web Prototype
- New design-system project id: 3c835d81-b8f3-4b12-8990-ea6128f34a2b
- New design-system id: user:web-prototype-design-system-2
- Source skill id: (none)
- Source design system id: (none)

## Source metadata

```json
{
  "kind": "prototype",
  "nameSource": "prompt"
}
```

## Copied files

- admin-penalties.html
- admin-menu.html
- admin-users.html
- admin-metrics.html
- admin-dashboard.html
- admin-dashboard-check.png
- kitchen-staff-app.html
- employee-meal-app.html
- preview-polish-check.png
- preview-profile.png
- preview-booking.png
- preview-login.png
- preview-dashboard.png

## Skipped files

- (none)

## Generation contract

- Read this file before editing design-system outputs.
- Read the copied files directly from the project workspace; they are source evidence, not generated design-system output.
- Preserve high-signal assets, source examples, UI surfaces, copy, tokens, typography, and interaction patterns from the copied project.
- Generate a reusable OpenDesign design-system package in this same project: DESIGN.md, README.md, SKILL.md, colors_and_type.css, context/provenance, focused preview cards, preserved assets/build/fonts when available, and ui_kits/app/.
- Before final response, run `"$OD_NODE_BIN" "$OD_BIN" tools connectors design-system-package-audit --path . --fail-on-warnings` and fix every actionable issue.
