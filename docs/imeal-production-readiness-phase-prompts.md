# IMeal Production Readiness — Phase-by-Phase Implementation Prompts

Source audit branch: `deploy-develop-2`  
Source audit head: `5f0f4215a4e26b283ea4999af690f89762db621f`

## How to use this file

Run exactly one phase per Codex/Grok session. Each prompt is intentionally self-contained: inspect the current HEAD, implement only the named phase, report how you should manually test/validate it, then stop. You will perform verification yourself before reviewing/committing and starting the next phase.

Important: the audit SHA above is context, not a reset target. After Phase 1, later prompts must work from the current branch HEAD and must preserve already-reviewed changes.

Every implementation prompt below requires the agent to:

- inspect the current implementation and nearby tests before editing;
- keep the diff limited to the phase;
- avoid unrelated refactors, package upgrades, formatting sweeps, migrations, or cleanup;
- add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation;
- **not run** tests, typecheck, lint, build, smoke tests, or other verification commands after implementation;
- translate the phase acceptance criteria into a clear **manual test/validation checklist** for you;
- never claim the phase is tested/passed unless you report that result yourself;
- stop after implementation + manual test instructions;
- never continue into the next phase automatically.

Important: any `Done when`, regression-test, boundary-test, or acceptance wording inside a phase remains a behavior/coverage target. The agent must not execute that verification. Instead, it must explain how you can validate the target manually.

# Track A — Runtime/Auth blocker
### Track A completion checklist
- [x] A1.1
- [x] A1.2
- [x] A1.3
- [x] A1.4
- [x] A1.5
- [x] A2
- [x] A3
- [x] A4
- [x] A5
- [x] A6
- [x] A7
- Next session may continue with Track B / remaining phases.


## Phase A1.1 — Standardize structured logging for all 4xx/5xx responses

### Prompt

```text
You are working in the IMeal repository. Implement only Phase A1.1 — Standardize structured logging for all 4xx/5xx responses. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Goal: make every HTTP client/server error traceable from production logs without exposing sensitive information.

Scope:
- `ApiExceptionFilter`
- Apply consistently to every HTTP response with status `400–599`.
- Preserve a common structured event schema.

Required safe fields:

event
errorClass
method
path
route
statusCode
errorCode
requestId
service
release

Where:

4xx → errorClass = CLIENT_ERROR
5xx → errorClass = SERVER_ERROR

The `path` must never include query-string secrets.

Never log:

Authorization
Cookie
OTP
session token
access token
refresh token
SMTP credentials
request body
raw query parameters containing secrets

Example 4xx log:

{
  "event": "http.exception",
  "errorClass": "CLIENT_ERROR",
  "method": "POST",
  "path": "/auth/otp/request",
  "statusCode": 404,
  "errorCode": "NOT_FOUND",
  "requestId": "..."
}

Example 5xx log:

{
  "event": "http.exception",
  "errorClass": "SERVER_ERROR",
  "method": "POST",
  "path": "/auth/otp/request",
  "statusCode": 503,
  "errorCode": "OTP_PROVIDER_UNAVAILABLE",
  "requestId": "..."
}

Logging policy:

expected/recoverable 4xx
→ structured client-error log

unexpected 5xx
→ structured error log
→ retain sanitized internal exception/cause information
→ retain stack trace where useful for server-side diagnosis

Stack traces and internal exception details must never be returned to the client.

Review checkpoint:
- Logging only.
- Do not change route behavior.
- Do not change domain behavior.
- Do not change HTTP status semantics.

Done when:
- representative 4xx logging tests pass
- representative 5xx logging tests pass
- secret-redaction tests pass
- API typecheck passes


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase A1.1. Do not implement the next phase.

```

## Phase A1.2 — Standardize the public API error contract

### Prompt

```text
You are working in the IMeal repository. Implement only Phase A1.2 — Standardize the public API error contract. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Goal: every API failure gives clients enough information to handle the error consistently without exposing implementation details.

Canonical response:

{
  "statusCode": 404,
  "errorCode": "NOT_FOUND",
  "message": "The requested information could not be found.",
  "requestId": "..."
}

Required fields:

statusCode
errorCode
message
requestId

Rules:
- `errorCode` is machine-readable and stable.
- `message` is safe for end users.
- `requestId` allows the user-visible error to be correlated with backend logs.
- Never return stack traces.
- Never return SQL/database errors.
- Never return SMTP/provider credentials.
- Never expose internal filesystem paths.
- Never expose raw exception causes.
- Domain-specific `errorCode` must take precedence over generic HTTP status handling.

Example:

404 + MENU_NOT_FOUND

is more useful than:

404 + NOT_FOUND

Do not remove existing domain error codes.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase A1.2. Do not implement the next phase.

```

## Phase A1.3 — Add canonical fallback mapping for HTTP 4xx/5xx

### Prompt

```text
You are working in the IMeal repository. Implement only Phase A1.3 — Add canonical fallback mapping for HTTP 4xx/5xx. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Goal: ensure that even an unhandled/generic HTTP error produces a safe, understandable message.

Minimum canonical mappings:

400 BAD_REQUEST
→ The provided information is not valid. Please check it and try again.

401 UNAUTHORIZED
→ Your session is no longer valid. Please sign in again.

403 FORBIDDEN
→ You do not have permission to perform this action.

404 NOT_FOUND
→ The requested information could not be found.

405 METHOD_NOT_ALLOWED
→ This action is currently unavailable.

408 REQUEST_TIMEOUT
→ The request took too long. Please try again.

409 CONFLICT
→ The information has changed. Please refresh and try again.

410 GONE
→ This information is no longer available.

413 PAYLOAD_TOO_LARGE
→ The submitted data is too large.

415 UNSUPPORTED_MEDIA_TYPE
→ This file or data format is not supported.

422 UNPROCESSABLE_ENTITY
→ Some provided information could not be accepted. Please check it and try again.

429 TOO_MANY_REQUESTS
→ Too many attempts were made. Please wait a moment and try again.

500 INTERNAL_SERVER_ERROR
→ Something went wrong on our side. Please try again later.

501 NOT_IMPLEMENTED
→ This feature is currently unavailable.

502 BAD_GATEWAY
→ A connected service is currently having problems. Please try again later.

503 SERVICE_UNAVAILABLE
→ The service is temporarily unavailable. Please try again later.

504 GATEWAY_TIMEOUT
→ A connected service is taking too long to respond. Please try again later.

Unknown statuses must also have class-level fallbacks:

unknown 4xx
→ The request could not be completed. Please check the information and try again.

unknown 5xx
→ The service is temporarily experiencing a problem. Please try again later.

Important:
- Do not describe every 4xx as a development-team failure.
- Many 4xx errors represent invalid user input, expired authentication, insufficient permission, business-rule conflicts, or rate limiting.
- 5xx errors should use system-failure language by default.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase A1.3. Do not implement the next phase.

```

## Phase A1.4 — Centralize mobile user-facing error presentation

### Prompt

```text
You are working in the IMeal repository. Implement only Phase A1.4 — Centralize mobile user-facing error presentation. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Goal: users should receive understandable Vietnamese error messages instead of HTTP terminology or backend exception text.

Create one centralized error presenter/mapper in the mobile application.

Priority:

domain errorCode
→ HTTP status fallback
→ generic network fallback

Examples:

OTP_EXPIRED
→ Mã xác thực đã hết hạn. Vui lòng yêu cầu mã mới.

SESSION_INVALID
→ Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.

429
→ Bạn đã thử quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.

500
→ Hệ thống đang gặp sự cố. Vui lòng thử lại sau.

503
→ Dịch vụ hiện đang tạm thời gián đoạn. Vui lòng thử lại sau.

For unexpected server-side failures, optionally display:

Mã hỗ trợ: <requestId>

Example:

Hệ thống đang gặp sự cố. Vui lòng thử lại sau.

Mã hỗ trợ: 0ec73a13-6090-4890-97f0-46965cf5e6f2

This lets support/developers locate the exact backend log without showing technical details to the user.

Never display:

HTTP 500
NestJS
Prisma
PostgreSQL
SMTP
stack trace
exception class
Cannot POST /...
ECONNREFUSED
ETIMEDOUT

unless running in an explicitly enabled development/debug environment.

Done when:
- domain-code mapping tests pass
- representative 4xx UI tests pass
- representative 5xx UI tests pass
- unknown-error fallback test passes
- `requestId` is preserved where available
- mobile typecheck passes


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase A1.4. Do not implement the next phase.

```

## Phase A1.5 — HTTP error matrix regression tests

### Prompt

```text
You are working in the IMeal repository. Implement only Phase A1.5 — HTTP error matrix regression tests. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Goal: prevent future regressions in both observability and user-facing error handling.

Cover at minimum:

400
401
403
404
405
408
409
422
429
500
502
503
504
unknown 4xx
unknown 5xx

For every case verify:

correct HTTP status
correct errorCode
requestId exists
structured backend log exists
no sensitive fields are logged
no internal exception details reach the client
client receives a safe message

Additional 5xx assertion:

internal diagnostics remain available server-side
but are absent from the public response

Do not test every domain error code in this phase.

The objective is to lock the global HTTP error-handling infrastructure.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase A1.5. Do not implement the next phase.

```

## Phase A2 — Test real `apiConfig`

### Prompt

```text
You are working in the IMeal repository. Implement only Phase A2 — Test real `apiConfig`. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Goal: make CI catch `/api/auth/...` regressions.

Add focused tests for:

- `EXPO_PUBLIC_API_URL`
- `API_BASE`
- `API_ROOT`

Minimum cases:

https://host/api
→ API_BASE = https://host/api
→ API_ROOT = https://host

Also cover:
- trailing slash normalization
- missing configuration
- development fallback behavior

Do not change networking behavior in this phase.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase A2. Do not implement the next phase.

```

## Phase A3 — Auth API timeout

### Prompt

```text
You are working in the IMeal repository. Implement only Phase A3 — Auth API timeout. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Goal: stop OTP/login requests from using unlimited raw `fetch()`.

Scope:
- `authAPI.ts`
- `authAPI.test.ts`

Use the shared timeout helper for:
- OTP request
- OTP verify
- `/auth/me`
- logout

Do not change endpoint URLs.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase A3. Do not implement the next phase.

```

## Phase A4 — Notification API timeout

### Prompt

```text
You are working in the IMeal repository. Implement only Phase A4 — Notification API timeout. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Goal: make notification networking consistent with registration/check-in APIs.

Replace raw `fetch()` in `notificationAPI.ts` with the shared timeout helper.

Keep API contracts unchanged.

Done when:
- notification tests pass
- mobile typecheck passes


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase A4. Do not implement the next phase.

```

## Phase A5 — Auth route contract test

### Prompt

```text
You are working in the IMeal repository. Implement only Phase A5 — Auth route contract test. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Goal: lock down the canonical auth routes.

Canonical API routes:

POST /auth/otp/request
POST /auth/otp/verify
GET  /auth/me
POST /auth/logout

Regression expectation:

/auth/otp/request      ✅ canonical
/api/auth/otp/request  ❌ not canonical

Tests must not hide URL behavior by mocking `apiConfig` into an unrelated origin.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase A5. Do not implement the next phase.

```

## Phase A6 — Decide/fix mobile web CORS

### Prompt

```text
You are working in the IMeal repository. Implement only Phase A6 — Decide/fix mobile web CORS. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

This is primarily a decision/documentation phase. Do not silently implement the next architectural step.

PHASE CONTRACT
Goal: explicitly decide whether Expo Web is a production-supported client.

Option A — support Expo Web:
- Add explicit CORS allowlist.
- Do not use wildcard production CORS.
- Support browser preflight.
- Add an `OPTIONS /auth/otp/request` regression test.

Option B — native-only staging:
- Document native-only support.
- Remove Expo Web from production qualification later.

Recommended for staging: native-only unless Expo Web is a real product requirement.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase A6. Do not implement the next phase.

```

## Phase A7 — Real auth smoke test

### Prompt

```text
You are working in the IMeal repository. Implement only Phase A7 — Real auth smoke test. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Goal: cover the complete authentication lifecycle without contacting Gmail.

Flow:

known allowlisted test user
→ POST /auth/otp/request
→ OTP outbox generated
→ mocked/deterministic delivery
→ POST /auth/otp/verify
→ sessionToken
→ GET /auth/me
→ POST /auth/logout
→ GET /auth/me => SESSION_INVALID

This closes the gap between unit tests and real runtime auth behavior.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase A7. Do not implement the next phase.

```

# Track B — Admin Weekly Menu blocker
### Track B completion checklist
- [x] B1
- [x] B2
- [x] B3
- [x] B4
- Next session may continue with B5 / remaining Track B phases.


## Phase B1 — Add canonical meal fields to Admin UI

### Prompt

```text
You are working in the IMeal repository. Implement only Phase B1 — Add canonical meal fields to Admin UI. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Goal: allow a newly-created draft to be edited with the fields required by the backend.

Each daily menu needs:
- Meal name — required
- Description
- Image URL — optional

Do not change backend behavior.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase B1. Do not implement the next phase.

```

## Phase B2 — Send canonical menu payload

### Prompt

```text
You are working in the IMeal repository. Implement only Phase B2 — Send canonical menu payload. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Current UI effectively sends legacy `content`.

Change it to send canonical fields:

{
  "mealName": "...",
  "description": "...",
  "imageUrl": null
}

Legacy `content` may remain only if needed for compatibility.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase B2. Do not implement the next phase.

```

## Phase B3 — Admin menu unit regression tests

### Prompt

```text
You are working in the IMeal repository. Implement only Phase B3 — Admin menu unit regression tests. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Cover:

create draft
→ render empty meal fields
→ enter mealName
→ save
→ correct PUT payload

Do not add publish coverage yet.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase B3. Do not implement the next phase.

```

## Phase B4 — Draft → publish integration regression

### Prompt

```text
You are working in the IMeal repository. Implement only Phase B4 — Draft → publish integration regression. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Cover the complete menu lifecycle:

create draft
→ update all enabled days
→ revisions exist
→ publish
→ publishedAt is set

This is the phase that closes the Admin Weekly Menu blocker.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase B4. Do not implement the next phase.

```

## Phase B5 — Fix draft audit atomicity

### Prompt

```text
You are working in the IMeal repository. Implement only Phase B5 — Fix draft audit atomicity. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Current behavior can create an audit entry before the draft is successfully created.

Move draft creation and success audit into one transaction.

Expected invariant:

draft creation fails
→ no success audit exists


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase B5. Do not implement the next phase.

```

## Phase B6 — Attach actor to draft audit

### Prompt

```text
You are working in the IMeal repository. Implement only Phase B6 — Attach actor to draft audit. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Pass `@CurrentUser()` from the controller into `createDraft()`.

Audit should identify the acting admin user.

Keep this separate from B5 for a small diff.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase B6. Do not implement the next phase.

```

## Phase B7 — Audit cutoff changes

### Prompt

```text
You are working in the IMeal repository. Implement only Phase B7 — Audit cutoff changes. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Add server-backed audit for cutoff changes.

Record safe fields such as:
- old value
- new value
- actor
- result

Do not log unrelated sensitive data.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase B7. Do not implement the next phase.

```

# Track C — Worker correctness
### Track C completion checklist
- [x] C1
- [x] C2
- [x] C3
- [x] C4
- Next session may continue with C5 / remaining phases.


## Phase C1 — Remove misleading cutoff worker semantics

### Prompt

```text
You are working in the IMeal repository. Implement only Phase C1 — Remove misleading cutoff worker semantics. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Recommended architecture:

Registration cutoff remains dynamically enforced by the registration service.

Therefore:
- remove/deprecate `CutoffWorkerService`
- remove the cutoff cron
- remove the misleading `System locked menus` audit
- update worker module/tests

Do not modify registration cutoff enforcement here.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase C1. Do not implement the next phase.

```

## Phase C2 — Verify cutoff server enforcement

### Prompt

```text
You are working in the IMeal repository. Implement only Phase C2 — Verify cutoff server enforcement. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Add boundary tests:

before cutoff → accepted
at cutoff     → rejected
after cutoff  → rejected

Timezone must remain:

Asia/Ho_Chi_Minh


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase C2. Do not implement the next phase.

```

## Phase C3 — Align no-show time

### Prompt

```text
You are working in the IMeal repository. Implement only Phase C3 — Align no-show time. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Current official processing time is 13:45, but one inner guard allows processing from 13:30.

Unify all behavior to 13:45.

Boundary tests:

13:44:59 → reject/skip
13:45:00 → eligible


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase C3. Do not implement the next phase.

```

## Phase C4 — Worker Nest structured logging

### Prompt

```text
You are working in the IMeal repository. Implement only Phase C4 — Worker Nest structured logging. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Port the API structured Nest logger behavior to the worker.

Worker Nest logs should preserve safe:
- message
- context
- event
- service
- release

Do not expose secrets or raw stack data unnecessarily.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase C4. Do not implement the next phase.

```

# Track D — Push delivery reliability

## Phase D1 — Characterize current push state machine

### Prompt

```text
You are working in the IMeal repository. Implement only Phase D1 — Characterize current push state machine. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Test-only phase.

Lock existing behavior for:

PENDING → PROCESSING
stale PROCESSING → reclaim
revoked device → FAILED
success → SENT
temporary error → PENDING
permanent error → FAILED

Do not refactor production code yet.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase D1. Do not implement the next phase.

```

## Phase D2 — Separate DB claim transaction

### Prompt

```text
You are working in the IMeal repository. Implement only Phase D2 — Separate DB claim transaction. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Refactor the claim phase so the database transaction only:
- claims rows
- validates ownership/state
- commits

Return an immutable claimed batch.

Do not call Expo inside this transaction.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase D2. Do not implement the next phase.

```

## Phase D3 — Move Expo network call outside transaction

### Prompt

```text
You are working in the IMeal repository. Implement only Phase D3 — Move Expo network call outside transaction. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Target flow:

claim
→ commit
→ Expo API
→ persist provider result

Keep retry semantics unchanged.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase D3. Do not implement the next phase.

```

## Phase D4 — CAS result persistence

### Prompt

```text
You are working in the IMeal repository. Implement only Phase D4 — CAS result persistence. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Persist provider results using compare-and-set semantics.

Example:

UPDATE ...
WHERE id = ?
  AND status = PROCESSING
  AND claim/version matches

Add a `claimToken` migration only if needed.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase D4. Do not implement the next phase.

```

## Phase D5 — Push concurrency regression tests

### Prompt

```text
You are working in the IMeal repository. Implement only Phase D5 — Push concurrency regression tests. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Cover:

worker A claims
worker B cannot double-send
stale worker result cannot overwrite newer state
provider timeout does not keep a DB transaction open


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase D5. Do not implement the next phase.

```

# Track E — Location/GPS invariants

## Phase E1 — Detect overlapping active policies

### Prompt

```text
You are working in the IMeal repository. Implement only Phase E1 — Detect overlapping active policies. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Stop silently selecting the newest active policy.

Expected behavior:

0 active policies → unavailable
1 active policy   → valid
>1 active policy  → configuration ambiguity / fail closed

Remove `take: 1` behavior that hides overlap.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase E1. Do not implement the next phase.

```

## Phase E2 — Prevent overlap on admin write path

### Prompt

```text
You are working in the IMeal repository. Implement only Phase E2 — Prevent overlap on admin write path. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Before saving/updating a policy:
- query policies for the same location
- check effective-time intersection
- reject overlap

Suggested error code:

LOCATION_POLICY_OVERLAP


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase E2. Do not implement the next phase.

```

## Phase E3 — Make policy writes concurrency-safe

### Prompt

```text
You are working in the IMeal repository. Implement only Phase E3 — Make policy writes concurrency-safe. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Prevent this race:

request A checks → no overlap
request B checks → no overlap
A writes
B writes

Use transaction locking or advisory locking.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase E3. Do not implement the next phase.

```

## Phase E4 — Evaluate DB-level enforcement

### Prompt

```text
You are working in the IMeal repository. Implement only Phase E4 — Evaluate DB-level enforcement. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Separate migration phase.

Evaluate a PostgreSQL exclusion/range constraint.

If too invasive for staging:
- keep the service-level lock for staging
- defer DB constraint to production hardening


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase E4. Do not implement the next phase.

```

## Phase E5 — Roster overlap audit

### Prompt

```text
You are working in the IMeal repository. Implement only Phase E5 — Roster overlap audit. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

This is an audit-only phase. Do not change runtime behavior or production code unless the contract explicitly asks for a test artifact.

PHASE CONTRACT
Audit-only phase.

Check whether roster import/update can create:

2 active assignments for the same user at the same instant

Report and test before changing behavior.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase E5. Do not implement the next phase.

```

## Phase E6 — Prevent roster assignment overlap

### Prompt

```text
You are working in the IMeal repository. Implement only Phase E6 — Prevent roster assignment overlap. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Only implement if E5 confirms the gap.

Do not combine this with LocationPolicy work.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase E6. Do not implement the next phase.

```

# Track F — Local developer experience / SMTP

## Phase F1 — Make Gmail credentials optional in development Compose

### Prompt

```text
You are working in the IMeal repository. Implement only Phase F1 — Make Gmail credentials optional in development Compose. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Production remains fail-closed.

Local Compose should not require:
- `OTP_SMTP_USERNAME`
- `OTP_SMTP_PASSWORD`
- `OTP_SMTP_FROM`

just to boot the stack.

Do not weaken production environment validation.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase F1. Do not implement the next phase.

```

## Phase F2 — Explicit local OTP delivery behavior

### Prompt

```text
You are working in the IMeal repository. Implement only Phase F2 — Explicit local OTP delivery behavior. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Choose one local development behavior:

Option A:
- Mailpit

Option B:
- console/test provider

Option C:
- worker reports `CONFIGURATION` until credentials are supplied

Recommended: Mailpit if the team wants local end-to-end OTP testing.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase F2. Do not implement the next phase.

```

## Phase F3 — Local Compose smoke

### Prompt

```text
You are working in the IMeal repository. Implement only Phase F3 — Local Compose smoke. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Regression flow:

copy .env.example
→ docker compose config
→ docker compose up

No Google credential should be required for a normal local boot.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase F3. Do not implement the next phase.

```

# Track G — GitHub/release governance

## Phase G1 — Merge current PR cleanly

### Prompt

```text
You are working in the IMeal repository. Implement only Phase G1 — Merge current PR cleanly. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Merge the current PR’s exact green head into `deploy/develop` through a reviewable PR/merge.

This is the integration step only; it must not promote any temporary/worktree branch (including `deploy-develop-2`) directly to `deploy/staging`. Staging promotion is Phase G5 and must source `deploy/develop`.

EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase G1. Do not implement the next phase.

```

## Phase G2 — Enable protection for `deploy/develop`

### Prompt

```text
You are working in the IMeal repository. Implement only Phase G2 — Enable protection for `deploy/develop`. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

This phase may require GitHub repository settings rather than application-code edits. Do not create fake code changes to represent a repository setting.

PHASE CONTRACT
GitHub Settings:

- Require pull request
- Require 1 approval
- Dismiss stale approvals
- Block force pushes
- Block deletion
- Require:

staging-readiness / Secretless qualification (disposable PostgreSQL)

No workflow-code changes in this phase.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase G2. Do not implement the next phase.

```

## Phase G3 — Protect `deploy/staging`

### Prompt

```text
You are working in the IMeal repository. Implement only Phase G3 — Protect `deploy/staging`. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

This phase may require GitHub repository settings rather than application-code edits. Do not create fake code changes to represent a repository setting.

PHASE CONTRACT
Require:
- PR-based changes
- same secretless qualification
- no direct pushes


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase G3. Do not implement the next phase.

```

## Phase G4 — Configure `staging` environment

### Prompt

```text
You are working in the IMeal repository. Implement only Phase G4 — Configure `staging` environment. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

This phase may require GitHub repository settings rather than application-code edits. Do not create fake code changes to represent a repository setting.

PHASE CONTRACT
Configure:
- at least one required reviewer
- deployment branch = `deploy/staging`
- required staging secrets/variables


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase G4. Do not implement the next phase.

```

## Phase G5 — Reconcile staging divergence

### Prompt

```text
You are working in the IMeal repository. Implement only Phase G5 — Reconcile staging divergence. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
After G1, reconcile the existing divergence by opening and merging an explicit reviewable PR:

`deploy/develop` (the exact green head produced by G1)
→ `deploy/staging`

Do not force-reset either branch or discard intentional staging-only commits. Resolve the divergence explicitly while preserving commit lineage. The merged PR’s source MUST be that exact green `deploy/develop` head; never use `deploy-develop-2` as the staging-promotion source.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase G5. Do not implement the next phase.

```

## Phase G6 — Protected staging qualification

### Prompt

```text
You are working in the IMeal repository. Implement only Phase G6 — Protected staging qualification. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
After the exact release lineage is merged to `deploy/staging`:

- run protected staging qualification
- retain qualification artifacts/evidence

This is the real staging readiness gate.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase G6. Do not implement the next phase.

```

# Track H — Legacy delegation cleanup

## Phase H1 — Inventory active delegation references

### Prompt

```text
You are working in the IMeal repository. Implement only Phase H1 — Inventory active delegation references. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

This is an audit-only phase. Do not change runtime behavior or production code unless the contract explicitly asks for a test artifact.

PHASE CONTRACT
Classify every reference as:

runtime active
historical-read
schema-only
dead
migration dependency

Audit only.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase H1. Do not implement the next phase.

```

## Phase H2 — Mark historical-only contracts

### Prompt

```text
You are working in the IMeal repository. Implement only Phase H2 — Mark historical-only contracts. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Clearly mark these as historical-only where appropriate:

PickupDelegation
PickupSession
PROXY
DELEGATION_*

Do not drop DB structures yet.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase H2. Do not implement the next phase.

```

## Phase H3 — Remove unreachable delegation notification producers

### Prompt

```text
You are working in the IMeal repository. Implement only Phase H3 — Remove unreachable delegation notification producers. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
If no active producer emits:

DELEGATION_REQUESTED
DELEGATION_ACCEPTED
DELEGATION_DECLINED
DELEGATION_REVOKED
PROXY_PICKUP_COMPLETED

remove producer-side dead code first.

Keep reader compatibility for historical rows.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase H3. Do not implement the next phase.

```

## Phase H4 — Decide historical retention migration

### Prompt

```text
You are working in the IMeal repository. Implement only Phase H4 — Decide historical retention migration. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

This is primarily a decision/documentation phase. Do not silently implement the next architectural step.

PHASE CONTRACT
Choose later:

keep legacy tables permanently

or:

archive
→ migrate historical evidence
→ drop legacy schema

Do not perform this before staging stabilization.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase H4. Do not implement the next phase.

```

# Track I — API topology cleanup

## Phase I1 — Inventory canonical vs alias routes

### Prompt

```text
You are working in the IMeal repository. Implement only Phase I1 — Inventory canonical vs alias routes. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

This is an audit-only phase. Do not change runtime behavior or production code unless the contract explicitly asks for a test artifact.

PHASE CONTRACT
Build a matrix:

route
client users
canonical?
legacy?

No code changes.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase I1. Do not implement the next phase.

```

## Phase I2 — Freeze a canonical API convention

### Prompt

```text
You are working in the IMeal repository. Implement only Phase I2 — Freeze a canonical API convention. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

This is primarily a decision/documentation phase. Do not silently implement the next architectural step.

PHASE CONTRACT
Example future convention:

/api/v1/auth/*
/api/v1/me/*
/api/v1/kitchen/*
/api/v1/admin/*

Documentation/decision only.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase I2. Do not implement the next phase.

```

## Phase I3 — Migrate auth routes only

### Prompt

```text
You are working in the IMeal repository. Implement only Phase I3 — Migrate auth routes only. Do not start any later phase.

Start from the current branch HEAD. First inspect the existing route/controller/client/test structure and the decision produced by Phase I2. Do not assume old audit file paths are still exact.

PHASE CONTRACT
Goal: migrate only the auth domain to the canonical API convention chosen in Phase I2.

Scope:
- auth request/verify/me/logout routes
- auth client callers
- compatibility alias only if Phase I2 explicitly requires a temporary alias
- focused auth route-contract tests

Do not touch registrations, notifications, check-in, or admin routes in this phase.

Done when:
- auth uses the Phase I2 canonical convention
- all auth callers use the same canonical paths
- route-contract tests cover canonical paths and any intentionally retained alias
- auth tests and relevant typechecks pass

EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase I3. Do not implement the next phase.

```

## Phase I4 — Migrate registration routes only

### Prompt

```text
You are working in the IMeal repository. Implement only Phase I4 — Migrate registration routes only. Do not start any later phase.

Start from the current branch HEAD. First inspect the existing route/controller/client/test structure and the decision produced by Phase I2. Do not assume old audit file paths are still exact.

PHASE CONTRACT
Goal: migrate only registration-related routes to the canonical API convention chosen in Phase I2.

Scope:
- registration API routes and their client callers
- focused route-contract tests
- compatibility alias only if Phase I2 explicitly requires one

Do not touch auth, notifications, check-in, or admin routes in this phase.

Done when:
- registration server routes and client callers agree on the canonical paths
- focused route-contract tests pass
- relevant API/mobile typechecks pass

EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase I4. Do not implement the next phase.

```

## Phase I5 — Migrate notification routes only

### Prompt

```text
You are working in the IMeal repository. Implement only Phase I5 — Migrate notification routes only. Do not start any later phase.

Start from the current branch HEAD. First inspect the existing route/controller/client/test structure and the decision produced by Phase I2. Do not assume old audit file paths are still exact.

PHASE CONTRACT
Goal: migrate only notification-related routes to the canonical API convention chosen in Phase I2.

Scope:
- notification API routes and mobile callers
- focused route-contract tests
- compatibility alias only if Phase I2 explicitly requires one

Do not touch auth, registrations, check-in, or admin routes in this phase.

Done when:
- notification routes and callers agree on the canonical paths
- focused tests pass
- relevant API/mobile typechecks pass

EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase I5. Do not implement the next phase.

```

## Phase I6 — Migrate check-in routes only

### Prompt

```text
You are working in the IMeal repository. Implement only Phase I6 — Migrate check-in routes only. Do not start any later phase.

Start from the current branch HEAD. First inspect the existing route/controller/client/test structure and the decision produced by Phase I2. Do not assume old audit file paths are still exact.

PHASE CONTRACT
Goal: migrate only check-in routes to the canonical API convention chosen in Phase I2.

Scope:
- staff self-check-in and any kitchen/read-side check-in routes that remain active
- client callers
- focused route-contract tests
- compatibility alias only if Phase I2 explicitly requires one

Do not reintroduce delegation/proxy pickup behavior.

Do not touch auth, registrations, notifications, or admin routes in this phase.

Done when:
- check-in routes and callers agree on the canonical paths
- no delegation route is revived by the migration
- focused tests and relevant typechecks pass

EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase I6. Do not implement the next phase.

```

## Phase I7 — Migrate admin routes only

### Prompt

```text
You are working in the IMeal repository. Implement only Phase I7 — Migrate admin routes only. Do not start any later phase.

Start from the current branch HEAD. First inspect the existing route/controller/client/test structure and the decision produced by Phase I2. Do not assume old audit file paths are still exact.

PHASE CONTRACT
Goal: migrate only admin routes to the canonical API convention chosen in Phase I2.

Scope:
- active admin endpoints
- admin client callers
- focused route-contract tests
- compatibility alias only if Phase I2 explicitly requires one

Do not touch auth, registrations, notifications, or check-in routes in this phase.

Done when:
- active admin routes and callers agree on the canonical paths
- focused tests pass
- relevant API/mobile/admin typechecks pass

EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase I7. Do not implement the next phase.

```

# Track J — Toolchain/repo hygiene

## Phase J1 — Align TypeScript version

### Prompt

```text
You are working in the IMeal repository. Implement only Phase J1 — Align TypeScript version. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Update TypeScript only.

Do not combine with:
- ESLint
- Vitest
- Expo
- Node/Yarn migrations


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase J1. Do not implement the next phase.

```

## Phase J2 — Validate Node/Yarn parity

### Prompt

```text
You are working in the IMeal repository. Implement only Phase J2 — Validate Node/Yarn parity. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

PHASE CONTRACT
Standardize and verify:

Node 24
Yarn 4.18

across the repository and CI.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase J2. Do not implement the next phase.

```

## Phase J3 — Change GitHub default branch

### Prompt

```text
You are working in the IMeal repository. Implement only Phase J3 — Change GitHub default branch. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

This phase may require GitHub repository settings rather than application-code edits. Do not create fake code changes to represent a repository setting.

PHASE CONTRACT
Current GitHub default branch:

master

The audited branch is roughly 263 commits ahead.

After `deploy/develop` becomes the stable integration branch:
- change repository default branch
- verify default PR target
- verify branch/ruleset settings


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase J3. Do not implement the next phase.

```

## Phase J4 — Clean stale branches

### Prompt

```text
You are working in the IMeal repository. Implement only Phase J4 — Clean stale branches. Do not start any later phase.

Start from the current branch HEAD. Inspect the relevant implementation, nearby tests, package scripts, and existing conventions before editing. The source audit SHA is historical context only; do not reset the branch to it.

This phase may require GitHub repository settings rather than application-code edits. Do not create fake code changes to represent a repository setting.

PHASE CONTRACT
Only after confirming:
- no active PR dependency
- no release dependency
- no rollback dependency

Do not combine stale-branch deletion with the default-branch change.


EXECUTION RULES
1. Make the smallest reviewable diff that satisfies the contract above.
2. Preserve behavior outside this phase.
3. Do not combine unrelated cleanup, refactors, dependency upgrades, migrations, UI redesign, or route changes.
4. Reuse existing helpers/patterns when they already fit; do not create parallel abstractions without need.
5. Add or update focused tests only when the phase contract explicitly requires test coverage or existing tests must change with the implementation. Do not run those tests.
6. Do not run tests, typecheck, lint, build, smoke tests, or any other verification command after editing. You may inspect existing scripts/configuration only to understand the repository and to describe how the user can test the change.
7. If the phase depends on an earlier phase and that prerequisite is missing, stop and report the prerequisite instead of widening scope.
8. For audit-only or decision-only phases, do not turn the phase into an implementation task. Inspect only what the contract requires and report concrete findings.

MANUAL TEST / VALIDATION REPORT BEFORE STOPPING
- Do not perform verification yourself.
- Convert every relevant `Done when`, `Review checkpoint`, invariant, boundary case, regression expectation, or configuration requirement into manual steps for the user.
- For each manual check, report: prerequisite/setup, exact user action/request, expected result, and where to observe the result (UI, HTTP response, DB state, logs, GitHub settings, or configuration output).
- Include the normal path and the important failure/boundary paths relevant to this phase.
- If the phase is audit-only, separate confirmed findings from hypotheses and explain how the user can manually confirm the finding.
- If a requirement cannot be meaningfully validated by hand, say so explicitly and describe the closest manual inspection/check available; do not silently run an automated test instead.
- Do not say `tests pass`, `verified`, `phase passed`, or similar. Verification belongs to the user.

RETURN
- files changed (or `none` for audit/configuration-only phases)
- concise implementation/configuration/finding summary
- manual test/validation checklist, ordered from simplest/safest to more invasive cases
- expected result for each manual check
- any setup, test data, environment, or reset/cleanup notes needed
- any risk or follow-up that must be handled in a later phase

STOP after reporting Phase J4. Do not implement the next phase.

```

# Recommended execution order

Use the same staging-first order from the audited plan, but execute one prompt at a time:

```text
A1.1 -> A1.2 -> A1.3 -> A1.4 -> A1.5 -> A2 -> A3 -> A5 -> A7
B1 -> B2 -> B3 -> B4
C1 -> C2 -> C3 -> C4
G1 -> G2 -> G3 -> G4 -> G5 -> G6

Then after real staging is running:
D1 -> D2 -> D3 -> D4 -> D5
E1 -> E2 -> E3 -> E4 -> E5 -> E6
F1 -> F2 -> F3

Long-term cleanup:
H1 -> H2 -> H3 -> H4
I1 -> I2 -> I3 -> I4 -> I5 -> I6 -> I7
J1 -> J2 -> J3 -> J4
```

Notes:

- A4 remains independent and can be inserted after A3 when notification networking is being touched.
- A6 is a product-support decision: do not enable production web CORS merely because the code can support it.
- E4 and H4 may legitimately end as a documented defer/decision rather than an implementation commit.
- F2 should preserve the audited recommendation: Mailpit is preferred when the team wants local end-to-end OTP testing.

# Commit/review protocol

After every phase: review the diff manually, confirm the verification evidence, commit that phase separately, then start a fresh agent session with the next prompt. Never ask one session to complete a whole track.
