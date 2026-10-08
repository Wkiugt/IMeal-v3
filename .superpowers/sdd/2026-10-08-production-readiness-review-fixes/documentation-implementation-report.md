# Documentation/configuration implementation report

Plan: `docs/superpowers/plans/2026-10-08-production-readiness-review-fixes.md`
BASE: `5f0f4215a4e26b283ea4999af690f89762db621f`
Commit: `0f71abb75bd2ee0a48e5ea8c2aab208e2e1522cc` (`docs: restore release guidance and route envelopes`)

## Implemented

- Restored `docs/mobile-release.md` from `HEAD:docs/mobile-release.md` byte-for-byte. The restored blob matches `HEAD`; therefore no content delta for this file was needed in the commit. `README.md` was not edited.
- Replaced the blanket API success-envelope claim in `docs/02-technical-requirements.md` §8.1 and `AGENTS.md` with route-specific wording that preserves raw `/auth` payloads and raw `GET /admin/weekly-menus` arrays while retaining the envelope shape for envelope-backed versioned routes.
- Added implementation cross-references for the raw auth/Admin routes and envelope-backed check-in/employee-activity schemas and clients.
- Added the exact requested bullet under the current top `### Changed` section in `CHANGELOG.md`.

## Checks

- `git diff --check -- AGENTS.md CHANGELOG.md README.md docs/mobile-release.md docs/02-technical-requirements.md`: passed.
- `git diff --exit-code -- docs/mobile-release.md`: passed after restoration.
- Route-specific wording static check for §8.1 and `AGENTS.md`: passed.
- The amended destination-based README link check passes: it counts exactly two `](./docs/mobile-release.md)` destinations and verifies the destination at `README.md:250` and `README.md:329`, accepting the existing link-label capitalization; README remains unchanged per scope.

Tests/build/lint/typecheck were intentionally not run; final verification is deferred until both workstreams are complete.

## Concerns

The worktree contains unrelated pre-existing user changes, including README and technical-requirements edits outside this workstream. Only the three changed documentation files were staged/committed; unrelated changes remain untouched.

## Fix report

- Updated both route-specific envelope cross-references so they explicitly state that `apps/admin-web/src/main.ts` consumes the raw weekly-menu array and maps each daily menu’s revisions/current meal fields.
- Corrected the stale README-check note above; the amended destination-based check passes and verifies both destinations at `README.md:250` and `README.md:329`.
- Focused static documentation checks only; tests, builds, lint, and typecheck were intentionally not run.
