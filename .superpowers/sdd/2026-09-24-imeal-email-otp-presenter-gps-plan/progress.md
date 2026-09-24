# SDD ledger — plan: docs/superpowers/plans/2026-09-24-imeal-email-otp-presenter-gps-plan.md

- Workspace: existing isolated repository workspace
- Identity: task2-persistence worker

## Preflight scan

| Task | Shared file/interface | Finding | Ruling |
| --- | --- | --- | --- |
| 1 → 2 | `packages/contracts/src/v1/*` → Prisma persistence | Task 1 provides OTP, location, roster, exact pickup, and serving-verification shapes; Task 2 persists server-side counterparts without changing contracts. | Use Task 1 commit `ddcb635` as the contract boundary. |
| 2 → 3–9 | Prisma models → API/mobile/admin/worker callers | Task 2 must expose nullable/additive historical fields where existing callers cannot yet populate immutable snapshots; later tasks enforce required new write paths. | Preserve existing create callers and historical rows while adding indexes/FKs and snapshot columns. |
| 2 self-consistency | Schema, migration, DB tests | Tests require zero operational rows after migration, unique session/serving boundaries, and immutable registration snapshots; migration must contain no operational inserts. | Use fixture rows only inside tests; migration is additive/transformative and seed-free for locations/employees. |

## Progress

- [x] Official Task 2 brief generated/read via `subagent-driven-development` SDD helper.
- [x] Current migration history inspected; next migration remains `20260924000000_email_otp_presenter_gps`.
- [x] RED persistence assertions written; direct Yarn unavailable and Corepack run blocked before assertions by unavailable PostgreSQL.
- [x] Prisma schema and checked-in additive migration implemented; no operational location/employee seed rows.
- [x] Prisma validate, client generation, domain TypeScript validation, and diff hygiene passed.
- [!] GREEN DB persistence/registration tests blocked by unavailable Docker/PostgreSQL at `localhost:6432`.
- [x] Commit `c6557ee` — `feat(domain): add otp session location roster and serving snapshots`.
- [!] Task 2 status: BLOCKED for DB-backed verification; report at `task-2-report.md`.
- [x] Review Fix Round 1: legacy nullable pickup intent backfill, NOT VALID pickup ownership FK, all-active employee-code uniqueness, finite float checks, and regression assertion.
- [x] Fix commit `5205e72`.
- [!] Review-fix DB verification remains blocked by unavailable PostgreSQL/Docker; static checks passed.
- [x] Review Fix Round 2: valid serving verification now requires non-null finite accuracy; schema documentation and DB assertion added.
- [x] Fix commit `2eebaae`.
- [!] Review-fix DB verification remains blocked by unavailable PostgreSQL/Docker; static checks passed.
- [x] Review Fix Round 3: restored `serving_verifications_pkey` before the conditional accuracy check; duplicate-ID DB assertion added.
- [x] Fix commit `d736877`.
- [!] Review-fix DB verification remains blocked by unavailable PostgreSQL/Docker; static checks passed.
- [x] Task 2 fix round 4/5 — `5205e72` — legacy nullable pickup intent normalization, safe `NOT VALID` ownership FK, all-active employee-code uniqueness, finite float checks.
- [x] Task 2 fix round 5/5 — `2eebaae` — `VALID` serving verification requires non-null finite accuracy; schema note and DB assertion.
- [x] Task 2 PK fix — `d736877` — restored `serving_verifications_pkey` before the conditional accuracy check; duplicate-ID assertion.
- [x] Task 2: complete with DB verification blocked by unavailable PostgreSQL/Docker; static review approved.

- Task 1 complete through commit `ddcb635`; contract boundary consumed by this task.

- [x] Official Task 3 brief read from the approved plan/spec (the generated `task-3-brief.md` artifact was absent; Task 3 lines 368–457 were used verbatim as the brief).
- [x] RED OTP/controller/environment tests written and observed failing before implementation.
- [x] Task 3 allowlist-A OTP request/verify, redacted audit, hash-only challenge, throttles, conditional consumption, outbox row, controller routes, and production config guards implemented.
- [x] Focused GREEN: API OTP/controller/environment tests — 3 files, 21 tests passed.
- [x] API TypeScript validation passed; API lint exited 0 with pre-existing repository warnings; `git diff --check` passed.
- [x] Commit `90c1432` — `feat(api): add allowlist email otp authentication`.
- [!] DB-backed verification remains blocked by Task 2's unavailable PostgreSQL/Docker (`localhost:6432` refused; Docker Linux engine unavailable).
- [x] Task 3 complete; report at `task-3-report.md`.

- [x] Review fix round 1: request throttling/resend responses are now the same `{ accepted: true }` shape as ineligible responses; redacted internal audit outcomes remain.
- [x] Review fix round 1: per-client rate limiting now acquires sorted PostgreSQL transaction advisory locks keyed by hashed client identities across allowlisted addresses; no schema change required.
- [x] Review fix round 1 commit `43e4b05`; focused tests 22 passed, API TypeScript passed, lint exited 0 with pre-existing warnings, and `git diff --check` passed.

- [x] Review fix round 2: client advisory lock(s) now supplement, rather than replace, the eligible allowlist `FOR UPDATE` row lock; acquisition order is sorted client keys then address row to avoid cycles.
- [x] Review fix round 2 commit `02d0893`; concurrent two-address lock test now passes with both lock classes, focused tests 22 passed, API TypeScript passed, lint exited 0 with pre-existing warnings, and `git diff --check` passed.
- [x] Official Task 4 SDD brief generated from the approved plan (artifact: `task-4-brief.md`).
- [x] RED session/guard tests written and observed failing before the new session modules existed.
- [x] Opaque 32-byte database sessions implemented with one-way token hashes, minimized hashed metadata, creation/revocation audit linkage, idle and absolute expiry, last-used refresh, current-user/role/permission resolution, and all closed-set revocation reasons.
- [x] `VerifyOtp` creates exactly one session and returns only `VerifyOtpResponse` token/expiresAt/user; logout revokes `LOGOUT`; account-wide revocation helper and disabled-account revocation are available.
- [x] All protected API controllers migrated from JWT guard to `SessionGuard`; Entra/local production bootstrap files/tests/dependencies removed; config fails closed for legacy modes and non-test bypass.
- [x] Focused Task 4/auth verification: 5 files, 33 tests passed; full API suite: 15 files, 125 tests passed.
- [x] API TypeScript validation passed; API lint exited 0 with pre-existing warnings; `git diff --check` passed; Yarn immutable install passed with peer warnings.
- [!] DB-backed session verification remains blocked by unavailable PostgreSQL/Docker (`localhost:6432` refused; Docker Linux engine unavailable); Prisma-mock/static verification is complete.
- [!] Scope note: mobile/admin clients, `.env.example`, Docker Compose, and docs retain legacy references by explicit user instruction to exclude those tasks.
- [x] Task 4 committed as `25246d1` — `feat(api): replace production jwt bootstrap with opaque sessions`.
- [x] Task 4 report: `task-4-report.md`; review package input path is the plan workspace plus commit `25246d1`.
- [!] Task 4 complete with DB verification blocked by unavailable PostgreSQL/Docker; focused/mock/static checks are green.
- [x] Task 4 review fix: `SessionGuard` now returns canonical structured `SESSION_INVALID` for both absent and invalid bearer tokens; regression RED/GREEN verified.
- [x] Task 4 fix commit `771aeb6`; focused 33 tests and full API 125 tests passed; API tsc/lint/diff-check passed.
- [x] Scoped review package: `review-25246d1..771aeb6.diff`.

- [x] Official Task 5 SDD brief generated/read from plan lines 531–595; artifact: `task-5-brief.md`.
- [x] RED worker/API provider/outbox tests observed before implementation (missing production modules).
- [x] Task 5 implemented: encrypted provider payload in `providerPayloadRef`, transactional API enqueue, atomic `SKIP LOCKED` worker claim, expiry/consumed suppression, bounded exponential retry/max attempts, redacted audit/logging, minimal provider copy, and production fail-closed provider/encryption configuration.
- [x] Focused GREEN: API OTP/provider/outbox/controller/environment tests — 5 files, 33 tests passed; worker OTP delivery tests — 1 file, 3 tests passed.
- [x] API and worker TypeScript validation passed; API and worker lint exited 0 (API only pre-existing warnings); `git diff --check` passed.
- [!] Live PostgreSQL/outbox verification remains blocked: `localhost:6432` refused and Docker Desktop Linux engine unavailable; Prisma-shaped transaction tests do not claim live DB coverage.
- [x] Task 5 report: `task-5-report.md`.
- [x] Task 5 commit `f263a41` — `feat(worker): deliver otp through transactional outbox` (amended provider error classification hardening).
- [x] Task 5 review package recorded in `task-5-report.md`.

- [x] Task 5 review fix: worker startup validates encryption/config before boot; max-attempt cleanup preserves active `PROCESSING` claims; a no-argument cron wrapper delegates to direct processing; and current-time challenge state is checked before and immediately before provider send.
- [x] Task 5 claim ownership hardening: added nullable `claim_token` schema/migration field; worker/API claim batches assign fresh tokens and validation/processed/failed transitions require the token, preventing stale workers from completing reclaimed rows.
- [x] Task 5 review-fix regression coverage: worker focused suite — 1 file, 10 tests passed; API focused suite — 5 files, 33 tests passed; API/worker TypeScript, lint, Prisma validation, and diff-check passed (API lint retains pre-existing warnings).
- [!] Live PostgreSQL verification remains blocked by the same unavailable `localhost:6432`/Docker environment.
- [x] Task 5 review-fix commits `8db34ef`, `6ca4c3d`, and `9ac7a1e` (`fix(worker): preserve cron and claim ownership`).
- [x] Scoped review package: `review-f263a41..9ac7a1e.diff`.
- [!] Claim lease ownership closes stale-worker row transitions; external provider acceptance after a worker crash remains the documented unavoidable at-least-once ambiguity.

- [x] Official Task 6 brief generated/read from plan lines 599–675; artifact: `task-6-brief.md`.
- [x] RED Task 6 API location/roster tests observed failing before new modules existed; review regressions covered replay preview, atomic staging, policy boundaries, safe GPS mapping, audit IDs, and allowlist email validation.
- [x] Task 6 implemented: effective active location/policy resolution, server-side geofence/freshness/accuracy checks with canonical safe retry errors, authorized location/roster/allowlist admin endpoints, normalized strict roster preview validation with transactional staging, atomic/idempotent roster commit, and no fabricated operational data.
- [x] Registration snapshots now resolve server-side effective assignment by user ID/normalized email and preserve immutable location/assignment/name/address values on reactivation/update; related location active/effective predicates are part of assignment selection.
- [x] Task 6 review-focused GREEN: API roster/location/allowlist suites — 3 files, 14 tests passed; full API suite — 20 files, 148 tests passed.
- [x] Task 6 API/core TypeScript validation passed; API lint exited 0 with only pre-existing warnings; `git diff --check` passed.
- [!] Task 6 domain DB-backed tests remain blocked: no `DATABASE_URL` in default domain setup; focused run stopped before tests with `DATABASE_URL is not set in environment or .env.test`. Domain TypeScript validation passed.
- [x] Task 6 review-fix commit `0e87b57` — `feat(admin): add approved locations roster imports and snapshots`; report at `task-6-report.md`; review package input baseline `9ac7a1e`.
