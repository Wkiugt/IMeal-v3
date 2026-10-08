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

## Re-review fix report

- Removed the stray leading `-` from the Admin weekly-menu continuation line in both `AGENTS.md` and `docs/02-technical-requirements.md`; wording and route-specific envelope policy are unchanged.
- Focused Markdown/static checks passed; tests, builds, lint, and typecheck were intentionally not run.
## Final verification after commit `51a8441`

Verification was rerun from HEAD `51a844114cf8db1548bbc141c120d7635fd7d9cb` without source edits or commits:

- `corepack yarn workspace @imeal/api test --run src/admin/weekly-menus/weekly-menus.service.spec.ts src/health/health.controller.spec.ts src/common/api-exception.filter.spec.ts` — exit 0; 3 files and 72 tests passed. Vitest emitted the existing `vite-tsconfig-paths` deprecation warning.
- `corepack yarn workspace @imeal/api typecheck` — exit 0; no output.
- `corepack yarn workspace @imeal/mobile test` — exit 0; 30 files and 225 tests passed.
- `corepack yarn workspace @imeal/mobile typecheck` — exit 0; no output.
- `git diff --check -- AGENTS.md CHANGELOG.md README.md docs/mobile-release.md docs/02-technical-requirements.md apps/api/src/common/api-error-messages.ts` — exit 0; no output/whitespace errors.
- `git diff --exit-code -- docs/mobile-release.md` — exit 0; no output, restored file matches tracked bytes.
- Exact plan Node README destination check — exit 0; `](./docs/mobile-release.md)` occurs exactly twice at README lines 250 and 329, and the document exists.

### Manual evidence

- Weekly-menu source and regression show non-null revisions ordered by revision descending then id descending, with `take: 1`; Admin Web still consumes only `revisions?.[0]` and contains no ordering workaround.
- Health regressions cover live draining, ready, legacy `/health`, and malformed-header readiness. Every failure body asserts status 503, `SERVICE_UNAVAILABLE`, the exact shared message, and the expected request ID; live, ready, and malformed-header cases also assert the `x-request-id` response header, while legacy uses the same `writeResult`/header path. The exception filter's `Service is shutting down.` override remains intact and tested.
- README destinations resolve to the existing restored runbook. The runbook's `1.0.0`, `vn.iec.imeal`, `imeal`, production API/project validation, EAS profile names, remote credentials, Node 24.18.1, Yarn 4.18.0, and `autoIncrement: false` claims match `apps/mobile/app.config.ts` and `apps/mobile/eas.json`; it explicitly disclaims a signed store build.
- §8.1 and `AGENTS.md:81-98` match the raw auth controller/client schemas, raw weekly-menu controller/Admin Web mapping, and envelope-backed check-in/employee-activity contracts and mobile consumers.

The worktree remained pre-existing dirty (0 staged, 45 unstaged, 8 untracked); no source files were changed by this verification.
 
## Final unit-suite evidence

- `corepack yarn test:unit` — exit 0; 67/67 test files passed and 653/653 tests passed (0 failures).
- Warnings: the existing `vite-tsconfig-paths` deprecation notice was emitted by the API and worker tasks; expected health/OTP/logger warning and error-path records also appeared in test output.
- Finishing environment: `git-dir` `D:/My-Project/IEC/IMeal/.git/worktrees/17628-f0ab12cb-863a-4343-b74b-51f850323f49`; common dir `D:/My-Project/IEC/IMeal/.git`; top level `C:/Users/0xKoigzzzz/orca/workspaces/IMeal/deploy-develop-2`; branch `deploy-develop-2`.
- Post-suite status remains unchanged: 0 staged, 46 unstaged, 8 untracked.
