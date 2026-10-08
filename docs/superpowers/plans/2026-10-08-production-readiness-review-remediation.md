# Production Readiness Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate every production-readiness review finding while preserving the public contracts API, production locking and SMTP safety, and unrelated working-tree changes.

**Architecture:** Restore the contracts compatibility layer first, then apply independent package-local fixes in parallel: centralized observability redaction, mobile presentation mapping, Admin canonical meal persistence, OTP raw-query capability checks, and worker scheduler registration coverage. Finish with documentation/reference migration and one ordered cross-workspace verification pass.

**Tech Stack:** TypeScript, Zod, NestJS, Vitest, React/DOM Admin Web, Expo mobile, Nest `@nestjs/schedule`, Yarn 4.18.0, Turbo, Markdown/Prettier.

**Spec:** `docs/imeal-production-readiness-phase-prompts.md` (Tracks A, B, F); `docs/superpowers/plans/2026-10-08-production-readiness-review-fixes.md` (historical review context only; this plan supersedes its narrower scope); current review findings supplied with this plan.

## Global Constraints

- The current working tree is dirty; inspect the diff before implementation and never overwrite, reset, stage, or reformat unrelated user changes.
- Preserve the existing public `@imeal/contracts` root shape `{ v1 }`; do not flatten barrels, remove current exports, or edit generated `dist` files.
- Do not weaken production environment validation, SMTP ownership, OTP locking, or safe logging requirements.
- Do not add a cutoff worker or restore cutoff cron registration.
- Keep API changes limited to the weekly-menu validation behavior required by the Admin change and the OTP guard.
- Use existing package scripts and conventions; do not add dependencies.
- Do not put real credentials, tokens, OTPs, GPS coordinates, or production identifiers in tests or documentation.
- The implementation phase must run the commands specified here only after the relevant changes are complete; this planning task itself runs no tests, builds, lint, formatting, or source changes.

---

## Dependency and Parallelization Map

- **Task 1 is mandatory first:** capture the dirty-tree boundary and restore/freeze contracts.
- **Tasks 2–6 can run in parallel after Task 1:** observability, mobile mapping, Admin save behavior, OTP guard, and worker scheduler tests have separate source boundaries. Mobile consumes the contract symbols restored by Task 1.
- **Task 7 can run in parallel with Tasks 2–6 but must use the Task 1 contract decision:** documentation/reference migration and SMTP setup.
- **Task 8 is sequential after Tasks 1–7:** run focused checks, then package and repository checks, then final audits.

## Task 1: Restore contracts compatibility and freeze the public surface

**Files:**
- Modify: `packages/contracts/src/v1/errors.ts`
- Modify: `packages/contracts/src/v1/envelopes.ts`
- Modify: `packages/contracts/src/v1/index.ts` only if a restored symbol is not already re-exported
- Test: `packages/contracts/test/contracts.test.ts`
- Inspect only: `packages/contracts/src/index.ts`, `packages/contracts/package.json`

**Interfaces:**
- Produces the unchanged package-root interface `import { v1 } from '@imeal/contracts'`.
- Restores `v1.ErrorCodeSchema`, `v1.ErrorCode`, `v1.ErrorDetailSchema`, `v1.ErrorDetail`, `v1.ErrorEnvelopeSchema`, `v1.ErrorEnvelope`, and `v1.Envelope<T>` compatibility.
- Preserves separate `v1.ApiErrorResponseSchema` and `v1.ApiErrorResponse`.
- Preserves `v1.GpsRecoveryActionSchema`, `v1.GpsRecoveryAction`, `v1.GpsFailureDetailsSchema`, and `v1.GpsFailureDetails`.

- [ ] **Step 1: Record the current dirty-tree boundary before implementation.**

Run:

```powershell
git status --short
git diff -- packages/contracts/src packages/contracts/test
```

Do not alter files shown as unrelated existing work.

- [ ] **Step 2: Restore the old error-detail schema without aliasing the raw API shape.**

In `packages/contracts/src/v1/errors.ts`, retain the current `PublicErrorCodeSchema`, `PublicErrorCode`, `ApiErrorResponseSchema`, GPS types, and operational codes. Add the removed compatibility exports with the tracked baseline shape:

```ts
export const ErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_SERVER_ERROR',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorDetailSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;
```

- [ ] **Step 3: Restore the discriminated error envelope.**

In `packages/contracts/src/v1/envelopes.ts`, replace the current alias with:

```ts
export const ErrorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: ErrorDetailSchema,
  meta: z.record(z.unknown()).optional(),
});
```

Keep `SuccessEnvelopeSchema`, `ErrorEnvelope`, and `Envelope<T>`, and make `EnvelopeSchema` discriminate on `success` while preserving the existing generic data schema:

```ts
export const EnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.discriminatedUnion('success', [
    SuccessEnvelopeSchema(dataSchema),
    ErrorEnvelopeSchema,
  ]);
```

Retain `ApiErrorResponseSchema` as the separate raw shape `{ statusCode, errorCode, message, requestId }`; do not alias it to `ErrorEnvelopeSchema`.

- [ ] **Step 4: Add compatibility and boundary tests.**

In `packages/contracts/test/contracts.test.ts`, add tests with these names:

- `preserves the v1 namespace and restored error exports`
- `accepts the legacy discriminated error envelope and rejects the raw API shape`
- `discriminates success and failure envelopes on success`
- `keeps ApiErrorResponseSchema separate with 400-through-599 status bounds`
- `preserves GPS recovery details and action types`

Test these exact cases:

```ts
v1.ErrorEnvelopeSchema.safeParse({
  success: false,
  error: { code: 'BAD_REQUEST', message: 'Invalid request' },
  meta: { requestId: 'request-1' },
}).success === true;

v1.ErrorEnvelopeSchema.safeParse({
  statusCode: 400,
  errorCode: 'BAD_REQUEST',
  message: 'Invalid request',
  requestId: 'request-1',
}).success === false;

v1.ApiErrorResponseSchema.safeParse({
  statusCode: 400,
  errorCode: 'BAD_REQUEST',
  message: 'Invalid request',
  requestId: 'request-1',
}).success === true;

v1.ApiErrorResponseSchema.safeParse({ statusCode: 399, errorCode: 'BAD_REQUEST', message: 'x', requestId: 'r' }).success === false;
v1.ApiErrorResponseSchema.safeParse({ statusCode: 600, errorCode: 'BAD_REQUEST', message: 'x', requestId: 'r' }).success === false;
v1.GpsFailureDetailsSchema.safeParse({ action: 'RETRY' }).success === true;
```

- [ ] **Step 5: Verify only this package before handing off.**

Run:

```powershell
corepack yarn workspace @imeal/contracts test
corepack yarn workspace @imeal/contracts typecheck
corepack yarn workspace @imeal/contracts build
```

**Acceptance:** existing `{ v1 }` imports remain valid; old envelope consumers receive `{ success: false, error, meta? }`; raw API errors remain separately validated; GPS details and raw status bounds are covered; no generated `dist` file is manually changed.

## Task 2: Close observability redaction gaps

**Files:**
- Modify: `packages/observability/src/index.ts`
- Test: `packages/observability/test/observability.test.ts`
- Test if affected: `apps/api/src/common/api-exception.filter.spec.ts`, `apps/api/src/common/http-logging.interceptor.spec.ts`

**Interfaces:**
- Preserve `JsonStructuredLogger`, `sanitizeLogText`, `SafeLogFields`, and all existing redaction behavior.
- Extend the central sanitizer to dotted authorization property names and `Set-Cookie` header forms.

- [ ] **Step 1: Add failing redaction fixtures.**

Add tests named `redacts dotted authorization properties` and `redacts Set-Cookie header values`. Include:

```ts
'headers.authorization=Bearer dotted-secret'
'req.headers.authorization: "Bearer quoted-secret"'
'Set-Cookie: session=secret-cookie; Path=/; HttpOnly'
'set-cookie: refresh_token=secret-refresh; Secure'
```

Assert each secret is absent, `[REDACTED]` is present, and existing safe text remains present.

- [ ] **Step 2: Extend the existing central redaction pipeline.**

Add a dotted-property pattern that matches names such as `req.headers.authorization` and `headers.authorization` before generic serialization, and a Set-Cookie header pattern that replaces the entire header value while retaining the header label. Apply both through `redactString`; do not add caller-specific masking.

- [ ] **Step 3: Preserve existing behavior and run focused checks.**

Run:

```powershell
corepack yarn workspace @imeal/observability test
corepack yarn workspace @imeal/observability typecheck
corepack yarn workspace @imeal/api test -- src/common/api-exception.filter.spec.ts src/common/http-logging.interceptor.spec.ts
```

**Acceptance:** dotted authorization and Set-Cookie secrets are absent and `[REDACTED]` is visible; existing nested, query, OTP, SMTP, QR, coordinate, message, stack, route, and safe-field tests remain valid.

## Task 3: Make mobile status and message mapping exact

**Files:**
- Modify: `apps/mobile/src/api/mobileApiError.ts`
- Test: `apps/mobile/src/api/mobileApiError.test.ts`
- Modify if required: `apps/mobile/src/i18n/translations.ts`
- Test if present: mobile translation parity test

**Interfaces:**
- Preserve `MobileApiErrorCode`, `mobileErrorPresentationKey`, `getMobileErrorMessage`, `toMobileApiError`, and request-ID support behavior.
- Payload `errorCode` takes precedence over HTTP status.

- [ ] **Step 1: Add a complete table-driven mapping test.**

Add a test named `maps every supported HTTP status to the exact safe translation key` for:

```ts
400: 'errors.badRequest'
401: 'errors.sessionInvalid'
403: 'errors.forbidden'
404: 'errors.notFound'
405: 'errors.methodNotAllowed'
408: 'errors.requestTimeout'
409: 'errors.conflict'
410: 'errors.gone'
413: 'errors.payloadTooLarge'
415: 'errors.unsupportedMediaType'
422: 'errors.unprocessableEntity'
429: 'errors.rateLimited'
500: 'errors.internalServerError'
501: 'errors.notImplemented'
502: 'errors.badGateway'
503: 'errors.serviceUnavailable'
504: 'errors.gatewayTimeout'
```

Add tests named `uses safe fallbacks for unknown statuses`, `payload errorCode overrides HTTP status`, `maps SESSION_INVALID to the session message`, and `keeps server diagnostics out of presentation text`.

Unknown 4xx must map to `errors.badRequest`; unknown 5xx must map to `errors.internalServerError`.

- [ ] **Step 2: Align dictionaries and translation typing.**

Ensure `errors.badRequest`, `errors.forbidden`, `errors.notFound`, and `errors.rateLimited` are distinct keys with both Vietnamese and English values. Ensure every `TranslationKey` has a value in both dictionaries; do not reuse one generic key for these four cases.

- [ ] **Step 3: Run mobile verification.**

```powershell
corepack yarn workspace @imeal/mobile test -- src/api/mobileApiError.test.ts
corepack yarn workspace @imeal/mobile typecheck
corepack yarn workspace @imeal/mobile test
```

**Acceptance:** all 17 specified statuses, unknown fallbacks, payload precedence, `SESSION_INVALID`, and dictionary parity are covered; no backend or transport diagnostic is user-visible.

## Task 4: Remove legacy Admin content from canonical saves

**Files:**
- Modify: `apps/admin-web/src/main.ts`
- Test: `apps/admin-web/src/main.test.ts`
- Inspect/modify only if required by existing validation: `apps/api/src/admin/weekly-menus/dto/weekly-menus.schema.ts`
- Test only if API schema changes: `apps/api/src/admin/weekly-menus/weekly-menus.service.spec.ts`

**Interfaces:**
- `updateDailyMenu(date, payload)` receives canonical fields only in the clean compatibility path.
- Existing service persistence may continue storing historical `content`, but Admin input must not use it to create a revision.

- [ ] **Step 1: Add failing Admin tests.**

Add tests named `does not PUT when meal name is whitespace`, `sends canonical meal fields without content`, `rejects an invalid image URL without PUT`, and `does not create a revision for a legacy content-only no-op`.

Assert the valid request body is exactly:

```ts
{ mealName: 'Chicken rice', description: 'Lunch', imageUrl: null }
```

Assert whitespace-only names and invalid image URLs produce no fetch/PUT call. For a legacy content-only no-op, assert the service does not call `dailyMenuRevision.create`.

- [ ] **Step 2: Implement canonical client validation and payload.**

In `renderMenus`, trim `mealName`, reject an empty trimmed value before `updateDailyMenu`, call the existing browser validity path for the URL field, and send only `mealName`, `description`, and `imageUrl`. Empty image input becomes `null`. Do not change unrelated Admin rendering.

- [ ] **Step 3: Preserve service no-op semantics.**

In `WeeklyMenusService.updateDailyMenu`, compare canonical fields and flags, not incoming legacy `content`, when deciding whether to create a revision. Continue deriving stored `content` from the canonical meal name or existing historical value so legacy storage survives without making a new revision.

- [ ] **Step 4: Run focused Admin/API checks.**

```powershell
corepack yarn workspace @imeal/admin-web test -- src/main.test.ts
corepack yarn workspace @imeal/admin-web typecheck
corepack yarn workspace @imeal/admin-web build
corepack yarn workspace @imeal/api test -- src/admin/weekly-menus/weekly-menus.service.spec.ts
corepack yarn workspace @imeal/api typecheck
```

**Acceptance:** no PUT occurs for whitespace names or invalid image URLs; valid saves omit `content`; legacy stored content survives; content-only no-op saves do not create revisions; existing revision, publish, snapshot, actor, and audit behavior remains unchanged.

## Task 5: Guard OTP raw-query capabilities without weakening locks

**Files:**
- Modify: `apps/api/src/auth/otp.service.ts`
- Test: `apps/api/src/auth/otp.service.spec.ts`

**Interfaces:**
- The transaction capability guard must require callable `$executeRaw` and `$queryRaw` before invoking either.
- Production Prisma transactions retain advisory and row locks.

- [ ] **Step 1: Add partial-client regression tests.**

Add tests named `uses both raw capabilities for OTP locking`, `does not call absent raw methods`, and `fails closed for an incomplete production transaction client`. Cover complete, `$queryRaw`-only, `$executeRaw`-only, and no-raw transaction mocks.

- [ ] **Step 2: Implement the typed guard.**

Use a predicate equivalent to:

```ts
const hasOtpRawLockCapabilities = (
  tx: unknown,
): tx is { $executeRaw: Function; $queryRaw: Function } =>
  typeof (tx as { $executeRaw?: unknown }).$executeRaw === 'function' &&
  typeof (tx as { $queryRaw?: unknown }).$queryRaw === 'function';
```

Use it before the existing advisory-lock and `FOR UPDATE` calls. The incomplete real-client path must produce the existing safe configuration/dependency failure, not silently skip production locking.

- [ ] **Step 3: Run focused API checks.**

```powershell
corepack yarn workspace @imeal/api test -- src/auth/otp.service.spec.ts
corepack yarn workspace @imeal/api typecheck
corepack yarn workspace @imeal/api lint
```

**Acceptance:** complete clients execute both locks; partial mocks never produce an absent-method `TypeError`; real production execution fails closed rather than weakening OTP concurrency protection.

## Task 6: Permanently test worker cron registration

**Files:**
- Create: `apps/worker/src/scheduler-registration.spec.ts`
- Inspect only: `apps/worker/src/app.module.ts`, `apps/worker/src/otp-delivery-worker.service.ts`, `apps/worker/src/notification-dispatch.service.ts`, `apps/worker/src/notification-reminder.service.ts`, `apps/worker/src/no-show-worker.service.ts`

**Interfaces:**
- Uses the existing `AppModule`, `ScheduleModule.forRoot()`, Nest `SchedulerRegistry`, and existing service decorators.
- Does not add or restore `CutoffWorkerService` or a cutoff cron.

- [ ] **Step 1: Build an application-level scheduler test.**

Create a Nest testing module importing `AppModule`, initialize it, obtain `SchedulerRegistry`, and inspect `getCronJobs()`. Close the module in `afterEach`.

- [ ] **Step 2: Assert exact registrations.**

Add tests named `registers every production cron with its expected expression` and `does not register a cutoff cron`. Assert method/job names and expressions for OTP delivery, notification dispatch, registration reminder, pickup reminder, and no-show; assert reminder/no-show timezone options, including `Asia/Ho_Chi_Minh` for no-show.

- [ ] **Step 3: Run worker verification.**

```powershell
corepack yarn workspace @imeal/worker test -- src/scheduler-registration.spec.ts src/app.module.spec.ts
corepack yarn workspace @imeal/worker typecheck
corepack yarn workspace @imeal/worker lint
corepack yarn workspace @imeal/worker test
```

**Acceptance:** all intended jobs are registered at runtime with exact expressions/timezones; no cutoff job exists; the test closes cleanly and does not alter readiness initialization.

## Task 7: Restore or migrate readiness references and document SMTP setup

**Files:**
- Restore if present in a tracked baseline: `docs/imeal-production-readiness-assessment.md`
- Otherwise modify every active reference in:
  - `docs/superpowers/plans/2026-09-28-imeal-phase0-domain-correctness-plan.md`
  - `docs/superpowers/plans/2026-09-28-production-hardening-plan.md`
  - `docs/superpowers/plans/2026-09-28-staging-readiness-plan.md`
  - `docs/superpowers/plans/2026-09-29-imeal-cross-session-control-plan.md`
  - related `docs/superpowers/specs/*.md` and `docs/superpowers/evidence/*.md`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/runbooks/otp-email.md`
- Modify: `docs/02-technical-requirements.md`
- Modify: `docs/runbooks/production-release.md`
- Modify: `docs/README.md` only if the canonical reading order needs the runbook link
- Modify: `docker-compose.yml` only if the explicitly selected local SMTP behavior requires it

**Interfaces:**
- Canonical readiness references point to existing `docs/03-product-flows.md`, `docs/05-backend-structure.md`, `docs/06-execution-plan.md`, `docs/runbooks/staging-readiness.md`, or `docs/runbooks/production-release.md`.
- SMTP documentation uses the existing `OTP_SMTP_USERNAME`, `OTP_SMTP_PASSWORD`, `OTP_SMTP_FROM`, optional `OTP_SMTP_FROM_NAME`, `smtp.gmail.com`, port `587`, and worker-only ownership.

- [ ] **Step 1: Attempt restoration from tracked content without inventing content.**

Run:

```powershell
git cat-file -e HEAD:docs/imeal-production-readiness-assessment.md
```

If present, restore exactly with:

```powershell
git show HEAD:docs/imeal-production-readiness-assessment.md > docs/imeal-production-readiness-assessment.md
```

The current repository history checked during planning does not contain this path; therefore the expected path is reference migration, not fabricated restoration.

- [ ] **Step 2: Migrate every reference when restoration is unavailable.**

Search tracked content with:

```powershell
git grep -n "imeal-production-readiness-assessment\.md"
```

Replace active links and “canonical assessment” claims with the existing authoritative documents above. Historical evidence may state that the old artifact was user-owned/deleted, but must not retain a live link to a missing file.

- [ ] **Step 3: Update SMTP documentation.**

Link `docs/runbooks/otp-email.md` from `README.md`. Document explicit App Password creation, placeholder-only examples, worker-only credential injection, direct worker versus Compose injection, STARTTLS/TCP 587, no API SMTP credentials, and rotation. State the selected local behavior without weakening production validation.

- [ ] **Step 4: Audit documentation references and secrets.**

Run:

```powershell
git grep -n "imeal-production-readiness-assessment\.md"
git grep -n -E "(OTP_SMTP_PASSWORD|App Password|smtp\.gmail\.com|OTP_PROVIDER_API_KEY)" README.md .env.example docs docker-compose.yml
```

**Acceptance:** restoration is exact when tracked content exists; otherwise every active reference is migrated; no missing-file link remains; SMTP setup is complete, consistent, placeholder-only, and does not weaken production configuration.

## Task 8: Integration verification and final audits

**Files:**
- No new source files.
- Inspect all files changed by Tasks 1–7 only.

- [ ] **Step 1: Run focused package checks.**

```powershell
corepack yarn workspace @imeal/contracts test
corepack yarn workspace @imeal/contracts typecheck
corepack yarn workspace @imeal/observability test
corepack yarn workspace @imeal/observability typecheck
corepack yarn workspace @imeal/api test -- src/auth/otp.service.spec.ts src/admin/weekly-menus/weekly-menus.service.spec.ts src/common/api-exception.filter.spec.ts
corepack yarn workspace @imeal/api typecheck
corepack yarn workspace @imeal/api lint
corepack yarn workspace @imeal/worker test -- src/scheduler-registration.spec.ts
corepack yarn workspace @imeal/worker typecheck
corepack yarn workspace @imeal/worker lint
corepack yarn workspace @imeal/mobile test -- src/api/mobileApiError.test.ts
corepack yarn workspace @imeal/mobile typecheck
corepack yarn workspace @imeal/admin-web test -- src/main.test.ts
corepack yarn workspace @imeal/admin-web typecheck
```

- [ ] **Step 2: Run repository checks in dependency order.**

```powershell
corepack yarn test:build-order
corepack yarn typecheck
corepack yarn lint
corepack yarn build
corepack yarn test:unit
corepack yarn test:db
corepack yarn test:staging-tools
corepack yarn prettier --check README.md .env.example docs packages apps
 git diff --check
```

Use a disposable non-production database for `test:db`. Correct the leading space before `git diff --check` if copying the command into a shell; the intended command is exactly `git diff --check`.

- [ ] **Step 3: Perform final contract, reference, and redaction audits.**

Verify:

```powershell
git grep -n "imeal-production-readiness-assessment\.md"
git grep -n "content" apps/admin-web/src/main.test.ts apps/api/src/admin/weekly-menus
```

Review built contracts through the package root and confirm `{ v1 }` remains the only root shape. Confirm log fixtures contain `[REDACTED]` and no raw secret sentinel. Confirm no cutoff cron registration and no generated `dist` edits.

**Acceptance:** all focused and cross-workspace checks pass; the public contract remains compatible; all review findings have implementation and test coverage; only intended files changed; unrelated dirty-tree work remains intact.

## Final Self-Review

- [ ] Contracts task restores `ErrorEnvelopeSchema` old discriminator, `ErrorCode`/`ErrorDetail` exports, GPS details, raw API schema separation, exports, and 400–599 bounds.
- [ ] Observability task covers dotted authorization and Set-Cookie secrets while preserving prior redaction tests.
- [ ] Mobile task covers every required status, safe unknown fallbacks, payload precedence, `SESSION_INVALID`, and bilingual dictionary parity.
- [ ] Admin task removes canonical `content`, trims/rejects whitespace names, validates image URLs, tests no PUT, and tests legacy no-op behavior.
- [ ] OTP task guards both raw methods without weakening production locks.
- [ ] Worker task verifies no-show expression/timezone and application scheduler registration without adding cutoff.
- [ ] Documentation task restores the assessment only from tracked content or migrates every reference, and documents SMTP placeholders/App Password/worker-only/direct-versus-Compose injection.
- [ ] Integration task includes focused tests, typechecks, build, lint, format check, and final reference/redaction/contract audits.
- [ ] No step contains an unresolved TODO, TBD, invented file, generated-dist edit, unrelated source change, or silent public-v1 contract change.
