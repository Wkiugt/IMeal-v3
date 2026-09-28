# SDD ledger — plan: docs/superpowers/plans/2026-09-28-production-hardening-plan.md

## Plan execution boundary

The production-hardening plan is being executed one task at a time. Completed work is recorded below; later tasks remain explicitly unstarted until authorized. The approved scope keeps shutdown, Compose/deployment, and migration-gate work separate from service/runtime tasks.

## Task 1 completion

- Task 1: complete (commits `f1a6a77..692bc7f`, review clean).
- Report: `.superpowers/sdd/production-hardening-plan/task-1-report.md`.
- Added the shared observability package primitives and migration-evidence reader.
- Focused observability tests: 14/14 passed; observability build passed; immutable Yarn install passed; scoped formatting/diff checks passed.
- Review: spec compliance PASS; quality PASS; safe for later tasks.
- Deferred nonblocking note: later integrations must respect the explicit stable-ID allowlist and must not reintroduce broad key-suffix heuristics.

## Task 2 completion

- Task 2: complete (commits `38582b4..bc82360`, review clean).
- Report: `.superpowers/sdd/production-hardening-plan/task-2-report.md`.
- Added fail-closed API/worker environment validation and OTP/provider configuration boundaries.
- Focused API environment tests: 51/51 passed; worker environment tests: 51/51 passed; API/worker typechecks passed; scoped formatting/diff checks passed.
- Fix round 1 and re-review complete; spec compliance PASS; quality PASS; safe for Task 3.

## Task 3 completion

- Task 3: complete (commits `71c257c..20e3351`, review clean).
- Report: `.superpowers/sdd/production-hardening-plan/task-3-report.md`.
- Implemented the API Prisma lifecycle boundary with bounded disconnect handling, deterministic timer cleanup, safe failure logging, and provider allocation assertions.
- Prisma lifecycle spec: 5/5 passed; API unit suite: 243/243 passed; API typecheck passed; scoped formatting/diff checks passed.
- No `new PrismaClient` remains under `apps/api/src` outside the lifecycle service.
- Re-review: prior findings addressed; spec compliance PASS; quality PASS; safe for Task 4.

## Task 4 completion

- Task 4: complete (commit `33b3e77`, reviewer clean).
- Report: `.superpowers/sdd/production-hardening-plan/task-4-report.md`.
- Implemented the worker Prisma lifecycle boundary and shared provider ownership.
- Worker unit suite: 79/79 passed; lifecycle spec: 5/5 passed; worker typecheck passed; worker e2e smoke app test passed.
- Five database-backed worker e2e tests were skipped because `DATABASE_URL` was unavailable.
- Review: spec compliance PASS; quality PASS; nonblocking caveat that an explicit connect-timeout test remains absent; safe for Task 5.

## Task 5 completion

- Task 5: complete (commit `99c3b2d`, reviewer clean).
- Report: `.superpowers/sdd/production-hardening-plan/task-5-report.md`.
- Added unauthenticated API and worker `/health/live` and `/health/ready` endpoints with request IDs, bounded DB probes, migration evidence checks, safe 503 bodies, and lifecycle/scheduler/drain readiness state.
- API health tests: 8/8; worker health tests: 7/7; API/worker typechecks passed; full API suite: 251/251; full worker suite: 86/86; scoped formatting/diff checks passed.
- `@imeal/observability` is declared as an API/worker workspace dependency.
- Review: spec compliance PASS; quality PASS; safe for Task 6.
- API database-backed e2e setup was unavailable in the verification environment and remains a nonblocking caveat.

## Task 6 completion

- Task 6 implementation: complete (commit `4fdff77`).
- Report: `.superpowers/sdd/production-hardening-plan/task-6-report.md`.
- Added request-context storage, validated request IDs, response correlation, safe API HTTP success/error logs, and exception-filter correlation without changing response envelopes.
- Added API/worker structured logger bootstrap providers and migrated worker scheduled jobs plus raw API/worker operational error logging to explicit observability allowlist fields.
- No arbitrary identifier fields or raw error/provider payloads are emitted; worker job logs use only approved `jobName`, `jobRunId`, `count`, `total`, `attempt`, `retry`, `providerCode`, and `errorCode` fields.

## Task 6 review fix round 1

- Review verdict: FAIL; fix round 1 applied after commit `4fdff77`.
- API auth OTP/logout correlation now prefers interceptor-established `request.requestId`; all fallback candidates are passed through `resolveRequestId`, and malformed IDs are never persisted.
- `ApiExceptionFilter` validates `request.requestId`/`request.id` candidates through `resolveRequestId` before response envelopes, headers, and exception logs.
- Notification and OTP provider-code extraction maps only bounded known provider/network/HTTP codes and returns `UNKNOWN` for arbitrary payload-like values.
- Replaced vacuous `Logger.prototype` spies with injected/captured `StructuredLogger` assertions; added malformed auth/filter and provider-code redaction regressions.
- No exception class/message field was added; the approved Task 6 contract requires safe event/errorCode metadata rather than raw exception serialization, so this omission is intentional and nonblocking.
- Focused API review-fix tests: 16/16; focused worker review-fix tests: 70/70; full API suite: 264/264; full worker suite: 88/88; API/worker typechecks passed; scoped Prettier check and `git diff --check` passed.
- Task 6 clean re-review: PASS across final range `4fdff77..1b0cc17`; prior findings are addressed; spec compliance and quality are PASS; safe for Task 7.

## Task 7 completion

- Task 7: complete (initial commit `578e7f6`; review fix 1 `ef745fe`; review fix 2 `a17f65d`; report `.superpowers/sdd/production-hardening-plan/task-7-report.md`).
- Explicit SIGTERM/SIGINT boundaries begin drain, wait bounded in-flight work, wait for listen readiness, and invoke `app.close()` only afterward; successful close disposes listeners, failed close reports safely and permits retry.
- Added signal order/idempotence integration tests proving pre-listen ordering, health-visible draining before app close/Prisma teardown, listener cleanup, close rejection/retry, and mixed-signal coalescing.
- API focused shutdown/health tests: 14/14; worker focused shutdown/health tests: 13/13; full API suite: 271/271; full worker suite: 94/94; API/worker builds and typechecks passed; scoped Prettier and `git diff --check` passed.
- API bounded HTTP/SSE and worker cron/provider admission, immediate health drain readiness, and post-listen scheduler readiness remain covered.
- Review status: fix rounds 1–2 complete; spec compliance PASS; quality PASS; safe to stop before Task 8.

## Task 8 completion

- Task 8: complete (commit `0a88169`, `feat: define private production Compose boundary`).
- Report: `.superpowers/sdd/production-hardening-plan/task-8-report.md`.
- Added the fail-closed production Compose/Caddy boundary: only Caddy host ports, private `edge`/`app`/`data` networks, required production values, immutable digest image references, SCRAM PostgreSQL/PgBouncer, private MinIO setup, persistent TLS storage, and no public `/storage/*` route.
- API/worker depend on successful `migration-gate` completion and mount shared migration evidence read-only; the migration-gate implementation remains explicitly deferred to Task 9.
- Hardened API/worker/Admin Web images with immutable bases, built-runtime artifact copies, non-root runtimes, Prisma generation preservation, and the Admin Web port-80 compatibility contract. Added focused rendered Compose/static checks and Docker context exclusions.
- Verification passed: `node scripts/verify-production-boundary.mjs`; fail-closed Compose rendering without production variables; rendered `config`/`config --images`; Caddy `validate`; API/worker/Admin Web image builds and non-root runtime smoke checks; and `git diff --check`.
- Scope note: no production services were started with real credentials. The unstaged `apps/worker/tsconfig.build.tsbuildinfo` generated-metadata change was inspected and left untouched as possible concurrent user work. The pre-existing untracked production/staging plan files remain unstaged and unmodified.

## Remaining tasks

- Task 9: not started (migration gate integration).
- Later staging/documentation/operational tasks remain unstarted.
