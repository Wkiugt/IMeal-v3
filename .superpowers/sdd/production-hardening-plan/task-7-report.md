# Task 7 report — graceful shutdown coordination

## Status

COMPLETE — commit `578e7f6` (`feat: drain services gracefully on shutdown`). Task 8 remains not started.

## Scope

- Added API and worker `ShutdownCoordinator` state machines with idempotent drain transitions, in-flight registration/release, bounded waits, and structured drained/timeout/completed shutdown events.
- Registered Nest `SIGTERM`/`SIGINT` shutdown hooks in both bootstraps; Prisma remains owned by its existing Nest lifecycle hooks, and no early `process.exit` path was added.
- API HTTP requests, including long-lived SSE responses, now hold an in-flight registration until completion; new non-health requests are rejected after drain begins while health probes remain available to report draining with HTTP 503.
- Worker cron entrypoints register in-flight work and reject new callbacks during drain. Existing claim, retry, stale-recovery, and success bookkeeping paths remain unchanged; uncompleted work is not marked successful during shutdown.
- Worker scheduler readiness is marked only after `app.listen` completes. API and worker health services consume coordinator drain state for immediate readiness failure.
- Documented the validated `SHUTDOWN_TIMEOUT_SECONDS` 1–300 second bound in `.env.example`.
- No Compose/Caddy or migration-gate changes were made; those remain Task 8/9 boundaries.

## Verification

- `yarn workspace @imeal/api test --run src/common/shutdown-coordinator.spec.ts src/common/http-logging.interceptor.spec.ts src/health` — 4 files, 14/14 passed.
- `yarn workspace @imeal/worker test --run src/shutdown-coordinator.spec.ts src/health` — 3 files, 10/10 passed.
- `yarn workspace @imeal/worker test --run src/cutoff-worker.service.spec.ts src/pickup-worker.service.spec.ts src/no-show-worker.service.spec.ts src/notification-dispatch.service.spec.ts src/otp-delivery-worker.service.spec.ts` — 5 files, 75/75 passed.
- `yarn workspace @imeal/api build` — passed.
- `yarn workspace @imeal/worker build` — passed.

## Task 6 re-review

- Final Task 6 range `4fdff77..1b0cc17` was re-reviewed clean before Task 7 execution.
- Spec compliance: PASS.
- Quality and maintainability: PASS.
- Prior request-correlation and provider-code findings are addressed; Task 6 is safe for Task 7.

## Deferred boundaries

Task 8 production Compose/Caddy stop grace and Task 9 migration-gate integration were not started. Database-backed deployment/e2e prerequisites remain outside this local Task 7 verification.
