# Task 6 report — lock-safe per-registration no-show processing

## Changed files
- `apps/worker/src/no-show-worker.service.ts`
  - Candidate discovery filters active accounts, no serving, target date, and deterministic registration IDs.
  - Each registration runs in its own transaction. The transaction locks only the registration row first with parameterized `FOR UPDATE`, then re-reads status, serving, account activity, date, and eligibility before locking the registration-keyed penalty row.
  - Registration no-show, penalty, audit, notification, and dashboard outbox writes are atomic; retries preserve PAID/WAIVED penalties and separate JobRun bookkeeping.
  - Preserves the normal today-before-13:45 scheduler gate and enforces domain eligibility at/after 13:30 VN for forced/manual processing.
- `apps/worker/src/no-show-worker.service.spec.ts`
  - Focused tests cover 13:30/13:45 gates, registration-first lock sequencing and no unnecessary user lock, penalty identity, notification/outbox dedupe keys, retry idempotency, PAID/WAIVED preservation, rollback, race outcomes, and cancelled/disabled/served/date exclusion.
- `apps/worker/test/no-show-worker.e2e-spec.ts`
  - Added migration-backed disposable PostgreSQL tests for registration penalty uniqueness and committed retry idempotency, concurrent worker serialization, rollback of all side effects for one registration, and independent commit of the next registration.
  - The test skips when `DATABASE_URL` is unavailable rather than fabricating database evidence.
- `apps/api/src/admin/penalties/penalties.service.ts`
  - Added nullable `registrationId`/date mapping to all admin penalty responses and parameterized penalty-row locks for paid/waived transitions.
- `apps/api/src/admin/penalties/penalties.service.spec.ts`
  - Added registration/date response assertions and row-lock assertion.
- `.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-6-brief.md`
  - Task scope and acceptance brief created before source changes.
- `.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-6-report.md`
  - This evidence report.

## Verification
- `yarn workspace @imeal/worker exec vitest run src/no-show-worker.service.spec.ts` — PASS, 14 tests.
- `yarn workspace @imeal/api exec vitest run src/admin/penalties/penalties.service.spec.ts` — PASS, 11 tests.
- `yarn workspace @imeal/worker exec vitest run --config vitest.config.e2e.ts test/no-show-worker.e2e-spec.ts` — BLOCKED/SKIPPED, 1 file and 3 tests skipped because `DATABASE_URL` was unavailable in the execution environment. The real PostgreSQL test remains present and is configured to create a schema, deploy migrations, and clean up when a database URL is supplied.
- `yarn workspace @imeal/worker exec tsc --noEmit` — PASS.
- `yarn workspace @imeal/api exec tsc --noEmit` — PASS.
- `yarn workspace @imeal/core exec tsc --noEmit` — PASS.
- `git diff --check` — PASS; only Git's LF-to-CRLF working-copy normalization warnings were reported.

## Concerns/blockers
- Real PostgreSQL concurrency, rollback, independent-commit, and unique-index assertions could not execute because `DATABASE_URL` was unavailable. No database result is claimed. Run the focused e2e command with PostgreSQL before the Task 8 release gate.
- Expected rollback/cron-rethrow unit tests log errors through Nest's logger while asserting the failures; all focused unit tests pass.
- The pre-existing user-owned modification to `.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/progress.md` was not edited or staged.

## Commits
- Original implementation commit reviewed: `b2fdea475ad5d181596493c2a2cc7be5625637d4`.
- Review-fix source/test commit: `20425b24a570f4eb6d87f194f8b061452eca1ab5`.
