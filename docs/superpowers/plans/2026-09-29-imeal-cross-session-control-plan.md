# IMeal Cross-Session Control Plan

> Durable control file for resuming work across sessions. This is a status, evidence, dependency, and handoff record; it is not a duplicate implementation plan.
>
> **Last reviewed:** 2026-09-29, from checked-in repository evidence only.

## Project objective and scope boundary

**Objective:** complete and preserve the Phase 0 domain-correctness implementation, obtain independently reviewable staging/release evidence, and begin the Phase 1 pilot/product work only after the release gate is approved.

**In scope:**

- Track implementation state, release-gate state, dependencies, owners, evidence, blockers, and safe next actions.
- Keep the distinction between implementation-complete and release-ready explicit.
- Record commands and externally retained artifacts needed to advance the gate.

**Out of scope:**

- Repeating the detailed implementation steps in the dated plans.
- Treating local, disposable, synthetic, unit, or repository-only results as staging or production approval.
- Committing credentials, OTPs, real employee/location data, provider payloads, or external approval claims.
- Starting Phase 1 product work before the Phase 0 release gate is approved.

Canonical implementation plans and operational guidance remain the dated plans and runbook linked below. This file coordinates them; it does not replace them.

## Current state

| Area | Current state | Evidence and interpretation |
| --- | --- | --- |
| Phase 0 domain correctness Tasks 1–8 | **IMPLEMENTATION-COMPLETE / DONE** | The SDD ledger records Tasks 1–8 complete. Fresh local/disposable verification is recorded as core focused 42/42, serial full core 93/93, API e2e 45/45 plus production concurrency 12/12, worker e2e 5/5, workspace typecheck PASS, and mobile `tsc` PASS. These are implementation evidence, not release approval. See [`progress.md`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/progress.md), task reports, and [`final-step3-review.md`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/final-step3-review.md). |
| Phase 0 Task 9 rollout | **CONDITIONAL / NO-GO** | The disposable expand → preflight → idempotent backfill → post-preflight → constraint-validation sequence is green, but no approved staging/representative target, independent approval/audit record, backup/restore rehearsal, rollback authority, or production/UAT evidence is available. The dirty local public schema was not backfilled. See [`task-9-report.md`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-9-report.md) and [`final-step3-review.md`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/final-step3-review.md). |
| Production hardening | **IMPLEMENTATION-COMPLETE / DONE** | The hardening ledger and Task 9 report record Tasks 1–9 complete: observability/configuration, Prisma lifecycle, health, request correlation/logging, shutdown, production Compose/Caddy, and direct-primary migration gate. No production services or credentials were used. See [`production-hardening-plan/progress.md`](../../../.superpowers/sdd/production-hardening-plan/progress.md) and [`production-hardening-plan/task-9-report.md`](../../../.superpowers/sdd/production-hardening-plan/task-9-report.md). |
| Staging-readiness repository surface | **IMPLEMENTATION-COMPLETE / DONE (repository only)** | The staging tooling, Compose/Caddy boundary, workflow, alert rules, release/evidence helpers, and runbook exist on observed branch `develop/Hardening`. Their presence does not prove an external staging target or release qualification. See [`2026-09-28-staging-readiness-plan.md`](2026-09-28-staging-readiness-plan.md), [`staging-readiness.md`](../../runbooks/staging-readiness.md), and [`staging-readiness.yml`](../../../.github/workflows/staging-readiness.yml). |
| Staging/release qualification | **BLOCKED / CONDITIONAL / NO-GO** | The runbook reports no real staging environment, DNS/TLS, OTP provider path, backup/restore rehearsal, alert delivery, UAT, identity approval, or location/roster approval. The private worker `/metrics` endpoint and verifier now exist, but real API-to-worker transport/flush, authoritative collector callers, protected bindings, and qualification evidence remain absent; protected runtime integration still fails closed. See [`staging-readiness.md`](../../runbooks/staging-readiness.md) and [`imeal-production-readiness-assessment.md`](../../imeal-production-readiness-assessment.md). |
| Phase 1 product/pilot work | **NOT_STARTED** | The product gaps and one-canteen pilot remain after the Phase 0 gate; no Phase 1 product task is claimed complete here. See the P1 list and pilot sequence in [`imeal-production-readiness-assessment.md`](../../imeal-production-readiness-assessment.md). |

### Implementation-complete versus release-ready

- **Implementation-complete** means the repository code/tooling and its recorded focused evidence satisfy the relevant implementation scope.
- **Release-ready** additionally requires an approved representative staging target, target-specific migration/preflight/backfill/validation evidence, independent approval, encrypted backup and restore rehearsal with RPO/RTO, rollback authority, security/edge/observability evidence, provisioned identity/roster/location/provider inputs, and native/device/UAT and smoke evidence.
- No local or disposable result in this file, the SDD reports, or the runbook is production approval. The release decision remains **CONDITIONAL / NO-GO** until external gates are independently evidenced.

## Status vocabulary

Use only these values in the matrix. `CONDITIONAL / NO-GO` is a deliberate release-gate state, not a synonym for implementation failure.

| Status | Meaning |
| --- | --- |
| `DONE` | The scoped repository work is implemented and its cited evidence is observed. |
| `IN_PROGRESS` | Work is actively being performed in the named session; do not infer completion from intent. |
| `BLOCKED` | The next required action cannot proceed until the cited blocker is removed. |
| `NOT_STARTED` | No implementation or qualification work is claimed for the scoped item. |
| `CONDITIONAL / NO-GO` | Some implementation/local evidence exists, but a release decision is explicitly withheld pending named gates. |

## Phase/task control matrix

Owner/session values are placeholders until a future session claims them. Evidence links point to repository artifacts; external evidence belongs in the protected evidence directory described by the runbook and MUST NOT be fabricated here.

| ID | Phase / task | Status | Dependencies | Owner / session | Evidence / report links | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| `P0-DOM-01` | Additive schema, preflight, and safe migration | `DONE` | — | `[owner/session]` | [`task-1-report.md`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-1-report.md) | Preserve; consume in target-safe rollout. |
| `P0-DOM-02` | Shared response contracts without new authority inputs | `DONE` | `P0-DOM-01` | `[owner/session]` | [`task-2-report.md`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-2-report.md) | Preserve; verify against staging consumers during qualification. |
| `P0-DOM-03` | Registration snapshots and menu publication | `DONE` | `P0-DOM-01`, `P0-DOM-02` | `[owner/session]` | [`task-3-report.md`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-3-report.md) | Preserve; use representative-data preflight before cutover. |
| `P0-DOM-04` | Fail-closed pickup reads and serving snapshot writes | `DONE` | `P0-DOM-01`, `P0-DOM-03` | `[owner/session]` | [`task-4-report.md`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-4-report.md) | Preserve; include in staging serving smoke. |
| `P0-DOM-05` | Canonical Kitchen dashboard projection | `DONE` | `P0-DOM-02`, `P0-DOM-04` | `[owner/session]` | [`task-5-report.md`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-5-report.md) | Preserve; verify dashboard evidence on target. |
| `P0-DOM-06` | Lock-safe no-show and penalty processing | `DONE` | `P0-DOM-01`, `P0-DOM-03` | `[owner/session]` | [`task-6-report.md`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-6-report.md) | Preserve; include retry/no-show evidence in smoke/UAT. |
| `P0-DOM-07` | Committed dashboard events and outbox behavior | `DONE` | `P0-DOM-04`, `P0-DOM-05`, `P0-DOM-06` | `[owner/session]` | [`task-7-report.md`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-7-report.md) | Preserve; verify event/recovery behavior on staging. |
| `P0-DOM-08` | PostgreSQL concurrency and all-or-nothing proof | `DONE` | `P0-DOM-01`–`P0-DOM-07` | `[owner/session]` | [`task-8-report.md`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-8-report.md) | Preserve; rerun only against an isolated approved target when authorized. |
| `P0-DOM-09` | Rollout gates and canonical documentation | `CONDITIONAL / NO-GO` | `P0-DOM-01`–`P0-DOM-08`, staging prerequisites | `[owner/session]` | [`task-9-report.md`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-9-report.md), [`docs/06-execution-plan.md`](../../06-execution-plan.md) | Obtain independent staging/approval, backup/restore, representative-data, and rollback evidence; do not backfill before approval. |
| `HARD-01` | Hardening Task 1: shared observability and migration-evidence primitives | `DONE` | — | `[owner/session]` | [`task-1-report.md`](../../../.superpowers/sdd/production-hardening-plan/task-1-report.md) | Preserve; staging consumes the stable redaction/evidence contract. |
| `HARD-02` | Hardening Task 2: fail-closed API/worker environment validation | `DONE` | `HARD-01` | `[owner/session]` | [`task-2-report.md`](../../../.superpowers/sdd/production-hardening-plan/task-2-report.md) | Preserve; verify protected environment inputs externally. |
| `HARD-03` | Hardening Task 3: API Prisma lifecycle | `DONE` | `HARD-02` | `[owner/session]` | [`task-3-report.md`](../../../.superpowers/sdd/production-hardening-plan/task-3-report.md) | Preserve; consume lifecycle ownership in deployment. |
| `HARD-04` | Hardening Task 4: worker Prisma lifecycle | `DONE` | `HARD-03` | `[owner/session]` | [`task-4-report.md`](../../../.superpowers/sdd/production-hardening-plan/task-4-report.md) | Preserve; consume lifecycle ownership in deployment. |
| `HARD-05` | Hardening Task 5: API/worker health and readiness | `DONE` | `HARD-03`, `HARD-04` | `[owner/session]` | [`task-5-report.md`](../../../.superpowers/sdd/production-hardening-plan/task-5-report.md) | Preserve; prove target readiness and safe 503 behavior. |
| `HARD-06` | Hardening Task 6: request IDs, structured logs, and redaction | `DONE` | `HARD-05` | `[owner/session]` | [`task-6-report.md`](../../../.superpowers/sdd/production-hardening-plan/task-6-report.md) | Preserve; verify log/telemetry redaction on staging. |
| `HARD-07` | Hardening Task 7: graceful shutdown coordination | `DONE` | `HARD-05`, `HARD-06` | `[owner/session]` | [`task-7-report.md`](../../../.superpowers/sdd/production-hardening-plan/task-7-report.md) | Preserve; exercise restart/drain evidence in smoke. |
| `HARD-08` | Hardening Task 8: private production Compose/Caddy boundary | `DONE` | `HARD-05`, `HARD-07` | `[owner/session]` | [`task-8-report.md`](../../../.superpowers/sdd/production-hardening-plan/task-8-report.md) | Preserve; render and review only with protected values. |
| `HARD-09` | Hardening Task 9: direct-primary migration gate | `DONE` | `HARD-08` | `[owner/session]` | [`task-9-report.md`](../../../.superpowers/sdd/production-hardening-plan/task-9-report.md) | Consume the released gate; production data-specific outcomes still require staging evidence. |
| `STG-REPO-01` | Staging safety/evidence tooling, boundary, workflow, alerts, manifest, and runbook | `DONE` | `HARD-01`–`HARD-09` | `[owner/session]` | [`staging plan`](2026-09-28-staging-readiness-plan.md), [`staging runbook`](../../runbooks/staging-readiness.md), [`staging workflow`](../../../.github/workflows/staging-readiness.yml) | Keep repository checks aligned; use external evidence for qualification. |
| `STG-METRICS-01` | Hardening-owned metrics collector/endpoint required by protected runtime integration | `BLOCKED` | `HARD-01`–`HARD-09`, runtime owner decision | `[platform/runtime owner/session]` | [`staging runbook blockers`](../../runbooks/staging-readiness.md), [`readiness assessment`](../../imeal-production-readiness-assessment.md) | Provide or explicitly resolve the missing `/metrics` implementation and then rerun protected integration; fail closed, never mark it manually PASS. |
| `STG-EXT-01` | External staging qualification and release evidence | `CONDITIONAL / NO-GO` | `P0-DOM-09`, `STG-REPO-01`, `STG-METRICS-01` | `[release owner/session]` | [`staging runbook`](../../runbooks/staging-readiness.md), [`Task 9 report`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-9-report.md) | Provision isolated staging and collect every required artifact in the ordered checklist below. |
| `P1-PRODUCT-01` | Phase 1 product gaps and one-canteen pilot | `NOT_STARTED` | `STG-EXT-01` release gate approved; no P0 open | `[product owner/session]` | [`P1 gaps and pilot`](../../imeal-production-readiness-assessment.md) | Only after release approval, sequence weekly-save/menu UX, delegation, history/penalties, realtime/recovery, Admin lifecycle, and pilot UAT. |

## Ordered next actions and evidence updates

### 1. Clear prerequisites before any target write

- Name the release owner, independent reviewer, data/DB owner, security owner, product/UAT owner, operations/on-call owner, rollback authority, release ID, reviewed commit, target database, and target schema in restricted external records.
- Provision an isolated staging target: separate database/credentials, object-storage bucket, OTP/provider secrets, network, HTTPS hostname/certificate, four approved operational locations, roster/role assignments, edge WAF/rate limits, centralized logs/metrics, alert delivery, and rollback artifact. Keep all values outside source control.
- Resolve the hardening-owned `/metrics` collector/endpoint blocker before protected runtime integration. Missing telemetry is a failed gate, not an approval exception.
- Preserve the dirty local public schema as diagnostic evidence only. Its unresolved snapshot, roster/effective-location, menu, and future-active gaps require exact remediation/quarantine or approved-backup recovery; never infer target approval from the clean disposable schema.

### 2. Run target-safe migration and recovery evidence in this order

The commands below are operator commands from the runbook. Execute them only with the approved external target and retain redacted artifacts outside the checkout:

1. Local/repository contract checks, when authorized: `yarn test:staging-tools` and `node --test scripts/staging/compose-config.test.mjs`.
2. Render the protected boundary: `docker compose --env-file "$STAGING_ENV_FILE_PATH" -f docker-compose.yml -f docker-compose.staging.yml config --quiet`.
3. Record `release-manifest.json`, `target-fingerprint.json`, and `migration-status.txt` for the exact reviewed commit.
4. Run `scripts/staging/phase0-preflight.mjs` against the target; retain `preflight-before.json`. Abort on any nonzero named check or target mismatch.
5. Run encrypted target backup and isolated restore rehearsal; retain `backup-manifest.json` and `restore-rehearsal.json` with checksum and measured RPO/RTO.
6. Obtain the independent `approval.json` bound to the exact release, target, preflight hash, backup hash, decision, rollback authority, and decision window. The repository tooling MUST NOT self-approve.
7. Run `scripts/staging/phase0-backfill.mjs`; retain `backfill-result.json`. Run no backfill before steps 4–6 pass.
8. Run `scripts/staging/phase0-validate.mjs`; retain `preflight-after.json` and `constraint-validation.json`. Require all named checks/status counts and both constraints to pass.
9. Deploy the protected staging Compose target, then run authenticated infrastructure/business/worker smoke and alert-delivery checks; retain `smoke-infrastructure.json`, `smoke-auth-rbac.json`, `observability-alert-test.json`, and related redacted reports.
10. Obtain `signoff.json` only after all evidence is complete, access-controlled, checksumed, independently reviewed, and rollback-compatible. Until then the decision is **CONDITIONAL / NO-GO**.

### 3. Update control artifacts from observed evidence only

After each externally observed gate, update this file's matrix and handoff plus the relevant canonical records, without rewriting history or inventing results:

- [`phase0 progress ledger`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/progress.md)
- [`Phase 0 Task 9 report`](../../../.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-9-report.md)
- [`production readiness assessment`](../../imeal-production-readiness-assessment.md)
- [`execution plan`](../../06-execution-plan.md)
- [`staging runbook`](../../runbooks/staging-readiness.md)
- Protected external evidence artifacts named above; never commit them when they contain secrets or operational PII.

### 4. Start Phase 1 product work only after the release gate

Once `STG-EXT-01` has an independent PASS/sign-off and no P0 remains, start `P1-PRODUCT-01` in a separately owned session. Use the readiness assessment's ordered product gaps and one-canteen pilot: weekly draft/save UX, server-authored menu/location display, delegation create/search/reconciliation, staff history/penalties, Kitchen realtime/recovery, session expiry/offline/retry behavior, Admin lifecycle/audit, and native device/UAT. Phase 1 work MUST NOT be used to bypass an unresolved Phase 0 or staging gate.

## External blockers (current)

- No approved staging or representative target and no target-specific staging `DATABASE_URL` evidence.
- No independent preflight/backfill approval or audit record, controlled artifact/checksum, named rollback authority, or decision window.
- No encrypted backup/restore rehearsal, measured RPO/RTO, or verified rollback evidence.
- Private worker `/metrics` endpoint and verifier now exist, but no real API-to-worker transport/flush, authoritative collector callers, protected bindings, or qualification evidence; protected runtime integration therefore fails closed.
- No provisioned/observed WAF/rate-limit control, alert route, centralized staging telemetry, DNS/TLS, OTP provider path, or production secret/provider evidence.
- No approved allowlist/identity/role/roster/four-location operational data, native device/UAT, or production smoke evidence.
- The existing local public schema remains dirty and was intentionally not backfilled or constraint-validated.

## Session handoff

This handoff records only observed values; re-check branch, HEAD, and worktree status at the start of every session.

| Field | Handoff |
| --- | --- |
| Current branch | `develop/Hardening` (observed with `git branch --show-current` before this control-plan commit) |
| HEAD | `663fefdbd324a24753b370817681862bb9d0945e` (observed before this control-plan commit; re-check after checkout) |
| Active session | `[fill with session/owner identifier]` |
| Last completed task | Phase 0 domain-correctness Tasks 1–8; production-hardening Tasks 1–9; staging-readiness repository surface present. Phase 0 Task 9 is not complete. |
| Blockers | External staging target/approval, backup/restore and rollback evidence, representative data remediation, `/metrics`, edge/alert provisioning, identity/provider/location approval, and UAT. |
| Next safe task | Complete staging prerequisites and collect target-safe evidence in the ordered sequence above; do not run backfill without independent approval. |
| Files touched in this session | `docs/superpowers/plans/2026-09-29-imeal-cross-session-control-plan.md` only. |
| Pre-existing worktree state preserved | `apps/worker/tsconfig.build.tsbuildinfo` modified; dated production-hardening and staging-readiness plans untracked. These were observed and must not be overwritten, staged, or deleted by this control plan. |

## Maintenance rules

- Re-check `git branch --show-current`, `git rev-parse HEAD`, and `git status --short` at session start; update the handoff only with observed values.
- Update matrix status, dependency, owner/session, evidence links, and next action whenever a gate changes. Prefer a new dated report or external artifact over rewriting historical evidence.
- Preserve user-owned files and unrelated worktree changes. Stage and commit only the requested control file unless the user explicitly authorizes another path.
- Never force-push, reset away work, or rewrite another session's commit.
- Never fabricate approval IDs, checksums, credentials, target data, UAT, monitoring, rollback authority, or production evidence.
- Keep local/disposable, staging, and production evidence labeled separately; zero-row or green disposable output is never an approval.
- Do not mark `DONE` or release-ready from source presence alone. Keep `CONDITIONAL / NO-GO` while any named external gate is unavailable or failed.
- Do not start Phase 1 product work until the release gate is independently approved; record the decision and evidence links before changing its status.
