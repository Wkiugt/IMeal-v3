# CI qualification runbook

## Runtime and install

The repository requires Node `24.x` and Yarn `4.18.0` (`package.json` declares both). In a clean checkout, activate the pinned package manager before installing:

```text
corepack enable
corepack install --global yarn@4.18.0
yarn --version
yarn install --immutable
```

The workflow command catalogue uses the same Yarn/Corepack adapter for every Yarn command and uses the active Node executable for Node-only commands. The database lane uses the workspace `test:db` scripts; `@imeal/core` excludes `**/*.unit.test.ts`, while the root unit lane remains the authority for unit coverage.

## Local qualification

```text
yarn ci:verify
```

The default local verifier does not launch Docker, does not inherit `DATABASE_URL`, and writes a fresh report under `.superpowers/sdd/ci-stabilization/local-ci-verify/<uuid>/ci-verify.json`. It records Node/Yarn/install versions, command argv, elapsed time, status, and redacted log references. A blocked disposable-PostgreSQL, Compose, image, or secret-scanner lane is not a pass; the verifier exits nonzero for any prerequisite, lane failure, or block. This task exercised the default mode only and did not run Docker or recommend local Docker execution. The implementation has an explicit `--allow-docker` option for authorized environments; it is not part of the default proof.

## Mobile checks

The mobile producer first records Expo alignment checks, then runs the export and real negative regression independently:

```text
node scripts/ci/mobile-export.mjs --output-dir <directory> --log <file> [--keep-output]
node scripts/ci/metro-smoke.mjs [--port <number>] [--timeout-ms <number>] [--log <file>]
```

`mobile-export` accepts only `--output-dir`, `--log`, and `--keep-output`. `metro-smoke` accepts only `--port`, `--timeout-ms`, and `--log`. The real negative test is scheduled after export without making export success a prerequisite, so setup failures and broken-import regressions remain independently visible.

## Evidence and reruns

The required producer graph is `static`, `suites`, `mobile-export`, `mobile-smoke`, `db`, `tooling`, `security-audit`, `security-secrets`, `images-api`, `images-worker`, and `images-admin-web`. Producer evidence uses stable same-run names with overwrite for partial reruns. Aggregation binds every producer to release ID, run ID/attempt, source SHA, and workflow SHA; missing, duplicate, stale, or cross-run evidence fails closed. Protected staging evidence is attempt-scoped (`staging-release-<releaseId>-attempt<runAttempt>`), while deployment requires the current successful checks job and matching provenance.

The checks job is scheduled with `always()` so producer failures still reach aggregation. Artifact downloads intentionally use `always() && !cancelled()`; aggregation itself always runs and receives the workflow `cancelled()` flag. A global cancellation forces a `FAIL` report with a cancellation diagnostic, suppresses the success qualification artifact, uploads diagnostics, and fails the job. A cancelled or skipped producer job is never eligible for PASS.

## Scope and known limits

The local proof exercised Windows Node 24. WSL probing found only the Docker Desktop distribution; POSIX process-group and Linux container qualification therefore remains unconfirmed until an authorized Linux runner. GitHub Actions scheduling and branch-protection settings were not executed locally. The current Yarn audit is a blocking diagnostic: published `braces@3.0.3` and `node-forge@1.4.0` remain reported high severity, with no compatible patched release available and no waiver or severity exclusion applied. Standalone secret scanning evidence is separate from workflow Docker execution.
