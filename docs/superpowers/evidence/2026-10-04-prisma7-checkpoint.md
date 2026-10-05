# Final platform runtime qualification evidence

Date: 2026-10-04

Worktree: `deploy/develop`

Scope: Node 24, Expo 57, Prisma 7.10.0, backend/runtime images, CI qualification, mobile managed checks, security controls, and disposable database qualification. This is the consolidated final record for the upgrade-authored worktree changes. It does not claim protected staging readiness, provider delivery, external metrics authority, or production deployment.

## Versions and disposable infrastructure

- Node: `v24.18.1`
- Corepack/Yarn: `4.18.0`
- Prisma CLI, `@prisma/client`, and `@prisma/adapter-pg`: `7.10.0`
- PostgreSQL: Docker `postgres:16-alpine`
- Disposable container: `imeal-prisma7-pg`
- Host port: `55432` (the existing `127.0.0.1:5432` service was not used)
- Disposable schemas exercised: `public`, `debug_seed`, and image/runtime smoke schemas. No protected data was used.

The disposable database password and any external credentials are intentionally not recorded. Commands below use `$DISPOSABLE_DATABASE_URL` as a local shell variable whose value was a disposable-only connection URL.

## Prisma configuration and adapter contract

- `packages/domain/prisma.config.ts` uses Prisma 7 `defineConfig`, checked-in schema/migration paths, and `env('DATABASE_URL')`.
- The former Prisma 8-only `skills` configuration was removed. No `as any`, unknown-field spread, or compatibility alias remains.
- `packages/domain/prisma/schema.prisma` has no datasource URL, uses `provider = "prisma-client"`, and emits ESM TypeScript to `src/generated/prisma`.
- Generated output is a build artifact and is ignored by `.gitignore`; generation runs before TypeScript builds and in API/worker image builders.
- `packages/domain/src/prisma.ts` is the canonical client boundary. Direct URLs retain the PostgreSQL startup `search_path` option. URLs with `pgbouncer=true` use the official `pg` `PoolConfig.Client` hook instead: startup `search_path` is omitted, `SET LOCAL search_path` follows the exact PrismaPg `BEGIN`, and standalone queries run in an explicit transaction. This is required because PostgreSQL 15 does not report `search_path` for PgBouncer to track. Standalone pooled queries pay one extra `BEGIN`/`SET LOCAL`/`COMMIT` sequence; migrations reject pooled URLs and remain direct.
- The pooled adapter preserves PrismaPg factory lifecycle, connection information, error handling, rollback, and disposal. Failed terminal control SQL or failed rollback discards the public `pg.Client` with `end()`; ordinary in-transaction query errors remain recoverable for savepoints. Unsupported future `Submittable` queries fail closed rather than bypassing schema setup.
- `packages/domain/tsconfig.build.json` is a strict NodeNext build boundary. Its explicit `skipLibCheck: true` matches the existing package `tsconfig.json` setting; it was not introduced as a new blanket suppression.
- Schema input is deliberately bounded to the repository's simple PostgreSQL identifier invariant; no speculative URL translation was added.
- `pool_timeout=0` and `connect_timeout=0` remain disabled. An explicit `connection_limit` maps directly to `pg.max`; when omitted, `pg` inherits its driver default pool maximum of 10 rather than the legacy Rust-engine CPU-derived default. For positive timeout values, `pg`'s single shared timer uses the stricter positive bound. Omitted timeout values use explicit Prisma-compatible defaults (10 seconds pool, 5 seconds connect) rather than silently inheriting `pg`'s indefinite timer. When the two Prisma timers differ, this is a documented conservative tradeoff because `pg` cannot represent them independently.
- `@imeal/core` is the only package boundary. The unused `@imeal/core/prisma` subpath export and obsolete `ts-node` dependency were removed; local seed runs with `tsx`.
- No model, relation, enum, index, constraint, or migration file changed.

## Commands and observed results

All database commands used the disposable database variable and an explicit schema. No command used a repository or protected GitHub secret.

```text
corepack yarn install --immutable
  PASS — Yarn 4.18.0; existing YN0086 peer warning only.

DATABASE_URL="$DISPOSABLE_DATABASE_URL" corepack yarn workspace @imeal/core prisma validate --schema prisma/schema.prisma
DATABASE_URL="$DISPOSABLE_DATABASE_URL" corepack yarn workspace @imeal/core prisma generate --schema prisma/schema.prisma
  PASS — Prisma 7.10.0 validation and generated client.

DATABASE_URL="$DISPOSABLE_DATABASE_URL" corepack yarn workspace @imeal/core prisma migrate deploy
  PASS — all 10 existing migrations applied to a fresh disposable schema.

corepack yarn workspace @imeal/core build
  PASS — strict NodeNext core build, generated client included.

DATABASE_URL="$DISPOSABLE_DATABASE_URL" corepack yarn workspace @imeal/core test:unit --run
  PASS — 5 files, 45 tests.

DATABASE_URL="$DISPOSABLE_DATABASE_URL" corepack yarn workspace @imeal/core test --run
  PASS — 10 files, 89 tests (final post-hook count; schema isolation, transactions/rollback, concurrency, serving behavior, and local-seed database paths).

DATABASE_URL="$DISPOSABLE_DATABASE_URL" corepack yarn workspace @imeal/api test
  PASS — 32 files, 280 tests.

DATABASE_URL="$DISPOSABLE_DATABASE_URL" corepack yarn workspace @imeal/api test:e2e --run
  PASS — 11 files, 78 tests.

DATABASE_URL="$DISPOSABLE_DATABASE_URL" corepack yarn workspace @imeal/worker test
  PASS — 21 files, 178 tests.

DATABASE_URL="$DISPOSABLE_DATABASE_URL" corepack yarn workspace @imeal/worker test:e2e --run
  PASS — 2 files, 10 tests.

corepack yarn lint
  PASS — 8 packages, 0 errors; existing warnings only.

corepack yarn typecheck
  PASS — contracts/core/API/worker/mobile/admin-web after the SDK 51 mobile notification behavior fix.
```
The earlier command block records the checkpoint-2 sequence; final post-hook counts and final image/scanner qualification are consolidated below. No protected staging or production gate is inferred from disposable checks.

The API e2e health setup writes a temporary migration marker whose target is the already-migrated disposable schema and whose release is a test-only label; it removes the file and restores environment variables during teardown. This is legitimate disposable test metadata, not protected staging evidence or an approval substitute. The employee-activity fixture uses an explicit noncolliding historical date rather than depending on the wall clock. Neither change alters service rules.

### Final adapter and image qualification additions

- `corepack yarn workspace @imeal/core build`: PASS after the official `pg` Client hook and lifecycle cleanup changes.
- `corepack yarn workspace @imeal/core exec vitest run test/db-connection.spec.ts`: PASS, 3/3 real PostgreSQL tests, including savepoint rollback, outer rollback, and a two-row SSI write-skew where the second callback completed and terminal COMMIT returned PrismaPg `DriverAdapterError.cause.kind=TransactionWriteConflict` with SQLSTATE `40001`; the failed client was reused successfully via raw search-path query.
- Pool-size-one consumer smoke against the original pinned PgBouncer 1.25.2 image and PostgreSQL 15: PASS for two alternating schemas across interactive transactions, standalone raw/ORM queries, trigger-backed writes, rollback, and reconnect after a terminated backend. No `track_extra_parameters`, PostgreSQL 18, or protected credentials were used.
- `imeal-api-prisma7:final-20261004-r5` / manifest `sha256:3d61b521dbbd59a56f4a490b42159da851454f0aa5e811d23e90631935832826` (config `sha256:b9efc80c30e31c4bbe2793997f799374b057d1477d2d35dfa7c583a690ba7c34`): rebuilt after the final local-seed PrismaPg conflict-policy mapping.
- `imeal-worker-prisma7:final-20261004-r5` / manifest `sha256:2dad9742d96d70df76b1d4e8e0424a03ed5a11bee19786a9aeac715d0d406c25` (config `sha256:9ce84ee7cac7985c129bb1547747521d4597aa8770eb50a22554c36d9f51e54b`): rebuilt after the final local-seed PrismaPg conflict-policy mapping.
- API r5 `/health` reached HTTP 200 with `database=ok` and `migration=ok` through the original pinned pooler using the disposable r5 marker; worker r5 `/health/live` reached HTTP 200 and `/health/ready` reached HTTP 503 with `database=ok`/`migration=ok`, `scheduler=down`, and `lastLoop=not_configured`; both containers logged graceful shutdown completion. Source inspection of the untouched worker readiness wiring finds `WORKER_METRICS_COLLECTOR_SCHEDULER` provided as `undefined` and no `markSchedulerInitialized()` call; this is an explicit pre-existing readiness gate, not attributed to the Prisma/image changes.
- `imeal-admin-prisma7:final-20261004-r4` / `imeal-admin-prisma7@sha256:0c492ba50d70ab4c36efc257b31053714aeb59268f196449b85c8d00d21f702c`: nginx/1.30.5 served the index and `/assets/index-CiwbJ-pj.js` over HTTP 200 as uid 101 after stable Alpine v3.24 upgrades to libexpat 2.8.5-r0 and pcre2 10.49-r0; Admin was unchanged by the final backend mapper and remains r4.
- Full production startup remains intentionally blocked by missing protected QR/OTP/session/provider/metrics/evidence inputs and by the currently unqualified worker scheduler readiness wiring above. Test/development runtime checks do not establish production readiness.

## Final command, artifact, and security status

The following results are the final observations for this worktree. They are local/disposable qualifications unless explicitly identified as a source or protected-input blocker.

```text
corepack yarn install --immutable
  PASS — Yarn 4.18.0; existing aggregate YN0086 peer warning only.

corepack yarn build
  PASS — 6 successful Turbo tasks (core, observability, contracts, Admin Web, API, worker).

corepack yarn typecheck
  PASS — contracts, core, API, worker, mobile, and Admin Web.

corepack yarn lint
  PASS — 0 errors; existing API/worker warnings only.

corepack yarn test:unit
  PASS — 60 files, 542 tests (core 45, contracts 43, API 279, worker 175).

DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/imeal_ci?schema=public&pgbouncer=true corepack yarn test:db
  PASS — 23 files, 177 tests (core 10/89, API e2e 11/78, worker e2e 2/10).

corepack yarn test:staging-tools
  PASS — 115 tests (post-review cleanup; the historical checkpoint recorded 121 tests).

corepack yarn node --test scripts/staging/compose-config.test.mjs
  PASS — 6 tests.

Throwaway staging workflow branch/dispatch expression smoke
  PASS — 5 guarded cases; no source-wiring test was added.

corepack yarn workspace @imeal/core exec vitest run test/db-connection.spec.ts
  PASS — 3 bounded real-PostgreSQL regressions: savepoint/outer rollback and terminal COMMIT SQLSTATE 40001 recovery after a two-row SSI write-skew.

Actual disposable migration gate using imeal-migration-prisma7:final-20261004-r5
  PASS — PostgreSQL 16 on host port 55432, direct URL/schema migration_r3_smoke,
  test-only release final-20261004-r5, target migration-r5-disposable, approval approval-r5-disposable, marker mode 0444. This is not production approval.
```

## Final image bindings and scanner proof

These are uncommitted local worktree aliases and local image manifests, not registry release bindings:

| Artifact | Final local manifest | Runtime/qualification evidence |
| --- | --- | --- |
| `imeal-api-prisma7:final-20261004-r5` | manifest `sha256:3d61b521dbbd59a56f4a490b42159da851454f0aa5e811d23e90631935832826`; config `sha256:b9efc80c30e31c4bbe2793997f799374b057d1477d2d35dfa7c583a690ba7c34` | `/health` HTTP 200, `database=ok`/`migration=ok` through original pinned PgBouncer 1.25.2/PostgreSQL 15, graceful SIGTERM |
| `imeal-worker-prisma7:final-20261004-r5` | manifest `sha256:2dad9742d96d70df76b1d4e8e0424a03ed5a11bee19786a9aeac715d0d406c25`; config `sha256:9ce84ee7cac7985c129bb1547747521d4597aa8770eb50a22554c36d9f51e54b` | `/health/live` HTTP 200; `/health/ready` HTTP 503 with `database=ok`/`migration=ok`, scheduler down, last loop not configured; graceful SIGTERM |
| `imeal-admin-prisma7:final-20261004-r4` | manifest `sha256:0c492ba50d70ab4c36efc257b31053714aeb59268f196449b85c8d00d21f702c` | unchanged by backend mapper; nginx/1.30.5 index/assets HTTP 200, UID 101; stable Alpine 3.24 package fixes |
| `imeal-migration-prisma7:final-20261004-r5` | manifest `sha256:e0c5823fbb7afde00aa21f1d6e8d7985248024e3a5c6b3ee998abd38ec926537`; config `sha256:30a323512de3980de7912a2eb29e855aa878272fea1c5e38915612fcd6cc42a1` | rebuilt from current worktree; actual disposable migration gate passed as recorded above |

Historical migration r3 digest `sha256:bf3a5f64d14a2e6c332e7e14d894f3c1d1707278e6aa545185da642cab7a5dbe` is retained only as historical evidence; it is not the final source binding.

The exact pinned scanner references were:

```text
aquasec/trivy@sha256:fa9a2d2a839e69bfc0e774e885c526b5db20dc1feba5bcd1bfb59e51e7855ae0
anchore/syft@sha256:b8c170b8e51bfc4779ec3ef4399942c57290f5ce76a9c3af564c9d00d4946a6b
```

Local final-image Trivy policy proof passed with 0 HIGH and 0 CRITICAL for API r5, worker r5, Admin r4, and migration r5 (`--exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed`; no advisory suppression). The corrected extracted CI SBOM loop used the pinned Syft v1.18.1 source syntax `docker:imeal/${service}:${GITHUB_SHA}` against r5 API/worker aliases and unchanged Admin r4, producing SPDX JSON. Assertions inspected actual `SPDXRef-Package-*` IDs. A separate local four-image Syft run produced SPDX JSON for API r5 (1,284 packages), worker r5 (1,284), Admin r4 (72), and migration r5 (1,291).

The workflow now uses Syft's supported `docker:` source prefix in both built-image and protected deployed-image invocations, with the required trailing continuation on each pinned scanner image line. Both Trivy workflow jobs create a shared `$RUNNER_TEMP/trivy-cache` and use the measured `--timeout 15m`. The protected workflow job was not run: its protected credentials, endpoints, approval, and immutable release inputs are unavailable. The corrected local scanner proof is not a protected-job PASS.

The observed PrismaPg 7 terminal serialization failure was a `DriverAdapterError` whose `cause` contained `kind: "TransactionWriteConflict"` and `originalCode: "40001"`; the true COMMIT smoke exercised SQLSTATE `40001`, not a live deadlock. The installed upstream PrismaPg mapping recognizes SQLSTATE `40001` and `40P01` as that same `TransactionWriteConflict` kind, and the error does not expose a top-level `P2034` code at this boundary. Repository search found one existing P2034-dependent consumer: local-seed's bounded retry policy. Its narrow error extractor recognizes only this exact PrismaPg cause kind with original code `40001` or `40P01` and maps it to the existing `P2034` policy code; no global adapter shim or new retry policy was added. No other serialization-error caller required migration.

## Security and mobile evidence links

- Node 24 foundation and four Dockerfile base-image contract: [`2026-10-04-node24-foundation.md`](2026-10-04-node24-foundation.md).
- Expo SDK 57 managed dependency, Expo Doctor, TypeScript, 28-file/158-test, Metro Android/iOS/web bundle, and unauthenticated web-runtime evidence: [`2026-10-04-mobile-sdk57-research.md`](2026-10-04-mobile-sdk57-research.md). No physical-device, OTP, authenticated-session, GPS, QR, or native-build claim is made.
- Final dependency audit and exact lock resolutions: [`2026-10-04-final-dependency-audit.md`](2026-10-04-final-dependency-audit.md). Two unfixed HIGH advisories remain (`braces@3.0.3`, `node-forge@1.4.0`); no advisory was suppressed.
- Final image Trivy/Syft and runtime bindings: [`2026-10-04-image-scans.md`](2026-10-04-image-scans.md).
- Gitleaks source/full-history and negative-control evidence: [`2026-10-04-secret-scanner-ci-review.md`](2026-10-04-secret-scanner-ci-review.md).

## Upgrade-authored final file inventory

This is the single final inventory collected from the worktree mutation list. It includes the Node, mobile, backend, CI, documentation, security, image, and regression-test changes owned by this upgrade.

The former `scripts/staging/runbook-links.test.mjs` source-only wording/link test was deleted during the final test-policy cleanup; the `test:staging-tools` glob now covers the remaining staging tests.

### Root, CI, security, and operator contract

- `.github/workflows/staging-readiness.yml`
- `.gitleaks.toml`
- `.gitignore`
- `CHANGELOG.md`
- `README.md`
- `UPGRADE.md`
- `package.json`
- `yarn.lock`

### Admin Web

- `apps/admin-web/Dockerfile`
- `apps/admin-web/package.json`

### Mobile

- `apps/mobile/App.tsx`
- `apps/mobile/app.config.ts`
- `apps/mobile/index.js`
- `apps/mobile/metro.config.js`
- `apps/mobile/package.json`
- `apps/mobile/src/notifications/NotificationProvider.tsx`
- `apps/mobile/src/screens/checkIn/SelfCheckInScreen.tsx`
- `apps/mobile/src/screens/profile/ProfileComposition.tsx`
- `apps/mobile/src/startLanLauncher.test.ts`
- `apps/mobile/src/ui/AppShell.test.tsx`
- `apps/mobile/src/ui/AppShell.tsx`
- `apps/mobile/src/ui/components/Controls.tsx`

### API

- `apps/api/Dockerfile`
- `apps/api/package.json`
- `apps/api/src/admin/allowlist/allowlist.controller.spec.ts`
- `apps/api/src/admin/allowlist/allowlist.controller.ts`
- `apps/api/src/admin/locations/locations.service.spec.ts`
- `apps/api/src/admin/penalties/penalties.service.spec.ts`
- `apps/api/src/admin/penalties/penalties.service.ts`
- `apps/api/src/admin/roster/roster-import.service.spec.ts`
- `apps/api/src/admin/users/admin-users.service.ts`
- `apps/api/src/admin/weekly-menus/weekly-menus.service.spec.ts`
- `apps/api/src/admin/weekly-menus/weekly-menus.service.ts`
- `apps/api/src/auth/session.service.spec.ts`
- `apps/api/src/check-in/check-in.service.ts`
- `apps/api/src/common/prisma.service.spec.ts`
- `apps/api/src/common/prisma.service.ts`
- `apps/api/src/common/transaction-locks.ts`
- `apps/api/src/locations/locations.service.ts`
- `apps/api/src/notifications/notifications.service.spec.ts`
- `apps/api/src/notifications/notifications.service.ts`
- `apps/api/src/otp/otp-outbox.service.ts`
- `apps/api/src/penalties/employee-penalties.service.ts`
- `apps/api/src/registrations/registrations.service.spec.ts`
- `apps/api/src/registrations/registrations.service.ts`
- `apps/api/test/admin-users.e2e-spec.ts`
- `apps/api/test/employee-activity.e2e-spec.ts`
- `apps/api/test/health.e2e-spec.ts`
- `apps/api/test/production-concurrency.e2e-spec.ts`

### Worker

- `apps/worker/Dockerfile`
- `apps/worker/package.json`
- `apps/worker/src/app.module.spec.ts`
- `apps/worker/src/common/prisma.service.spec.ts`
- `apps/worker/src/common/prisma.service.ts`
- `apps/worker/src/no-show-worker.service.spec.ts`
- `apps/worker/src/no-show-worker.service.ts`
- `apps/worker/src/notification-dispatch.service.ts`
- `apps/worker/src/notification-reminder.service.ts`
- `apps/worker/src/otp-delivery-worker.service.ts`
- `apps/worker/src/worker-notification-publisher.ts`
- `apps/worker/test/no-show-worker.e2e-spec.ts`

### Core, contracts, observability, and migration image

- `packages/contracts/package.json`
- `packages/observability/package.json`
- `packages/domain/package.json`
- `packages/domain/prisma.config.ts`
- `packages/domain/prisma/schema.prisma`
- `packages/domain/tsconfig.build.json`
- `packages/domain/src/index.ts`
- `packages/domain/src/prisma.ts`
- `packages/domain/src/RegistrationService.ts`
- `packages/domain/src/db.ts`
- `packages/domain/src/local-seed/index.ts`
- `packages/domain/src/local-seed/writer.ts`
- `packages/domain/test/concurrency.test.ts`
- `packages/domain/test/db-connection.spec.ts`
- `packages/domain/test/legacyRegistrationFixture.ts`
- `packages/domain/test/local-seed-cli.unit.test.ts`
- `packages/domain/test/local-seed-writer.unit.test.ts`
- `packages/domain/test/setup.ts`
- `infra/migrations/Dockerfile`

### Documentation and plans
- `docs/imeal-production-readiness-assessment.md`

- `docs/local-role-testing.md`
- `docs/runbooks/staging-readiness.md`
- `docs/superpowers/plans/2026-09-24-imeal-local-seed-plan.md`
- `docs/superpowers/plans/2026-09-28-imeal-phase0-domain-correctness-plan.md`
- `docs/superpowers/plans/2026-09-28-staging-readiness-plan.md`
- `docs/superpowers/specs/2026-09-28-staging-readiness-design.md`
- `docs/superpowers/plans/2026-10-04-platform-runtime-upgrade.md`
- `docs/superpowers/evidence/2026-10-04-final-dependency-audit.md`
- `docs/superpowers/evidence/2026-10-04-image-scans.md`
- `docs/superpowers/evidence/2026-10-04-mobile-sdk57-research.md`
- `docs/superpowers/evidence/2026-10-04-node24-foundation.md`
- `docs/superpowers/evidence/2026-10-04-prisma7-checkpoint.md`
- `docs/superpowers/evidence/2026-10-04-secret-scanner-ci-review.md`

`apps/worker/tsconfig.build.tsbuildinfo` was already dirty in the initial worktree. It was not hand-edited, reverted, or used as authored source inventory; compiler runs may regenerate it. Throwaway local scanner/gate files under `tmp/` are not deliverables and are removed after qualification.

## Readiness and release blockers

- The worker r5 live/database smoke passed, but readiness is HTTP 503: source wiring provides `WORKER_METRICS_COLLECTOR_SCHEDULER` as `undefined` and does not call `markSchedulerInitialized()`, so scheduler and last-loop checks remain down/not configured. No fake telemetry or readiness override was added.
- Protected production/staging startup is fail-closed because exact protected QR/session/OTP/provider/metrics/evidence inputs, approved endpoints/identity, and release approval are unavailable in this worktree. The disposable migration marker uses test-only labels and is not production approval.
- The recursive dependency audit intentionally remains non-green for the two unfixed HIGH advisories and deprecation findings documented above; no ignore-CVE policy was added.
- Local aliases at `d61af2c9463b1f3597c8288184fbde0ae41d503e` and final image tags are uncommitted worktree artifacts, not released source-commit or registry-digest proof.

Root upgrade links:

- [`UPGRADE.md`](../../../UPGRADE.md)
- [`CHANGELOG.md`](../../../CHANGELOG.md)
- [`2026-10-04-platform-runtime-upgrade.md`](../plans/2026-10-04-platform-runtime-upgrade.md)

Those documents point back to this consolidated record for the complete final inventory and qualification status.
