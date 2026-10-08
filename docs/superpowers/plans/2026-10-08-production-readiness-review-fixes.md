# Production Readiness Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the four confirmed production-readiness review findings without changing unrelated runtime behavior: deterministic Admin Web menu revisions, canonical health errors, restoration of the tracked mobile-release runbook, and accurate API envelope documentation.

**Architecture:** Keep the API authoritative for which weekly-menu revision is current; the existing Admin Web `revisions?.[0]` mapping remains compatible and receives a deterministic latest row. Share one service-unavailable message constant between the exception filter and direct health responses. Restore the deleted release document byte-for-byte and narrow the technical-requirements wording to the actual route-specific response contracts rather than migrating any endpoint.

**Tech Stack:** NestJS/Fastify API, Prisma, Vitest, TypeScript, Expo/EAS configuration, Markdown documentation, Yarn 4.18.0 via Corepack.

**Spec:** The four confirmed findings in this review request, together with `docs/02-technical-requirements.md` §8.1 and the tracked `docs/mobile-release.md` as the source-of-truth documentation.

## Global Constraints

- Only these four fixes are in scope: revision ordering, canonical health 503 text, mobile-release document restoration, and API envelope documentation.
- Do not perform an API-wide envelope migration; do not change runtime routes, API clients, contracts, or Admin Web payload mapping for documentation purposes.
- Do not introduce a client-side revision-ordering workaround unless implementation evidence proves the server contract is insufficient.
- Preserve health `statusCode`, `errorCode`, and `requestId` behavior, and preserve the `Service is shutting down.` exception-filter override.
- Restore `docs/mobile-release.md` byte-for-byte from the tracked pre-change version; do not expand supported mobile platforms or alter `apps/mobile/app.config.ts` or `apps/mobile/eas.json`.
- Do not edit the README links at `README.md:250` and `README.md:329`; they must continue to point to `./docs/mobile-release.md`.
- Use only a disposable database for any database/e2e verification; never point an e2e command at production.
- The implementation worker must run the verification commands only after all four changes are complete; this research/planning pass runs no tests, builds, lint, or formatters.

---

## Current Findings and File Map

- **Admin revision ordering:** The uncommitted Admin Web change is `DailyMenuSchema` in `apps/admin-web/src/main.ts:31-59`; its transform uses `revisions?.[0]` and `renderMenus` at `apps/admin-web/src/main.ts:548-659` uses the mapped meal fields for editing/saving. The API read is `WeeklyMenusService.getWeeklyMenus` in `apps/api/src/admin/weekly-menus/weekly-menus.service.ts:25-33`, where `dailyMenus.include.revisions` is currently unordered. The established canonical latest-revision query is already present in `apps/api/src/admin/weekly-menus/weekly-menus.service.ts:87-92` and must be reused.
- **Health error text:** `HealthController.writeResult` in `apps/api/src/health/health.controller.ts:89-104` emits `Service unavailable.` for every non-200 result. `ApiExceptionFilter` in `apps/api/src/common/api-exception.filter.ts:40-69` defines the canonical 503 text as `The service is temporarily unavailable. Please try again later.`; its shutdown exception override is in `:208-213`.
- **Mobile release links:** The current uncommitted state deletes tracked `docs/mobile-release.md`. The tracked version is still consistent with `apps/mobile/app.config.ts` (version/package/API validation) and `apps/mobile/eas.json` (development/preview/production profiles). `README.md:250` and `README.md:329` link to that file.
- **Envelope documentation:** `docs/02-technical-requirements.md:249-267` currently states a blanket success envelope. Actual raw auth returns are in `apps/api/src/auth/auth.controller.ts:61-147`, raw Admin Web weekly-menu returns are in `apps/api/src/admin/weekly-menus/weekly-menus.controller.ts:29-61`, and their clients parse raw payloads in `apps/mobile/src/api/authAPI.ts:74-186` and `apps/admin-web/src/main.ts:548-565`. Envelope-backed schemas are defined in `packages/contracts/src/v1/envelopes.ts:4-22`, `packages/contracts/src/v1/check-in.ts:90-188`, and `packages/contracts/src/v1/employee-activity.ts:113-179`; clients consume those shapes in `apps/mobile/src/api/checkInAPI.ts:90-159` and `apps/mobile/src/api/employeeActivityAPI.ts:99-152`.

## Task 1: Restore the tracked mobile-release document

**Files:**
- Restore: `docs/mobile-release.md` from the tracked pre-change version (`HEAD:docs/mobile-release.md`).
- Verify unchanged: `README.md:250` and `README.md:329`.
- Cross-check only: `apps/mobile/app.config.ts` and `apps/mobile/eas.json` (do not modify).

**Interfaces:**
- Consumes: the tracked Git blob for `docs/mobile-release.md`.
- Produces: a byte-identical `docs/mobile-release.md` with valid README links.

- [ ] **Step 1: Restore the exact tracked bytes.**

  Use the non-destructive tracked-file read to recreate the deleted file:

  ```bash
  git show HEAD:docs/mobile-release.md > docs/mobile-release.md
  ```

  Do not rewrite, reformat, or update any wording. In particular, retain the document’s existing statements about `vn.iec.imeal`, `imeal`, app version `1.0.0`, `apps/mobile/eas.json` profiles, production environment requirements, and the explicit absence of a signed store build.

- [ ] **Step 2: Verify byte-for-byte restoration and link presence.**

  Run:

  ```bash
  git diff --exit-code -- docs/mobile-release.md
  node -e "const fs=require('node:fs'); const read=fs.readFileSync('README.md','utf8'); const destination='](./docs/mobile-release.md)'; const lines=read.split(/\r?\n/); if (!fs.existsSync('docs/mobile-release.md')) throw new Error('missing docs/mobile-release.md'); if (read.split(destination).length - 1 !== 2) throw new Error('README must retain exactly two mobile-release destinations'); for (const lineNumber of [250,329]) { if (!lines[lineNumber - 1]?.includes(destination)) throw new Error('README line '+lineNumber+' must retain the mobile-release destination'); }"
  ```

  Expected: the tracked file diff exits successfully (no content difference), and the Node link check exits successfully. The check must find exactly two occurrences of the destination suffix:

  ```text
  ](./docs/mobile-release.md)
  ```

  at `README.md:250` and `README.md:329`, accepting the existing capitalization of either link label while preserving both destinations.

- [ ] **Step 3: Manually compare the restored document’s assumptions with mobile configuration.**

  Confirm without editing source that:
  - `apps/mobile/app.config.ts` still defines the documented `APP_VERSION`, package/bundle identifiers, URL scheme, and production `EXPO_PUBLIC_API_URL`/EAS project validation.
  - `apps/mobile/eas.json` still defines the documented `development`, `preview`, and `production` profiles, `distribution`, channels, `credentialsSource`, Node `24.18.1`, Yarn `4.18.0`, and `autoIncrement: false` behavior.
  - Nothing in the restored document claims additional production platforms or a signed store submission.

## Task 2: Make `getWeeklyMenus` return the deterministic latest revision

**Files:**
- Modify: `apps/api/src/admin/weekly-menus/weekly-menus.service.ts:25-33`, symbol `WeeklyMenusService.getWeeklyMenus`.
- Test: `apps/api/src/admin/weekly-menus/weekly-menus.service.spec.ts`, `describe('WeeklyMenusService')`.
- Do not modify for this fix: `apps/admin-web/src/main.ts:31-59` (`DailyMenuSchema`), because its raw `[0]` mapping is compatible once the API orders and limits the relation.

**Interfaces:**
- Consumes: Prisma `weeklyMenu.findMany` and the existing latest-revision query semantics at `weekly-menus.service.ts:87-92`.
- Produces: one verified current revision per returned day, with the highest revision number first and `id` as the deterministic secondary ordering key.

- [ ] **Step 1: Add the focused unit regression before changing the query.**

  Add a test that sets `mockPrisma.weeklyMenu.findMany` to return a representative weekly menu whose day contains the current revision, then calls `await service.getWeeklyMenus()`. Assert both the exact Prisma arguments and the returned current revision:

  ```ts
  it('loads only the deterministic latest verified revision for each day', async () => {
    const latest = {
      id: 'revision-2',
      revision: 2,
      mealName: 'New lunch',
      description: 'New description',
      imageUrl: null,
      content: 'New lunch',
    };
    mockPrisma.weeklyMenu.findMany.mockResolvedValueOnce([
      {
        id: 'weekly-menu-1',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2026-09-07T00:00:00.000Z'),
        dailyMenus: [{ id: 'daily-menu-1', revisions: [latest] }],
      },
    ]);

    const result = await service.getWeeklyMenus();

    expect(mockPrisma.weeklyMenu.findMany).toHaveBeenCalledWith({
      orderBy: { startDate: 'asc' },
      include: {
        dailyMenus: {
          include: {
            mealDays: true,
            revisions: {
              where: { revision: { not: null } },
              orderBy: [{ revision: 'desc' }, { id: 'desc' }],
              take: 1,
            },
          },
        },
      },
    });
    expect(result[0]?.dailyMenus[0]?.revisions).toEqual([latest]);
  });
  ```

  Keep the fixture limited to the fields needed by the assertion; the exact call assertion is the important regression because Prisma applies the relation filtering/order/limit.

- [ ] **Step 2: Run only the new focused test to establish the pre-fix failure.**

  Run:

  ```bash
  corepack yarn workspace @imeal/api test --run src/admin/weekly-menus/weekly-menus.service.spec.ts -t "loads only the deterministic latest verified revision"
  ```

  Expected before implementation: FAIL because the current query contains `revisions: true` rather than the asserted nested `where`, `orderBy`, and `take` options. Do not broaden this run to the full repository.

- [ ] **Step 3: Reuse the established nested Prisma query in `getWeeklyMenus`.**

  Change only the `dailyMenus` include in `WeeklyMenusService.getWeeklyMenus` from:

  ```ts
  include: { mealDays: true, revisions: true },
  ```

  to:

  ```ts
  include: {
    mealDays: true,
    revisions: {
      where: { revision: { not: null } },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      take: 1,
    },
  },
  ```

  Keep `orderBy: { startDate: 'asc' }` unchanged. The `revision: { not: null }` filter intentionally excludes legacy/unverified rows, matching the existing write/publish query semantics. Do not sort or select revisions in `apps/admin-web/src/main.ts` as a workaround.

- [ ] **Step 4: Run the focused unit regression and the surrounding service suite.**

  Run:

  ```bash
  corepack yarn workspace @imeal/api test --run src/admin/weekly-menus/weekly-menus.service.spec.ts -t "loads only the deterministic latest verified revision"
  corepack yarn workspace @imeal/api test --run src/admin/weekly-menus/weekly-menus.service.spec.ts
  ```

  Expected: the exact Prisma argument assertion and returned-latest-revision assertion pass, followed by all existing `WeeklyMenusService` tests passing.


## Task 3: Share the canonical `SERVICE_UNAVAILABLE` message

**Files:**
- Create: `apps/api/src/common/api-error-messages.ts`.
- Modify: `apps/api/src/common/api-exception.filter.ts:40-69`, symbol `CANONICAL_MESSAGES`.
- Modify: `apps/api/src/health/health.controller.ts:13-17,89-104`, symbols `ApiHealthErrorBody` and `HealthController.writeResult`.
- Test: `apps/api/src/health/health.controller.spec.ts:74-131`.
- Preserve unchanged tests/behavior: `apps/api/src/common/api-exception.filter.spec.ts` canonical 5xx tests and shutdown override tests.

**Interfaces:**
- Consumes: one shared exported message constant.
- Produces: identical canonical 503 response text from both the exception filter and direct health failure responses, without changing status, error code, request ID, or shutdown behavior.

- [ ] **Step 1: Add the shared message constant.**

  Create `apps/api/src/common/api-error-messages.ts` with one named export and no unrelated error-message migration:

  ```ts
  export const SERVICE_UNAVAILABLE_MESSAGE =
    'The service is temporarily unavailable. Please try again.';
  ```

- [ ] **Step 2: Write the health regression cases for every `writeResult` failure path.**

  Update `apps/api/src/health/health.controller.spec.ts` so these existing cases expect the exact canonical text:
  - `returns the canonical error response for readiness failures` (ready endpoint).
  - `keeps the legacy health alias canonical on readiness failure` (legacy `/health` endpoint).
  - `uses established request IDs for malformed and missing headers` (ready endpoint with request context).

  Add a live/draining case that makes `service.live` return `result(503, requestId)`, invokes `controller.live`, and asserts the complete direct body and response side effects:

  ```ts
  it('returns the canonical error response when live is draining', () => {
    const requestId = '123e4567-e89b-42d3-a456-426614174005';
    service.live.mockReturnValueOnce(result(503, requestId));

    const body = controller.live(requestId, response as never);

    expect(body).toEqual({
      statusCode: 503,
      errorCode: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Please try again.',
      requestId,
    });
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.header).toHaveBeenCalledWith('x-request-id', requestId);
  });
  ```

  The assertions should remain literal/exact so the health response contract cannot drift silently. Import the shared constant in production code, not as the only expected value in the regression test.

- [ ] **Step 3: Run the health tests before implementation to verify the old literal is detected.**

  Run:

  ```bash
  corepack yarn workspace @imeal/api test --run src/health/health.controller.spec.ts
  ```

  Expected before implementation: the updated health expectations fail with `Service unavailable.`. Do not modify the exception filter’s shutdown behavior to make this test pass.

- [ ] **Step 4: Use the shared constant in both runtime producers.**

  In `apps/api/src/common/api-exception.filter.ts`, import `SERVICE_UNAVAILABLE_MESSAGE` and replace only the `HttpStatus.SERVICE_UNAVAILABLE` value in `CANONICAL_MESSAGES`; leave every other canonical message and `genericMessage` fallback unchanged.

  In `apps/api/src/health/health.controller.ts`, import the same constant, type `ApiHealthErrorBody.message` as `typeof SERVICE_UNAVAILABLE_MESSAGE`, and return the constant from `writeResult`. Keep `statusCode: 503`, `errorCode: 'SERVICE_UNAVAILABLE'`, and `requestId` exactly as they are.

  Do not change this existing filter branch:

  ```ts
  const publicMessageValue =
    status === HttpStatus.SERVICE_UNAVAILABLE &&
    code === 'SERVICE_UNAVAILABLE' &&
    body.message === 'Service is shutting down.'
      ? body.message
      : message;
  ```

- [ ] **Step 5: Run the focused health/filter regressions.**

  Run:

  ```bash
  corepack yarn workspace @imeal/api test --run src/health/health.controller.spec.ts src/common/api-exception.filter.spec.ts
  ```

  Expected: ready, legacy, malformed-header, and live/draining health tests pass; the filter’s exact canonical-message matrix and `Service is shutting down.` exception tests also pass unchanged.

## Task 4: Correct the route-specific API envelope documentation

**Files:**
- Modify: `docs/02-technical-requirements.md:249-267`, §8.1 `API-wide contract`.
- Modify: `AGENTS.md:81-83`, repository guidance; replace the unconditional success-envelope claim with the same route-specific policy.
- Cross-reference without modifying: `apps/api/src/auth/auth.controller.ts:61-147`, `apps/api/src/admin/weekly-menus/weekly-menus.controller.ts:29-61`, `apps/mobile/src/api/authAPI.ts:74-186`, `apps/admin-web/src/main.ts:548-565`, `packages/contracts/src/v1/envelopes.ts:4-22`, `packages/contracts/src/v1/check-in.ts:90-188`, `packages/contracts/src/v1/employee-activity.ts:113-179`, `apps/mobile/src/api/checkInAPI.ts:90-159`, and `apps/mobile/src/api/employeeActivityAPI.ts:99-152`.

**Interfaces:**
- Consumes: actual controller return shapes and existing client/contract schemas.
- Produces: documentation that distinguishes envelope-backed versioned routes from current raw auth and Admin Web weekly-menu routes without changing runtime code.

- [ ] **Step 1: Replace the blanket success-envelope sentence in both authoritative guidance files.**

  In `docs/02-technical-requirements.md` §8.1, replace the current blanket bullet:

  ```text
  - JSON success envelope: `{ data, meta?: { requestId, pagination? } }`.
  ```

  In `AGENTS.md:81-83`, replace the unconditional `API success responses follow { data, meta? }` guidance with the same route-specific policy. Both files must state:

  ```text
  - JSON success shape is route-specific. Envelope-backed versioned routes use
    `{ data, meta?: { requestId, pagination? } }` (with `meta.pagination` where
    the route is paginated). Current raw authentication endpoints under `/auth`
    return their documented raw payloads, and `GET /admin/weekly-menus` returns
    its documented raw weekly-menu array; these routes are not wrapped solely
    because the general API guidance describes envelope-backed routes.
  ```

  Keep the existing error-contract statement and request-ID requirements intact. This is documentation/repository guidance only: do not add a runtime `success` field, wrapper, adapter, or API/client migration.

- [ ] **Step 2: Add concrete cross-references in the documentation and guidance.**

  Ensure the revised §8.1 paragraph and the nearby `AGENTS.md` guidance identify enough implementation evidence for a future reader to verify the distinction:
  - `apps/api/src/auth/auth.controller.ts` returns raw OTP request/verify, logout, and `/auth/me` values; `apps/mobile/src/api/authAPI.ts` parses those raw schemas.
  - `apps/api/src/admin/weekly-menus/weekly-menus.controller.ts` delegates raw weekly-menu values; `apps/admin-web/src/main.ts` parses the raw array and daily-menu revisions.
  - `packages/contracts/src/v1/check-in.ts` and `employee-activity.ts` define `{ data, meta? }` response schemas consumed by the corresponding mobile API clients.

  Do not claim that every `/v1` or `/api` route is envelope-backed; use the actual “envelope-backed versioned routes” distinction and preserve the existing endpoint catalog. Do not make any runtime migration while synchronizing these two guidance sources.

- [ ] **Step 3: Perform static documentation and guidance checks.**

  Run:

  ```bash
  git diff --check -- AGENTS.md README.md docs/mobile-release.md docs/02-technical-requirements.md
  git diff --exit-code -- docs/mobile-release.md
  node -e "const fs=require('node:fs'); const docs=fs.readFileSync('docs/02-technical-requirements.md','utf8'); const guidance=fs.readFileSync('AGENTS.md','utf8'); const section=docs.slice(docs.indexOf('### 8.1 API-wide contract'), docs.indexOf('### 8.2 Runtime environment contract')); for (const [name,text] of [['docs/02-technical-requirements.md',section],['AGENTS.md',guidance]]) { if (!text.includes('route-specific')) throw new Error(name+': missing route-specific envelope wording'); if (!text.includes('/auth') || !text.includes('/admin/weekly-menus')) throw new Error(name+': missing raw-route exceptions'); if (!text.includes('{ data, meta?')) throw new Error(name+': missing envelope shape'); }"
  ```

  Expected: no whitespace errors, the restored mobile-release file has no diff from its tracked version, and both §8.1 and `AGENTS.md:81-83` contain the route-specific statement, both raw-route exceptions, and the envelope shape.

## Task 5: Record the delivery changelog entry

**Files:**
- Modify: `CHANGELOG.md:3-8`, the current top `Unreleased — 2026-10-07` `### Changed` section.

**Interfaces:**
- Consumes: the four completed fixes in Tasks 1-4.
- Produces: one concise documentation-only delivery record; it does not change runtime behavior or expand scope.

- [ ] **Step 1: Add one concise `### Changed` bullet under the existing top Unreleased section.**

  Add this exact bullet under `CHANGELOG.md:5` without creating another heading or rewriting existing entries:

  ```markdown
  - Admin weekly-menu reads now select the deterministic latest revision; health 503 responses use the canonical message; the tracked mobile-release runbook links are restored; and API documentation records route-specific success envelopes.
  ```

  Keep this as a release note only. Do not claim an API-wide envelope migration, a mobile platform expansion, a signed store release, or any behavior beyond the four confirmed fixes.

- [ ] **Step 2: Verify the changelog entry is documentation-only and scoped.**

  Confirm the bullet is under the existing top `### Changed` heading, names all four fixes once, and introduces no source/test/config changes. Include `CHANGELOG.md` in the final changed-file review and whitespace check.

## Task 6: Integration verification and manual checks

**Files:**
- No additional source or documentation files.

- [ ] **Step 1: Run the exact package-manifest verification commands after all implementation tasks.**

  Run the focused API unit suites and typecheck:

  ```bash
  corepack yarn workspace @imeal/api test --run src/admin/weekly-menus/weekly-menus.service.spec.ts src/health/health.controller.spec.ts src/common/api-exception.filter.spec.ts
  corepack yarn workspace @imeal/api typecheck
  ```

  Run the mobile package checks relevant to the restored release documentation/config contract:

  ```bash
  corepack yarn workspace @imeal/mobile test
  corepack yarn workspace @imeal/mobile typecheck
  ```


  These commands come directly from the package manifests (`test`, `typecheck`, and API `test`/`typecheck` scripts); do not substitute an API-wide envelope migration or unrelated suite changes.

- [ ] **Step 2: Perform the final static file/link checks.**

  Run:

  ```bash
  git diff --check -- AGENTS.md CHANGELOG.md README.md docs/mobile-release.md docs/02-technical-requirements.md apps/api/src/common/api-error-messages.ts
  git diff --exit-code -- docs/mobile-release.md
  node -e "const fs=require('node:fs'); const read=fs.readFileSync('README.md','utf8'); const destination='](./docs/mobile-release.md)'; const lines=read.split(/\r?\n/); if (read.split(destination).length - 1 !== 2) throw new Error('README must retain exactly two mobile-release destinations'); for (const lineNumber of [250,329]) { if (!lines[lineNumber - 1]?.includes(destination)) throw new Error('README line '+lineNumber+' must retain the mobile-release destination'); } if (!fs.existsSync('docs/mobile-release.md')) throw new Error('mobile-release document missing');"
  ```

  Also manually confirm the implementation diff (excluding pre-existing user changes in the worktree and this plan file) contains only the four scoped implementation areas plus the required changelog entry: the weekly-menu service/spec, shared API error message plus filter/health controller/spec, restored `docs/mobile-release.md`, the §8.1 documentation edit, matching `AGENTS.md` guidance, and the concise `CHANGELOG.md` bullet. No source/runtime client migration is acceptable.

- [ ] **Step 3: Complete manual behavior checks.**

  - **Revision ordering:** With a disposable database containing two non-null revisions for one day, call `GET /admin/weekly-menus` through the existing authenticated Admin route and verify the returned day has only the highest revision, with the newest meal name/description/image. Confirm no Admin Web client sorting code was added.
  - **Health failures:** Exercise the controller tests or a disposable readiness/draining setup for `/health/live`, `/health/ready`, and `/health`; verify HTTP 503, `errorCode: 'SERVICE_UNAVAILABLE'`, the exact canonical message, and the same request ID. Separately verify the exception filter’s `Service is shutting down.` response remains unchanged.
  - **Mobile release links:** Open both README links and verify the restored document remains consistent with the current app config/EAS profile names; do not claim a signed store release or new platform support.
  - **Envelope docs:** Compare §8.1 with the cited auth controller/client, weekly-menu controller/Admin Web mapping, and contract-backed mobile clients. Confirm documentation changed only the description, not any route, schema, or client parser.

## Acceptance Criteria

- `WeeklyMenusService.getWeeklyMenus` includes `dailyMenus.revisions` with exactly `where: { revision: { not: null } }`, `orderBy: [{ revision: 'desc' }, { id: 'desc' }]`, and `take: 1`; its unit regression asserts the exact Prisma arguments and the returned latest revision.
- `apps/admin-web/src/main.ts` remains raw-payload compatible and contains no client-side revision-ordering workaround; the required service regression is the sole revision-ordering regression.
- `SERVICE_UNAVAILABLE_MESSAGE` is defined once in `apps/api/src/common/api-error-messages.ts` and used by both `ApiExceptionFilter` and `HealthController`; health live, ready, legacy, and malformed-header 503 tests expect the exact canonical message.
- Health status code, `SERVICE_UNAVAILABLE` error code, request ID, and the exception filter’s special `Service is shutting down.` behavior are unchanged.
- `docs/mobile-release.md` is byte-for-byte identical to `HEAD:docs/mobile-release.md`, exists at the path used by both README links, and remains consistent with the current mobile app/EAS configuration.
- `CHANGELOG.md` contains one concise `### Changed` bullet under the current top Unreleased section covering deterministic latest weekly-menu reads, canonical health 503 text, restored mobile-release links, and route-specific API envelope documentation; it is documentation-only.
- Focused API tests/typecheck, mobile tests/typecheck, static documentation checks, and manual checks pass when run by the implementation worker.

## Risks and Scope Decisions

- **Legacy revisions:** Filtering `revision: null` rows is intentional and matches the existing write/publish query at `weekly-menus.service.ts:87-92`; selecting an arbitrary legacy row would reintroduce stale/unverified data. Supporting legacy rows in the Admin read is a separate contract decision.
- **Shared message scope:** A single constant prevents future drift between direct health responses and `ApiExceptionFilter` without refactoring every canonical message. The shutdown override remains a deliberately separate public message.
- **Documentation restoration:** The tracked file is restored exactly rather than regenerated, translated, reformatted, or expanded. Any mismatch is a failure, not an invitation to update the runbook.
- **Envelope wording:** The documentation acknowledges the current mixed contract. It does not normalize raw auth/Admin routes, add wrappers, update mobile/Admin clients, or alter package contracts.
- **Unrelated changes:** Existing uncommitted changes outside these four findings belong to the user and must not be folded into this implementation.

## Final Integration Checklist

- [ ] All scoped tasks are implemented with only the scoped files changed.
- [ ] The exact Prisma relation query and latest-revision regression pass.
- [ ] Health ready/legacy/malformed-header/live-draining tests pass with the shared canonical message.
- [ ] Existing filter canonical-message and shutdown tests pass unchanged.
- [ ] `docs/mobile-release.md` matches the tracked blob byte-for-byte.
- [ ] README lines 250 and 329 still link to the restored file.
- [ ] §8.1 and `AGENTS.md:81-83` accurately distinguish envelope-backed versioned routes from raw auth/Admin weekly-menu routes and cite actual controllers, clients, and contracts.
- [ ] `CHANGELOG.md` contains the concise documentation-only `### Changed` bullet covering all four fixes.
- [ ] No API-wide envelope migration, mobile platform expansion, unrelated refactor, or source/test/docs change outside this plan’s four fix areas was introduced.
