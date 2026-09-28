# Task 6 brief — lock-safe per-registration no-show processing

## Scope
Replace batch no-show writes in `apps/worker/src/no-show-worker.service.ts` with one independently committed transaction per candidate registration. Preserve the normal 13:45 worker gate while allowing the domain predicate at/after 13:30 for explicit forced/manual recovery. Use registration-first row locking, registration-scoped penalty identity, and atomic registration/penalty/audit/notification/outbox writes. Map nullable registration metadata in admin penalty responses without changing routes, envelopes, or admin authority.

## Acceptance criteria
- Candidate discovery is target-date, `ACTIVE`, active-account, no-serving, and deterministic by registration ID; each candidate runs in its own transaction.
- Each transaction locks the registration first (`FOR UPDATE`), rechecks `ACTIVE`, eligible time, active account, date, and no serving; served, cancelled, disabled, and otherwise finalized rows are skipped without side effects.
- Domain eligibility is strictly `serverNow >= 13:30` Vietnam time. The normal no-show scheduler still rejects today before 13:45 unless `force=true`; forced/manual processing after 13:30 is allowed.
- A successful transaction creates/reuses exactly one penalty keyed by `registrationId`, with `mealDate`, amount `50000`, reason `NO_SHOW`, and `PENDING` for new rows; owner/date/amount/reason mismatches fail closed.
- Registration `NO_SHOW`/`noShowAt`, immutable audit, deduped notification (`no-show-penalty:{userId}:{registrationId}`), and transactional outbox (`kitchen:no-show:{registrationId}`, `NO_SHOW_RECONCILED`) commit atomically; side-effect failure rolls all business writes back.
- Retries are no-ops for completed rows and never duplicate penalty, audit, notification, or outbox; existing `PAID`/`WAIVED` penalties remain unchanged.
- Admin list responses map nullable `registrationId` and `mealDate`; paid/waived transitions remain row-locked and cannot create/reopen penalties or alter registration state.
- Permanent tests cover 13:30/13:45 boundaries, lock order, atomicity/rollback, concurrency/race outcomes, idempotency, paid/waived preservation, disabled/cancelled/served exclusion, and admin response mapping.
- Do not implement Task 7 realtime/client work, infrastructure, or P1 behavior.

## Relevant files
- `apps/worker/src/no-show-worker.service.ts`
- `apps/worker/src/no-show-worker.service.spec.ts`
- `apps/api/src/admin/penalties/penalties.service.ts`
- `apps/api/src/admin/penalties/penalties.service.spec.ts`
- Prisma fields/relations added by Task 1, including `Penalty.registrationId` and `mealDate`.

## Verification
Run focused commands from the approved plan:
- `yarn workspace @imeal/worker exec vitest run src/no-show-worker.service.spec.ts`
- `yarn workspace @imeal/api exec vitest run src/admin/penalties/penalties.service.spec.ts`
- Run worker/API/domain typechecks as needed to prove changed code compiles and inspect the final diff.

## Report
Write `.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-6-report.md` with exact changed files, commands/results, evidence, blockers/concerns, and exact commit hash. Commit source/tests and this brief/report. Do not modify `progress.md`.
