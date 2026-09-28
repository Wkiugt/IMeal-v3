# Production migration gate

The production Compose stack starts `migration-gate` before the API and worker. The
service is a prebuilt image produced from `infra/migrations/Dockerfile`; it connects
directly to the PostgreSQL primary and never uses the PgBouncer endpoint.

## Required inputs

The gate requires all of the following environment variables:

- `MIGRATION_DATABASE_URL`: `postgres://` or `postgresql://` URL for the primary,
  with `schema` matching `MIGRATION_TARGET_SCHEMA`. PgBouncer hosts, port `6432`,
  and `pgbouncer=true` URLs are rejected.
- `MIGRATION_TARGET_SCHEMA`: the SQL schema used by the gate's explicit
  `search_path`.
- `MIGRATION_TARGET_IDENTITY`: the deployment identity recorded in evidence and
  checked by API/worker health.
- `MIGRATION_APPROVAL_ID`: non-empty release approval identifier.
- `RELEASE_VERSION`: release identifier.
- `MIGRATION_EVIDENCE_PATH`: absolute path for the evidence marker. Production
  Compose mounts `/run/imeal/migration-gate.json` from the shared evidence volume.

The gate validates the target schema in the same direct database session used for
its SQL checks. Every `psql` invocation uses `ON_ERROR_STOP=1`, an explicit
`search_path`, and a `current_schema()` assertion. The successful assertion result
is redirected to `/dev/null`, so preflight and postflight logs contain only the
named report rows parsed by the gate.

## Execution order

1. Validate inputs and direct-primary URL semantics.
2. Assert the target database/schema.
3. Run `prisma migrate deploy` using the direct URL.
4. Run the checked-in phase-0 read-only preflight. All seven named checks must
   report zero affected rows.
5. Require the explicit approval identifier (before any backfill).
6. Run the idempotent phase-0 backfill SQL unchanged.
7. Repeat the exact read-only preflight and require all seven named checks to
   remain zero.
8. Validate the two phase-0 `NOT VALID` constraints.
9. Write the five-field evidence marker to a temporary file, set mode `0444`, and
   atomically rename it into place.

There is no down migration or destructive fallback. A failure exits non-zero and
leaves no new evidence marker. The command's success output contains only safe
release, migration, target-identity, and approval identifiers; connection URLs,
passwords, SQL payloads, and row samples remain in temporary files that are
removed on exit.

The marker is compatible with the runtime health contract:

```json
{
  "release": "release-1",
  "migration": "20260928000000_phase0_domain_correctness",
  "targetSchema": "production-primary",
  "approvalId": "change-123",
  "completedAt": "2026-09-28T12:00:00.000Z"
}
```

`targetSchema` is the deployment identity (`MIGRATION_TARGET_IDENTITY`), while
`MIGRATION_TARGET_SCHEMA` is the actual PostgreSQL schema selected by
`search_path`.

## Build and test

Build the image from the repository root and publish it with an immutable digest:

```sh
docker build -f infra/migrations/Dockerfile -t imeal-migration-gate:local .
```

The command-level contract tests use fake `psql` and `yarn` executables and cover
missing approval, target assertion failure, preflight failure, repeated idempotent
runs, read-only evidence mode, and post-validation failure:

```sh
yarn workspace @imeal/core exec vitest --root ../.. run infra/migrations/production-gate.test.ts
```

For the production Compose boundary, provide the required image and release
variables, then render the merged configuration before deployment:

```sh
yarn verify:production-boundary --env-file .env.production
```
