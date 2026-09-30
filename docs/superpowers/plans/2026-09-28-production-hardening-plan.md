# Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved production hardening design for the Compose/Caddy boundary, fail-closed runtime configuration, health/readiness, request IDs and structured logging, Prisma lifecycle, graceful shutdown, and migration gate integration without changing business rules.

**Architecture:** Keep one API process and one worker process behind Caddy. Only Caddy publishes host ports; API/worker/data services use private Compose networks. API and worker share one lifecycle-managed Prisma client each, expose truthful liveness/readiness probes, emit correlated redacted JSON logs, and drain safely on SIGTERM/SIGINT. A one-shot migration gate runs direct PostgreSQL migrations and target-safe preflight/backfill/validation before API or worker startup.

**Tech Stack:** Node.js `>=18`, Yarn `4.18.0`, NestJS/Fastify API, NestJS worker with `@nestjs/schedule`, Prisma/PostgreSQL/PgBouncer, Docker Compose, Caddy, Vitest, Supertest, TypeScript strict mode, POSIX shell/`psql` for the Linux migration gate.

**Spec:** `docs/superpowers/specs/2026-09-28-production-hardening-design.md`

## Global Constraints

- Preserve the server-authoritative architecture and all existing OTP, QR, GPS, registration, serving, delegation, notification, penalty, and timezone rules.
- Use Yarn 4.18.0 and the checked-in `yarn.lock`; do not introduce pnpm or a second package manager.
- Do not put real credentials, real employee/location data, provider keys, private keys, or access tokens in source control.
- Production must require `NODE_ENV=production`, `AUTH_MODE=otp`, `REQUIRE_AUTH=true`, all existing production secrets/settings, and the new release/edge/migration variables; no production fallback/default may enable traffic.
- The exact test-only auth bypass remains only `NODE_ENV=test` plus `REQUIRE_AUTH=false`; it must be rejected in production.
- Production exposes only Caddy ports 80/443. PostgreSQL, PgBouncer, MinIO, worker, and migration services remain private.
- API success/error envelopes, `X-Request-Id`, `requestId`, and `Idempotency-Key` semantics remain compatible with `packages/contracts/src/v1` and `docs/02-technical-requirements.md:216-224`.
- Logs must not contain OTP clear codes, bearer/session tokens, QR payloads/signatures, raw GPS coordinates, provider payloads/API keys, database URLs, or full push tokens.
- Migration rollback is approved-backup/application rollback only; never add a destructive down migration or a Firebase rollback path.
- External prerequisites are evidence/runbook tasks only. Do not fabricate DNS, certificates, secrets, approved locations, roster rows, role assignments, backup results, telemetry endpoints, approval IDs, or UAT results.
- Do not run repository-wide tests/builds/lint while sibling implementation tasks are incomplete. Each task runs only its scoped proof; the final integration task runs the project-wide checks once.

---

## Repository file map

### New files

- `packages/observability/package.json` — private shared package metadata and `build`/`test` scripts.
- `packages/observability/tsconfig.json` — strict ES2022 package compiler settings.
- `packages/observability/src/index.ts` — request-ID validation, redaction-safe JSON serialization, structured logger types/implementation, and migration-evidence reader/writer types.
- `packages/observability/test/observability.test.ts` — deterministic request-ID, log, redaction, and marker tests.
- `apps/api/src/common/prisma.service.ts` — one API Prisma client with module connect/disconnect lifecycle.
- `apps/worker/src/common/prisma.service.ts` — one worker Prisma client with module connect/disconnect lifecycle.
- `apps/api/src/common/request-context.ts` — validated request ID extraction and response header helpers.
- `apps/api/src/common/request-id.interceptor.ts` — global response-header/request-context interceptor.
- `apps/api/src/common/http-logging.interceptor.ts` — safe request completion/error log events.
- `apps/api/src/health/health.controller.ts` — API `/health/live` and `/health/ready` endpoints.
- `apps/api/src/health/health.service.ts` — bounded DB/drain/migration evidence checks.
- `apps/api/src/health/health.types.ts` — stable health response types.
- `apps/api/src/health/health.service.spec.ts` and `apps/api/src/health/health.controller.spec.ts` — API health behavior tests.
- `apps/worker/src/health.controller.ts` — worker `/health/live` and `/health/ready` endpoints.
- `apps/worker/src/health.service.ts` — worker DB/scheduler/drain/migration evidence checks.
- `apps/worker/src/health.service.spec.ts` and `apps/worker/src/health.controller.spec.ts` — worker health behavior tests.
- `apps/api/src/common/shutdown-coordinator.ts` — API drain state and bounded shutdown coordination.
- `apps/worker/src/shutdown-coordinator.ts` — worker drain/in-flight-job coordination.
- `apps/api/src/common/shutdown-coordinator.spec.ts` and `apps/worker/src/shutdown-coordinator.spec.ts` — shutdown state tests.
- `docker-compose.production.yml` — production-only overlay and private networks.
- `Caddyfile.production` — production TLS, redirect, routing, headers, and streaming configuration.
- `infra/migrations/Dockerfile` — migration-gate image with Node/Yarn/Prisma and `psql` client.
- `infra/migrations/production-gate.sh` — direct-DB migration, approval, preflight, backfill, validation, and atomic marker writer.
- `infra/migrations/production-gate.test.ts` — disposable-schema gate tests.
- `infra/migrations/README.md` — operator-facing gate invocation, evidence, and failure/rollback procedure.

### Existing files to modify during implementation

- API startup/module/config/error files: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/app.controller.ts`, `apps/api/src/app.service.ts`, `apps/api/src/config/environment.ts`, `apps/api/src/common/api-exception.filter.ts`.
- All API services/controllers currently constructing Prisma clients: `apps/api/src/auth/allowlist.service.ts`, `apps/api/src/auth/otp.service.ts`, `apps/api/src/auth/session.service.ts`, `apps/api/src/otp/otp-outbox.service.ts`, `apps/api/src/admin/allowlist/allowlist.controller.ts`, `apps/api/src/admin/penalties/penalties.service.ts`, `apps/api/src/admin/roster/roster-import.service.ts`, `apps/api/src/admin/weekly-menus/weekly-menus.service.ts`, `apps/api/src/delegations/delegations.service.ts`, `apps/api/src/kitchen/kitchen-dashboard.service.ts`, `apps/api/src/locations/locations.service.ts`, `apps/api/src/notifications/notifications.service.ts`, `apps/api/src/notifications/push-devices.service.ts`, `apps/api/src/pickup/pickup.service.ts`, and `apps/api/src/registrations/registrations.service.ts`.
- Worker startup/module/runtime files: `apps/worker/src/main.ts`, `apps/worker/src/app.module.ts`, `apps/worker/src/app.controller.ts`, `apps/worker/src/app.service.ts`, `apps/worker/src/cutoff-worker.service.ts`, `apps/worker/src/pickup-worker.service.ts`, `apps/worker/src/no-show-worker.service.ts`, `apps/worker/src/notification-dispatch.service.ts`, `apps/worker/src/notification-reminder.service.ts`, `apps/worker/src/otp-delivery-worker.service.ts`, and `apps/worker/src/worker-notification-publisher.ts` where raw console/error output remains.
- Container/runtime docs: `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/admin-web/Dockerfile`, `.env.example`, and only the required production-overlay portions of `docker-compose.yml`/local Compose documentation.
- Canonical operations docs: `docs/02-technical-requirements.md`, `docs/05-backend-structure.md`, `docs/06-execution-plan.md`, and `docs/imeal-production-readiness-assessment.md`.

## Interfaces and invariants

### Shared observability package

Implement these exact exports in `packages/observability/src/index.ts`:

```ts
export const REQUEST_ID_HEADER = 'x-request-id';
export const REQUEST_ID_PATTERN: RegExp;

export function resolveRequestId(value: unknown): string;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type SafeLogFields = {
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

export interface StructuredLogger {
  debug(event: string, fields?: SafeLogFields): void;
  info(event: string, fields?: SafeLogFields): void;
  warn(event: string, fields?: SafeLogFields): void;
  error(event: string, fields?: SafeLogFields): void;
}

export class JsonStructuredLogger implements StructuredLogger {
  constructor(
    service: 'api' | 'worker',
    release: string,
    sink?: (line: string) => void,
  );
  debug(event: string, fields?: SafeLogFields): void;
  info(event: string, fields?: SafeLogFields): void;
  warn(event: string, fields?: SafeLogFields): void;
  error(event: string, fields?: SafeLogFields): void;
}

export type MigrationEvidence = {
  release: string;
  migration: string;
  targetSchema: string;
  approvalId: string;
  completedAt: string;
};

export function readMigrationEvidence(
  filePath: string,
  expectedRelease: string,
  expectedTargetSchema: string,
): { ok: true; evidence: MigrationEvidence } | { ok: false; reason: string };
```

`JsonStructuredLogger` writes one JSON object per line with UTC timestamp, level, service, release, event, and safe fields. It redacts bearer/session tokens, OTP-like six-digit codes in sensitive fields, QR/provider payloads, push-token patterns, database URLs, and raw coordinates before serialization. `readMigrationEvidence` rejects missing, malformed, stale-release, or wrong-target markers without returning file contents to HTTP clients.

### API request context and health

```ts
export type ApiRequest = {
  id?: string;
  headers?: Record<string, string | string[] | undefined>;
  requestId?: string;
};

export function requestIdFrom(request: ApiRequest): string;
export function setRequestIdHeader(reply: { header(name: string, value: string): unknown }, id: string): void;
```

The interceptor sets the response header on normal responses; the exception filter uses the same request ID. The health service exposes:

```ts
export type HealthCheckState = 'ok' | 'down' | 'not_configured';

export type HealthResponse = {
  status: 'ok' | 'not_ready';
  service: 'api' | 'worker';
  release: string;
  checks: Record<string, HealthCheckState>;
  requestId: string;
};

export class HealthService {
  live(requestId: string): HealthResponse;
  ready(requestId: string): Promise<{ statusCode: 200 | 503; body: HealthResponse }>;
}
```

`/health/live` never queries the database. `/health/ready` checks Prisma, a bounded `SELECT 1`, drain state, and the release-matched read-only migration marker. Failures return 503 and safe check states only.

### Prisma lifecycle

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  onModuleInit(): Promise<void>;
  onModuleDestroy(): Promise<void>;
}
```

API and worker each register exactly one `PrismaService` provider. Services receive that instance through constructors; no runtime service creates `new PrismaClient()`.

### Shutdown

```ts
export class ShutdownCoordinator {
  beginDrain(): void;
  isDraining(): boolean;
  waitForInFlight(timeoutMs: number): Promise<'drained' | 'timed_out'>;
}
```

API shutdown marks readiness false, stops new HTTP/SSE work, waits bounded in-flight work, closes Nest/Fastify, then disconnects Prisma. Worker shutdown marks readiness false, prevents new cron callbacks, waits current jobs/provider calls, closes Nest/scheduler, then disconnects Prisma.

### Migration gate

`infra/migrations/production-gate.sh` consumes:

- `MIGRATION_DATABASE_URL` — direct PostgreSQL connection, never runtime PgBouncer URL.
- `MIGRATION_TARGET_SCHEMA` — explicit target schema.
- `MIGRATION_TARGET_IDENTITY` — externally verified target identity string.
- `MIGRATION_APPROVAL_ID` — independent approval record identifier.
- `RELEASE_VERSION` — release marker written only after successful validation.
- `MIGRATION_EVIDENCE_PATH` — writable path in the migration-evidence volume.

The script writes a temporary marker and atomically renames it to `/run/imeal/migration-gate.json` only after migration, clean preflight, approved backfill, post-preflight, and constraint validation all succeed. API and worker mount the marker read-only and require its release/target fields to match runtime configuration.

---

## Task 1: Add shared observability and migration-evidence primitives

**Files:**
- Create: `packages/observability/package.json`
- Create: `packages/observability/tsconfig.json`
- Create: `packages/observability/src/index.ts`
- Create: `packages/observability/test/observability.test.ts`

**Interfaces:**
- Consumes: existing UUIDv4 rule from `apps/api/src/common/api-exception.filter.ts:28-44`, existing notification redaction patterns from `apps/worker/src/notification-dispatch.service.ts:53-59`.
- Produces: the shared exports listed above for API, worker, health, and migration-gate tasks.

- [ ] **Step 1: Write failing request-ID and logger tests.**

Add tests for:

```ts
it('preserves a valid UUIDv4 request ID', () => {
  expect(resolveRequestId('550e8400-e29b-41d4-a716-446655440000'))
    .toBe('550e8400-e29b-41d4-a716-446655440000');
});

it('replaces malformed or missing request IDs', () => {
  expect(resolveRequestId('attacker-value')).toMatch(REQUEST_ID_PATTERN);
  expect(resolveRequestId(undefined)).toMatch(REQUEST_ID_PATTERN);
});

it('serializes required fields and redacts sensitive values', () => {
  const output = captureJsonLog(() => logger.info('http.request', {
    service: 'api', release: 'r1', requestId: '550e8400-e29b-41d4-a716-446655440000',
    bearer: 'Bearer opaque-token', otp: '123456',
    payload: 'ExpoPushToken[secret]',
  }));
  expect(output).toMatchObject({ event: 'http.request', service: 'api', release: 'r1' });
  expect(JSON.stringify(output)).not.toContain('opaque-token');
  expect(JSON.stringify(output)).not.toContain('123456');
  expect(JSON.stringify(output)).not.toContain('ExpoPushToken[secret]');
});

it('accepts only a matching migration evidence marker', () => {
  const result = readMigrationEvidence(file, 'release-1', 'staging-schema');
  expect(result).toEqual({ ok: true, evidence: expect.objectContaining({ release: 'release-1' }) });
});
```

Use a temporary file helper in the test; do not add a committed fixture containing secrets.

- [ ] **Step 2: Run the scoped test to confirm the package is absent/failing.**

Run:

```text
yarn workspace @imeal/observability test
```

Expected: the command fails because the new workspace package/source is not implemented yet.

- [ ] **Step 3: Add package metadata and strict compiler settings.**

Use the existing shared-package convention:

```json
{
  "name": "@imeal/observability",
  "version": "1.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc", "test": "vitest run" },
  "devDependencies": { "typescript": "^5.9.3", "vitest": "^2.1.9" }
}
```

Set `target` to `ES2022`, `module`/`moduleResolution` to match the package consumer boundary, `strict: true`, declarations, and `include: ["src/**/*"]` as in `packages/contracts/tsconfig.json`. Do not add a logging dependency.

- [ ] **Step 4: Implement the minimum shared primitives.**

Implement `resolveRequestId` with the existing UUIDv4 pattern and `randomUUID()`. Implement JSON serialization with an allowlisted base-field shape and redaction before `JSON.stringify`. Implement `readMigrationEvidence` with strict JSON shape/date/release/target validation and safe reason strings. Do not expose marker content through an HTTP response.

- [ ] **Step 5: Run focused verification.**

Run:

```text
yarn workspace @imeal/observability test
yarn workspace @imeal/observability build
```

Expected: all focused tests pass and declarations/build output are generated.

- [ ] **Step 6: Commit the isolated implementation.**

```text
git add packages/observability
git commit -m "feat: add shared observability primitives"
```

---

## Task 2: Harden API and worker environment validation

**Files:**
- Modify: `apps/api/src/config/environment.ts`
- Modify: `apps/api/src/config/environment.spec.ts`
- Modify: `apps/worker/src/otp-delivery-worker.service.ts`
- Modify: `apps/worker/src/otp-delivery-worker.service.spec.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: existing API/worker environment validators. Validation emits variable-name-only errors and does not import observability.
- Produces: validated `RELEASE_VERSION`, `LOG_LEVEL`, `SHUTDOWN_TIMEOUT_SECONDS`, `MIGRATION_EVIDENCE_PATH`, and `MIGRATION_TARGET_IDENTITY` configuration; existing validators retain their exported function names.

- [ ] **Step 1: Add failing API configuration tests.**

Extend `apps/api/src/config/environment.spec.ts` with cases that reject:

```ts
expect(() => validateApiEnvironment({ ...productionEnv, QR_SIGNING_SECRET: 'replace-with-at-least-32-random-characters' })).toThrow();
expect(() => validateApiEnvironment({ ...productionEnv, OTP_PROVIDER_URL: 'http://provider.example.test/send' })).toThrow();
expect(() => validateApiEnvironment({ ...productionEnv, RELEASE_VERSION: '' })).toThrow();
expect(() => validateApiEnvironment({ ...productionEnv, REQUIRE_AUTH: 'false', NODE_ENV: 'production' })).toThrow();
```

Add a positive case for trimmed valid secrets and fixed values. Assert error messages list variable names only, not values.

- [ ] **Step 2: Add failing worker configuration tests.**

Add production cases to the worker spec for missing `DATABASE_URL`, missing `RELEASE_VERSION`, missing `MIGRATION_EVIDENCE_PATH`, invalid shutdown timeout, placeholder provider values, and incorrect fixed operational settings. Preserve test defaults only when the test environment explicitly uses the existing test path.

- [ ] **Step 3: Run scoped failing tests.**

```text
yarn workspace @imeal/api test --run src/config/environment.spec.ts
yarn workspace @imeal/worker test --run src/otp-delivery-worker.service.spec.ts
```

Expected: new cases fail against current validation.

- [ ] **Step 4: Implement shared validation rules without changing business defaults.**

Add small local helpers for trimmed required values, placeholder rejection, bounded positive integers, production-only release/evidence settings, and HTTPS provider URLs. Extend API validation before `app.listen` and worker validation before worker `listen`. Ensure `QR_SIGNING_SECRET` is trimmed before length validation. Never log invalid values.

Add comments to `.env.example` for variable names and local-only placeholders; do not add real production values. Document that `MIGRATION_DATABASE_URL` is migration-only and must not be passed to API/worker.

- [ ] **Step 5: Run focused tests and typecheck.**

```text
yarn workspace @imeal/api test --run src/config/environment.spec.ts
yarn workspace @imeal/worker test --run src/otp-delivery-worker.service.spec.ts
yarn workspace @imeal/api exec tsc --noEmit -p tsconfig.json
yarn workspace @imeal/worker exec tsc --noEmit -p tsconfig.json
```

Expected: all scoped tests and both typechecks pass.

- [ ] **Step 6: Commit the configuration boundary.**

```text
git add apps/api/src/config/environment.ts apps/api/src/config/environment.spec.ts apps/worker/src/otp-delivery-worker.service.ts apps/worker/src/otp-delivery-worker.service.spec.ts .env.example
git commit -m "feat: fail closed on production runtime configuration"
```

---

## Task 3: Introduce one lifecycle-managed Prisma client in the API

**Files:**
- Create: `apps/api/src/common/prisma.service.ts`
- Create: `apps/api/src/common/prisma.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: all API Prisma-owning files listed in the repository file map
- Modify: corresponding API unit specs where constructors currently instantiate or mock Prisma

**Interfaces:**
- Consumes: `@prisma/client` and the existing API test mocks.
- Produces: `PrismaService` registered once in `AppModule`, injected into every API provider/controller that needs DB access, with `onModuleInit()` and `onModuleDestroy()` lifecycle methods.

- [ ] **Step 1: Write Prisma lifecycle tests.**

Create a mock Prisma client with `$connect` and `$disconnect` spies. Assert:

```ts
await service.onModuleInit();
expect(prisma.$connect).toHaveBeenCalledOnce();
await service.onModuleDestroy();
expect(prisma.$disconnect).toHaveBeenCalledOnce();
```

Add a test that a connect failure rejects startup and does not mark the service ready.

- [ ] **Step 2: Run the focused test to confirm failure.**

```text
yarn workspace @imeal/api test --run src/common/prisma.service.spec.ts
```

Expected: fail because the service does not exist.

- [ ] **Step 3: Implement and register `PrismaService`.**

Extend `PrismaClient`, implement `OnModuleInit`/`OnModuleDestroy`, and inject it from `AppModule`. Register the health/shutdown dependencies later through the same provider rather than creating another client. Do not add a second connection pool or import `packages/domain/src/db.ts` into API runtime.

- [ ] **Step 4: Replace every API `new PrismaClient()` allocation.**

For each API service/controller in the file map, replace the field/constructor allocation with constructor injection. Preserve optional collaborator injection only where existing tests require it; the Prisma dependency itself must be explicit and supplied by the module. Update `LocationsModule`, `AuthModule`, feature modules, and `AppModule` providers as necessary without changing route behavior.

- [ ] **Step 5: Update scoped constructor tests.**

Change each affected unit test factory to provide a Prisma-compatible mock. Add one regression assertion that no service constructor calls `new PrismaClient()` directly; use a source-level or module-provider test only for the allocation boundary, not for business behavior.

- [ ] **Step 6: Run API-focused verification.**

```text
yarn workspace @imeal/api test --run src/common/prisma.service.spec.ts
yarn workspace @imeal/api test
```

Run the API unit suite only after all API providers compile; do not run worker/domain suites in this task.

- [ ] **Step 7: Commit the API Prisma lifecycle.**

```text
git add apps/api/src apps/api/test
# Include only the API files changed by this task.
git commit -m "refactor: own one Prisma client in the API"
```

---

## Task 4: Introduce one lifecycle-managed Prisma client in the worker

**Files:**
- Create: `apps/worker/src/common/prisma.service.ts`
- Create: `apps/worker/src/common/prisma.service.spec.ts`
- Modify: `apps/worker/src/app.module.ts`
- Modify: `apps/worker/src/cutoff-worker.service.ts`
- Modify: `apps/worker/src/pickup-worker.service.ts`
- Modify: `apps/worker/src/no-show-worker.service.ts`
- Modify: `apps/worker/src/notification-dispatch.service.ts`
- Modify: `apps/worker/src/notification-reminder.service.ts`
- Modify: `apps/worker/src/otp-delivery-worker.service.ts`
- Modify: worker unit/e2e test factories that inject Prisma mocks

**Interfaces:**
- Consumes: the API lifecycle shape from Task 3 and existing optional Prisma injection seams.
- Produces: one registered worker `PrismaService`; all cron/outbox services use the same client; no worker production service allocates `new PrismaClient()`.

- [ ] **Step 1: Write lifecycle and allocation-boundary tests.**

Mirror Task 3's connect/disconnect tests. Add a test that `OtpDeliveryWorker`, `NotificationDispatchService`, and `NotificationReminderService` receive the same Prisma instance when assembled by `AppModule`.

- [ ] **Step 2: Run the focused tests before implementation.**

```text
yarn workspace @imeal/worker test --run src/common/prisma.service.spec.ts
```

Expected: fail because the lifecycle service and provider wiring are absent.

- [ ] **Step 3: Implement the worker lifecycle provider and injection.**

Register the service beside `ScheduleModule.forRoot()`. Preserve transaction clients passed to publisher methods; only root Prisma ownership changes. Ensure `WorkerOtpOutboxService` receives the same client as `OtpDeliveryWorker` rather than constructing its own fallback in production.

- [ ] **Step 4: Update worker tests and verify constructor behavior.**

Update test factories to pass mocks explicitly. Add a test that a missing DB connection prevents readiness but does not alter job idempotency logic.

- [ ] **Step 5: Run the worker unit suite and typecheck.**

```text
yarn workspace @imeal/worker test
yarn workspace @imeal/worker exec tsc --noEmit -p tsconfig.json
```

- [ ] **Step 6: Commit the worker Prisma lifecycle.**

```text
git add apps/worker/src apps/worker/test
# Include only the worker files changed by this task.
git commit -m "refactor: own one Prisma client in the worker"
```

---

## Task 5: Implement API and worker health/readiness endpoints

**Files:**
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/health.service.ts`
- Create: `apps/api/src/health/health.types.ts`
- Create: `apps/api/src/health/health.service.spec.ts`
- Create: `apps/api/src/health/health.controller.spec.ts`
- Create: `apps/worker/src/health.controller.ts`
- Create: `apps/worker/src/health.service.ts`
- Create: `apps/worker/src/health.service.spec.ts`
- Create: `apps/worker/src/health.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/app.controller.ts`, `apps/api/src/app.service.ts`
- Modify: `apps/worker/src/app.module.ts`, `apps/worker/src/app.controller.ts`, `apps/worker/src/app.service.ts`
- Modify: `docker-compose.production.yml` to set production readiness healthchecks for API and worker.

**Interfaces:**
- Consumes: `PrismaService`, `ShutdownCoordinator` from Task 7, `readMigrationEvidence` from Task 1, `RELEASE_VERSION`, `MIGRATION_EVIDENCE_PATH`, `MIGRATION_TARGET_SCHEMA`.
- Produces: unauthenticated `GET /health/live` and `GET /health/ready` on API and worker; safe `HealthResponse` with 200/503 status semantics.

- [ ] **Step 1: Write API health service/controller tests.**

Cover:

```ts
it('returns live without querying Prisma', () => {
  expect(service.live('request-1')).toMatchObject({ status: 'ok', service: 'api' });
  expect(prisma.$queryRaw).not.toHaveBeenCalled();
});

it('returns 200 ready only when DB, marker, and drain checks pass', async () => {
  await expect(service.ready('request-1')).resolves.toMatchObject({ statusCode: 200 });
});

it('returns 503 and safe check states on DB failure', async () => {
  prisma.$queryRaw.mockRejectedValue(new Error('secret database detail'));
  const result = await service.ready('request-1');
  expect(result.statusCode).toBe(503);
  expect(JSON.stringify(result.body)).not.toContain('secret database detail');
});
```

Add controller tests for `/health/live`, `/health/ready`, `X-Request-Id`, and no auth guard.

- [ ] **Step 2: Write equivalent worker tests.**

Require DB, marker, scheduler-initialized, and non-draining checks. Assert the health handler never invokes a business cron method.

- [ ] **Step 3: Run scoped tests before implementation.**

```text
yarn workspace @imeal/api test --run src/health
yarn workspace @imeal/worker test --run src/health
```

Expected: fail because the controllers/services are absent.

- [ ] **Step 4: Implement health services/controllers.**

Use a bounded Prisma query and `readMigrationEvidence`. Return only check states (`ok`, `down`, `not_configured`). Keep the existing `/health` route only as a sanitized compatibility alias if current tests/Compose require it; remove raw `error.message` from `AppService`. Do not add authentication guards to health routes.

- [ ] **Step 5: Wire modules and readiness state.**

Register health controllers/services in each module. Connect readiness to the shutdown coordinator and worker scheduler state. Store scheduler readiness as an in-memory boolean set after Nest initialization, not as a database row or business event.

- [ ] **Step 6: Run focused health tests and typechecks.**

```text
yarn workspace @imeal/api test --run src/health
yarn workspace @imeal/worker test --run src/health
yarn workspace @imeal/api exec tsc --noEmit -p tsconfig.json
yarn workspace @imeal/worker exec tsc --noEmit -p tsconfig.json
```

- [ ] **Step 7: Commit health/readiness behavior.**

```text
git add apps/api/src/health apps/api/src/app.controller.ts apps/api/src/app.service.ts apps/api/src/app.module.ts apps/worker/src/health.controller.ts apps/worker/src/health.service.ts apps/worker/src/health.service.spec.ts apps/worker/src/health.controller.spec.ts apps/worker/src/app.controller.ts apps/worker/src/app.service.ts apps/worker/src/app.module.ts
git commit -m "feat: add truthful API and worker readiness probes"
```

---

## Task 6: Integrate request IDs, error correlation, and structured logs

**Files:**
- Create: `apps/api/src/common/request-context.ts`
- Create: `apps/api/src/common/request-context.spec.ts`
- Create: `apps/api/src/common/request-id.interceptor.ts`
- Create: `apps/api/src/common/http-logging.interceptor.ts`
- Create: `apps/api/src/common/http-logging.interceptor.spec.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/common/api-exception.filter.ts`
- Modify: `apps/worker/src/main.ts`, worker scheduled services, and raw console/error logging sites

**Interfaces:**
- Consumes: `resolveRequestId`, `REQUEST_ID_HEADER`, `JsonStructuredLogger`, and `SafeLogFields` from Task 1.
- Produces: global API request ID interceptor, safe HTTP access logger, exception correlation, and worker job logs with `service`, `release`, `event`, and safe IDs/counts.

- [ ] **Step 1: Write request-context tests.**

Test valid/malformed/missing IDs, case-insensitive header lookup, and reply-header setting. Test that a successful controller response receives `X-Request-Id` and an error still uses the same ID in both header and envelope.

- [ ] **Step 2: Write logging/redaction tests.**

Capture logger output and assert HTTP logs include method, normalized route, status, duration, request ID, and release. Assert raw query strings and sensitive fields are excluded. Add worker job log tests for job name/run ID/counts and no raw `Error` serialization.

- [ ] **Step 3: Run scoped failing tests.**

```text
yarn workspace @imeal/api test --run src/common/request-context.spec.ts src/common/http-logging.interceptor.spec.ts
```

Expected: fail until middleware/interceptors are implemented.

- [ ] **Step 4: Implement request context and interceptor.**

Resolve incoming IDs through the shared validator, assign the chosen ID to Fastify request context, set response headers for normal responses, and register the interceptor globally. Configure Fastify `trustProxy` from a validated trusted-proxy setting that accepts only the Caddy/network boundary; do not trust arbitrary public forwarding headers.

- [ ] **Step 5: Update the exception filter.**

Use the request-context ID instead of generating a second ID. Preserve `{ error, requestId }`, stable error codes, and existing details behavior. Log the sanitized exception through the shared logger without sending stack/database/provider details to clients.

- [ ] **Step 6: Integrate structured logs.**

Install the shared logger through `app.useLogger` in API/worker bootstrap. Replace startup `console.log`, production `console.warn`, and raw worker/API error logging with event names and safe fields. Keep existing business logs useful but remove raw request/provider payload serialization.

- [ ] **Step 7: Run focused tests and static checks.**

```text
yarn workspace @imeal/api test --run src/common/request-context.spec.ts src/common/http-logging.interceptor.spec.ts src/common/api-exception.filter.spec.ts
yarn workspace @imeal/worker test --run src/notification-dispatch.service.spec.ts src/no-show-worker.service.spec.ts
yarn workspace @imeal/api exec tsc --noEmit -p tsconfig.json
yarn workspace @imeal/worker exec tsc --noEmit -p tsconfig.json
```

- [ ] **Step 8: Commit request/logging integration.**

```text
git add apps/api/src/main.ts apps/api/src/app.module.ts apps/api/src/common apps/api/src/auth/auth.controller.ts apps/worker/src/main.ts apps/worker/src/*.ts
git commit -m "feat: correlate and structure service logs"
```

---

## Task 7: Add graceful shutdown coordination

**Files:**
- Create: `apps/api/src/common/shutdown-coordinator.ts`
- Create: `apps/api/src/common/shutdown-coordinator.spec.ts`
- Create: `apps/worker/src/shutdown-coordinator.ts`
- Create: `apps/worker/src/shutdown-coordinator.spec.ts`
- Modify: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`
- Modify: `apps/worker/src/main.ts`, `apps/worker/src/app.module.ts`
- Modify: `apps/api/src/health/health.service.ts`, `apps/worker/src/health.service.ts`
- Modify: worker cron/provider services to register in-flight work
- Modify: `.env.example` with `SHUTDOWN_TIMEOUT_SECONDS` documentation only

**Interfaces:**
- Consumes: `PrismaService`, health services, structured logger, and existing Nest lifecycle hooks.
- Produces: `ShutdownCoordinator.beginDrain()`, `isDraining()`, and `waitForInFlight(timeoutMs)`; API/worker bootstrap sequence and bounded SIGTERM/SIGINT behavior.

- [ ] **Step 1: Write coordinator state-machine tests.**

Test initial not-draining state, idempotent `beginDrain`, registration/de-registration of in-flight work, successful drain before deadline, and timeout result after deadline. Verify no work can register after drain begins.

- [ ] **Step 2: Run failing coordinator tests.**

```text
yarn workspace @imeal/api test --run src/common/shutdown-coordinator.spec.ts
yarn workspace @imeal/worker test --run src/shutdown-coordinator.spec.ts
```

Expected: fail before implementation.

- [ ] **Step 3: Implement API bootstrap ordering.**

In `apps/api/src/main.ts`, validate environment, create/configure app, register logger/interceptors, enable shutdown hooks, connect Prisma through Nest lifecycle, then listen. On shutdown signal, mark draining before closing Fastify, wait `SHUTDOWN_TIMEOUT_SECONDS`, disconnect Prisma through Nest, and emit a terminal structured event. Do not call `process.exit(0)` before cleanup completes.

- [ ] **Step 4: Implement worker bootstrap/job drain.**

In `apps/worker/src/main.ts`, mark scheduler readiness only after bootstrap. On shutdown, mark draining, prevent new cron callbacks, await current job/provider work through the coordinator, close Nest/scheduler, and disconnect Prisma. Existing claim/stale-recovery semantics remain the source of truth; shutdown must not mark uncompleted work successful.

- [ ] **Step 5: Wire health and container stop grace.**

Read `SHUTDOWN_TIMEOUT_SECONDS` from validated configuration. Health readiness returns 503 immediately after drain starts. Add Compose `stop_grace_period` greater than the configured timeout plus margin in the production overlay task.

- [ ] **Step 6: Run scoped shutdown tests.**

```text
yarn workspace @imeal/api test --run src/common/shutdown-coordinator.spec.ts src/health
yarn workspace @imeal/worker test --run src/shutdown-coordinator.spec.ts src/health
```

- [ ] **Step 7: Commit graceful shutdown.**

```text
git add apps/api/src/main.ts apps/api/src/app.module.ts apps/api/src/common/shutdown-coordinator.ts apps/api/src/common/shutdown-coordinator.spec.ts apps/api/src/health apps/worker/src/main.ts apps/worker/src/app.module.ts apps/worker/src/shutdown-coordinator.ts apps/worker/src/shutdown-coordinator.spec.ts apps/worker/src/health* .env.example
git commit -m "feat: drain services gracefully on shutdown"
```

---

## Task 8: Add the production Compose and Caddy boundary

**Files:**
- Create: `docker-compose.production.yml`
- Create: `Caddyfile.production`
- Modify: `apps/api/Dockerfile`
- Modify: `apps/worker/Dockerfile`
- Modify: `apps/admin-web/Dockerfile`
- Modify: `.dockerignore` to exclude `.env*`, `/run/imeal/`, and migration-evidence artifacts from image build contexts.

**Interfaces:**
- Consumes: health endpoints from Task 5, shutdown timeout from Task 7, migration gate service/marker from Task 9, runtime environment names from Task 2.
- Produces: production Compose invocation with only Caddy host ports, private `edge`/`app`/`data` networks, pinned images, explicit Admin Web Dockerfile, read-only migration marker volume, and Caddy HTTPS routing.

- [ ] **Step 1: Add a configuration test/check before writing the overlay.**

Create a shell/static test command in the task notes or test harness that fails unless rendered Compose output has:

```text
- only Caddy entries under `ports`;
- no `POSTGRES_HOST_AUTH_METHOD` or `password_encryption=md5`;
- no `AUTH_TYPE: plain`;
- no `latest` image tags;
- `admin-web` uses `apps/admin-web/Dockerfile`;
- API/worker depend on successful `migration-gate`;
- API/worker mount migration evidence read-only.
```

- [ ] **Step 2: Write the production overlay.**

Define the `edge`, `app`, and `data` networks. Use Compose `!reset []` for inherited host-port lists only after verifying the production Compose version supports it. If the pinned Compose version does not support it, move local port mappings into a separately documented `docker-compose.local.yml` before enabling production; do not rely on a silently ignored merge tag.

Require all production values with `${NAME:?NAME is required}`. Use direct `MIGRATION_DATABASE_URL` only in the gate. Mount the evidence volume read-write only to the gate and read-only to API/worker. Set non-root runtime users after validating their required filesystem paths.

- [ ] **Step 3: Write the Caddy production configuration.**

Use `${PUBLIC_HOSTNAME}` for the approved hostname, automatic/managed TLS, HTTP-to-HTTPS redirect, API path proxying, Admin Web fallback, SSE/WebSocket transport support, reviewed security headers, and no `/storage/*` MinIO route. Keep `Caddyfile` local behavior unchanged until the production overlay explicitly mounts `Caddyfile.production`.

- [ ] **Step 4: Harden Dockerfiles.**

Pin base images to approved immutable references, run the application runtime as a non-root UID, copy only built runtime artifacts, and preserve Prisma generation/build behavior. Do not copy `.env` or production evidence into images. Make Compose reference `apps/admin-web/Dockerfile` explicitly.

- [ ] **Step 5: Run rendered-config and Caddy verification.**

```text
docker compose -f docker-compose.yml -f docker-compose.production.yml config
docker compose -f docker-compose.yml -f docker-compose.production.yml config --images
docker compose -f docker-compose.yml -f docker-compose.production.yml run --rm caddy caddy validate --config /etc/caddy/Caddyfile
```

Review the rendered output for zero non-Caddy host ports, private networks, no placeholder defaults, no public MinIO route, and correct healthcheck endpoints. Do not start production services with real credentials during this scoped verification.

- [ ] **Step 6: Commit the deployment boundary.**

```text
git add docker-compose.production.yml Caddyfile.production apps/api/Dockerfile apps/worker/Dockerfile apps/admin-web/Dockerfile .dockerignore
git commit -m "feat: define private production Compose boundary"
```

---

## Task 9: Implement the direct PostgreSQL migration gate

**Files:**
- Create: `infra/migrations/Dockerfile`
- Create: `infra/migrations/production-gate.sh`
- Create: `infra/migrations/production-gate.test.ts`
- Create: `infra/migrations/README.md`
- Modify: `docker-compose.production.yml` to add the one-shot `migration-gate` service and evidence volume
- Use the existing phase-0 preflight/backfill SQL unchanged; do not expand its mutation scope or add a destructive migration.

**Interfaces:**
- Consumes: direct `MIGRATION_DATABASE_URL`, `MIGRATION_TARGET_SCHEMA`, `MIGRATION_TARGET_IDENTITY`, `MIGRATION_APPROVAL_ID`, `RELEASE_VERSION`, `MIGRATION_EVIDENCE_PATH`; current Prisma migrations and phase-0 SQL.
- Produces: exit 0 only after migration/preflight/approval/backfill/post-validation, atomic `/run/imeal/migration-gate.json`, and machine-readable safe gate output.

- [ ] **Step 1: Write failing shell/gate tests.**

Cover these command-level cases against disposable schemas:

```text
missing MIGRATION_APPROVAL_ID -> non-zero, no backfill
wrong current_schema() -> non-zero, no backfill
non-zero preflight -> non-zero, no marker
clean preflight without approval -> non-zero, no marker
successful idempotent backfill twice -> zero, one valid marker
post-validation failure -> non-zero, API/worker gate remains unsatisfied
```

Use the repository's existing target-safe `psql` pattern: explicit `search_path`, `current_schema()` assertion, `-v ON_ERROR_STOP=1`, and named output checks. Never point the test at dirty public production data.

- [ ] **Step 2: Run the failing gate test.**

```text
yarn workspace @imeal/core exec vitest run infra/migrations/production-gate.test.ts
```

Expected: fail because the gate files/service do not exist.

- [ ] **Step 3: Build the migration image.**

Create `infra/migrations/Dockerfile` from an approved Node base, install `postgresql-client`, enable Yarn 4.18.0, install immutable dependencies, generate Prisma, and copy the gate plus migration SQL. Do not copy `.env` or production credentials.

- [ ] **Step 4: Implement fail-closed gate ordering.**

In `production-gate.sh`:

1. Enable strict shell mode and require every named variable.
2. Reject placeholders and require direct PostgreSQL URL semantics.
3. Assert target database/schema in the same session.
4. Run `DATABASE_URL="$MIGRATION_DATABASE_URL" yarn workspace @imeal/core prisma migrate deploy`.
5. Run current preflight SQL with explicit target and `ON_ERROR_STOP=1`.
6. Abort on any named non-zero check or missing independent approval.
7. Run the exact deterministic backfill.
8. Re-run preflight and validate both named constraints only after operational checks are zero.
9. Write marker JSON to a temporary file with mode 0444 and atomically rename it to `MIGRATION_EVIDENCE_PATH`.
10. Print only target/release/migration/check/approval identifiers; never print URLs, passwords, row payloads, or secrets.

The script must be safe to rerun and must not execute a destructive down migration.

- [ ] **Step 5: Add Compose dependency and marker verification.**

Add the one-shot service with direct DB network access. Add `depends_on: migration-gate: condition: service_completed_successfully` to API and worker. Mount the evidence volume read-only in API/worker. The health services from Task 5 must compare marker release and target identity to runtime values.

- [ ] **Step 6: Run disposable migration-gate verification.**

```text
yarn workspace @imeal/core exec vitest run infra/migrations/production-gate.test.ts
docker compose -f docker-compose.yml -f docker-compose.production.yml config
```

Expected: gate tests pass; rendered Compose shows API/worker blocked on successful gate and the marker volume read-only outside the gate.

- [ ] **Step 7: Commit the migration gate.**

```text
git add infra/migrations docker-compose.production.yml packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness
git commit -m "feat: gate production startup on migration evidence"
```

---

## Task 10: Update canonical docs and external prerequisite evidence

**Files:**
- Modify: `.env.example`
- Modify: `docs/02-technical-requirements.md`
- Modify: `docs/05-backend-structure.md`
- Modify: `docs/06-execution-plan.md`
- Modify: `docs/imeal-production-readiness-assessment.md`
- Create/modify: `infra/migrations/README.md` from Task 9

**Interfaces:**
- Consumes: implemented environment names, health endpoints, Compose invocation, Caddy hostname, logger/redaction policy, Prisma lifecycle, and migration-gate marker contract.
- Produces: documentation that names the actual interfaces and separates repository implementation from external evidence.

- [ ] **Step 1: Update the environment contract.**

Document names and semantics for `PUBLIC_HOSTNAME`, `RELEASE_VERSION`, `LOG_LEVEL`, `SHUTDOWN_TIMEOUT_SECONDS`, `MIGRATION_DATABASE_URL`, `MIGRATION_TARGET_SCHEMA`, `MIGRATION_TARGET_IDENTITY`, `MIGRATION_APPROVAL_ID`, `MIGRATION_EVIDENCE_PATH`, and trusted-proxy configuration. Use only local placeholders in `.env.example`; explicitly state production values are injected out of band.

- [ ] **Step 2: Update technical/backend contracts.**

Add `/health/live` and `/health/ready` response/status semantics, request-ID behavior on all responses, structured-log redaction rules, one-Prisma-per-process lifecycle, shutdown sequence, private Compose topology, Caddy TLS boundary, and migration marker dependency. Keep existing API envelopes and business invariants unchanged.

- [ ] **Step 3: Update execution/readiness gates.**

In `docs/06-execution-plan.md` and `docs/imeal-production-readiness-assessment.md`, replace vague deployment checklist text with evidence gates that require:

- rendered production Compose output showing only Caddy public ports;
- Caddy certificate/redirect proof;
- secret-manager references without secret values;
- staging migration-gate output and independent approval ID;
- backup/restore report and named rollback authority;
- centralized logging/metrics/alert destination and retention;
- image digest/provenance evidence;
- native device/UAT/recovery evidence.

Do not mark any external prerequisite complete without an actual operator artifact. Do not add synthetic locations, roster rows, roles, certificates, or secrets.

- [ ] **Step 4: Review docs for contract drift.**

Run:

```text
yarn prettier --check .env.example docs/02-technical-requirements.md docs/05-backend-structure.md docs/06-execution-plan.md docs/imeal-production-readiness-assessment.md infra/migrations/README.md
```

If repository formatting does not support Markdown checking through this command, run the repository's documented formatting check on only the changed files and record the result.

- [ ] **Step 5: Commit documentation updates.**

```text
git add .env.example docs/02-technical-requirements.md docs/05-backend-structure.md docs/06-execution-plan.md docs/imeal-production-readiness-assessment.md docs/README.md infra/migrations/README.md
git commit -m "docs: document production hardening operations"
```

---

## Task 11: Final integration verification and release evidence checklist

**Files:**
- No planned file additions. Any defect discovered during final verification returns to the owning Task 1–10, which reruns its scoped proof before this task resumes.

**Interfaces:**
- Consumes: all prior implementation outputs and canonical docs.
- Produces: verified repository state and an external release-evidence checklist, not a claim of production readiness.

- [ ] **Step 1: Run package tests and typechecks.**

```text
yarn workspace @imeal/observability test
yarn workspace @imeal/core test:unit
yarn workspace @imeal/contracts test
yarn workspace @imeal/api test
yarn workspace @imeal/worker test
yarn typecheck
```

Expected: zero failures. If a failure is caused by an implementation change, fix it in the owning task and rerun the scoped check before continuing.

- [ ] **Step 2: Run DB/e2e verification with disposable infrastructure.**

```text
yarn test:db
```

Use a disposable PostgreSQL schema and the repository's test setup. Verify API/worker health tests, serving/idempotency tests, and migration-gate tests do not use production URLs or data.

- [ ] **Step 3: Render and inspect the production topology.**

```text
docker compose -f docker-compose.yml -f docker-compose.production.yml config
docker compose -f docker-compose.yml -f docker-compose.production.yml config --images
docker compose -f docker-compose.yml -f docker-compose.production.yml run --rm caddy caddy validate --config /etc/caddy/Caddyfile
```

Confirm only Caddy publishes ports, all images are pinned, database auth is not MD5/plain, API/worker depend on the gate, and the marker is read-only outside the gate.

- [ ] **Step 4: Run staging-like smoke scenarios.**

With externally provisioned staging prerequisites only:

```text
curl -I http://$PUBLIC_HOSTNAME/health/live
curl -i https://$PUBLIC_HOSTNAME/health/live
curl -i https://$PUBLIC_HOSTNAME/health/ready
```

Then exercise DB outage/readiness, malformed secret startup, migration-gate failure, provider timeout, malformed request ID, SIGTERM during an HTTP request, SIGTERM during a worker job, and restart/recovery. Capture request IDs, safe logs, readiness transitions, stale-claim recovery, and no-secret assertions.

- [ ] **Step 5: Assemble external evidence without fabricating it.**

The release operator records these artifacts outside source-controlled code:

1. DNS/TLS/ACME certificate ownership and HTTPS redirect proof.
2. Secret-manager references and rotation owner; values remain undisclosed.
3. Approved staging/production database targets and private firewall proof.
4. Migration gate output, target identity, migration version, independent approval ID, pre/post checks, and checksum.
5. Encrypted backup/restore rehearsal, RPO/RTO, retention, and rollback authority.
6. Centralized log/metric/alert destination and access/retention controls.
7. Immutable image digest/provenance and vulnerability scan output.
8. Approved four-location/roster/allowlist/role provisioning evidence.
9. Managed kitchen-device, mobile, accessibility, outage, retry, and pilot UAT evidence.

These are evidence/runbook tasks, not source-controlled seed/configuration code.

- [ ] **Step 6: Run final repository verification.**

```text
git diff --check HEAD~1..HEAD
git status --short
```

Confirm only intended implementation/docs files are changed for the selected release and no `.env`, certificate, key, provider payload, operational seed, or external evidence secret is tracked.

- [ ] **Step 7: Create the final implementation commit(s).**

The implementation should retain the task commits above or squash only when the integration owner explicitly chooses to do so. The final implementation report must list the actual commit IDs, verification commands/results, external prerequisites still open, and must not claim production readiness from local evidence alone.

---

## Coverage checklist

This plan covers every approved design section:

- **Production Compose/Caddy boundary:** Tasks 8 and 11; private networks, no public data ports, pinned images, explicit Admin Web Dockerfile, TLS, redirect, security headers, SSE/WebSocket support, no public MinIO route.
- **Fail-closed secret/config behavior:** Task 2 and Task 8; production-only auth, placeholder rejection, HTTPS provider, direct migration URL separation, protected runtime injection.
- **API/worker health/readiness:** Task 5 and Task 7; liveness/readiness contracts, DB/migration marker checks, 503 semantics, drain transitions, Compose probes.
- **Request IDs/structured logging:** Tasks 1 and 6; validated UUIDv4 IDs on all responses, stable error envelope, structured JSON, route/duration fields, job fields, redaction.
- **Graceful shutdown:** Task 7; API/SSE drain, worker cron/job drain, timeout, readiness transition, Prisma disconnect.
- **Prisma lifecycle:** Tasks 3 and 4; one injected client per process, connect/disconnect hooks, all listed client allocations removed, test mocks preserved.
- **Migration gate integration:** Task 9 and Task 11; direct PostgreSQL, explicit target, approval, preflight, deterministic backfill, post-validation, atomic release marker, Compose dependency, restore/application rollback.
- **Docs and external prerequisites:** Task 10 and Task 11; canonical contract updates and evidence/runbook tasks without fabricated operational data.

## Self-review requirements before implementation begins

- Review every task against `docs/superpowers/specs/2026-09-28-production-hardening-design.md`.
- Confirm all task interfaces use the exact exported names above.
- Confirm no task changes OTP/QR/GPS/serving/business rules.
- Confirm all production Compose/Caddy changes are scoped to Tasks 8–9 and all docs changes to Task 10.
- Confirm no implementation placeholder markers remain in the plan.
- Confirm external prerequisites are listed as operator evidence/runbook work and no task creates fabricated credentials, locations, roster rows, certificates, approval IDs, backup results, or telemetry destinations.
