# Task 7 — Staging metrics and evidence gate report

## Scope

Task 7 hardens the exact 23-name staging metrics contract, bounded Prometheus
labels/status selectors, worker job completeness, fail-closed runtime parsing,
strict phase-specific PASS evidence, required runtime/smoke evidence, and
target-bound observability alert evidence. The verifier requires
`runtime-integration.json.evidence.metricsSnapshotDigest` to be the SHA-256 of
the fetched worker metrics body; the alert source is restricted to that
artifact, records its artifact hash provenance, and must match the runtime
metrics digest. It never creates an alert acknowledgement.

## Focused verification

The following repository-only checks passed:

```text
node --test scripts/staging/alert-rules.test.mjs scripts/staging/evidence.test.mjs scripts/staging/runbook-links.test.mjs scripts/staging/runtime-integration.test.mjs scripts/staging/compose-config.test.mjs scripts/staging/smoke-staging.test.mjs scripts/staging/backup-restore.test.mjs — 80 tests passed
yarn workspace @imeal/worker test --run src/metrics/metrics.service.spec.ts src/metrics/metrics.controller.spec.ts src/metrics/authoritative-metrics.spec.ts src/metrics/metrics-environment.spec.ts src/otp-delivery-worker.service.spec.ts src/notification-dispatch.service.spec.ts src/cutoff-worker.service.spec.ts src/pickup-worker.service.spec.ts src/no-show-worker.service.spec.ts — 100 tests passed
```

The worker app e2e command is a recorded local failure, not a staging result:
`yarn workspace @imeal/worker test:e2e --run test/app.e2e-spec.ts` had 4/5 tests
pass; the complete-bound `/metrics` fixture returned HTTP 503 where the test
expects HTTP 200. No failure was bypassed and no staging/prod target was
contacted.

These tests use disposable fixtures and injected fetch/command implementations.
The qualification path now fails on API or worker readiness HTTP 503 and only
returns PASS when both readiness responses are HTTP 200 with body
`status: "ok"` and the expected release marker. They do not connect to staging,
query a real metrics collector, exercise a real alert transport, use
credentials, or prove an external target/source.

## Evidence and decision

- `STG-METRICS-01`: **BLOCKED**. No observed protected staging deployment,
  internal `/metrics` scrape from the approved target, authoritative PostgreSQL,
  object-storage, backup/restore, or security source evidence is present.
- `P0-DOM-09`: **CONDITIONAL / NO-GO** pending the protected staging migration,
  target fingerprint, phase artifacts, smoke evidence, and independent review.
- `STG-EXT-01`: **CONDITIONAL / NO-GO** pending approved edge WAF/rate-limit,
  TLS/redirect, controlled alert delivery, and acknowledgement evidence.

The API/authoritative runtime wiring gap remains a Task 8 and external
qualification blocker; these repository-only changes do not fake collectors,
target bindings, or staging observations.
