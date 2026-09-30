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
