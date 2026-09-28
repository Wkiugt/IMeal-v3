# Task 8 report — production Compose and Caddy boundary

## Status

COMPLETE — implementation commit `0a88169` plus review-fix commits `d63326a` and `b7869bc` (`fix: validate Compose stop grace units`). This report records the review-fix rounds; Task 9 remains not started.

## Scope

- Added `docker-compose.production.yml` as a fail-closed production overlay while leaving the development `docker-compose.yml` and local `Caddyfile` behavior unchanged.
- Production publishes host ports only from Caddy. API, worker, PostgreSQL, PgBouncer, MinIO, bucket setup, and the migration evidence volume stay on private networks; `app` and `data` are internal networks.
- Production values, image references, volume names, network names, host ports, TLS hostname/email, and migration approval inputs are required with `${NAME:?NAME is required}`. Image values are documented as immutable `repository@sha256:digest` references.
- PostgreSQL is configured for SCRAM authentication; the production rendering contains no `POSTGRES_HOST_AUTH_METHOD`, MD5 password-encryption setting, or plain PgBouncer auth mode. MinIO setup keeps the bucket private, and no public `/storage/*` route exists.
- API and worker wait for a successful `migration-gate`, receive only the PgBouncer `DATABASE_URL`, and mount the shared migration evidence read-only. The gate contract alone is declared here; Task 9 still owns the released gate implementation and one-shot migration behavior.
- Added `Caddyfile.production` with automatic managed TLS, explicit HTTP-to-HTTPS redirection, API routing, Admin Web fallback, SSE/WebSocket-compatible proxy flushing, persistent Caddy data/config storage, and reviewed security headers.
- Hardened API, worker, and Admin Web Dockerfiles with immutable Node/Nginx bases, built-artifact-only runtime copies, Prisma generation/build preservation, and non-root runtime users. Admin Web retains port 80 compatibility for the development stack; production explicitly enforces the nginx UID and verifies its writable paths.
- `.dockerignore` excludes `.env*`, `/run/imeal/`, and migration-evidence artifacts. `.env.example` documents the production-only injection contract without adding production secret defaults.
- Added `scripts/verify-production-boundary.mjs` and the `verify:production-boundary` package script for rendered Compose/static boundary checks.
- Review fix: production API, worker, and Admin Web services are now explicitly prebuilt-only (`build: !reset null`); deployment requires digest-pinned image variables, while the Dockerfiles remain available for CI image builds.

## Review fix round 2

- Enforced the documented seconds contract for `STOP_GRACE_PERIOD`: the verifier now requires strict `/^\d+s$/` input before parsing, so Compose values such as `35ms` are rejected instead of being misread as 35 seconds.
- Added `scripts/verify-production-boundary.test.mjs` and `test:production-boundary`; its negative test supplies `35ms` and proves the verifier fails before the `>= 30s + 5s` drain-margin comparison.
- `.env.example` continues to document the passing `STOP_GRACE_PERIOD=45s` contract and the deployment-env verifier command.

## Verification

- `node scripts/verify-production-boundary.mjs` — passed with synthetic local values. It now asserts the worker `/health/ready` probe, a 5-second drain margin (`stop_grace_period >= SHUTDOWN_TIMEOUT_SECONDS + 5s`), no production build contexts, digest-pinned rendered images, and `.env.example` coverage for every required `*_IMAGE` variable.
- `node --test scripts/verify-production-boundary.test.mjs` — 1/1 passed; the `35ms` negative case is rejected by the strict seconds parser.
- `node scripts/verify-production-boundary.mjs --env-file <deployment-env-file>` — passed against digest-pinned deployment test values; a mutable `API_IMAGE=...:mutable` input failed closed as expected.
- `docker compose -f docker-compose.yml -f docker-compose.production.yml config` without required production variables — failed closed with required-variable errors as expected.
- Rendered production `docker compose ... config` and `config --images` with non-secret test values — passed; only Caddy published host ports, API/worker/Admin Web had no build contexts, and all rendered image references used digests.
- Caddy immutable image validation (`caddy validate --config /etc/caddy/Caddyfile`) — `Valid configuration`.
- API production Docker image build — passed before the prebuilt-only overlay fix; runtime smoke imported `@imeal/contracts`, `@imeal/observability`, and `@prisma/client` as UID 1000.
- Worker production Docker image build — passed before the prebuilt-only overlay fix; runtime smoke imported workspace dependencies as UID 1000.
- Admin Web production Docker image build — passed before the prebuilt-only overlay fix; non-root nginx served `/health` successfully on port 80. This also verifies the unchanged development Compose port contract.
- `git diff --check` — passed before the review-fix implementation commit.

## Commits

- `0a88169 feat: define private production Compose boundary`
- `d63326a fix: harden production boundary verification`
- `b7869bc fix: validate Compose stop grace units`

## Deferred boundaries

- Task 9 migration-gate implementation, migration scripts/tests, and direct PostgreSQL gate behavior were not started. The production overlay only consumes a required released `MIGRATION_GATE_IMAGE` contract so API/worker startup can depend on successful gate completion.
- No production services were started with real credentials.
- The current worktree intentionally retains an unstaged `apps/worker/tsconfig.build.tsbuildinfo` change. It was inspected as generated build metadata and left untouched because the Docker image builds were isolated and it may be concurrent user work.
- The pre-existing untracked plans `docs/superpowers/plans/2026-09-28-production-hardening-plan.md` and `docs/superpowers/plans/2026-09-28-staging-readiness-plan.md` were not staged or modified.
