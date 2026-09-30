# Task 5 authoritative-source metrics report

## Scope

Task 5 adds strict worker-side input boundaries for M-14 through M-23. PostgreSQL/PgBouncer, private object storage, encrypted backup/restore evidence, and independent security-boundary observations are accepted only as target-bound source records. Adapters validate the approved metric contract, source identity, bounded labels, freshness, evidence bindings, nonnegative values, and duplicate/conflict behavior before a snapshot can cross `WorkerMetricsService.acceptAuthoritativeSnapshot` through the shared sink helper.

No adapter performs network access, credential lookup, backfill, synthetic zero substitution, application-error inference, or public endpoint exposure. Missing configuration/source data and invalid evidence return a structured non-success state without numeric samples.

## Focused verification

- `yarn workspace @imeal/worker test --run src/metrics/authoritative-metrics.spec.ts src/metrics/sources/postgres-metrics.adapter.spec.ts src/metrics/sources/object-storage-metrics.adapter.spec.ts src/metrics/sources/backup-restore-metrics.adapter.spec.ts src/metrics/sources/security-boundary-metrics.adapter.spec.ts` — 5 files, 29 tests passed.
- `yarn workspace @imeal/worker test --run src/metrics/metrics-environment.spec.ts` — 1 file, 5 tests passed; production requires all four opaque runtime source bindings, while non-production test configuration remains optional and source references reject credentials/unsafe whitespace without echoing values.
- `yarn workspace @imeal/observability test` — 3 files, 76 tests passed.
- `yarn workspace @imeal/observability build` — passed.

## Boundary evidence

- M-14–M-17 accept only explicitly scoped PostgreSQL/PgBouncer records with the fixed `pgbouncer_client`/`postgres_backend` pool enum, bounded ratios, nonnegative source counters, configured denominators, target fingerprint, and approved query/exporter/source bindings. HTTP/API error counts and request latency are not accepted as substitutions.
- M-18–M-19 accept only private-storage capacity and `health`/`read`/`write` operation records. Zero capacity remains a real source value; negative/non-finite values, public endpoint-like fields, and API upload outcomes are rejected.
- M-20–M-22 require target/release-bound encrypted manifest and rehearsal evidence, matching digests and completion timestamps, retained state, checksum/rehearsal result, and nonnegative counts. Missing evidence is `unknown`; invalid/future/mismatched evidence is `collector_failure`; no PASS or zero is fabricated.
- M-23 accepts only independent security-boundary taxonomy events with approved categories, SHA-256 event identities used solely for deduplication, and the contract-bound security taxonomy/deduplication window. Same-digest/different-category conflicts fail closed; an explicitly valid empty fresh feed emits bounded real zero observations, while a missing/unavailable feed remains non-success. Event identity, source text, URLs, credentials, request IDs, application request errors, and arbitrary labels are never emitted.
- Shared authoritative snapshot construction deduplicates identical series, rejects conflicting duplicates, rejects sensitive/unknown evidence fields, and reports worker sink rejection without exposing source errors.

## External status

- Production source-binding omission is intentional and remains a Task 6 prerequisite: Task 5 validates the fail-closed configuration contract but does not provision runtime bindings or claim production startup/readiness.
- Repository implementation evidence is local only. No PostgreSQL/PgBouncer exporter, private MinIO/storage target, encrypted backup/restore evidence pipeline, independent Caddy/WAF/TLS/scanner feed, staging credentials, staging target, controlled alert delivery, or independent approval was provisioned or observed. `STG-METRICS-01` remains **BLOCKED / CONDITIONAL / NO-GO**; this report does not claim staging or production approval.
