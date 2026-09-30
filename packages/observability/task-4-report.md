# Task 4 worker metrics report

## Scope

Task 4 adds the worker-owned application metrics registry and the worker-origin `GET /metrics` controller. Worker lifecycle seams record OTP delivery outcomes and scheduled-job terminal statuses. The endpoint fails closed unless every contract metric has a fresh, validated source series.

## Earlier focused verification

- `yarn workspace @imeal/observability test --run test/metrics.test.ts` — 1 file, 16 tests passed.
- `yarn workspace @imeal/observability build` — passed.
- `yarn workspace @imeal/worker build` — passed.
- `yarn workspace @imeal/worker test --run src/metrics/metrics.service.spec.ts src/metrics/metrics.controller.spec.ts` — 2 files, 9 tests passed.
- `yarn workspace @imeal/worker test --run src/otp-delivery-worker.service.spec.ts` — 55 tests passed, including raw prepass terminal finalization and fallback outbox wiring.
- `yarn workspace @imeal/worker test --run src/metrics/metrics.service.spec.ts src/metrics/metrics.controller.spec.ts src/otp-delivery-worker.service.spec.ts src/notification-dispatch.service.spec.ts src/cutoff-worker.service.spec.ts src/pickup-worker.service.spec.ts src/no-show-worker.service.spec.ts` — 7 files, 87 tests passed.
- `yarn workspace @imeal/worker test:e2e --run test/app.e2e-spec.ts` — 5 tests passed; the complete bound fixture returns all 23 contract names with HTTP 200 and safe output, incomplete `/metrics` remains HTTP 503, `/health/live` returns HTTP 200 with request-id, and `/health/ready` preserves HTTP 503 scheduler-down semantics.

## Boundary evidence

- OTP metrics are emitted only at the real provider-send, persisted retry, persisted terminal-failure, and raw outbox-finalization boundaries. Provider payloads, destinations, codes, and arbitrary provider error text are not metric labels.
- Outbox age reads only the OTP delivery outbox (`status`, `nextAttemptAt`, `createdAt`) and orders all pending rows by `createdAt`. Empty pending state is a fresh numeric zero; unavailable, malformed, future, or stale collector state is not converted to zero.
- Worker run labels are fixed to the approved seven job names and three terminal statuses. Persisted `JobRun` history uses explicit scheduler prefixes (including `no_show_worker_`); jobs without `JobRun` rows use only observed successful lifecycle completions. Missing history removes old local and worker-source gauges; query failure is a per-job collector failure.
- API, worker, and authoritative snapshots retain their approved source identities and freshness metadata. At endpoint evaluation, observed timestamps are aged against each contract row's stale-after interval; missing, stale, collector-failure, or incomplete input returns non-2xx. Snapshot validation rejects unapproved labels/evidence and sensitive text, and complete-fixture tests cover all 23 contract names.
- Worker bootstrap publishes local application snapshots only when real runtime release/evidence-digest metadata is configured; no sample or credential is fabricated. The worker publishes its application snapshot on the 30-second interval (`APPLICATION_OBSERVATION_INTERVAL_SECONDS`). `/metrics` is registered only on the worker application. No API controller, Caddy/public route, auth bypass, credential, provider endpoint, broker, or synthetic external metric source is added.

These checks do not claim staging approval.

## Runtime wiring update

- Commit `22e5b25` adds the private structured API-to-worker snapshot
  transport; the worker accepts application snapshots without exposing a
  public API metrics route.
- Commit `85bdf01` adds the authoritative collector orchestrator and commit
  `199eab2` registers its worker lifecycle. The runtime performs an initial
  collection, then uses a fixed 60-second schedule and stops on shutdown.
- Optional authoritative providers and protected runtime configuration fail
  closed when absent. This report records repository wiring only; it does not
  claim real provider observations or 23-metric runtime qualification.

## Task8 latest verification note

An earlier repository-only rerun before c021e37 observed 4 of 5 tests passing:
the complete-bound `/metrics` fixture returned HTTP 503 where the test expects
HTTP 200. This pre-fix observation was recorded rather than bypassed; it was
not staging evidence and did not establish all 23 metrics as real runtime
observations. After c021e37, the current repository-only rerun passes 5/5
tests; the complete-bound fixture returns HTTP 200. No credentials or backfill
were used, and this does not establish staging qualification.
