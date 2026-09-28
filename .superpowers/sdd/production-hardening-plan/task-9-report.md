# Task 9 report — production migration gate

## Status

COMPLETE — direct-primary migration gate implementation and production Compose integration are ready. Later staging and operational tasks remain unstarted.

## Scope

- Added `infra/migrations/Dockerfile`, producing a prebuilt digest-publishable gate image with Prisma, `psql`, and the checked-in phase-0 SQL.
- Added `infra/migrations/production-gate.sh` with strict shell mode, required direct database URL/schema/identity/approval/release inputs, placeholder and PgBouncer rejection, Prisma deploy, same-session target-schema assertion, explicit `search_path`, `ON_ERROR_STOP=1`, named seven-check preflight parsing, idempotent backfill, post-validation, and atomic `0444` evidence-marker publication.
- PostgreSQL client URLs strip Prisma's `schema` query parameter before `psql` while retaining other query parameters; Prisma still receives the original direct URL. This avoids PostgreSQL URI rejection of the Prisma-only parameter.
- Added command-level tests in `infra/migrations/production-gate.test.ts` covering missing approval, schema URL mismatch, target-session failure, preflight failure, repeated approved runs with one read-only marker, and post-validation failure. The fake client rejects any schema query passed to `psql` to protect this URL boundary.
- Added `infra/migrations/README.md` describing required inputs, exact gate order, marker contract, redaction behavior, build, and verification commands.
- Updated production Compose so `migration-gate` constructs its direct URL with the required `MIGRATION_TARGET_SCHEMA`; API/worker continue to consume the shared marker read-only after successful gate completion.

## Task 9 fix round

- Suppressed the successful same-session target assertion result with `psql` output redirection; preflight and postflight logs now contain only their named report rows.
- Added the reusable seven-check zero parser and reran the exact read-only preflight after idempotent backfill before constraint validation or marker publication.
- Updated the fake `psql` harness to require the assertion-output redirection and emit valid postflight report rows, added postflight-failure/no-marker coverage, and asserted the observable target/assert → migrate → preflight → backfill → postflight → validation command sequence. Approval remains a required gate between the first preflight and backfill.

## Verification

- `sh -n infra/migrations/production-gate.sh` — passed.
- `yarn workspace @imeal/core exec vitest --root ../.. run infra/migrations/production-gate.test.ts` — 7/7 passed.
- `node --test scripts/verify-production-boundary.test.mjs` — 1/1 passed after Compose integration.
- `docker compose` merged production config with synthetic required values — passed; the migration gate URL rendered with the target schema and all production images remained prebuilt-only.
- `docker build -f infra/migrations/Dockerfile -t imeal-migration-gate:local .` — passed.
- Disposable PostgreSQL 16 smoke — passed twice against an empty database: Prisma migration deployment, preflight, idempotent backfill, exact postflight preflight, post-validation, atomic marker publication, and rerun all completed successfully. Marker mode was `0444` and contained the phase-0 migration identity. No production credentials or production services were used.
- Disposable negative smoke with a missing target schema — failed closed before marker publication; gate output did not expose the database password.
- `git diff --check -- infra/migrations docker-compose.production.yml .superpowers/sdd/production-hardening-plan` — passed (only the existing Compose LF/CRLF warning was reported).

## DB-backed limitation

The disposable smoke exercises an empty PostgreSQL database and therefore proves the migration/gate mechanics, idempotent rerun, target assertion, and marker contract—not production data-specific backfill outcomes. The checked-in production preflight and backfill SQL are copied unchanged into the image; no production database was available or touched.

## Deferred boundaries

- Staging rollout, production deployment, and later operational/documentation tasks remain unstarted by instruction.
- Existing unrelated generated metadata and pre-existing untracked plan files remain outside this task's scope.
