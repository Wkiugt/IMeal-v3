# Task 7 — Staging metrics and evidence gate report

## Scope

Task 7 hardens the exact 23-name staging metrics contract, bounded Prometheus
labels/status selectors, worker job completeness, fail-closed runtime parsing,
strict phase-specific PASS evidence, required runtime/smoke evidence, and
target-bound observability alert evidence. The verifier requires the alert
snapshot digest to equal the SHA-256 of a supplied PASS evidence artifact and
never creates an alert acknowledgement.

## Focused verification

The following repository-only checks passed:

```text
node --test scripts/staging/alert-rules.test.mjs scripts/staging/evidence.test.mjs scripts/staging/runbook-links.test.mjs
node --test scripts/staging/runtime-integration.test.mjs
node --test apps/worker/src/metrics/metrics.service.spec.ts
```

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

The repository changes establish the verifier contracts and fail-closed checks;
they do not manufacture runtime observations, collectors, alert delivery, or
release qualification.
