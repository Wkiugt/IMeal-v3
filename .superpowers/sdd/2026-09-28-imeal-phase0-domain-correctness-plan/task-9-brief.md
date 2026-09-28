# Task 9 — Rollout gates and canonical documentation

## Scope

Execute the Phase 0 rollout evidence sequence on a disposable/local PostgreSQL target only:

1. Expand-only Prisma migration and generated client.
2. Read-only preflight report and explicit approval gate.
3. Exact, idempotent backfill only after a clean disposable preflight.
4. Post-backfill preflight and named constraint validation.
5. Focused and full contract/domain/API/worker verification, recording blockers without fabrication.
6. Update only canonical rollout/backend/product-flow/readiness documents from observed evidence. Do not change product behavior, client realtime/infrastructure/P1 scope, or `progress.md`.

Current gate state: **NOT COMPLETE / NO-GO**. Local/disposable evidence is
implementation evidence only; no independent approval or staging/production
sign-off is implied.

## Required evidence

- Actual migration field/index/FK/check behavior and row-preserving/no-seed result.
- Preflight seven named checks plus four status counts, with bounded IDs and no sensitive values.
- Backfill command/result and repeatability on disposable schema.
- Post-backfill check results and invariant validation.
- Focused/full test and typecheck commands with exact PASS/BLOCKED results.
- Explicit dirty-local-data, missing `DATABASE_URL`, mobile typecheck, and unavailable staging blockers where applicable.
- Required env/secret/backup/restore references only when already evidenced; no operational evidence invented.

## Safety gate

Never run backfill or validation against the existing dirty local public schema.
Use a disposable schema/database and a target-safe `psql` wrapper that sets the
intended `search_path` in the same session, asserts `current_schema()` matches
that target, and passes `-v ON_ERROR_STOP=1` before `-f`-ing the SQL file.
Treat any nonzero operational preflight as NO-GO until an approved remediation
exists. Do not claim staging or production deployment, backup/restore, secrets,
or mobile verification without observed evidence.

## Acceptance

Create `task-9-report.md` with exact commands/results/blockers, update canonical
docs with actual schema fields, compatibility/cutover order, invariants,
rollback/abort conditions, and evidence links, and update the checked-in
preflight/backfill SQL when review requires a predicate correction. Then commit
only this brief/report/docs/rollout SQL. Do not modify `progress.md`.
