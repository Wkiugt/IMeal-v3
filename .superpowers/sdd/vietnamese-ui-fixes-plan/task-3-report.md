# Task 3 report: Admin Web Vietnamese copy and protocol mappings

## Status

Implemented and committed the Admin Web Vietnamese-only client copy changes.

## Files changed

- `apps/admin-web/src/main.ts`
  - Translated shell, login, weekly-menu, penalty, and client fallback labels/messages to the approved Vietnamese strings.
  - Changed `formatDate` from `en-GB` to `vi-VN` while retaining `{ dateStyle: 'medium' }`.
  - Added the local `PenaltyFilterStatus`, `penaltyFilterOptions`, and `penaltyStatusLabels` symbols.
  - Rendered penalty option and badge text from Vietnamese labels while retaining protocol values and CSS class generation.
- `apps/admin-web/index.html`
  - Set `lang="vi"`.
  - Set title to `Quản trị IMeal`.
  - Set description to `Bảng quản trị IMeal`.

No CSS, layout, menu input element, API/domain schema, user/server data, permissions, headers, paths, enum values, or session key was changed.

## Mapping decisions

- Penalty filter options display `Tất cả`, `Đang chờ`, `Đã thanh toán`, and `Đã miễn`; their `.value` attributes remain `ALL`, `PENDING`, `PAID`, and `WAIVED` respectively.
- Penalty status badges display through `penaltyStatusLabels`, but retain `penalty.status.toLowerCase()` for the existing `status pending|paid|waived` CSS classes.
- Penalty query construction still sends `status.value` and `search.value` unchanged to `/admin/penalties`.
- `ErrorResponseSchema.message` remains verbatim when returned by the server. The client does not string-match or translate backend messages.
- Meal content, penalty reasons, profile name/email, permission codes, API paths/headers, and the `imeal.local.access-token` session key remain unchanged.

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
dist/index.html                  0.50 kB │ gzip:  0.31 kB
dist/assets/index-DLVB37dN.css   2.34 kB │ gzip:  1.01 kB
dist/assets/index-x-xis8O1.js   64.81 kB │ gzip: 16.23 kB

✓ built in 335ms
```

## Concerns

- Runtime fixture/screenshot and responsive geometry checks are intentionally deferred to the plan's integration/runtime-proof task; this task did not modify layout or CSS.
- `Admin Web root element is missing` and `Content root is missing` remain English internal invariant diagnostics because they are not client-owned UI copy or approved fallback labels.

## Commit

Implementation commit: `31bae05` (`fix(admin): translate client copy to Vietnamese`)
