# Task 3 report — pickup availability transport/UI

## Changed files

- `packages/contracts/src/v1/pickup.ts`: added strict v1 pickup availability code/details/error schemas and inferred types.
- `packages/contracts/src/v1/index.ts`: exported the pickup contract.
- `packages/contracts/test/contracts.test.ts`: added valid closed/not-ready payload checks and invalid details coverage.
- `apps/mobile/package.json`: merged `@imeal/contracts: workspace:^` while retaining the existing Expo tunnel script/ngrok dependency edits.
- `yarn.lock`: updated by Yarn after the workspace dependency was added.
- `apps/api/src/common/business-time.ts`: changed the serving-window upper boundary to exclusive 13:30:00.
- `apps/api/src/common/business-time.spec.ts`: pinned 13:30:00 as rejected.
- `apps/api/src/pickup/pickup.service.ts`: both serving failures now throw HTTP 403 `ForbiddenException` responses with the typed code, exact message, and Vietnam-window details.
- `apps/api/src/pickup/pickup.service.spec.ts`: added exact response assertions for window-closed and kitchen-not-ready conditions.
- `apps/mobile/src/api/pickupAPI.ts`: added typed 403 parsing for direct and Nest-wrapped JSON payloads, with generic fallback for malformed/non-403/network failures shared by options and QR requests.
- `apps/mobile/src/screens/pickup/PickupIntentScreen.tsx`: preserved the existing minimum-visible-loading hook and request invalidation; replaced the string error with window-closed/not-ready/generic error states, one inline card per state, and retained QR failures as global notices.

## Commands and output

- `corepack yarn install` — refused the lockfile mutation under the repository's immutable setting (expected because the dependency was newly added).
- `corepack yarn install --no-immutable` — completed with existing peer-dependency warnings and updated `yarn.lock`.
- `corepack yarn workspace @imeal/contracts build` — completed successfully with no output.
- `corepack yarn workspace @imeal/contracts test` — 1 file, 12 tests passed.
- `corepack yarn workspace @imeal/api test -- src/common/business-time.spec.ts src/pickup/pickup.service.spec.ts` — 13 files, 77 tests passed (the workspace runner included the API unit set despite the file filters).
- `corepack yarn workspace @imeal/contracts exec tsc --noEmit -p tsconfig.json` — passed with no output.
- `corepack yarn workspace @imeal/api exec tsc --noEmit -p tsconfig.json` — passed with no output.
- `corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json` — passed with no output.
- `git diff --check -- <changed files>` — passed; only Git's LF/CRLF normalization warnings were emitted for the two rewritten mobile files.

The contract and API tests followed RED/GREEN cycles: the new contract tests initially failed because the export did not exist; the boundary test initially accepted 13:30; and exact service tests initially saw string-only exception responses. The implemented contract, exclusive boundary, and structured exceptions made those tests pass.

## Self-review

- The server remains authoritative: no client retry, sleep, or fake success was added. QR generation still uses its real completion/polling timing and still reports transient failures through `QR unavailable`.
- The mobile parser validates every non-2xx JSON body against the shared schema candidates, but only creates `PickupAvailabilityApiError` for a valid typed 403. Nest's standard wrapped `{ message: payload }` response and direct typed payloads are both supported.
- The closed-window card has the requested `Clock3`, exact title/body copy, and no action. The not-ready card uses the server message and `Check again`; generic failures use an actionable connection message and `Retry`. Initial options errors no longer call `showNotice`.
- Request-ID invalidation, selected-option reconciliation, empty-options copy, minimum loading, QR refresh behavior, and QR global notices remain in place.
- Existing user changes to README/docs and the preexisting Expo tunnel package/lock edits were not reverted or staged.

## Concerns

- The targeted API command's Vitest workspace invocation ran the full API unit discovery (13 files / 77 tests) rather than filtering to only the two requested files; all discovered tests passed.
- No browser/Expo visual verification was run in this slice; the main integration pass should exercise the three Ticket error cards at the requested viewport.
- Yarn reported preexisting peer-dependency warnings during install.
