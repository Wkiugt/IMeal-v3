# Task 8 verification and external qualification assessment

## Scope and safety boundary

Task 8 records repository-only verification. No staging or production credentials,
targets, backfill, alert delivery, or live collector calls were used. Commits
`22e5b25`, `85bdf01`, and `199eab2` add repository runtime wiring only; they do
not constitute external source evidence or release approval.

The worker has a private `/metrics` endpoint, a private structured
API-to-worker snapshot transport, worker application snapshot publication, and
an authoritative collector lifecycle. The API transport accepts snapshots at
the private worker route with protected token configuration; the worker
application snapshot interval is 30 seconds. The authoritative collector
runtime is registered in the worker module, performs an initial collection,
then schedules a fixed 60-second collection and stops on module shutdown.

The API automatic periodic flush and metadata caller remain unimplemented:
there is no approved API metadata-caller contract that defines when and how
the API may create and flush snapshots. The four authoritative source-provider
tokens remain optional and undefined, so missing providers or protected
configuration fail closed without zeroes, Prisma/application substitutions, or
synthetic data.

These are implementation boundaries only. No real PostgreSQL/PgBouncer,
object-storage, backup/restore, or security-boundary provider implementations,
protected staging bindings, target/evidence values, redacted target-bound
runtime evidence, or controlled alert acknowledgement are present.

## Current repository wiring evidence

- `22e5b25`: private structured API-to-worker transport and worker-side
  application snapshot acceptance; no public API `/metrics` route or broker.
- `85bdf01`: four strict authoritative adapter orchestration with source
  provider ports, fixed 60-second schedule, and failure forwarding.
- `199eab2`: worker lifecycle registration, initial collection, module-destroy
  stop, optional provider tokens, protected target-fingerprint/release
  validation, and staging/production target-fingerprint pass-through.

## Exact verification results

All commands below were run from the repository checkout without staging or
production credentials or targets.

### Observability package

- `yarn workspace @imeal/observability test` — **PASS**; 3 files, 76 tests.
- `yarn workspace @imeal/observability build` — **PASS**.

### API metrics and build

- `yarn workspace @imeal/api test --run src/common/http-logging.interceptor.spec.ts src/common/metrics.service.spec.ts src/common/api-metrics-source.spec.ts src/auth/otp.service.spec.ts src/auth/auth.controller.spec.ts src/pickup/pickup.service.spec.ts` — **PASS**; 6 files, 87 tests.
- `yarn workspace @imeal/api build` — **PASS**.
- `yarn workspace @imeal/api exec tsc -p tsconfig.json --noEmit` — **PASS**.

### Worker metrics, authoritative sources, lifecycle, and build

- `yarn workspace @imeal/worker test --run src/metrics/authoritative-metrics-runtime.service.spec.ts src/metrics/authoritative-metrics-collector.spec.ts` — **PASS**; 2 files, 14 tests.
- `yarn workspace @imeal/worker test --run src/metrics/authoritative-metrics-runtime.service.spec.ts src/metrics/authoritative-metrics-collector.spec.ts src/metrics/metrics.service.spec.ts src/metrics/metrics.controller.spec.ts src/metrics/metrics-environment.spec.ts` — **PASS**; 5 files, 37 tests.
- `yarn workspace @imeal/worker test:e2e --run test/app.e2e-spec.ts` — **PASS**; 1 file, 5 tests after worker lifecycle registration.
- `yarn workspace @imeal/worker build` — **PASS**.
- `yarn workspace @imeal/worker exec tsc -p tsconfig.json --noEmit` — **PASS**.
- `node --test scripts/staging/compose-config.test.mjs` — **PASS**; 6 tests, including target-fingerprint pass-through and private worker boundary.
  The focused commands above exercise repository fixtures only.

### Focused staging tooling and scripts

- `node --test scripts/staging/alert-rules.test.mjs scripts/staging/evidence.test.mjs scripts/staging/runbook-links.test.mjs scripts/staging/runtime-integration.test.mjs scripts/staging/compose-config.test.mjs scripts/staging/smoke-staging.test.mjs scripts/staging/backup-restore.test.mjs` — **PASS**; 7 files, 80 tests.
- `node --check scripts/staging/alert-rules.test.mjs && node --check scripts/staging/evidence.mjs && node --check scripts/staging/evidence.test.mjs && node --check scripts/staging/restore-rehearsal.mjs && node --check scripts/staging/runtime-integration.mjs && node --check scripts/staging/runtime-integration.test.mjs` — **PASS**.

These staging tests use disposable fixtures and injected fetch/command
implementations. They do not connect to staging, run a runtime qualification,
query a real metrics collector, send an alert, use credentials, or run a
backfill.

## Implementation evidence versus external blockers

Repository evidence demonstrates:

- API metric lifecycle instrumentation and bounded source snapshots are covered
  by focused API/observability tests; the API `/metrics` route remains absent.
- The worker private `/metrics` listener, metric contract, lifecycle services,
  authoritative adapter validation, and private Compose boundary have local
  tests. The worker app e2e complete-bound fixture now emits all seven approved
  worker jobs for both M-12 and M-13 and returns HTTP 200.
- Staging tooling validates strict metric text, alert selectors/absence rules,
  target-bound phase evidence, smoke check names, and restore/backup controls.

The following remain blockers:

- The private API-to-worker transport is implemented, but the API automatic
  periodic flush and metadata caller remain unimplemented because no approved
  API metadata-caller contract exists.
- The collector lifecycle and four optional provider tokens are registered, but
  no real PostgreSQL/PgBouncer, private object-storage, backup/restore, or
  security-boundary provider implementations exist; missing providers and
  configuration remain `collector_failure`.
- Protected source bindings, target fingerprint/evidence digest and release
  values, deployed target identity, redacted runtime/smoke evidence, and
  independent release signoff are absent.
- Controlled alert delivery and explicit alert acknowledgement evidence remain
  absent.

No repository-only result can substitute for those external observations.

## Qualification decision

- `STG-METRICS-01`: **BLOCKED** — no protected deployment, real private source
  observations, target-bound runtime scrape, or external collector evidence was
  observed.
- `P0-DOM-09`: **CONDITIONAL / NO-GO** — protected migration, target fingerprint,
  phase artifacts, runtime/smoke evidence, and independent review are absent.
- `STG-EXT-01`: **CONDITIONAL / NO-GO** — approved edge WAF/rate-limit control,
  TLS/redirect proof, controlled alert delivery, and alert acknowledgement are
  absent.

This report does not claim all 23 metrics are real runtime observations and does
not claim staging or release readiness.
