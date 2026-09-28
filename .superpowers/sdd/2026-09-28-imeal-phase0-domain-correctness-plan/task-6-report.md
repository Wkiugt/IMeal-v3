# Task 6 report — lock-safe per-registration no-show processing

## Changed files
- `apps/worker/src/no-show-worker.service.ts`
  - Candidate discovery now filters active accounts, no serving, target date, and deterministic registration IDs.
  - Each registration is processed in its own transaction with safe parameterized `FOR UPDATE` registration/account locking, serving/account/date/status rechecks, penalty-row locking, registration-keyed penalty verification/creation, atomic no-show/audit/notification/outbox writes, retry behavior, and separate JobRun bookkeeping.
  - Preserves the normal today-before-13:45 scheduler gate and enforces domain eligibility at/after 13:30 VN for forced/manual processing.
- `apps/worker/src/no-show-worker.service.spec.ts`
  - Permanent tests cover 13:30/13:45 gates, future-date guard, registration-first locking, penalty identity, notification/outbox dedupe keys, retry idempotency, PAID/WAIVED preservation, rollback, serving/no-show race outcomes, and cancelled/disabled/served/date exclusion.
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
- `yarn workspace @imeal/worker exec tsc --noEmit` — PASS.
- `yarn workspace @imeal/api exec tsc --noEmit` — PASS.
- `yarn workspace @imeal/core exec tsc --noEmit` — PASS.
- `git diff --check` — PASS; Git reported only the repository's existing LF-to-CRLF working-copy normalization warning.

## Concerns/blockers
- No disposable PostgreSQL/Docker run was available in this focused worker/API verification, so real PostgreSQL concurrency and migration-backed unique-index behavior remain for the later Task 8/database gates. The implementation uses parameterized Prisma SQL locks and the Task 1 `Penalty.registrationId` partial unique index.
- Expected rollback/cron-rethrow tests log errors through Nest's logger while asserting the failures; the focused test commands still pass.

## Commit
- `590e329` — `fix: make no-show penalties retry-safe per registration`
