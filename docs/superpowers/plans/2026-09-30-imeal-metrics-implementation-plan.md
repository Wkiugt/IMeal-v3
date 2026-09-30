# IMeal metrics implementation plan

**Date:** 2026-09-30  
**Status:** Plan for execution after the remaining 23-row contract details receive named runtime/platform owner review.  
**Approval boundary:** D1–D9 in [`../specs/2026-09-29-imeal-metrics-contract-design.md`](../specs/2026-09-29-imeal-metrics-contract-design.md) are **APPROVED BY USER**. That approval authorizes implementation planning only; it does not make `STG-METRICS-01` pass, provision a target, create credentials, or grant release sign-off.

## Goal and non-goals

Implement the checked-in staging runtime-integration producer path for exactly these 23 names:

```text
imeal_http_requests_total
imeal_http_request_duration_seconds_bucket
imeal_auth_attempts_total
imeal_otp_delivery_total
imeal_otp_delivery_retries_total
imeal_otp_delivery_failures_total
imeal_otp_outbox_oldest_age_seconds
imeal_serving_confirm_total
imeal_serving_confirm_duration_seconds_bucket
imeal_idempotency_conflicts_total
imeal_worker_runs_total
imeal_worker_job_last_success_timestamp_seconds
imeal_worker_job_lag_seconds
imeal_postgres_connection_usage_ratio
imeal_postgres_transaction_errors_total
imeal_postgres_lock_waits_total
imeal_postgres_disk_usage_ratio
imeal_object_storage_capacity_bytes
imeal_object_storage_errors_total
imeal_backup_age_seconds
imeal_backup_checksum_failures_total
imeal_restore_test_failures_total
imeal_security_boundary_violations_total
```

The implementation MUST preserve the existing consumer and release boundary:

- Application/API/worker code emits only application metrics. PostgreSQL/PgBouncer, object storage, backup/restore, and security metrics come from their authoritative sources; application constants, zeros, or guessed approximations are forbidden.
- `/metrics` is an internal worker-origin endpoint only. Caddy and the public API MUST continue to return a non-success response for `/metrics`.
- Labels and enumerations are bounded and allowlisted; no request IDs, user IDs, emails, employee/location data, QR/session values, provider payloads, exception text, secrets, or PII may appear in labels or values.
- The existing alert names/thresholds and evidence gates remain authoritative. A green local test, a metric-name response, or a local collector does not qualify staging or release.
- No new Redis/Kafka/Kubernetes/broker is introduced. The API-to-worker application-metric transport must be an explicitly approved internal adapter/source, recorded in the 23-row contract before instrumentation.

Do not begin Tasks 2–6 until Task 1's row-level contract decision is recorded by the named runtime/platform owner. If a source or transport cannot produce a real value, leave that metric stale/unknown and fail the collector check; never synthesize a value.

## Repository evidence and interfaces to preserve

- `scripts/staging/runtime-integration.mjs:12-36` is the exact required-name list; `:196-249` requires every name from the internal worker origin; `:306-329` rejects successful public API metrics.
- `infra/staging/Caddyfile:22-27` intentionally returns 404 for public `/metrics`; the plan MUST NOT add a public route.
- `docs/superpowers/specs/2026-09-28-staging-readiness-design.md:394-432` defines observability purposes and initial alert policy.
- `infra/staging/alert-rules.yml:1-136` defines the checked-in alert expressions, owners/actions, and alert test route.
- `apps/api/src/common/http-logging.interceptor.ts:41-93` already owns one request/error lifecycle and normalized route; use it to avoid double-counting HTTP requests.
- `apps/api/src/auth/otp.service.ts`, `apps/api/src/auth/auth.controller.ts`, and their focused tests own authentication/OTP outcomes.
- `apps/api/src/pickup/pickup.service.ts:316-323` and `confirmPickup` own serving confirmation, idempotency replay, and conflict behavior; preserve its transaction boundaries.
- `apps/worker/src/otp-delivery-worker.service.ts`, `notification-dispatch.service.ts`, `notification-reminder.service.ts`, `cutoff-worker.service.ts`, `pickup-worker.service.ts`, and `no-show-worker.service.ts` own worker/provider/job lifecycle seams.
- `apps/api/src/app.module.ts:43-72` and `apps/worker/src/app.module.ts:30-64` are the provider/controller composition points.
- `packages/observability/src/index.ts` is the shared package entry point; its existing redaction and structured-logging primitives remain the common safety vocabulary.

## Implementation sequence

### Task 1 — Lock the concrete 23-row schema and source/transport decisions before code

**Files:**

- Modify `docs/superpowers/specs/2026-09-29-imeal-metrics-contract-design.md`.
- Add `packages/observability/src/metrics-contract.ts` and `packages/observability/test/metrics-contract.test.ts` only after the row decisions below are approved; these files encode the approved contract, not an invented producer.

**Work:**

1. Keep the user-approved D1–D9 section unchanged. Add a concrete contract table entry for every M-01 through M-23 row with: authoritative source, producer/adapter owner, type (`counter`, `gauge`, or `histogram`), unit, exact bounded labels/enums, cardinality budget, histogram buckets, scrape/observation interval, stale/unknown behavior, restart/counter-reset behavior, retention, and evidence binding.
2. Resolve the API-to-worker transport and endpoint ownership explicitly. The selected design MUST make application signals visible at the internal worker-origin `/metrics` without exposing API `/metrics` through Caddy or the public API. Record the rejected alternatives and why they would violate D1/D2 or add an unapproved broker.
3. Derive alert-facing semantics from existing evidence rather than inventing a second threshold policy:
   - HTTP readiness/error alerts remain tied to `imeal_http_requests_total` and request duration.
   - OTP retry/failure/backlog semantics remain tied to the existing ratios and 300-second backlog condition.
   - Serving latency remains tied to p95 > 1 second for 10 minutes.
   - Worker freshness remains tied to successful-run timestamps and the existing 600-second lag policy.
   - PostgreSQL/storage/backup/security alerts remain source-owned and fail closed when unavailable.
4. Choose fixed histogram boundaries that include the existing one-second serving threshold, record them in the table, and treat a later change as a contract migration requiring updated focused tests. Choose bounded route/result/job/status vocabularies; do not use free-form values.
5. Define a common sample envelope for all sources: metric name, type/unit, allowlisted labels, numeric value, observed-at timestamp, source identity, freshness state (`fresh`, `stale`, `unknown`, or `collector_failure`), and evidence/reference metadata where applicable. The envelope MUST reject secret-bearing text and unbounded labels.
6. Add a decision-log entry identifying the named reviewer, date, and approval artifact. Keep `STG-METRICS-01` **BLOCKED** until later real-source and runtime evidence exists.

**Acceptance:** the spec contains 23 concrete rows and no `UNRESOLVED` implementation field for the approved scope; every remaining external prerequisite is explicitly named rather than guessed. The contract tests prove exact-name completeness, unique IDs, type/unit consistency, bounded labels/enums, bucket inclusion of the serving threshold, and rejection of secrets/PII. No producer code or endpoint is claimed by this task.

**Focused verification:** `yarn workspace @imeal/observability test` and `yarn workspace @imeal/observability build` after the contract module exists.

### Task 2 — Implement the shared bounded registry and OpenMetrics serializer

**Files:**

- Add `packages/observability/src/metrics.ts`.
- Modify `packages/observability/src/index.ts` to export the approved metric contract and registry types.
- Add `packages/observability/test/metrics.test.ts`.
- Modify `packages/observability/package.json` only if the existing package test/build scripts need the new focused test included (do not add a new dependency without a demonstrated need).

**Work:**

1. Implement an allocation-conscious in-process registry for counters, gauges, and histograms using the Task 1 contract. Registration MUST be explicit; unknown names, unknown labels, invalid units, and unbounded label values MUST throw.
2. Serialize deterministic OpenMetrics/Prometheus text with `# HELP`/`# TYPE`, stable label ordering, escaped label values, fixed histogram buckets, `_bucket`, `_sum`, and `_count` rows as applicable.
3. Reset application counters/histograms on process restart by construction; do not persist them or infer continuity across restarts. Preserve authoritative external samples and their freshness states separately.
4. Enforce the shared redaction rule before accepting labels or values. The registry MUST reject OTPs, bearer/session tokens, provider keys/payloads, database URLs, raw coordinates, email/employee/location identifiers, and exception text.
5. Provide merge/replace operations for source snapshots so the worker aggregator can combine API/worker application samples with authoritative adapters without silently replacing stale/unknown/collector-failure states with zero.

**Acceptance:** focused tests cover counter increment, gauge replacement, histogram bucket/count/sum output, restart semantics, bounded-label rejection, deterministic output, redaction, and stale/unknown propagation. There is no generic “emit arbitrary metric” escape hatch and no zero-value fallback for a missing source.

**Focused verification:** `yarn workspace @imeal/observability test`.

### Task 3 — Instrument API application metrics at existing lifecycle seams

**Files:**

- Add `apps/api/src/common/metrics.service.ts` and its focused spec.
- Add `apps/api/src/common/api-metrics-source.ts` (or the exact approved transport adapter named by Task 1) and its focused spec.
- Modify `apps/api/src/common/http-logging.interceptor.ts` and `apps/api/src/common/http-logging.interceptor.spec.ts`.
- Modify `apps/api/src/auth/otp.service.ts`, `apps/api/src/auth/otp.service.spec.ts`, `apps/api/src/auth/auth.module.ts`, and `apps/api/src/auth/auth.controller.spec.ts`.
- Modify `apps/api/src/pickup/pickup.service.ts`, `apps/api/src/pickup/pickup.service.spec.ts`, and `apps/api/src/pickup/pickup.module.ts`.
- Modify `apps/api/src/app.module.ts` to register the metrics provider and inject it into the existing interceptor without creating a second global request interceptor.

**Work:**

1. In `HttpLoggingInterceptor`, record exactly one `imeal_http_requests_total` and one duration observation per completed request, including errors and shutdown rejection, using the Task 1 normalized route/result vocabulary. Exclude `/metrics` before recording; the API still MUST NOT expose that route.
2. In `OtpService`/the existing auth outcome boundary, record `imeal_auth_attempts_total` with only approved result enums. Distinguish invalid/rejected business authentication from dependency/provider failures according to the contract; never include an email, OTP, request ID, provider code, or exception message as a label.
3. In `PickupService.confirmPickup`, record `imeal_serving_confirm_total` and the duration histogram exactly once for success, typed business rejection, idempotent replay, and infrastructure failure. Record `imeal_idempotency_conflicts_total` only for the existing conflict outcome, without changing the transaction or replay response.
4. Send/flush API application samples through the approved Task 1 source adapter. If the adapter is unavailable, mark the source stale/collector-failure and retain the release gate; do not expose a public fallback endpoint or fabricate samples.
5. Keep structured logs and request IDs unchanged except for using the same bounded route/result taxonomies; do not duplicate metric increments from `ApiExceptionFilter`.

**Acceptance:** API unit tests prove one request count per success/error, `/metrics` exclusion, duration recording, auth result taxonomy, serving success/error/replay/conflict mapping, and no change to response envelopes/idempotency. Tests assert serialized labels contain no sensitive data and that an unavailable API-to-worker sink is observable as a failure state rather than zeros.

**Focused verification:** `yarn workspace @imeal/api test --run apps/api/src/common/http-logging.interceptor.spec.ts apps/api/src/auth/otp.service.spec.ts apps/api/src/pickup/pickup.service.spec.ts` (use the repository's supported Vitest file-selection syntax if the workspace wrapper differs).

### Task 4 — Instrument worker application metrics and expose the private worker-origin endpoint

**Files:**

- Add `apps/worker/src/metrics/metrics.service.ts` and `apps/worker/src/metrics/metrics.service.spec.ts`.
- Add `apps/worker/src/metrics/metrics.controller.ts` and `apps/worker/src/metrics/metrics.controller.spec.ts`.
- Add `apps/worker/src/metrics/metrics.module.ts` only if it keeps the existing module composition clearer; otherwise register the provider/controller directly in `apps/worker/src/app.module.ts`.
- Modify `apps/worker/src/app.module.ts` and `apps/worker/src/main.ts` only for dependency registration/startup validation.
- Modify focused worker services/tests: `otp-delivery-worker.service.ts`, `otp-delivery-worker.service.spec.ts`, `notification-dispatch.service.ts`, `notification-dispatch.service.spec.ts`, `notification-reminder.service.ts`, `notification-reminder.service.spec.ts`, `cutoff-worker.service.ts`, `cutoff-worker.service.spec.ts`, `pickup-worker.service.ts`, `no-show-worker.service.ts`, and `no-show-worker.service.spec.ts`.
- Modify `apps/worker/src/health.controller.ts` only if the approved internal endpoint isolation requires a shared private-network guard; health response behavior must remain unchanged.

**Work:**

1. Record OTP delivery attempt/retry/terminal-failure counters at the provider and retry boundaries already present in `OtpDeliveryWorker`; map provider outcomes to the fixed taxonomy and never expose provider payloads or arbitrary provider codes.
2. Observe `imeal_otp_outbox_oldest_age_seconds` from the real outbox query/claim source. Empty queue, database unavailability, stale observation, and collector failure must follow the Task 1 states; an empty queue MUST NOT be confused with a zero-value source failure.
3. Record `imeal_worker_runs_total{job,status}` at each existing scheduled job's start/end/failure boundary. Derive last-success timestamps and lag from the existing `jobRun` records/schedule definitions, with a bounded job enum and explicit missing-job behavior.
4. Merge API application samples and worker samples with the authoritative adapters from Task 5 into one worker-owned registry. The merge must preserve source identity and freshness and reject duplicate conflicting samples.
5. Add `GET /metrics` on the worker process for the internal monitoring network only. Return HTTP 200 only when a complete safe snapshot is available; do not add an API controller, Caddy route, public auth bypass, or public fallback. Preserve existing health/readiness routes and request-ID behavior.

**Acceptance:** focused tests prove OTP attempt/retry/failure mapping, outbox age and unavailable DB states, every required worker job's success/failure/lag semantics, duplicate-source rejection, complete 23-name output, safe redaction, and HTTP 200 only for a complete snapshot. Worker e2e proves `/health/*` remains unchanged and `/metrics` exists only on the worker-origin app server.

**Focused verification:** `yarn workspace @imeal/worker test --run apps/worker/src/metrics/metrics.service.spec.ts apps/worker/src/metrics/metrics.controller.spec.ts` plus the modified worker service specs.

### Task 5 — Implement authoritative external-source adapters without application approximations

**Files:**

- Add `apps/worker/src/metrics/authoritative-metrics.ts` and `apps/worker/src/metrics/authoritative-metrics.spec.ts` for the adapter interfaces, freshness/error states, and merge contract.
- Add source-specific adapters under `apps/worker/src/metrics/sources/`: `postgres-metrics.adapter.ts`, `object-storage-metrics.adapter.ts`, `backup-restore-metrics.adapter.ts`, and `security-boundary-metrics.adapter.ts`, with focused specs for each.
- Add/modify worker configuration validation in `apps/worker/src/metrics/metrics-environment.ts`, `apps/worker/src/main.ts`, and the worker environment tests. Use secret names and provider endpoints only through runtime configuration; never place values in source, tests, manifests, or metric output.
- If the approved owner selects a platform collector instead of an in-process adapter for a source, keep the corresponding adapter as a strict input/validation boundary and document the collector contract in the metrics spec; do not add an in-process fake.

**Work:**

1. PostgreSQL/PgBouncer (M-14–M-17): use the approved least-privilege source/query/exporter for real connection/pool usage, transaction errors, lock waits, and disk usage. Define database/PgBouncer scope, units, unavailable-DB behavior, and source freshness in the 23-row contract. Application request failures MUST NOT be substituted for database transaction/lock metrics.
2. Object storage (M-18–M-19): use the approved private MinIO/storage-platform source for usable capacity and bounded storage errors. Keep bucket/service scope and access private; no public object-storage URL or unrestricted admin metric is allowed.
3. Backup/restore (M-20–M-22): consume target-bound encrypted backup/restore manifests and checksum/rehearsal artifacts. Validate identity, timestamp, checksum, release/target binding, and retention state. Missing, stale, or invalid evidence is stale/unknown/failure, never zero or PASS.
4. Security boundary (M-23): consume the independent Caddy/WAF/TLS/scanner/external security source with a fixed taxonomy and deduplication window. Do not infer violations solely from application logs or request errors.
5. Every adapter returns source identity, observed time, freshness state, and redacted evidence binding. It MUST fail closed on missing credentials/configuration, invalid source data, stale data, or unexpected labels.

**Acceptance:** adapter specs exercise real-source mapping at the boundary (using deterministic source fixtures, not synthetic metric output), least-privilege/configuration validation, stale/unknown/collector-failure semantics, redaction, target/evidence binding, duplicate/deduplication behavior, and rejection of application-only substitutions. The tests do not claim staging approval.

**Focused verification:** `yarn workspace @imeal/worker test --run apps/worker/src/metrics/authoritative-metrics.spec.ts apps/worker/src/metrics/sources/*.spec.ts`.

### Task 6 — Wire deployment isolation and runtime configuration

**Files:**

- Modify `docker-compose.staging.yml` to attach the worker metrics listener only to the private monitoring/data network and keep public `ports` absent; use existing `!override`/network patterns.
- Modify `infra/staging/Caddyfile` only if needed to preserve/strengthen the existing `/metrics` 404 block; never proxy metrics to API or worker.
- Modify `apps/worker/src/main.ts`/environment validation for required source configuration and fail-closed startup, without logging secret values.
- Add/modify `scripts/staging/compose-config.test.mjs`, `scripts/staging/runtime-integration.test.mjs`, and `scripts/staging/runtime-integration.mjs` only when the implemented contract requires an assertion that is not already present.
- Update `docs/runbooks/staging-readiness.md` and `docs/superpowers/specs/2026-09-28-staging-readiness-design.md` with observed endpoint/source prerequisites only after implementation and deployment configuration are actually present.

**Work:**

1. Render the staging Compose overlay with redacted variables and prove DB, PgBouncer, MinIO, and worker remain unreachable from the public edge. The worker-origin metrics route must be reachable only from the approved monitoring network/source.
2. Require a complete source configuration at worker startup. A missing PostgreSQL/storage/backup/security source MUST fail closed or expose a collector-failure state according to the contract; it MUST NOT start with placeholder values.
3. Preserve Caddy's public `/metrics` 404 and all existing security headers, request-ID forwarding, API route behavior, and health checks.
4. Keep the staging runtime consumer as a verifier, not a producer. It must still require all 23 names, safe output, internal HTTP 200, and public non-success.

**Acceptance:** Compose tests prove no public internal ports, no public `/metrics`, no secrets in rendered config, private worker metrics reachability, and required source bindings. Runtime integration tests prove all 23 names, safe text, request/health identity, and public metrics rejection.

**Focused verification:** `node --test scripts/staging/compose-config.test.mjs scripts/staging/runtime-integration.test.mjs` and the existing `yarn test:staging-tools` once all sibling staging changes are integrated.

### Task 7 — Align alerts and controlled evidence capture

**Files:**

- Modify `infra/staging/alert-rules.yml` only to bind the approved concrete row labels/source states while preserving existing metric names, owners, actions, and alert test route.
- Modify `scripts/staging/evidence.mjs`, `scripts/staging/runtime-integration.mjs`, and their tests only to capture redacted source/freshness/evidence identity required by the approved contract; do not turn evidence helpers into metric producers.
- Modify `scripts/staging/runbook-links.test.mjs`, `docs/runbooks/staging-readiness.md`, and the relevant metrics/staging specs to link the actual command and artifact names.

**Work:**

1. Verify every alert expression references a contract-approved metric and bounded label. Keep the existing initial thresholds unless a separately approved baseline decision changes them; record any threshold change in the contract decision log.
2. Add explicit alert tests for stale/unknown/collector-failure states, missing required metrics, unsafe labels, and controlled alert delivery. A local alert test is not delivery approval.
3. Capture target-bound, redacted evidence for source identity, metric snapshot, freshness state, checksums, and alert acknowledgement. Do not include credentials, raw payloads, PII, or unapproved locations/targets.
4. Keep `STG-METRICS-01` blocked until the deployed internal endpoint, real sources, controlled alert delivery, and independent review are evidenced.

**Acceptance:** alert and evidence tests pass with the exact 23-name contract; evidence fails closed on missing source, stale/unknown state, unsafe output, mismatched target/release, or missing alert acknowledgement. Documentation describes observed behavior only.

**Focused verification:** `node --test scripts/staging/alert-rules.test.mjs scripts/staging/evidence.test.mjs scripts/staging/runbook-links.test.mjs`.

### Task 8 — End-to-end verification and release-gate handoff

**Files:**

- No new source files. Update only the implementation/spec/runbook files already listed when their observed commands or statuses change.
- Retain generated evidence outside source control under the operator-selected protected evidence directory; never commit credentials, OTPs, target data, or raw operational payloads.

**Work and order:**

1. Run focused observability package tests/build.
2. Run API metrics tests and existing API unit/e2e suites that cover auth, pickup confirmation, idempotency, request IDs, and health.
3. Run worker metrics tests and existing worker unit/e2e suites that cover OTP delivery, retries, job runs, health, and shutdown.
4. Run typecheck/build for the affected packages/apps.
5. Render redacted staging Compose and run boundary tests.
6. Against an approved isolated staging target only, run the runtime integration: API/worker health and request-ID checks, public `/metrics` rejection, internal worker `/metrics` completeness/redaction, and real-source freshness checks.
7. Capture alert delivery, backup/restore evidence binding, security-boundary evidence, and independent review records according to the staging runbook.
8. Report statuses separately: repository implementation evidence, `STG-METRICS-01`, `P0-DOM-09`, `STG-EXT-01`, and release qualification. Do not mark any gate PASS from local/disposable results.

**Acceptance:** the implementation has focused proof for all 23 names and source boundaries, the public/internal isolation contract is observed, no sensitive values are emitted, and the handoff clearly states any unavailable external gate. `STG-METRICS-01` may change from **BLOCKED** only through its existing independent evidence/approval process; this plan itself never grants release readiness.

## Review checkpoints

- **Checkpoint A (after Task 1):** named runtime/platform owner approves the concrete 23-row schema, API-to-worker transport, endpoint ownership, labels/enums, buckets, freshness, and source boundaries. Reject or revise before any instrumentation.
- **Checkpoint B (after Tasks 2–5):** focused producer and adapter tests pass; no public endpoint or synthetic source exists; application and authoritative-source ownership remains separated.
- **Checkpoint C (after Tasks 6–7):** redacted Compose/runtime/alert/evidence checks pass; Caddy still rejects public `/metrics`; internal worker endpoint proves all 23 names from real or explicitly bound sources.
- **Checkpoint D (after Task 8):** independent evidence review records target, source, alert, backup/restore, security, and rollback facts. Keep release status `CONDITIONAL / NO-GO` when any named external gate is absent.

## Commands summary

```text
yarn workspace @imeal/observability test
yarn workspace @imeal/observability build
yarn workspace @imeal/api test
yarn workspace @imeal/worker test
yarn typecheck
node --test scripts/staging/compose-config.test.mjs
node --test scripts/staging/runtime-integration.test.mjs
node --test scripts/staging/alert-rules.test.mjs scripts/staging/evidence.test.mjs scripts/staging/runbook-links.test.mjs
yarn test:staging-tools
```

Run commands only at the task/checkpoint where their prerequisites are complete. A successful local command is implementation evidence, not staging or production approval.
