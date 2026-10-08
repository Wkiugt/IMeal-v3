# IMeal v2 Production Hardening Design

**Status:** Design only — no production code or deployment configuration is changed by this document.

**Date:** 2026-09-28

**Scope:** Repository-addressable hardening for the API, worker, Prisma lifecycle, Compose deployment boundary, Caddy edge, runtime secrets, health/readiness, request correlation, structured logs, graceful shutdown, and migration cutover.

## 1. Executive decision

Adopt a secure-by-default Compose topology with one public edge and private application/data networks:

```text
Staff / Kitchen / Admin browser
             |
       Caddy :80/:443
        /           \
  Admin static       API :3000
                         |
                    PgBouncer :5432
                         |
                    PostgreSQL :5432

Worker :3001  -----------+

MinIO is private and is not routed by Caddy.
```

The implementation is intentionally boring:

1. Keep one API process and one worker process at the documented 200–300-user scale.
2. Make production Compose an explicit overlay, with no public database, PgBouncer, MinIO, or worker ports.
3. Terminate TLS at Caddy and redirect HTTP to HTTPS.
4. Require every production secret and fixed operational setting before either process listens.
5. Use separate liveness and readiness probes. Readiness must fail closed on database or startup-gate failure and must never expose raw dependency errors.
6. Generate and return one validated request ID on every API response, and emit safe structured JSON logs.
7. Use one injected Prisma client per process with explicit connect/disconnect lifecycle.
8. Drain HTTP/SSE and stop new scheduled work on SIGTERM/SIGINT before disconnecting Prisma.
9. Make migration deployment a one-shot, target-safe gate. API and worker start only after migration, preflight, approval, backfill, and validation succeed.
10. Treat migration rollback as database restore/application rollback, never as a destructive down migration.

This design does not make the product production-ready by itself. It closes the deployment/runtime hardening boundary while retaining the separate prerequisites for identity provisioning, approved locations/roster, backup/restore, observability destination, and release/UAT evidence.

## 2. Repository evidence and constraints

The design follows the current repository rather than introducing a second contract.

### 2.1 Canonical contracts

- `docs/README.md:7-23` requires allowlist-A email OTP, opaque PostgreSQL-backed sessions, private operational data, `Asia/Ho_Chi_Minh`, 5-second QR TTL, 30-second pickup sessions, and centralized monitoring.
- `docs/README.md:79-94` requires server-authoritative writes, API-side time, minimized sensitive evidence, persisted notifications, and centralized API/worker/PostgreSQL health monitoring.
- `docs/02-technical-requirements.md:148-175` requires HTTPS at the reverse proxy, private PostgreSQL, explicit API permissions, and server-side pickup validation.
- `docs/02-technical-requirements.md:216-256` defines success/error envelopes, request IDs, idempotency behavior, cursor bounds, realtime envelopes, production environment requirements, and fixed business settings.
- `docs/05-backend-structure.md:1015-1064` defines the additive migration, target-safe preflight, independent approval, deterministic backfill, post-backfill validation, and no-destructive-rollback procedure.
- `docs/imeal-production-readiness-assessment.md:203-222` identifies public network exposure, TLS, backup/restore, and identity provisioning as P0 release blockers.
- `docs/imeal-production-readiness-assessment.md:295-326` defines the recommended single-host topology, private data services, Caddy edge, backups, centralized telemetry, and pinned images.
- `AGENTS.md:108-115` requires Yarn 4.18.0, Docker Compose, Prisma migrations, and runtime secrets outside source control.

### 2.2 Current implementation evidence

The following are the concrete seams this design addresses:

- `apps/api/src/main.ts:9-20` validates API configuration but does not configure graceful shutdown, request correlation, or startup failure handling.
- `apps/worker/src/main.ts:5-12` validates worker configuration and listens, but has no graceful shutdown or readiness endpoint.
- `apps/api/src/config/environment.ts:73-147` already provides fail-closed API validation, including OTP/session secrets, provider settings, GPS bounds, fixed serving values, and test-only auth bypass.
- `apps/worker/src/otp-delivery-worker.service.ts:268-314` validates worker delivery settings, but worker runtime lifecycle is still unmanaged.
- `apps/api/src/app.service.ts:12-27` exposes a DB health response with HTTP-success semantics even when the query fails, and returns the raw database error message.
- `apps/worker/src/app.controller.ts:4-12` exposes only a Hello World root route; `docker-compose.yml:194-206` uses that route as worker health.
- `apps/api/src/common/api-exception.filter.ts:58-114` creates structured error envelopes and error request IDs, but does not provide a global success-response request ID or structured exception logging.
- `apps/api/src/app.service.ts:5-6`, `apps/api/src/auth/session.service.ts:70-73`, `apps/api/src/registrations/registrations.service.ts:120-123`, and worker services such as `apps/worker/src/cutoff-worker.service.ts:5-12` and `apps/worker/src/notification-dispatch.service.ts:110-122` independently construct Prisma clients.
- `docker-compose.yml:1-250` publishes DB, PgBouncer, and MinIO ports; forces MD5/plain database authentication; uses mutable images; and builds `admin-web` from the repository root without naming `apps/admin-web/Dockerfile`.
- `Caddyfile:1-17` disables automatic HTTPS, listens only on `:80`, and exposes `/storage/*` through MinIO.
- `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/migration.sql:70-115` deliberately leaves two constraints `NOT VALID`; the documented preflight/backfill/validation gate is therefore operationally significant and cannot be replaced by `prisma migrate deploy` alone.

## 3. Goals

1. Prevent accidental public access to PostgreSQL, PgBouncer, MinIO, the worker, and internal migration services.
2. Ensure production cannot start with placeholder credentials, test auth bypass, insecure provider URLs, incorrect business invariants, or missing migration approval.
3. Provide truthful liveness/readiness signals suitable for Compose restart and external monitoring.
4. Make every API request and error correlatable without trusting attacker-supplied arbitrary IDs.
5. Emit machine-readable logs with no OTPs, session tokens, QR payloads, raw coordinates, provider payloads, or routine personal data.
6. Stop accepting new work cleanly during deployment and close Prisma connections deterministically.
7. Prevent a migration race or dirty target from becoming an application cutover.
8. Preserve existing API contracts, business rules, idempotency, and transaction boundaries except where required to expose health and lifecycle behavior.
9. Keep the design deployable on the documented single Linux host with Docker Compose; do not introduce Kubernetes, Redis, Kafka, or a distributed tracing broker.

## 4. Non-goals

- Implementing Admin user/role/disable lifecycle inside this hardening design. That lifecycle is not missing; it is a separate product surface and is outside this design.
- Changing OTP, QR, GPS, registration, serving, delegation, penalty, or notification business rules.
- Designing a new backup product. Backup destination, encryption ownership, restore rehearsal, RPO/RTO, and rollback authority remain external release prerequisites.
- Adding horizontal API/worker scaling, a distributed event broker, Redis, Kafka, or Kubernetes.
- Making MinIO public or adding a public object-storage URL contract.
- Replacing the existing shared contracts or creating an alternate response-envelope convention.
- Treating local Compose or disposable migration evidence as staging/production approval.

## 5. Target deployment boundary

### 5.1 Networks and exposure

The production Compose model uses three logical networks:

- `edge`: Caddy and the Admin Web container. Only Caddy publishes host ports 80 and 443.
- `app`: Caddy, API, worker, and the migration gate. This network is internal to the host and permits only service-to-service traffic.
- `data`: API, worker, migration gate, PgBouncer, PostgreSQL, and private MinIO as needed. This network is internal and has no host-published ports.

The API and worker keep container ports 3000 and 3001 respectively. They are not host-published. The worker does not receive public traffic. PostgreSQL, PgBouncer, MinIO API, and the MinIO console have no host `ports` entries in production.

Caddy may proxy API paths and Admin Web content. It must not proxy `/storage/*` to MinIO. Menu images remain private object storage and need an application-authorized/signed access design before any public image route is added.

### 5.2 Compose file responsibilities

Add a production overlay at `docker-compose.production.yml` and keep local developer values separate from production values. The exact invocation is:

```text
docker compose \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  up -d --build
```

The overlay must:

- bind only Caddy `80:80` and `443:443`;
- remove or reset all base host-published DB, PgBouncer, MinIO, and console ports;
- put DB, PgBouncer, API, worker, migration gate, and MinIO on internal networks;
- require production variables with `${NAME:?NAME is required}` instead of using `CHANGE_ME_LOCAL` defaults;
- use a direct PostgreSQL URL only for the migration gate and a PgBouncer transaction-pooling URL for API/worker runtime;
- set `NODE_ENV=production`, `AUTH_MODE=otp`, and `REQUIRE_AUTH=true` explicitly;
- set `stop_grace_period` long enough for the documented shutdown timeout plus margin;
- make API and worker depend on successful completion of the migration gate, not merely successful PostgreSQL health;
- use `apps/admin-web/Dockerfile` explicitly for the Admin Web build;
- pin every image to an approved immutable tag or digest, including PostgreSQL, PgBouncer, MinIO, Caddy, Nginx, and Node base images;
- remove the PostgreSQL `password_encryption=md5` command and `POSTGRES_HOST_AUTH_METHOD=md5` setting;
- configure SCRAM-capable PostgreSQL/PgBouncer authentication and verify the selected PgBouncer image supports the configured authentication mode;
- avoid putting provider/API keys in command lines or image layers;
- run application containers as a non-root UID after verifying filesystem write paths.

Because Compose list merge behavior differs across Compose versions, the overlay must be validated with `docker compose config`. If the selected Compose version cannot reliably reset inherited `ports`, the maintainable alternative is to move local host-port mappings from the shared base into a `docker-compose.local.yml` file and make the base secure by default. Production must never depend on an overlay merge quirk to remove an exposed port.

### 5.3 Caddy production contract

Replace the development-only `Caddyfile` behavior with a production site configuration whose hostname is supplied by the approved `PUBLIC_HOSTNAME` value. Caddy must:

- serve the approved hostname on HTTPS with automatic ACME certificate management or an externally managed certificate;
- redirect all HTTP requests to HTTPS;
- proxy API paths matching the current API route families (`/api/*`, `/auth/*`, `/registrations/*`, `/admin/*`, `/v1/*`, `/internal/*`) to `imeal_api:3000`;
- serve Admin Web static content for non-API paths;
- not expose MinIO or any internal service;
- set security headers appropriate to the Admin Web/API boundary (at minimum HSTS after HTTPS verification, content-type protection, referrer policy, and a deliberately reviewed content-security policy rather than a blanket permissive policy);
- pass the original request ID only after API-side validation, or leave it for the API to generate;
- preserve WebSocket/SSE support and streaming timeouts for kitchen realtime paths;
- log only safe access metadata and use a central sink configured outside the repository.

Caddy's certificate issuance requires DNS records, inbound 80/443 reachability, an ACME account/contact policy, and a certificate storage volume with restricted permissions. These are external prerequisites, not values to invent in source control.

## 6. Fail-closed runtime configuration and secret contract

### 6.1 Existing validation to preserve

`validateApiEnvironment` remains the single API startup validation entry point. It must continue enforcing:

- `DATABASE_URL` and `QR_SIGNING_SECRET`;
- `AUTH_MODE=otp` and `REQUIRE_AUTH=true` outside the exact `NODE_ENV=test` plus `REQUIRE_AUTH=false` harness;
- OTP hash and delivery-encryption secrets;
- session hash secret and idle/absolute timeouts;
- HTTPS OTP provider URL, API key, and sender identity;
- OTP expiry/resend/attempt/rate values;
- positive GPS policy defaults;
- exact serving/QR values from `apps/api/src/config/environment.ts:24-31`.

The validator should trim before length checks, reject known placeholder values (`CHANGE_ME_LOCAL`, `replace-with-`, `example.test`), and validate production-only URL/network restrictions without logging the values. A production API must fail before `app.listen` when any check fails.

`validateWorkerEnvironment` must enforce the worker's complete production contract before listening: `DATABASE_URL`, OTP encryption/provider settings, all OTP delivery retry/claim settings, and the same fixed business invariants. It must reject production `NODE_ENV` values that are not explicit and must never enable a test default in production.

### 6.2 Required production variables

The production secret manager or protected host environment must supply the existing names, including:

- `DATABASE_URL` for runtime PgBouncer access;
- `QR_SIGNING_SECRET`, `OTP_HASH_SECRET`, `OTP_DELIVERY_ENCRYPTION_KEY`, `SESSION_HASH_SECRET`;
- `OTP_PROVIDER_URL`, `OTP_PROVIDER_API_KEY`, `OTP_PROVIDER_FROM`;
- OTP/session/GPS/serving settings already documented in `.env.example:25-70` and `docs/02-technical-requirements.md:226-251`;
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` without tracked defaults;
- `PUBLIC_HOSTNAME` and the selected ACME/certificate configuration;
- `RELEASE_VERSION` and `LOG_LEVEL` for operational correlation;
- direct `MIGRATION_DATABASE_URL` or an equivalent migration-only injection used only by the migration gate.

The migration-only URL must not be passed to the API or worker. The API/worker runtime URL must use PgBouncer transaction pooling and the migration URL must connect directly to PostgreSQL so Prisma migration advisory/DDL behavior is not routed through transaction pooling.

### 6.3 Secret handling rules

- Secrets are injected at runtime through a protected environment/secret manager and are absent from source control, image layers, Compose command strings, and ordinary logs.
- Secret values are never returned by readiness, diagnostics, error envelopes, or audit details.
- Production rejects the test auth bypass even if other values appear valid.
- Provider URLs must be HTTPS with a hostname; loopback/example destinations are rejected in production.
- Rotation is a runbook operation: provision the new value, restart the affected process through the normal gate, verify readiness and provider delivery, then revoke the old value. QR/session/OTP rotation effects must be explicitly accepted by the operator because existing signed artifacts/sessions may become invalid.

## 7. Health and readiness interfaces

### 7.1 API endpoints

Add a small unauthenticated health controller under a non-business route:

```text
GET /health/live
GET /health/ready
```

`/health/live` is process liveness only. It must not query PostgreSQL or expose configuration. It returns 200 while the API process is able to serve requests and 503 after shutdown begins.

`/health/ready` returns 200 only when:

- production environment validation succeeded;
- Prisma has connected successfully;
- `SELECT 1` succeeds within a bounded timeout;
- the process is not draining;
- a migration evidence marker mounted read-only from the gate matches `RELEASE_VERSION` and the target identity.

A successful response is bounded and machine-readable:

```json
{
  "status": "ok",
  "service": "api",
  "release": "configured-release",
  "checks": { "database": "ok", "migration": "ok" },
  "requestId": "generated-uuid-v4"
}
```

The notation above describes fields, not literal values to commit. A failure returns HTTP 503 with the same envelope shape and only safe check states, for example `database: "down"`; it never includes the Prisma exception message, URL, host, credentials, or stack. Both endpoints return `X-Request-Id`.

The existing `/health` route may remain temporarily as a compatibility alias, but Compose and monitoring must use `/health/live` and `/health/ready`. The alias must adopt the sanitized status code/body semantics rather than retaining `apps/api/src/app.service.ts:12-27`.

### 7.2 Worker endpoints

Add the same `/health/live` and `/health/ready` controller surface to the worker. Worker readiness requires:

- environment validation success;
- Prisma connection and bounded `SELECT 1` success;
- Nest scheduler initialized;
- no shutdown drain in progress;
- the migration gate completed for the current release.

The worker health endpoint must not execute a business job. It reports scheduler readiness and a safe last-loop state only. The root Hello World route must not be used as a production readiness signal.

The worker is internal-only, so its health endpoint is reachable only from the host/monitoring network. Caddy does not proxy it.

### 7.3 Probe and timeout behavior

Every dependency check has a bounded timeout and does not hold a long-lived transaction. Repeated readiness failures produce a structured log event with service, check name, release, and request ID when applicable, but not raw exception text. Compose healthchecks use `wget`/`curl` against readiness routes and must distinguish liveness from readiness.

## 8. Request IDs and structured logging

### 8.1 Request-ID interface

Create one API request context implementation used by middleware/interceptor, the exception filter, and access logging. The behavior is:

1. Read `X-Request-Id` case-insensitively.
2. Accept it only if it matches the existing UUIDv4 validation rule in `apps/api/src/common/api-exception.filter.ts:28-44`.
3. Generate `randomUUID()` for missing or malformed values.
4. Store the chosen ID on the Fastify request context.
5. Set `X-Request-Id` on every response, including successful responses, validation failures, stream responses where headers are available, and errors.
6. Include the ID in the existing error envelope's `requestId` field.
7. Pass the ID to audit/serving records already designed to retain a request ID; never use an arbitrary client string for correlation.

Configure Fastify's proxy trust only for the known Caddy/network boundary. Do not trust arbitrary forwarding headers from public clients.

### 8.2 Structured log interface

Add a new shared `packages/observability` package with:

```ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type SafeLogFields = {
  service: 'api' | 'worker';
  release: string;
  event: string;
  requestId?: string;
  jobName?: string;
  jobRunId?: string;
  statusCode?: number;
  durationMs?: number;
  errorCode?: string;
  providerCode?: string;
  [key: string]: string | number | boolean | undefined;
};

interface StructuredLogger {
  debug(event: string, fields?: SafeLogFields): void;
  info(event: string, fields?: SafeLogFields): void;
  warn(event: string, fields?: SafeLogFields): void;
  error(event: string, fields?: SafeLogFields): void;
}
```

The logger writes one JSON object per line to stdout/stderr for the container runtime. Required base fields are UTC timestamp, level, service, release, and event. HTTP access events additionally contain method, normalized route template (not the raw URL query), status, duration, and request ID. Job events contain job name/run ID and counts. Exceptions are represented by stable error code and sanitized error class/message; stack traces remain local-only or go to a protected error sink according to the external logging policy.

The redaction policy is explicit:

- never log OTP clear codes, OTP provider payloads, session tokens, bearer headers, QR payloads/signatures, raw GPS coordinates, provider API keys, database URLs, or full push tokens;
- use existing hashes or stable IDs for email/identity correlation where required;
- sanitize provider errors using the existing notification redaction behavior at `apps/worker/src/notification-dispatch.service.ts:53-59`;
- do not serialize arbitrary request bodies or exception response objects into logs.

Replace startup `console.log`, production `console.warn`, and raw `logger.error(error)` paths with structured events while preserving operator-useful event names. This is an observability boundary change, not a business response change.

## 9. Graceful shutdown and Prisma lifecycle

### 9.1 One Prisma service per process

Add an injectable `PrismaService extends PrismaClient` in an application-owned shared location. Register it once in API `AppModule` and once in worker `AppModule`. It implements:

```ts
class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  onModuleInit(): Promise<void>;
  onModuleDestroy(): Promise<void>;
}
```

`onModuleInit` connects with a bounded timeout and emits a safe lifecycle event. `onModuleDestroy` calls `$disconnect()` and emits completion/failure safely. All API/worker services currently constructing `new PrismaClient()` receive this instance through their constructors. Tests may continue injecting a Prisma-compatible mock through the constructor boundary; they must not create production clients.

The domain package's `packages/domain/src/db.ts:1-3` remains a separate library entry point for domain tests until a deliberate package-level Prisma ownership change is designed. API and worker processes must not import that global directly; they use their application-owned lifecycle service.

The runtime `DATABASE_URL` must include explicit connection and pool timeout settings appropriate for PgBouncer. Exact values are deployment tuning, but a missing/invalid URL remains a startup error rather than silently falling back to a local database.

### 9.2 API shutdown sequence

In `apps/api/src/main.ts`:

1. Validate environment.
2. Create the app and configure Fastify trust/request-ID behavior.
3. Register structured logging and request context.
4. Connect Prisma/readiness dependencies.
5. Enable Nest shutdown hooks for SIGTERM and SIGINT.
6. Listen only after startup validation succeeds.
7. On shutdown signal, mark the process not-ready, stop accepting new requests, allow in-flight HTTP/SSE work to finish up to `SHUTDOWN_TIMEOUT_SECONDS`, close the Nest/Fastify server, disconnect Prisma, and exit non-zero if shutdown exceeds the bounded deadline.

No request should begin after the process is marked draining. Existing committed transactions remain authoritative; a client retry uses existing idempotency semantics.

### 9.3 Worker shutdown sequence

In `apps/worker/src/main.ts`:

1. Validate environment and connect Prisma.
2. Start Nest/scheduler and mark worker ready.
3. On SIGTERM/SIGINT, mark not-ready and prevent new cron callbacks from starting.
4. Await currently running job/provider attempt completion up to the same bounded shutdown deadline.
5. Close scheduler/Nest resources and disconnect Prisma.
6. Emit one terminal lifecycle event and exit non-zero only on timeout or cleanup failure.

Job claims already use database state/claim tokens. If the process stops after a claim, stale-claim recovery must return the row to a retryable state according to the existing worker policy; shutdown must not manually delete claims or mark business work successful.

### 9.4 Container stop policy

Set Compose `stop_grace_period` to exceed the configured shutdown timeout. Restart policy remains `unless-stopped` for API/worker, but a startup validation failure must remain visible in logs and must not be masked by an infinite crash loop; monitoring alerts on repeated restarts.

## 10. Migration gate integration

### 10.1 Gate ownership

Add `infra/migrations/production-gate.sh` plus its shell/SQL test harness. The gate is the only production process allowed to run Prisma migrations and domain preflight/backfill.

The gate performs, in order:

1. Validate a direct `MIGRATION_DATABASE_URL`, target schema, release identifier, and an externally issued approval identifier. No `CHANGE_ME_LOCAL` or empty values are accepted.
2. Assert the target database/schema in the same `psql` session. Never infer the target from a shell default.
3. Run `prisma migrate deploy` against the direct PostgreSQL URL.
4. Run the current `preflight.sql` with `ON_ERROR_STOP=1`, explicit `search_path`, and a `current_schema()` assertion.
5. Abort with no backfill if any named operational check is non-zero, if the target is ambiguous, if migration status is not clean, or if the independent approval identifier is missing.
6. Run the exact deterministic `backfill.sql` only after approval and clean preflight.
7. Re-run preflight and require the named lifecycle/serving constraints to validate. Use `VALIDATE CONSTRAINT` only after the operational checks are clean.
8. Emit a machine-readable gate result containing target, migration version, release, approval ID, checks, and timestamps. Do not include credentials or row payloads.
9. Exit zero only on complete success.

The gate must be idempotent for retries. It may retain the additive migration after a failed gate; it must never run a destructive down migration or invent snapshot/penalty data.

### 10.2 Compose dependency

The production overlay adds a `migration-gate` one-shot service. API and worker use `depends_on: migration-gate: condition: service_completed_successfully` in addition to private DB/PgBouncer health. The migration gate must use the direct DB network and must not be routed through Caddy.

The gate writes `/run/imeal/migration-gate.json` to a named Compose volume only after all checks pass. The marker contains the release identifier, migration identifier, target schema identifier, approval identifier, and completion timestamp; it contains no credentials or row payloads. API and worker mount the volume read-only and readiness verifies that the marker release matches `RELEASE_VERSION`. A stale marker therefore cannot make a newly released application ready. The release procedure must recreate or rerun the gate when `RELEASE_VERSION` changes.

A successful migration container is not proof of independent approval. The external release operator/pipeline records approval and gate output separately, as required by `docs/05-backend-structure.md:1026-1032` and `docs/06-execution-plan.md:138-151`.

### 10.3 Failure and rollback

- Migration application failure: API/worker remain stopped; inspect the failed migration and restore only under the named rollback authority.
- Preflight non-zero: no backfill, no application start; quarantine/remediate exact rows or restore the approved backup.
- Backfill failure: transaction/statement must stop at the target-safe wrapper; capture output, keep the schema additive, and do not start API/worker.
- Post-backfill validation failure: no cutover; restore the approved backup or remediate exact rows under the documented decision window.
- Application failure after a successful gate: stop traffic, use the previous compatible application against the additive schema or restore the approved database backup. There is no Firebase rollback path and no destructive down migration.

## 11. Files and ownership

This is the proposed implementation map; these files are not changed by this design task.

### New files

- `docker-compose.production.yml` — secure production overlay, private networks, required env, service dependencies, pinned images, stop grace period.
- `infra/migrations/production-gate.sh` — target-safe migration/preflight/approval/backfill/validation orchestration.
- `apps/api/src/common/prisma.service.ts` — API Prisma lifecycle owner.
- `apps/worker/src/common/prisma.service.ts` — worker Prisma lifecycle owner.
- `apps/api/src/common/request-context.ts` — validated request ID and response-header contract.
- `packages/observability/src/index.ts` and package metadata — safe structured logger and field types.
- `apps/api/src/health/health.controller.ts` and health service — live/readiness checks.
- `apps/worker/src/health.controller.ts` and health service — worker live/readiness checks.
- `Caddyfile.production` — TLS edge and private routing.

### Existing files to modify in the implementation phase

- `apps/api/src/main.ts` and `apps/worker/src/main.ts` — startup ordering, logger, signal hooks, and bounded shutdown.
- `apps/api/src/app.module.ts` and `apps/worker/src/app.module.ts` — lifecycle providers and health controllers.
- `apps/api/src/common/api-exception.filter.ts` — consume the canonical request context, sanitize/log exceptions, and preserve the existing envelope.
- Every API/worker service currently using `new PrismaClient()` — constructor injection only; no business-rule rewrite.
- `docker-compose.yml` only if needed to move local port mappings out of the shared base; otherwise keep local behavior and rely on an explicitly validated secure overlay.
- `.env.example` — document the split between disposable local values and required production variables without adding real secrets.
- `apps/api/src/config/environment.ts` and `apps/worker/src/otp-delivery-worker.service.ts` — complete placeholder/production URL/secret checks.
- `apps/api/src/app.service.ts` and `apps/worker/src/app.controller.ts` — remove misleading health semantics/root probe dependency.
- `apps/api/Dockerfile`, `apps/worker/Dockerfile`, and `apps/admin-web/Dockerfile` — non-root runtime and explicit reproducible build behavior.

### Interfaces that must not change

- Existing business API route paths and versioned contracts in `packages/contracts/src/v1`.
- Existing success/error envelope semantics from `docs/02-technical-requirements.md:216-224`.
- Existing `X-Request-Id` spelling and `requestId` response field.
- Existing environment variable names unless a compatibility alias is explicitly versioned and removed in the same cutover. New migration/edge variables must be documented in `.env.example` without secret values.

## 12. Failure handling matrix

| Failure | Observable behavior | Recovery |
| --- | --- | --- |
| Missing/placeholder production secret | Process exits before listening; safe structured startup error | Correct secret-manager injection; restart through Compose |
| `REQUIRE_AUTH=false` outside test harness | API exits before listening | Set `REQUIRE_AUTH=true`; no production bypass |
| OTP provider URL not HTTPS | API/worker exits before listening | Provision approved HTTPS provider URL |
| PostgreSQL unavailable after startup | `/health/ready` returns 503; API remains live but is removed from traffic; worker is not ready | Restore DB/network; Compose/monitoring restarts as policy dictates |
| PostgreSQL unavailable during startup | API/worker do not become ready; no business traffic | Fix DB and rerun readiness/migration dependency |
| Migration gate fails | API/worker containers do not start; gate result identifies step/check | Remediate exact target or restore approved backup |
| Caddy certificate/DNS failure | HTTPS edge does not become healthy; no HTTP production fallback | Fix DNS/ACME/certificate prerequisite; do not expose API over plaintext |
| Provider call timeout/transient failure | Structured retryable event; outbox remains retryable with bounded backoff | Worker retry/dead-letter alert; persisted inbox remains authoritative |
| SIGTERM/SIGINT | Readiness becomes 503, new work stops, in-flight work drains, Prisma disconnects | Container restarts after clean stop; clients retry idempotently |
| Shutdown timeout | Process exits non-zero after deadline; stale claims recover through existing worker policy | Operator investigates long-running work and repeats deployment |
| Malformed request ID | API generates a UUIDv4; response uses generated ID | No operator action; attacker cannot control correlation format |
| DB/exception detail | Client receives safe code/message only; structured logger receives sanitized diagnostic | Use request ID and protected logs for investigation |

## 13. Rollout sequence

### Phase A — Build and static validation

1. Implement lifecycle, health, request-ID, logger, and environment changes behind tests.
2. Build API/worker/Admin Web with pinned images and non-root runtime.
3. Validate `docker compose -f docker-compose.yml -f docker-compose.production.yml config` and inspect the rendered configuration for zero non-Caddy published ports, no placeholder defaults, and correct Admin Web Dockerfile.
4. Run Caddy configuration validation and a disposable local TLS/route smoke test.

### Phase B — Staging migration gate

1. Obtain a representative disposable/staging database and restorable backup.
2. Provision the independent approval record, direct migration URL, secrets, four approved locations/roster inputs, roles, and provider settings out of band.
3. Run the migration gate against an explicitly named target schema/database.
4. Capture preflight, backfill, post-preflight, constraint validation, and release checksums.
5. Start API/worker only after the gate succeeds and verify both readiness endpoints.

### Phase C — Staging failure/recovery rehearsal

Exercise DB outage, provider timeout, malformed secret, failed migration check, SIGTERM during an in-flight request/job, Caddy certificate failure, and repeated worker restart. Verify that no raw secret or dependency error appears in HTTP or logs and that retry/idempotency behavior preserves business state.

### Phase D — Production cutover

1. Confirm external prerequisites and named rollback authority.
2. Take and verify the approved backup.
3. Run the exact migration gate and retain its output as release evidence.
4. Start the pinned API/worker overlay, confirm readiness and Caddy HTTPS, then run the minimum OTP/menu/registration/pickup/dashboard/no-show smoke path.
5. Monitor API readiness, worker readiness, DB resources, migration status, OTP delivery, notification queue lag, serving conflicts, and backup health.

## 14. Rollback strategy

Rollback is an operational decision, not an automatic Compose action:

- If the gate has not completed, leave API/worker stopped and fix the target or discard only a disposable schema.
- If additive migration completed but application cutover did not, retain the additive schema and deploy the previous compatible application where compatibility has been verified.
- If business data was changed and the approved rollback authority chooses restoration, restore the named backup within the recorded decision window. Do not run a hand-written reverse migration.
- If only API/worker code is bad, revert the application image to the previous signed release while preserving the approved schema compatibility boundary.
- Revoke/rotate secrets only with the explicit rotation playbook; do not silently regenerate QR/session/OTP secrets during a normal application rollback.

## 15. Verification requirements

### 15.1 Unit and integration checks

- Environment tests reject empty, placeholder, non-HTTPS, wrong fixed-setting, and production test-bypass configurations; test harness behavior remains limited to `NODE_ENV=test` plus `REQUIRE_AUTH=false`.
- Health tests verify 200 live, 200 ready with DB, 503 ready on DB failure, sanitized failure bodies, and both API/worker response shapes.
- Request-ID tests verify missing, valid UUIDv4, malformed, duplicate, and error responses; every response includes the chosen ID.
- Structured logger tests verify required fields and redaction of bearer tokens, OTPs, QR strings, GPS coordinates, provider payloads, and push tokens.
- Shutdown tests verify readiness flips before drain, new work is rejected/stopped, active work is bounded, and Prisma disconnect is called exactly once.
- Prisma lifecycle tests verify one process-level service is injected and all owned clients disconnect on module destroy.
- Migration-gate tests use disposable schemas to verify target assertion, `ON_ERROR_STOP`, approval requirement, dirty preflight abort, idempotent backfill, post-validation requirement, and no destructive rollback.

### 15.2 Container and staging smoke checks

```text
# Render and inspect the production topology
docker compose -f docker-compose.yml -f docker-compose.production.yml config

# Validate Caddy syntax before start
docker compose -f docker-compose.yml -f docker-compose.production.yml run --rm caddy caddy validate --config /etc/caddy/Caddyfile

# From an allowed client, verify HTTPS and redirect behavior
curl -I http://PUBLIC_HOSTNAME/health/live
curl -i https://PUBLIC_HOSTNAME/health/live
curl -i https://PUBLIC_HOSTNAME/health/ready
```

The verification record must show:

- HTTP redirects to HTTPS and HTTPS presents the approved certificate;
- only Caddy publishes host ports;
- DB/PgBouncer/MinIO/worker are unreachable from a client network;
- API and worker readiness are false until the migration gate succeeds;
- Admin Web and API route through the configured edge without browser mixed-content/CORS surprises;
- graceful stop leaves no active Prisma connection leak and no stuck worker claim beyond the configured recovery window;
- centralized logs contain request/job correlation and no forbidden secret classes.

## 16. Explicit external prerequisites

The following cannot be invented or completed by repository code:

1. Approved production API hostname, DNS records, inbound 80/443 firewall policy, ACME/certificate ownership, and Caddy certificate storage policy.
2. Secret-manager or protected-host ownership for database credentials, OTP/session/QR/encryption secrets, provider API key/sender, and release metadata.
3. Approved OTP provider contract, HTTPS endpoint, rate/expiry/support policy, and delivery monitoring.
4. Exactly four organization-approved locations, effective GPS policies, scanner device IDs, and employee roster/allowlist data; no fabricated operational rows may be added to source control.
5. Explicit initial-Admin provisioning authority and staff/kitchen role assignments. The current repository does not provide the complete admin lifecycle.
6. Separate staging and production databases, private network/firewall rules, and a direct migration connection path.
7. Encrypted offsite PostgreSQL backup target, tested restore, RPO/RTO, retention/legal policy, and named rollback authority/decision window.
8. Centralized log/metric/alert destination with retention and access control for API, worker, Caddy, PostgreSQL, PgBouncer, OTP delivery, notification delivery, queue lag, and backup failures.
9. Approved image/dependency vulnerability policy, immutable image digests, signed release artifacts, and CI/CD migration gates.
10. Staging representative-data approval, security/load/recovery tests, managed kitchen-device/UAT evidence, and pilot go/no-go sign-off.

## 17. Acceptance criteria

The hardening work is complete only when all of the following are evidenced:

- Production Compose renders with only Caddy public ports, private data services, pinned images, explicit Admin Web Dockerfile, required secrets, SCRAM-capable DB auth, and a bounded stop grace period.
- Caddy validates, redirects HTTP to HTTPS, serves the approved hostname/certificate, proxies only approved API/Admin paths, and does not expose MinIO.
- API and worker refuse production startup on missing/placeholder/insecure configuration and become ready only after the migration gate and DB checks succeed.
- Liveness/readiness responses are truthful, bounded, sanitized, request-ID correlated, and covered by tests.
- Every API response carries a validated/generated request ID; errors retain the existing envelope and safe stable error codes.
- API/worker logs are structured, correlated, centralized by deployment configuration, and demonstrably free of forbidden secret classes.
- SIGTERM/SIGINT drains requests/jobs and disconnects the single Prisma client per process without unbounded shutdown.
- The migration gate has target assertion, approval, preflight, deterministic backfill, post-validation, machine-readable evidence, and restore-based rollback behavior.
- Staging outage/retry/restart/migration failure drills pass before production traffic is enabled.

This design deliberately leaves the application/business gaps identified in `docs/imeal-production-readiness-assessment.md` as separate workstreams; it does not claim overall production readiness until those gates and the external prerequisites are complete.
