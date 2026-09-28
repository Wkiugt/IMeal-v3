# Task 6 report — request IDs, error correlation, and structured logs

## Status

Complete. Task 7 was not started.

## Implemented scope

- Added request-context storage and request-ID interceptor behavior using the shared UUIDv4 resolver and `x-request-id` contract.
- Added success/error HTTP structured logging with normalized routes, status, duration, release, and request ID fields.
- Preserved API error envelopes while correlating response headers, bodies, exception logs, and HTTP error logs.
- Added API and worker structured logger providers/bootstrap adapters.
- Migrated worker scheduled services and raw API/worker operational logging sites to stable event names and explicit observability allowlist fields.
- Worker job logs use only approved fields such as `jobName`, `jobRunId`, `count`, `total`, `attempt`, `retry`, `providerCode`, and `errorCode`; no arbitrary identifier fields or raw error/provider payloads are logged.
- Added focused request-context, request-ID, HTTP logging, and exception-filter tests.

## Verification

- Initial Task 6 focused API tests — 11/11 passed.
- Initial Task 6 focused worker tests — 17/17 passed.
- Initial API and worker typechecks passed.
- Initial full API suite — 262/262 passed.
- Initial full worker suite — 86/86 passed.
- `git diff --check` passed for the initial implementation.

The previously recorded API database-backed e2e setup caveat remains nonblocking; Task 6 verification was unit/type focused and did not start any database-dependent migration or deployment work.

## Review fix round 1

- Review verdict: FAIL; fixed malformed request-ID trust and provider-code leakage findings.
- API auth OTP/logout correlation now prefers the interceptor-established `request.requestId` and validates every fallback with `resolveRequestId`; malformed client IDs are never persisted.
- `ApiExceptionFilter` validates `request.requestId`/`request.id` candidates through `resolveRequestId` before response envelopes, headers, and exception logs.
- Notification and OTP provider-code extraction now maps only bounded known provider/network/HTTP codes and returns `UNKNOWN` for arbitrary payload-like values.
- Replaced vacuous `Logger.prototype` spies with injected/captured `StructuredLogger` assertions proving OTP/provider secrets and payload-like provider values are absent from logs.
- Added malformed auth/filter correlation regressions and provider-code redaction regressions.
- Focused API review-fix tests — 16/16 passed.
- Focused worker review-fix tests — 70/70 passed (notification dispatch, no-show, and OTP delivery).
- Full API suite — 264/264 passed.
- Full worker suite — 88/88 passed.
- API/worker typechecks passed after the fix round.
- Scoped Prettier check passed; `git diff --check` passed.

## Boundaries

No shutdown coordinator, Compose/production overlay, or migration-gate work was started. Task 7 remains not started.
