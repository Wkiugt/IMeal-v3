# Task 5 brief — canonical Kitchen dashboard projection

## Scope
Replace ACTIVE-only dashboard aggregation in `apps/api/src/kitchen/kitchen-dashboard.service.ts` with the canonical projection from the approved Phase 0 spec/plan. Preserve existing routes, authorization, response envelope shape, serving signal behavior, and recent serving logs.

## Acceptance criteria
- Use one registration query for the target meal date, ordered deterministically by `createdAt ASC, id ASC`, loading `ACTIVE`, `SERVED`, `NO_SHOW`, and only `CANCELLED` rows that have a serving so cancelled/serving violations can be detected.
- Include `mealServing`, user/snapshot data, and delegation data needed by projection/logs. Do not use a second no-show registration query.
- Derive state exactly from serving/status: serving => `SERVED`; otherwise `NO_SHOW` status => `NO_SHOW`; otherwise `PENDING`.
- Reject `SERVED` without serving, `NO_SHOW` with serving, and `CANCELLED` with serving by throwing `InternalServerErrorException('Kitchen dashboard state invariant violated')`. Do not expose row identifiers or sensitive values in the message.
- Validate mismatches before filtering disabled accounts. Valid `CANCELLED` rows and `user.isActive=false` rows are excluded from every counter/list. Valid `ACTIVE + serving` and legacy `SERVED + serving` remain in total/served/all projections.
- Counters/lists must satisfy: `totalRegistered` is pending + served + no-show; `servedTotal` counts servings; `noShowTotal` counts NO_SHOW without serving; `remaining === pending.length`; choice totals cover the same projection set.
- Every dashboard item in `served`, `pending`, `noShow`, and `all` includes `state` and `isServed` with `isServed === (state === 'SERVED')`; servedAt comes from serving and is null for non-served rows.
- Recent logs prefer non-null MealServing owner/location/menu snapshots, falling back to current registration/user fields for legacy rows without serving snapshots, without changing transport shape or leaking sensitive data.
- Do not implement realtime/client infrastructure, P1, new routes, or unrelated modules.

## Relevant files
- `apps/api/src/kitchen/kitchen-dashboard.service.ts`
- `apps/api/src/kitchen/kitchen-dashboard.service.spec.ts`
- `apps/api/test/kitchen-dashboard.e2e-spec.ts` (preserve route/envelope/authorization behavior; update fixtures only if required)
- `packages/contracts/src/v1/kitchen.ts` (already changed by Task 2; do not alter unless the existing contract blocks required behavior)
- Prisma model fields from Task 1/4 in `packages/domain/prisma/schema.prisma` and generated client.

## Verification
Run focused commands from the approved plan:
- `yarn workspace @imeal/api exec vitest run src/kitchen/kitchen-dashboard.service.spec.ts`
- `yarn workspace @imeal/api exec vitest run test/kitchen-dashboard.e2e-spec.ts`
- Run a scoped API typecheck if needed to prove the changed service/tests compile.

## Report
Write `.superpowers/sdd/2026-09-28-imeal-phase0-domain-correctness-plan/task-5-report.md` with changed files, exact commands/results, concerns, and exact commit hash. Commit source/tests and this brief/report. Do not modify `progress.md`.
