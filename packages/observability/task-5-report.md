# Task 5 authoritative-source metrics report

Task 5 adds strict worker-side input boundaries and repository-side typed
provider clients for M-14 through M-23. PostgreSQL/PgBouncer, private object
storage, encrypted backup/restore evidence, and independent security-boundary
observations are accepted only as target-bound source records. Adapters and
typed providers validate the approved metric contract, source identity, bounded
labels, freshness, evidence bindings, nonnegative values, release grammar, and
duplicate/conflict behavior before a snapshot can cross
`WorkerMetricsService.acceptAuthoritativeSnapshot` through the shared sink
helper.

The typed private HTTPS registry/feed transport resolves opaque references through
the protected boundary and sends references in the request body, not URL paths.
Four concrete provider clients (PostgreSQL/PgBouncer, object storage,
backup/restore evidence, and security boundary) are repository-complete, DI-wired
into the worker collector, and tested. Their strict schemas and fail-closed
mapping preserve the existing collector input contracts. No client performs
credential lookup, backfill, synthetic zero substitution, application-error
inference, or public endpoint exposure. Missing registry configuration/source
data and invalid evidence return a structured non-success state without numeric
samples.

## Focused verification

- `yarn workspace @imeal/worker test --run src/metrics/authoritative-metrics.spec.ts src/metrics/sources/authoritative-source-providers.spec.ts src/metrics/sources/postgres-metrics.adapter.spec.ts src/metrics/sources/object-storage-metrics.adapter.spec.ts src/metrics/sources/backup-restore-metrics.adapter.spec.ts src/metrics/sources/security-boundary-metrics.adapter.spec.ts` — 6 files, 41 tests passed.
- `yarn workspace @imeal/worker test --run src/metrics/metrics-environment.spec.ts` — 1 file, 5 tests passed; production requires all four opaque runtime source bindings, while non-production test configuration remains optional and source references reject credentials/unsafe whitespace without echoing values.
- `yarn workspace @imeal/observability test` — 3 files, 76 tests passed.
- `yarn workspace @imeal/observability build` — passed.

## Boundary evidence

- M-14–M-17 accept only explicitly scoped PostgreSQL/PgBouncer records with the fixed `pgbouncer_client`/`postgres_backend` pool enum, bounded ratios, nonnegative source counters, configured denominators, target fingerprint, and approved query/exporter/source bindings. HTTP/API error counts and request latency are not accepted as substitutions.
- M-18–M-19 accept only private-storage capacity and `health`/`read`/`write` operation records. An explicitly supplied valid fresh empty `operationErrors` array is a real zero observation and emits all three bounded zero series; missing source input remains `source_unavailable`, while an omitted operation-error field, negative/non-finite values, public endpoint-like fields, and API upload outcomes are rejected.
- M-20–M-22 require target/release-bound encrypted manifest and rehearsal evidence, matching digests and completion timestamps, retained state, checksum/rehearsal result, and nonnegative counts. Missing evidence is `unknown`; invalid/future/mismatched evidence is `collector_failure`; no PASS or zero is fabricated.
- M-23 accepts only independent security-boundary taxonomy events with approved categories, SHA-256 event identities used solely for deduplication, and the contract-bound security taxonomy/deduplication window. Same-digest/different-category conflicts fail closed; an explicitly valid empty fresh feed emits bounded real zero observations, while a missing/unavailable feed remains non-success. Event identity, source text, URLs, credentials, request IDs, application request errors, and arbitrary labels are never emitted.
- Shared authoritative snapshot construction deduplicates identical series, rejects conflicting duplicates, rejects sensitive/unknown evidence fields, and reports worker sink rejection without exposing source errors.

## External status

- Commits `07fd8b8`, `755e310`, and `43f1746` complete the typed private
  HTTPS registry/feed transport and four concrete source providers, with DI
  wiring into the worker collector. Strict exact-schema validation and
  fail-closed provider mapping are repository-complete and do not imply that
  any external source was contacted.
- The external source registry URL/protocol, protected source identifiers,
  credentials/workload identity/mTLS, exporter semantics, and target
  fingerprints/digests remain deployment inputs. No credentials or real
  endpoints were used. M-23 remains registry-bound for source resolution and
  has no cryptographic target binding.
- Production source-binding omission is intentional and remains a Task 8/external qualification prerequisite: Task 5 validates the fail-closed configuration contract but does not provision runtime bindings or claim production startup/readiness.
- Repository implementation evidence is local only. No PostgreSQL/PgBouncer exporter, private MinIO/storage target, encrypted backup/restore evidence pipeline, independent Caddy/WAF/TLS/scanner feed, staging credentials, staging target, controlled alert delivery, or independent approval was provisioned or observed. `STG-METRICS-01` remains **BLOCKED / CONDITIONAL / NO-GO**; this report does not claim staging or production approval.

## Runtime wiring update

- `22e5b25` supplies the private structured API-to-worker transport, while
  `199eab2` registers the worker runtime service that collects initially and
  then schedules the orchestrator every 60 seconds.
- Missing source references, target fingerprint, release metadata, registry
  configuration, or provider payloads remain fail-closed. No real source
  observation or complete 23-metric runtime qualification is claimed.
- M-23 source resolution remains registry-bound and does not provide
  cryptographic target binding; target fingerprints/digests are external
  evidence inputs.
