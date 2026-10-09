# Changelog

## Unreleased — 2026-10-07

### Changed

- API Nest logs stay structured JSON. The Nest adapter keeps the original message and a non-stack context on stable `nestjs.*` events instead of emitting empty `{"event":"nestjs.log"}` lines. `api.started` now includes `host`, numeric `port`, `service`, `release`, `event`, and a bind message for `0.0.0.0:<port>`. Free-form message, context, host, and port fields are allowlisted only after redaction and token checks.
- Fixed observability structured log redaction to use the bounded payload parser for serialized stack diagnostics without referencing the removed regex.
- Centralized mobile API error presentation with Vietnamese-safe domain/status/network precedence; canonical request IDs appear only as support codes for unexpected server failures.
- Admin weekly-menu reads now select the deterministic latest revision; health 503 responses use the canonical message; the tracked mobile-release runbook links are restored; and API documentation records route-specific success envelopes.

## Unreleased — 2026-10-06

### Changed

- OTP email is sent only by the worker through Gmail SMTP (`smtp.gmail.com:587`, STARTTLS, App Password). The API no longer requires an HTTP OTP provider. The production and staging workers join the internal data network and a non-internal egress network, and they still publish no ports.

- Root typecheck, unit, and database tasks now share Turbo dependency preparation, so each command builds its workspace dependencies independently without relying on prior local artifacts.
- Prisma metadata generation is an explicit domain build prerequisite, uses a build-only nonsecret URL, and is cached with the generated source while remaining ignored; clean-copy and schema-change regressions cover missing-output and invalidation behavior.
- Protected staging image qualification now scans immutable image archives with Trivy and retains redacted scan reports and advisory metadata for audit review.

- CI qualification now uses a Node 24/Yarn 4.18 command catalogue, immutable producer evidence, explicit per-lane downloads, cancellation-safe owned subprocess cleanup, and fail-closed protected staging gates. Default local verification does not launch Docker; this task exercised that default and leaves disposable PostgreSQL and image/secrets scanners blocked unless authorized CI execution is available.
- Independent cold-copy verification passed immutable install, typecheck, unit, build, build-order, and mobile/admin/observability client suites. The current dependency audit still reports high `braces@3.0.3` and `node-forge@1.4.0`; the security gate permits only the exact advisory exceptions recorded in the evidence, expiring 2026-11-06 00:00 UTC, and fails closed for every other or expired finding. No dependency, manifest, or lockfile upgrade/resolution was made.

- Platform limits are recorded explicitly: Windows Node 24 was exercised with workspace-junction failures; a clean Linux Node 24.21/Yarn 4.18 copy passed immutable install, build, typecheck, lint (11 warnings), unit, and client suites. Build-order and later Docker/image/mobile qualification were interrupted and are not PASS. Protected reruns keep stable producer names with overwrite for same-run evidence and use attempt-scoped protected release artifacts; every deployment requires current-run source/workflow/run provenance.
  The CI hardening also corrects generated POSIX fixture-file argv offsets and bounds dispatcher descendant/evidence waits, while image binding keeps Trivy's immutable bare `sha256:` ID distinct from Syft's required `docker:sha256:` target without weakening hashes or provenance.

## Unreleased — 2026-10-04

### Changed

- Standardized the repository on Node.js 24 and Yarn 4.18.0 with pinned Node 24 Alpine image inputs; direct Node type declarations resolve to `@types/node` 24.19.1.
- Upgraded the mobile app to Expo SDK 57.0.26, React 19.2.3, React Native 0.86.3, React Navigation 7, TypeScript 6.0.3, and Vitest 4.1.11.
- Updated mobile Expo config plugins and React 19/RN 0.86 compatibility types without weakening strictness or adding suppressions.
- Moved contracts and observability to Vitest 4; all workspaces now resolve Vitest 4.1.11.
- Upgraded Prisma 5.22.0 to stable Prisma 7.10.0 with the canonical generated-client output, `prisma.config.ts` datasource, PostgreSQL adapter, and unchanged existing ten migrations.
- Hardened PgBouncer transaction pooling schema isolation with the official `pg` client hook: pooled URLs omit startup `search_path`, apply transaction-local `SET LOCAL search_path` after PrismaPg `BEGIN`, wrap standalone queries, preserve savepoint/rollback lifecycle, and discard clients after failed terminal control or rollback cleanup.
- Rebuilt final API, worker, and Admin Web images after source settled; final runners remove unused npm/npx, and Admin's stable Alpine v3.24 packages are upgraded to fixed libexpat 2.8.5-r0 and pcre2 10.49-r0.
- Upgraded the worker's official Nest Express parent to 12.1.2 (multer 2.4.0).
- Repaired the CI qualification baseline with explicit deploy-branch guards, a disposable PostgreSQL database, and a separate protected ephemeral-staging qualification with mandatory teardown.
- Added narrow, consumer-tested lock resolutions for vulnerable exact descriptors: undici 6.28.1, mysql2 3.23.1, deepmerge-ts 8.0.2, uuid 11.1.1, and tmp 0.2.7.
- Added CI checks for pinned Expo Doctor, Expo dependency alignment, and real Metro Android/iOS/web HTTP bundle smoke.
- Added final upgrade and dependency-audit evidence under `docs/superpowers/evidence/`.
- Worker bootstrap now marks scheduler initialization immediately after successful `await app.listen(...)` and before resolving `listenReady`; existing readiness thresholds and metrics authority remain unchanged.

### Verification

- Mobile Expo Doctor: 21/21 checks passed; mobile suite: 28 files and 158 tests passed.
- Contracts: 43 tests; observability: 76 tests; worker: 175 tests; root unit suite passed.
- Disposable PostgreSQL Prisma 7.10 validation, generation, migration deploy, and migration status passed.
- `corepack yarn install --immutable` passed.
- Real PostgreSQL adapter regression: 3/3 bounded tests passed for savepoint rollback, outer rollback, and a two-row SSI write-skew whose second callback completed before terminal COMMIT returned PrismaPg `DriverAdapterError.cause.kind=TransactionWriteConflict`/SQLSTATE `40001`; the failed client was reused via a raw search-path query. Pool-size-one mixed-schema smoke passed on the original pinned PgBouncer 1.25.2 image with PostgreSQL 15.
- Final API/worker r5 runtime smoke passed through the original pinned pooler (`database=ok`, graceful shutdown); Admin Web r4 served index/assets as non-root uid 101. Protected production startup remains fail-closed pending external QR/OTP/provider/metrics/evidence inputs.
- Worker r5 readiness remains explicitly unqualified: it reported `database=ok`/`migration=ok` but HTTP 503 with `scheduler=down`/`lastLoop=not_configured`; source wiring provides `WORKER_METRICS_COLLECTOR_SCHEDULER` as `undefined` and never calls `markSchedulerInitialized()`. No fake readiness or telemetry was added.
- 2026-10-05 disposable Docker/Linux worker real-entrypoint qualification: `/health/live` returned HTTP 200 with `release=null` and startup checks `environment=not_configured`, `database=not_configured`, `migration=not_configured`, `scheduler=not_configured`, `draining=ok`, and `lastLoop=not_configured`; `/health/ready` returned HTTP 200 with `environment=ok`, `database=ok`, `migration=ok`, `scheduler=ok`, and `draining=ok`, with `lastLoop=not_configured`. `/metrics` remained HTTP 503 without protected metrics authority. This supersedes only the source-wiring readiness qualification, not the historical r5 image record. The database-down/SIGTERM sample reported `database=down` and `draining=down`; the separate healthy-database SIGTERM supplement had pre-signal HTTP 200 and graceful exit 0 but the listener closed before any post-signal HTTP 503 could be captured, so no healthy 200→503 drain transition is claimed and staging/production remain **CONDITIONAL / NO-GO**.
- The readiness harness now waits for bounded TCP `psql ... -c "SELECT 1;"` after the observed `pg_isready` PostgreSQL initialization race, builds the genuine worker Docker image without a host Yarn build, and captures the disposable PostgreSQL mount before label-scoped `--force --volumes` cleanup. Final smoke-owned resources were absent; the earlier failed attempt's anonymous-volume identity remains unavailable from bounded Docker events and is not claimed clean.
- Final recursive Yarn audit retains two upstream high advisories (`braces@3.0.3`, `node-forge@1.4.0`) and deprecation findings; no advisory was suppressed.
- The consolidated final qualification evidence and exact authored-file inventory are linked from [`docs/superpowers/evidence/2026-10-04-prisma7-checkpoint.md`](docs/superpowers/evidence/2026-10-04-prisma7-checkpoint.md); protected staging and production remain explicitly unqualified.
