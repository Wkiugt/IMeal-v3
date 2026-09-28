# Task 7 report — graceful shutdown coordination

## Status

COMPLETE — initial implementation `578e7f6` plus review fix `ef745fe` (`fix: drain before Nest teardown on signals`). Task 8 remains not started.

## Scope

- Added API and worker `ShutdownCoordinator` state machines with idempotent drain transitions, in-flight registration/release, bounded waits, and structured drained/timeout/completed shutdown events.
- Registered explicit idempotent `SIGTERM`/`SIGINT` handlers before listening. Each signal begins drain, waits for the bounded in-flight window, and only then invokes `app.close()`; duplicate signals share one close promise.
- Prisma remains owned by its existing Nest lifecycle hooks, and the late `beforeApplicationShutdown()` coordinator hook is retained as an idempotent fallback rather than the initial drain boundary.
- Worker scheduler readiness is marked only after `app.listen` completes. API and worker health services consume coordinator drain state for immediate readiness failure.
- API HTTP requests, including long-lived SSE responses, hold in-flight registrations until completion; new non-health requests are rejected after drain while health probes remain available for HTTP 503.
- Worker cron entrypoints register in-flight work and reject new callbacks during drain; claim/retry/stale-recovery/success bookkeeping semantics remain unchanged.
- Documented the validated `SHUTDOWN_TIMEOUT_SECONDS` 1–300 second bound in `.env.example`.
- No Compose/Caddy or migration-gate changes were made; those remain Task 8/9 boundaries.

## Verification

- `yarn workspace @imeal/api test --run src/common/shutdown-coordinator.spec.ts src/health` — 3 files, 12/12 passed.
- `yarn workspace @imeal/worker test --run src/shutdown-coordinator.spec.ts src/health` — 3 files, 11/11 passed.
- `yarn workspace @imeal/api test --run` — 28 files, 269/269 passed.
- `yarn workspace @imeal/worker test --run` — 10 files, 92/92 passed.
- `yarn workspace @imeal/api build` — passed.
- `yarn workspace @imeal/worker build` — passed.
- API and worker `tsc --noEmit -p tsconfig.json` — passed.
- Scoped Prettier check — passed; `git diff --check` — passed.

## Review fix round 1

- Blocker fixed: the signal boundary now calls `beginDrain()` before any Nest `app.close()` lifecycle teardown, so in-flight HTTP/SSE or worker job/provider work drains before Prisma disconnect.
- `SIGTERM` and `SIGINT` use one idempotent shared close promise, and repeated same/different signals cannot invoke `app.close()` more than once.
- Added API and worker integration/order tests that emit both signals with registered in-flight work, prove health-visible drain state before close, prove app-close/Prisma teardown ordering, and verify handler idempotence.

## Task 6 re-review

- Final Task 6 range `4fdff77..1b0cc17` was re-reviewed clean before Task 7 execution.
- Spec compliance: PASS.
- Quality and maintainability: PASS.
- Prior request-correlation and provider-code findings are addressed; Task 6 is safe for Task 7.

## Deferred boundaries

Task 8 production Compose/Caddy stop grace and Task 9 migration-gate integration were not started. Database-backed deployment/e2e prerequisites remain outside this local Task 7 verification.
