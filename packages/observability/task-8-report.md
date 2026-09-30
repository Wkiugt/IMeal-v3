# Task 8 verification and external qualification assessment

## Scope and safety boundary

Task 8 records repository-only verification. No staging or production credentials,
targets, backfill, alert delivery, or live collector calls were used. No missing
API-to-worker transport or flush path, authoritative collector caller, or
protected deployment wiring was invented.

The worker has a private `/metrics` endpoint and local metric/authoritative
adapter implementations. That is implementation evidence only. The repository
does not provide the API-to-worker transport/flush path, callers that collect the
PostgreSQL/object-storage/backup/security sources, protected source bindings,
redacted target-bound runtime evidence, or controlled alert acknowledgement.

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

- `yarn workspace @imeal/worker test --run src/metrics/metrics.service.spec.ts src/metrics/metrics.controller.spec.ts src/metrics/authoritative-metrics.spec.ts src/metrics/metrics-environment.spec.ts src/otp-delivery-worker.service.spec.ts src/notification-dispatch.service.spec.ts src/cutoff-worker.service.spec.ts src/pickup-worker.service.spec.ts src/no-show-worker.service.spec.ts` — **PASS**; 9 files, 100 tests.
- `yarn workspace @imeal/worker test --run src/metrics/authoritative-metrics.spec.ts src/metrics/metrics.service.spec.ts src/metrics/metrics.controller.spec.ts src/metrics/metrics-environment.spec.ts src/metrics/sources/postgres-metrics.adapter.spec.ts src/metrics/sources/object-storage-metrics.adapter.spec.ts src/metrics/sources/backup-restore-metrics.adapter.spec.ts src/metrics/sources/security-boundary-metrics.adapter.spec.ts` — **PASS**; 8 files, 47 tests.
- `yarn workspace @imeal/worker build` — **PASS**.
- `yarn workspace @imeal/worker exec tsc -p tsconfig.json --noEmit` — **PASS**.
- `yarn workspace @imeal/worker test:e2e --run test/app.e2e-spec.ts` — **FAIL**; 4 of 5 tests passed. The complete bound `/metrics` fixture expected HTTP 200 but observed HTTP 503 (`test/app.e2e-spec.ts:135`). This local fixture failure prevents claiming a complete worker runtime contract; it is not evidence of a live staging result and was not bypassed.

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
  tests. The worker app e2e complete-bound fixture currently returns 503 instead
  of the expected 200 and remains a recorded local failure.
- Staging tooling validates strict metric text, alert selectors/absence rules,
  target-bound phase evidence, smoke check names, and restore/backup controls.

The following are not present and remain blockers:

- API-to-worker transport and flush/caller wiring for API application snapshots;
- runtime callers that collect authoritative PostgreSQL/PgBouncer, private
  object-storage, backup/restore, and security-boundary observations;
- protected source bindings, deployed target identity, redacted runtime and
  smoke evidence, and independent release signoff;
- controlled alert delivery and explicit alert acknowledgement evidence.

No repository-only result can substitute for those external observations.

## Qualification decision

- `STG-METRICS-01`: **BLOCKED** — no protected deployment, real private source
  observations, target-bound runtime scrape, or external collector evidence was
  observed; the local worker e2e fixture also has one failed `/metrics` case.
- `P0-DOM-09`: **CONDITIONAL / NO-GO** — protected migration, target fingerprint,
  phase artifacts, runtime/smoke evidence, and independent review are absent.
- `STG-EXT-01`: **CONDITIONAL / NO-GO** — approved edge WAF/rate-limit control,
  TLS/redirect proof, controlled alert delivery, and alert acknowledgement are
  absent.

This report does not claim all 23 metrics are real runtime observations and does
not claim staging or release readiness.
