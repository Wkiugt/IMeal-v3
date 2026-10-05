# Platform Runtime Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualify a controlled Node 24 / Expo 57 / Prisma 7 platform upgrade while preserving the required Nest 12, Vite 8, Vitest 4 and Yarn 4.18 baselines and keeping staging deployment fail-closed.

**Architecture:** CI has two explicit phases: a secretless qualification job using a disposable PostgreSQL service and a separate protected, ephemeral staging qualification job. The protected job may deploy only from the explicitly approved deploy branches with complete protected inputs; hosted Compose is always torn down and is never treated as persistent infrastructure. Runtime/package changes remain separate from this CI baseline.

**Tech Stack:** Node.js 24.x; Yarn 4.18.0 through Corepack; Expo 57 with its official stable React/React Native pair; Prisma 7 stable (never Prisma 8 prerelease); NestJS 12; Vite 8; Vitest 4; GitHub Actions; PostgreSQL disposable service; Docker Compose.

**Spec:** User request for the controlled platform runtime upgrade (2026-10-04); no separate checked-in spec exists.

The consolidated final qualification report, exact upgrade-authored mutation inventory, command results, image bindings, scanner references, and release blockers are [`docs/superpowers/evidence/2026-10-04-prisma7-checkpoint.md`](../evidence/2026-10-04-prisma7-checkpoint.md).

## Global Constraints

- Do not modify package manifests or `yarn.lock` in checkpoint 0; release/version research is a separate prerequisite.
- Every Prisma validate/generate and every database-backed check MUST receive `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/imeal_ci?schema=public`; never use a repository or GitHub secret for CI qualification.
- Prisma generate MUST complete before TypeScript compilation.
- Prisma 7 requires an explicit generated-client output, `prisma.config.ts` datasource configuration for CLI connectivity, a PostgreSQL driver adapter, and explicit adapter pool/timeout settings; the future runtime workstream MUST also update imports and copy the generated client into runtime images.
- Prisma 7 removes `prisma db execute --url/--schema` and the old `prisma migrate diff --from-url/--to-url` forms; future migration scripts MUST use config datasource flags and MUST isolate schema/database targets explicitly.
- Prisma 8 is current upstream, but this work deliberately selects the latest stable Prisma 7 release and MUST NOT use a Prisma 8 prerelease.
- `actions/setup-node` MUST NOT request Yarn caching before deterministic Corepack Yarn 4.18 activation.
- CI push qualification targets `deploy/develop` and `deploy/staging`; arbitrary `workflow_dispatch` MUST NOT implicitly deploy.
- Secretless qualification and protected ephemeral staging qualification MUST be separate gates.
- Protected staging inputs MUST fail closed when absent, malformed, mutable, or inconsistent; do not invent infrastructure, credentials, image digests, or endpoints.
- GitHub-hosted Compose MUST be torn down after the run and MUST NOT be documented as persistent deployment infrastructure.
- Business logic is out of scope.

## Checkpoint 0 evidence and actual file map

- Current reference: `d61af2c9463b1f3597c8288184fbde0ae41d503e` on `deploy/develop`.
- Pre-existing user modification: `apps/worker/tsconfig.build.tsbuildinfo`; leave untouched.
- Workflow: `.github/workflows/staging-readiness.yml` now targets `deploy/develop` and `deploy/staging`, uses Node 24, activates Corepack Yarn 4.18 without setup-node Yarn caching, injects the exact disposable `DATABASE_URL` into the qualification job, and runs Prisma generate before typecheck.
- Protected staging workflow: `.github/workflows/staging-readiness.yml` requires a push to exactly `deploy/staging` or an explicit `workflow_dispatch` `deploy_staging=true` on exactly that ref; it keeps protected input validation, immutable image checks, ephemeral Compose startup, smoke/evidence, and `always()` teardown.
- Staging tooling: `scripts/staging/*.mjs`, especially `compose-config.test.mjs`, `runtime-integration.mjs`, `smoke-staging.mjs`, and `release-manifest.mjs`; the source-only protected-workflow wording checks were deleted rather than re-pinned.
- Operator contract: `docs/runbooks/staging-readiness.md` now distinguishes secretless qualification from protected ephemeral qualification, documents the exact branch/manual-dispatch guard, records the disposable CI database, and states that hosted Compose teardown is not persistent staging.
- Repository command contract: `package.json` scripts `test:staging-tools`, `staging:manifest`, and `staging:smoke`; package manifests and `yarn.lock` remain unchanged in this checkpoint.

## Known prerequisites and observed environment

- Node `v24.18.1` is installed; bare `yarn` is unavailable and `corepack enable` fails locally with `EPERM` writing the protected Node shim directory. `corepack install --global yarn@4.18.0` and `corepack yarn --version` succeed with `4.18.0`.
- Immutable dependency install passed with Yarn `4.18.0` (`YN0000 Done with warnings`; only the existing `YN0086` peer-dependency warning was reported).
- Docker `29.8.0` and Compose `v5.5.1` binaries are available, but `docker info` cannot connect to `//./pipe/dockerDesktopLinuxEngine`; the local Docker daemon is unavailable. PostgreSQL client `psql 18.3` is available, while the existing `127.0.0.1:5432` server rejects the disposable `postgres/postgres` credentials. No protected staging environment, secrets, approved origins, image digests, rollback artifact, DNS/TLS/OTP provider, external target, or persistent deployment host is available from the repository.
- Historical checkpoint-0 evidence: secretless `corepack yarn test:staging-tools` passed `121/121`; `corepack yarn node --test scripts/staging/compose-config.test.mjs` passed `6/6`; throwaway YAML/branch smoke passed for deploy/develop qualification, deploy/staging push qualification, and manual dispatch false/foreign-ref guards. Prisma validate/generate passed with the exact disposable URL on the then-current Prisma 5.22.0 baseline; no package upgrade was attempted in that checkpoint. The later Prisma 7.10.0 and Expo 57 cutover evidence is recorded below and in the dated evidence files.
- Checkpoint verification records the Docker-daemon and disposable-PostgreSQL blockers exactly; protected qualification remains an external prerequisite and is not simulated.
- Checkpoint 2 used Docker `29.8.0` with a disposable PostgreSQL 16 container named `imeal-prisma7-pg` on host port `55432`; the existing host `5432` service was not used. Prisma 7.10.0 applied all 10 checked-in migrations to disposable schemas, and the exact commands/results are recorded in `docs/superpowers/evidence/2026-10-04-prisma7-checkpoint.md`.

## Prisma 7 ownership handoff and implementation evidence (checkpoint 2)

The independent stable target is `prisma@7.10.0`, `@prisma/client@7.10.0`, and
`@prisma/adapter-pg@7.10.0`; Prisma 8 is currently an RC/latest tag and is
deliberately excluded. Official Prisma 7 requires ESM, a `prisma-client`
generator with an explicit output directory, a `prisma.config.ts` datasource
URL for CLI commands, and a PostgreSQL driver adapter for every client.

**Configuration and generated output:**

- Official Prisma CLI docs identify `definePrismaConfig` and the `skills` section as Prisma ORM 8 configuration. Stable Prisma 7's `PrismaConfig` does not support that field, so the Prisma 7 `prisma.config.ts` MUST use `defineConfig` without the unknown `skills` key; do not preserve it through `as any`, an intersection cast, or an unknown-field spread. The existing skills-only file MUST be reviewed before replacement, but no Prisma 8 config metadata may remain in the stable 7 config. Add Prisma 7 `schema: 'prisma/schema.prisma'`, `migrations.path: 'prisma/migrations'`, and `datasource.url` from `DATABASE_URL`.
- Change only the Prisma schema plumbing in
  `packages/domain/prisma/schema.prisma`: remove the deprecated datasource URL,
  use `provider = "prisma-client"`, and generate ESM TypeScript into
  `../src/generated/prisma` with explicit `.js` import extensions. No model,
  relation, enum, index, constraint, or migration changes are part of this
  upgrade.
- Add the smallest `@imeal/core` package boundary around the generated client:
  `packages/domain/src/prisma.ts` exports the generated `PrismaClient`, `Prisma`
  namespace/types, and one adapter factory; `packages/domain/src/db.ts` uses
  that factory for its singleton. `packages/domain/package.json` gets
  NodeNext-compatible `type`, `main`, `types`, `exports`, and `build` metadata,
  while `packages/domain/tsconfig.build.json` compiles strict NodeNext output.
  Consumers import the canonical core entrypoint after the cutover; no
  `@prisma/client` aliases, source-path imports, or deprecated shims remain.
- The adapter factory preserves only repository-used URL semantics: `schema` (default `public`), `connection_limit`, `pool_timeout`, and `connect_timeout`; it passes the original URL unchanged to `pg`, maps an explicit `connection_limit` to `max`, and otherwise inherits `pg`'s default maximum of 10 rather than the legacy Rust-engine CPU-derived default. It sets `search_path` from a safely quoted simple identifier. Timeout `0` remains disabled; positive values use the stricter shared `pg` timer, while omitted values use explicit Prisma-compatible 5s connect/10s pool bounds because `pg` exposes only one timer. The simple-identifier schema invariant is deliberate repository scope, not speculative URL translation; no other query parameters are translated.
- Because consumers resolve package exports rather than TypeScript source,
  `@imeal/core` MUST build before API/worker typecheck/build. API and worker
  Docker runner stages must copy the compiled core package and generated client
  output; the migration image only needs Prisma CLI/config/migrations.

**Consumer and test map reviewed for the cutover:**

- API runtime imports: `apps/api/src/common/prisma.service.ts`,
  `apps/api/src/admin/penalties/penalties.service.ts`,
  `apps/api/src/admin/penalties/employee-penalties.service.ts`,
  `apps/api/src/admin/users/admin-users.service.ts`,
  `apps/api/src/check-in/check-in.service.ts`,
  `apps/api/src/common/transaction-locks.ts`,
  `apps/api/src/locations/locations.service.ts`,
  `apps/api/src/notifications/notifications.service.ts`,
  `apps/api/src/otp/otp-outbox.service.ts`,
  `apps/api/src/registrations/registrations.service.ts`, and
  `apps/api/src/admin/weekly-menus/weekly-menus.service.ts`.
- Worker runtime imports: `apps/worker/src/common/prisma.service.ts`,
  `apps/worker/src/no-show-worker.service.ts`,
  `apps/worker/src/notification-dispatch.service.ts`,
  `apps/worker/src/notification-reminder.service.ts`,
  `apps/worker/src/otp-delivery-worker.service.ts`, and
  `apps/worker/src/worker-notification-publisher.ts`.
- Core runtime and CLI imports: `packages/domain/src/db.ts`,
  `packages/domain/src/RegistrationService.ts`,
  `packages/domain/src/local-seed/index.ts`,
  `packages/domain/src/local-seed/writer.ts`, and
  `packages/domain/src/local-seed/cli.ts`. Local seed's
  `datasources.db.url` constructor override must become the adapter factory's
  explicit URL input.
- Database-backed isolation/concurrency: `packages/domain/test/setup.ts`,
  `packages/domain/test/concurrency.test.ts`,
  `packages/domain/test/legacyRegistrationFixture.ts`,
  `packages/domain/test/db-connection.spec.ts`,
  `packages/domain/test/emailOtpLocationServing.test.ts`,
  `packages/domain/test/local-seed.db.test.ts`,
  `apps/api/vitest.config.e2e.ts`,
  `apps/api/test/admin-users.e2e-spec.ts`,
  `apps/api/test/production-concurrency.e2e-spec.ts`, and
  `apps/worker/test/no-show-worker.e2e-spec.ts`. Every dynamically created
  client must use the same adapter/schema factory and remain registered for
  teardown; no shared schema or unbounded pool is acceptable.
- Unit mocks and lifecycle contracts needing import/type updates include
  `apps/api/src/admin/allowlist/allowlist.controller.spec.ts`,
  `apps/api/src/admin/locations/locations.service.spec.ts`,
  `apps/api/src/admin/penalties/penalties.service.spec.ts`,
  `apps/api/src/admin/roster/roster-import.service.spec.ts`,
  `apps/api/src/admin/users/admin-users.service.spec.ts`,
  `apps/api/src/admin/weekly-menus/weekly-menus.service.spec.ts`,
  `apps/api/src/auth/session.service.spec.ts`,
  `apps/api/src/notifications/notifications.service.spec.ts`,
  `apps/api/src/registrations/registrations.service.spec.ts`,
  `apps/api/src/common/prisma.service.spec.ts`,
  `apps/worker/src/common/prisma.service.spec.ts`,
  and `apps/worker/test/no-show-worker.e2e-spec.ts`. Keep behavior assertions
  focused on lifecycle, isolation, concurrency, and errors rather than import
  wiring.

**CLI and image handoff:** current repository scans found only
`prisma migrate deploy` calls (in `docker-compose.yml`,
`infra/migrations/production-gate.sh`, and
`apps/worker/test/no-show-worker.e2e-spec.ts`); no removed `db execute --url`
or old `migrate diff --from-url/--to-url` flags are present. The Node/Docker
workstream owns `apps/api/Dockerfile`, `apps/worker/Dockerfile`,
`infra/migrations/Dockerfile`, `docker-compose.yml`, and
`docker-compose.staging.yml` until its checkpoint handoff. It must compile core
upstream, preserve direct-vs-pooled URL and schema bindings, and avoid changing
business logic or adding migrations.
- Workspace CLI discovery is verified: `corepack yarn workspace @imeal/core node -e "console.log(process.cwd())"` resolves to `packages/domain`, so a config beside that package's `package.json` is found from both root Compose (`/app`) and the migration gate's `cd "$GATE_WORKDIR"` invocation. The migration runner therefore needs the checked-in `packages/domain/prisma.config.ts` copied alongside `packages/domain/prisma`.
- `infra/migrations/Dockerfile` does not need a generated client; remove its build-time generate step and copy the Prisma 7 config into the runner. Keep config dependencies in the existing installed runtime set, and set `DATABASE_URL` only at migration execution from `MIGRATION_DATABASE_URL`.
- API/worker/migration builder generation, where retained, must use a non-secret disposable URL in the `RUN` environment rather than a build arg or secret. Runtime API/worker URLs remain injected at container start; no credential may enter a Docker layer.

**Checkpoint 2 implementation status (source and database gates):**

- Stable versions are `prisma`, `@prisma/client`, and `@prisma/adapter-pg` `7.10.0`; generated output is ignored at `packages/domain/src/generated/` and is regenerated before builds. Prisma 8-only `skills` config metadata was removed; the checked-in Prisma 7 config uses `defineConfig`.
- Core boundary is implemented in `packages/domain/src/prisma.ts`, `src/db.ts`, `src/index.ts`, and `tsconfig.build.json`; API and worker production consumers now import Prisma types/factory through `@imeal/core`. No model, relation, enum, index, constraint, or migration changed.
- Clean disposable PostgreSQL evidence: Prisma CLI validation/generation passed; all 10 existing migrations deployed; schema isolation, transaction rollback, concurrency, local-seed, API, and worker database paths passed without protected data or fabricated metrics.
- Final post-hook suite results are core unit `5 files/45 tests`, core database `10 files/89 tests`, API unit `32 files/279 tests`, API e2e `11 files/78 tests`, worker unit `21 files/175 tests`, and worker e2e `2 files/10 tests`; root unit is 542 and root database is 177. Root build, lint, and typecheck passed. The final image/runtime/scanner inventory is consolidated in `docs/superpowers/evidence/2026-10-04-prisma7-checkpoint.md`.
- Final r5 API, worker, migration, and unchanged Admin Web r4 images were rebuilt from the settled worktree and locally qualified; no protected release publication or production readiness is claimed.

## Implementation tasks

### Task 1: CI qualification baseline

**Files:**
- Modify: `.github/workflows/staging-readiness.yml`

- [x] Set the Node 24 environment and explicit `deploy/develop`/`deploy/staging` push triggers while retaining review-triggered qualification.
- [x] Activate Corepack Yarn 4.18 before any setup-node cache behavior and avoid setup-node Yarn caching until deterministic activation is complete.
- [x] Set the disposable PostgreSQL URL on Prisma validate/generate and all database-backed checks; run generate before `yarn typecheck`.
- [x] Split secretless checks from protected staging qualification; make protected deploy conditional on explicit approved event/branch and complete protected environment inputs.
- [x] Ensure manual dispatch selects qualification only by default and cannot infer deployment from arbitrary refs or absent staging inputs.
- [x] Preserve immutable image checks, evidence generation, protected Compose validation, smoke checks, and unconditional teardown.

### Task 2: Staging contract documentation and static checks

**Files:**
- Modify: `docs/runbooks/staging-readiness.md`
- Modify only if needed by an observable contract: `scripts/staging/compose-config.test.mjs`

- [x] Document secretless qualification versus protected ephemeral staging qualification, exact allowed branch/manual-dispatch behavior, disposable PostgreSQL usage, and hosted Compose teardown/non-persistence.
- [x] Keep protected input names and external prerequisites explicit without committing values or weakening validation.
- [x] Delete the affected source-only protected-workflow wording assertion instead of adding or re-pinning regex checks; no new source-text wiring test was added.

### Task 3: Focused evidence

- [x] Activate Yarn 4.18 with Corepack and run the staging tooling test suite.
- [x] Run the Compose configuration contract test and a throwaway YAML/branch expression smoke; Docker daemon unavailability is recorded rather than bypassed.
- [x] Report exact outputs, infrastructure availability, pre-existing issues, and any unobservable protected gates; do not claim staging readiness without external evidence.

### Task 4: Prisma 7 runtime and database cutover

- [x] Upgrade stable Prisma dependencies to `7.10.0`, replace the skills-only config with Prisma 7 `defineConfig`, and generate the explicit ESM client output.
- [x] Add the canonical `@imeal/core` adapter/client boundary; migrate API, worker, local-seed, unit, and database/e2e consumers without aliases or business behavior changes.
- [x] Preserve repository URL semantics, including schema isolation and bounded timeout `0`/default behavior; apply all existing migrations to disposable PostgreSQL schemas.
- [x] Add the official `pg` `PoolConfig.Client` hook for `pgbouncer=true`: omit startup `search_path`, apply transaction-local `SET LOCAL search_path` after exact PrismaPg control SQL, wrap standalone pooled queries, preserve rollback/savepoint/lifecycle behavior, and fail closed for unsupported Submittable queries.
- [x] Pass core/API/worker unit and database/e2e suites, root lint, and root typecheck; keep health evidence fixture disposable and clearly separate from protected staging evidence.
- [x] Rebuild final Node 24 API/worker/admin images after source settled, remove unused runner npm/npx, and prove non-root startup, Prisma query, shutdown, and Admin nginx HTTP; do not claim protected production readiness.

## Risks and non-goals

- Prisma 7 client/API migration and final image/runtime qualification are implemented; Expo native compatibility remains Fast's workstream.
- The final worker image reaches live/database checks but readiness is HTTP 503 because the untouched source provides `WORKER_METRICS_COLLECTOR_SCHEDULER` as `undefined` and never calls `markSchedulerInitialized()`. This is a remaining readiness qualification gate, not a reason to fake telemetry or mark the worker ready.
- A passing secretless qualification proves only repository checks against disposable fixtures; it does not prove credentials, DNS/TLS, provider delivery, approved identity/roster/location data, backups, alerts, or production readiness.
- Node 24 may expose unrelated existing dependency/type/test failures; preserve their exact evidence and avoid compatibility shims in CI.
