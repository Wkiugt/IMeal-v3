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
