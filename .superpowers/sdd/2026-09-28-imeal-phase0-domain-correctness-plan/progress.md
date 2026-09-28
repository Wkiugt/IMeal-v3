# SDD ledger — plan: docs/superpowers/plans/2026-09-28-imeal-phase0-domain-correctness-plan.md

## Setup

- Worktree: isolated existing worktree `C:/Users/0xKoigzzzz/orca/workspaces/IMeal/develop`, branch `Wkiugt/develop`; the repository's separate main worktree is `D:/My-Project/IEC/IMeal` on `master`. No worktree was created or switched.
- Base commit: `18200c66468c1fc292492d005ac49d8c03630537` (`git rev-parse HEAD`).
- User-owned untracked files observed before setup (`docs/imeal-production-readiness-assessment.md`, the plan, and the spec) were left untouched.
- Plan-specific workspace: `.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/`.
- Approved spec read once: `docs/superpowers/specs/2026-09-28-imeal-phase0-domain-correctness-design.md`.
- Setup restriction: no source, tests, migrations, configs, or docs were edited; no tests/build/migration/formatter commands were run.

## Task ledger

- [x] Task 1: Additive Prisma schema, read-only preflight, and safe migration
- [x] Task 2: Update shared response contracts without adding authority inputs
- [x] Task 3: Make registration writes resolve and persist immutable snapshots
- [x] Task 4: Enforce pickup snapshot reads and serving snapshot writes
- [x] Task 5: Replace ACTIVE-only Kitchen dashboard with a canonical projection
- [x] Task 6: Make no-show and penalty processing per-registration, lock-safe, and retryable
- [x] Task 7: Publish only committed dashboard events
- [x] Task 8: Prove cross-transaction concurrency and all-or-nothing behavior on PostgreSQL
- [ ] Task 9: Execute migration rollout gates and update canonical documentation

## Preflight conflict scan

The scan covers each task's internal consistency, every pair sharing a file or interface, global-constraint contradictions, test-quality defects (tautological/source-text/mock-wiring-only tests), and migration/rollout sequencing. The spec is the authority where plan text is ambiguous.

### One row per task (self-consistency)

| Task | Self-consistency check | Finding / ruling |
|---|---|---|
| 1 | Schema fields, migration/preflight/backfill SQL, persistence tests, and verification commands agree on additive/null-preserving rollout. | Clean. Named checks and the seven preflight checks are consistent; backfill is separate from migration. Tests assert persistence/invariants rather than source text. |
| 2 | Response-only contract fields, strictness rules, unchanged pickup input, and contract tests agree. | Clean. Tests exercise parse/reject behavior; no client authority input is introduced. |
| 3 | Registration snapshot resolver, menu publication, lifecycle writes, tests, and response mapping agree. | Ruling: multiple historical revisions are expected; choose the deterministic latest published revision and reject only zero or genuinely ambiguous tied/current candidates. This reconciles “revision DESC, id DESC” with “reject ambiguous”; if wrong, revision-selection tests and registration writes need rework. |
| 4 | Complete-snapshot predicate, pickup reads, serving writes, idempotency, and route-preservation tests agree. | Clean. Nullable description/image are explicitly allowed while required revision/name/location fields remain mandatory; no current-value fallback is permitted. |
| 5 | One-query dashboard projection, invariant validation, account filtering, counters/lists, and tests agree. | Clean. CANCELLED+serving is loaded only to detect the forbidden invariant, then valid cancelled rows are excluded. |
| 6 | Per-registration lock order, 13:30 eligibility/13:45 scheduler gate, penalty uniqueness, atomic side effects, admin mapping, and tests agree. | Clean. Worker is sequenced after the schema/unique key and before cross-transaction proof; retry preserves PAID/WAIVED. |
| 7 | Post-commit API events, transactional worker outbox, event types, stable identities, and timing tests agree. | Clean. Worker does not call the in-memory API event service; cancellation/reactivation emission occurs only after transaction commit. |
| 8 | Derived serving expectations, real PostgreSQL races, route/envelope scenarios, and focused verification agree. | Ruling: the missing “Step 4” number is a plan numbering defect only; execute the listed route/envelope step as Step 5 without inventing an omitted implementation step. If the gap hid required work, later race/e2e coverage would expose it and the plan would need amendment. |
| 9 | Expand/preflight/backfill/validate/verification/docs sequence agrees with the rollout policy. | Clean. Docs are updated only from observed evidence after implementation and staging gates; no rollout command is part of setup. |

### One row per shared file or interface pair

| Pair | Producer / consumer relationship | Finding / ruling |
|---|---|---|
| 1 ↔ 2 | Task 1 adds nullable schema/revision/penalty fields; Task 2 exposes selected fields as response-only contracts. | Clean; schema nullability maps to explicit nullable response fields, and request schemas remain authoritative. |
| 1 ↔ 3 | Task 1 produces registration/menu/assignment persistence fields and unique/restrictive relations; Task 3 writes/resolves them. | Clean; Task 1 must land first so Prisma types/relations exist before service changes. |
| 1 ↔ 4 | Task 1 produces registration and serving snapshot columns; Task 4 reads/copies them. | Clean; missing legacy values fail closed rather than being fabricated. |
| 1 ↔ 5 | Task 1 defines registration/serving state constraints; Task 5 projects those rows. | Clean; dashboard detects mismatches and does not repair them. |
| 1 ↔ 6 | Task 1 adds `Penalty.registrationId`/`mealDate` uniqueness; Task 6 uses that identity for locked retry-safe writes. | Clean; unique registration identity is database authority, so Task 6 follows migration/schema work. |
| 1 ↔ 8 | Task 1 persistence/migration surface establishes uniqueness and derived-serving facts; Task 8 proves them against PostgreSQL. | Clean; Task 8 is intentionally later and uses real constraints rather than mocks. |
| 1 ↔ 9 | Task 1 creates additive migration/preflight/backfill artifacts; Task 9 deploys and gates them. | Clean; expand → preflight approval → exact backfill → validation is preserved. |
| 2 ↔ 3 | Task 2 extends registration/week-menu response schemas; Task 3 maps resolver/publication results into those responses. | Clean; fields are server-returned and nullable only for legacy rows. |
| 2 ↔ 4 | Task 2 explicitly preserves pickup input schemas; Task 4 consumes those unchanged route inputs. | Clean; no location/menu aliases or authority inputs are added. |
| 2 ↔ 5 | Task 2 adds kitchen `state` and invariant; Task 5 populates the projection consumed by that contract. | Clean; `isServed === (state === 'SERVED')` is exercised behaviorally. |
| 2 ↔ 6 | Task 2 adds nullable penalty relation/date response fields; Task 6 maps new worker-created penalties through admin responses. | Clean; legacy rows remain nullable and admin still cannot create penalties. |
| 2 ↔ 8 | Task 2 contract boundaries are asserted by Task 8 route/e2e scenarios. | Clean; exact pickup intent/idempotency and client-authority rejection remain covered. |
| 3 ↔ 4 | Task 3 produces immutable registration snapshots; Task 4 requires them for pickup and copies them into serving. | Clean; a registration write is not successful when required resolution/snapshot persistence fails. |
| 3 ↔ 5 | Task 3 produces lifecycle/status rows; Task 5 derives dashboard membership from status plus serving. | Clean; ACTIVE+serving remains served projection and cancelled/disabled rows are excluded after invariant checks. |
| 3 ↔ 6 | Task 3 cancels/reactivates registrations; Task 6 discovers/rechecks only eligible ACTIVE rows under lock. | Clean; account-disabled/cancelled/final rows cannot become no-show. |
| 3 ↔ 7 | Task 3 owns cancellation/reactivation transaction paths; Task 7 adds post-commit `REGISTRATION_CHANGED` emission. | Clean; event emission is after commit and cannot roll back committed lifecycle data. |
| 3 ↔ 8 | Task 3 registration writes/menu-roster staleness are exercised by Task 8 concurrency/e2e scenarios. | Clean; Task 8 consumes the server-authoritative resolver and one-row lifecycle semantics. |
| 4 ↔ 5 | Task 4 creates canonical `mealServings`; Task 5 counts/lists them as the served authority. | Clean; no duplicate registration `SERVED` write is required for new serving. |
| 4 ↔ 6 | Task 4 serving confirmation races Task 6 no-show processing on the registration lock. | Clean; canonical lock order gives one winner and prevents losing side effects. |
| 4 ↔ 7 | Task 4 retains serving transaction result/post-commit path; Task 7 specifies stable `SERVING_CONFIRMED` emission. | Clean; event only follows successful transaction and excludes sensitive payloads. |
| 4 ↔ 8 | Task 4 pickup/serving behavior is tested by Task 8 real races and route scenarios. | Clean; stale snapshot, idempotency, all-or-nothing, and serving/no-show/cancel winner behavior are cross-layer proofs. |
| 5 ↔ 7 | Task 5 dashboard tests share the event-timing surface with Task 7's event tests. | Clean; projection is computed from committed state, while event assertions verify no pre-commit visibility. |
| 5 ↔ 8 | Task 5 dashboard projection is consumed by Task 8 dashboard route/envelope e2e tests. | Clean; both aliases preserve state fields and generic internal-error envelopes. |
| 6 ↔ 7 | Task 6 writes transactional no-show outbox rows; Task 7 defines their event type/dedupe and publisher boundary. | Clean; outbox is inside the business transaction, API in-memory emission is not used by worker. |
| 6 ↔ 8 | Task 6 lock/retry/penalty semantics are proved by Task 8 concurrent worker and serving/no-show races. | Clean; real PostgreSQL unique/row-lock behavior, not mock wiring, is required. |
| 7 ↔ 8 | Task 7 event timing and identity are verified by Task 8's cross-layer e2e/concurrency evidence. | Clean; route/domain assertions consume only committed event/outbox state. |
| 8 ↔ 9 | Task 8 produces focused race/e2e evidence; Task 9 uses it as a prerequisite for rollout gate and documentation updates. | Clean; docs cannot claim closure before evidence exists. |

### Global constraints, quality, and sequencing conclusions

- No contradiction was found with timezone (`Asia/Ho_Chi_Minh`), 10:30–13:30 serving, 13:30 eligibility versus 13:45 normal scheduling, exact routes/envelopes, no client authority, derived serving projection, or post-commit event requirements.
- No specified permanent test is a tautology, source-text assertion, or pure mock-wiring check on its face; the plan explicitly calls for real PostgreSQL locks/uniques for concurrency and migration behavior for persistence. Test implementations must preserve that standard.
- Migration/rollout sequencing is coherent: Task 1 expand/preflight/backfill surface precedes Tasks 3–8 consumers/proofs; Task 9 runs staging gates and updates docs last. The setup session does not execute those commands.
- Ruling: although the spec file currently labels itself “Draft — pending user review,” the user explicitly identified it as the approved spec for this execution. Treat its contents as binding authority for this SDD run; if that label reflects an actual unapproval, implementation may need to be paused/replanned before source changes begin.
- Task 1: fix round 1/5 (3 addressed, 1 open — Critical serving-side invariant remains non-concurrency-safe; commits 1f5ff0f..397207f)
- Task 1: fix round 2/5 (1 addressed, 0 open — race-safe parent locking and two-client proof; commits 397207f..aff3426)
- Task 1: complete (commits 1f5ff0f..aff3426, review clean)
- Task 2: complete (commits aff3426..9441257, review clean)
- Task 3: fix round 1/5 (4 addressed, 0 open; commits 878b023..25f9e7b)
- Task 3: complete (commits 878b023..25f9e7b, review clean)
Task 4: fix round 1/5 (1 Important canonical revision selection, 1 Important insufficient consumer/database behavior proof; commits 6051fdf..808f71f7c791ccc76e6492044b5ffdc7e8c6188a)
Task 4: complete (commits 6051fdf..808f71f7, review clean; requested report hash had a typo)
Task 5: fix round 1/5 (3 findings addressed; commits a29b726..b127fa5)
Task 5: fix round 2/5 (3 prior findings addressed; commits 0941f30..3cbc1af)
Task 5: complete (commits a29b726..b127fa5, review clean with PostgreSQL e2e unavailable)
Task 6: fix round 1/5 (3 findings addressed; commits b2fdea4..e11cc34)
Task 6: complete (commits b2fdea475ad5d181596493c2a2cc7be5625637d4..e11cc3472dd246601ff8b7b6fde1427670b1e0c9, review clean with PostgreSQL e2e unavailable)
Task 7: fix round 1/5 (P1/P2 addressed in test design; PostgreSQL e2e unexecuted; commits 1bb23c6..15922009)
Task 7 environmental evidence gate: PostgreSQL worker/API e2e remains unexecuted because DATABASE_URL was unavailable; no database evidence was fabricated.
Task 7: complete with environmental evidence gate (commits 1bb23c6fac30f7d69ec0490a129cade2148b0c29..1592200958e400b2ced512515d38803196beb41f; review conditional)
Task 8: fix round 1/5 (all findings addressed; commits 5d30e44..73978ca)
Task 8: fix round 2/5 (all findings addressed; commits 73978ca..70c91cb)
Task 8: complete (commits 5d30e44ad14325f99482dfe817ec5215e2c85f39..70c91cbea46d0ed18c45e3dec969ccc0fe119d28, review GO with evidence caveat)
Task 9: fix round 1/5 (F1/F3-F8 addressed; F2 remains external staging/approval gate; commits 9953f4a..e5982e3)
Task 9: local rollout package complete but blocked (commit e5982e3202c476646ee89bda979e637f55dfbc65; review NO-GO until approved staging/representative evidence and independent approval/audit reference)
