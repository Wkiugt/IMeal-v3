# Task 1 metrics contract report

## Changed files

- `packages/observability/src/metrics-contract.ts` — checked-in 23-row contract, exact required names, histogram family/base names and suffixes, bounded labels/enums, cardinality budgets, source/freshness/reset/retention/evidence metadata, common sample-envelope validation, and metric-specific secret/PII rejection.
- `packages/observability/test/metrics-contract.test.ts` — exact-name/ID, type/unit, labels/enums, cardinality, histogram bucket/family, metadata, deterministic backup-evidence state, envelope validation, and secret/PII rejection tests.
- `docs/superpowers/specs/2026-09-29-imeal-metrics-contract-design.md` — recorded 2026-09-30 Checkpoint A approval and kept `STG-METRICS-01` **BLOCKED**.

## Verification

- `yarn workspace @imeal/observability test` — **PASS**; 2 test files, 46 tests.
- `yarn workspace @imeal/observability build` — **PASS**; TypeScript exited 0 with no output.

## Concerns

- Real monitoring transport, authoritative PostgreSQL/storage/backup/security sources, credentials, targets, and runtime evidence remain external prerequisites. Missing M20–M22 evidence maps to `unknown`; invalid or unavailable evidence maps to `collector_failure`.
- No endpoint or producer was added. This task adds contract/types/validation/tests only; `STG-METRICS-01` remains **BLOCKED**.

## Review fix report

- Rejected unknown sample-envelope fields and unknown evidence keys; removed the open evidence index signature, constrained `reference`, reconstructed validated output, and added secret/PII tests for otherwise-valid evidence fields.
- Added machine-checkable row value semantics and validation for nonnegative values, M13 lag clamping, M14/M17 ratios, M18 zero capacity, M20 non-future age, non-finite values, and valid zero boundaries.
- Added explicit `/metrics` route rejection, exact M-01–M-23 ID mapping, stale/source/producer metadata assertions, job/database/backup evidence bindings, and frozen nested row metadata.
- Corrected the decision log to identify the reviewer as the runtime/platform owner represented by the user approval and the artifact as the 2026-09-30 user approval message in this conversation; `STG-METRICS-01` remains **BLOCKED**.

Fresh verification after the fixes:

- `yarn workspace @imeal/observability test` — **PASS**; 2 test files, 57 tests.
- `yarn workspace @imeal/observability build` — **PASS**; TypeScript exited 0 with no output.

No producer, registry/serializer, API/worker endpoint, external collector, synthetic metric, or fallback zero was added.

## Scoped re-review fix report

- Removed `manifestCompletionTimestamp` from M-21 and M-22; only M-20 requires the manifest completion-time binding, with fixtures and assertions aligned.
- Added strict source-identity and evidence-value vocabularies: approved application/authoritative identities, release/revision/date formats, SHA-256 digests, canonical timestamps, bounded source bindings, result enums, duration windows, fingerprints, and references. Arbitrary URLs, PII, exception text, secrets, and unapproved values are rejected.
- Recorded the decision log reviewer exactly as `runtime/platform owner (user)` and the approval artifact exactly as the `2026-09-30 user approval message in this conversation`; the owner-review checklist is satisfied while real transport/source/target/evidence/alert prerequisites remain unchecked. `STG-METRICS-01` remains **BLOCKED**.

Fresh verification after this scoped fix:

- `yarn workspace @imeal/observability test` — **PASS**; 2 test files, 59 tests.
- `yarn workspace @imeal/observability build` — **PASS**; TypeScript exited 0 with no output.

No producer, registry/serializer, endpoint, external collector, synthetic metric, or fallback zero was added.

## Test-scope correction

- Moved the evidence `source` rejection assertion inside its owning `rejects unbounded source and evidence metadata values` test so `baseSample` remains block-scoped and the test file compiles without out-of-scope references.

Fresh verification after the test-scope correction:

- `yarn workspace @imeal/observability test` — **PASS**; 2 test files, 59 tests.
- `yarn workspace @imeal/observability build` — **PASS**; TypeScript exited 0 with no output.

## Task 2 bounded registry report

- Added `packages/observability/src/metrics.ts` with a contract-registered in-process `MetricRegistry` for explicit counter increments, gauge replacement, and fixed-bucket histogram observations. State is process-local by construction; no persistence or cross-restart inference exists.
- Added deterministic OpenMetrics/Prometheus serialization with contract `HELP`/`TYPE`, stable label ordering and escaping, exact histogram family names, fixed `_bucket`/`_sum`/`_count` rows, and no untouched zero-value fallback.
- Enforced the Task 1 contract for names, units, metric kinds, bounded labels/cardinality, finite/value semantics, sensitive text, and authoritative-sample separation. Added validated source snapshot merge/replace operations that preserve `fresh`, `stale`, `unknown`, and `collector_failure`, reject conflicting duplicates, and refuse non-fresh-to-zero replacement.
- Exported the approved contract and registry APIs/types through `packages/observability/src/index.ts`. No API/worker endpoint, producer, external collector, synthetic infrastructure value, or arbitrary emit escape hatch was added; public `/metrics` rejection remains unchanged.

Fresh verification after Task 2:

- `yarn workspace @imeal/observability test` — **PASS**; 3 test files, 66 tests.
- `yarn workspace @imeal/observability build` — **PASS**; TypeScript exited 0 with no output.

## Task 2 freshness and zero-handling correction

- Source snapshots retain all freshness states for diagnostics, but `serialize()` now emits numeric OpenMetrics rows only for `fresh` samples; stale, unknown, and collector-failure values cannot appear as metrics or fallback zeros.
- Fresh observed zero values remain valid, including M-18 capacity, and may replace prior non-fresh samples. Incoming non-fresh zero values are still rejected when they would hide a prior source value.

Fresh verification after this correction:

- `yarn workspace @imeal/observability test` — **PASS**; 3 test files, 67 tests.
- `yarn workspace @imeal/observability build` — **PASS**; TypeScript exited 0 with no output.
