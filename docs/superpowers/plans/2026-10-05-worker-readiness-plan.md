# Worker Readiness Scheduler Initialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This document records the original plan and its later execution note; the original planning-turn constraints below are historical.

**Status:** **IMPLEMENTED — RUNTIME EVIDENCE RECORDED; HEALTHY-DB DRAIN LIMITATION RECORDED**

**Goal:** Make worker readiness become healthy after the real Nest business scheduler has bootstrapped, without changing any existing readiness threshold, migration/database gate, drain behavior, telemetry contract, or protected deployment boundary.

**Architecture:** Keep scheduler state in the existing `HealthService`. In the existing worker bootstrap, mark that state only after `await app.listen(...)` succeeds and immediately before the existing `resolveListenReady()`. Nest `listen()` runs application initialization and the installed `@nestjs/schedule` bootstrap hook before it resolves; the metrics collector timer remains a separate internal metrics concern.

**Tech Stack:** Node.js 24, NestJS 12, `@nestjs/schedule` 12.0.1, the existing worker HTTP health controller, Prisma 7 worker client, Vitest/supertest for existing focused tests, Docker Linux for the throwaway real-entrypoint smoke, and a direct disposable PostgreSQL 16 container (no mandatory PgBouncer).

**Spec:** `docs/superpowers/specs/2026-09-28-production-hardening-design.md` (worker health contract at `:236-252`). Supporting implementation guidance is in `docs/superpowers/plans/2026-09-28-production-hardening-plan.md:532-551,668-674`.

## Original planning-turn constraints (historical)

- ORIGINAL PLANNING TURN (before implementation): This turn wrote only `docs/superpowers/plans/2026-10-05-worker-readiness-plan.md`. It did not edit runtime source, manifests, lockfiles, Prisma schema/migrations, tests, generated metadata, `CHANGELOG.md`, or any other document then.
- Preserve every current uncommitted Node 24/Prisma 7/Expo 57 worktree change, generated artifact, and existing warning/metadata behavior. Do not reset, regenerate, reformat, or clean unrelated work.
- ORIGINAL PLANNING TURN: Do not rerun the already observed worker readiness failure. Commands listed in that plan were future implementation/qualification work and were **not executed evidence** from that planning turn; the later executed evidence is linked in the execution note below.
- Do not add runtime retries, runtime timeouts, backdoors, fake scheduler signals, synthetic metric producers/providers, scheduler labels, `SchedulerRegistry` reflection, telemetry redesign, or a relaxed readiness guard.
- Authority unavailable remains fail-closed: worker `/metrics` remains non-success until its approved fresh, identity-bound source snapshot is complete.
- Preserve the current health threshold: environment, database, migration, scheduler, and draining gate readiness; `lastLoop` remains a diagnostic field and is not added to the healthy array.
- The existing metrics collector scheduler token is not the Nest business scheduler interface and MUST NOT be wired to `SchedulerRegistry` or to health readiness.
- Protected environment values, real source endpoints, target fingerprints, provider credentials, approval records, image digests, DNS/TLS, alert delivery, and release evidence remain external prerequisites. This plan does not make any release gate pass.
- No commit is requested or included.

---

## Evidence-backed diagnosis

### Historical observed result (preserved; not rerun)

- `docs/superpowers/evidence/2026-10-04-prisma7-checkpoint.md:84-88` records worker `/health/live` HTTP 200 and `/health/ready` HTTP 503 with `database=ok`, `migration=ok`, `scheduler=down`, and `lastLoop=not_configured`. It attributes the source-side condition to no `markSchedulerInitialized()` call and explicitly separates it from the Prisma/image changes.
- `docs/superpowers/evidence/2026-10-04-image-scans.md:43-50,78-80,102-104` records the same local/disposable qualification and does not claim production readiness.

### Historical pre-fix root cause (preserved diagnosis)

1. Before the fix, `apps/worker/src/main.ts:34-37` validated worker and metrics environment before Nest creation. `HealthService` was already imported at `:14`, but the pre-fix bootstrap had no code retrieving it or calling `markSchedulerInitialized()`. The implementation-turn change and runtime result are recorded below.
2. Before the fix, `apps/worker/src/main.ts:65-80` awaited `app.listen(...)`, then resolved the existing startup barrier without a scheduler readiness transition. The implementation inserted the marker between successful `listen()` and `resolveListenReady()`, as recorded in the execution note.
3. `apps/worker/src/health.service.ts:49-74` initializes `schedulerInitialized` to `false` and exposes the existing `markSchedulerInitialized(): void` setter.
4. `apps/worker/src/health.service.ts:93-126` includes scheduler in the readiness computation at `:103-105`, while its `healthy` array at `:115-121` deliberately excludes `lastLoop`. With DB/migration healthy, `scheduler=down` is the sole observed health-gate failure; `lastLoop=not_configured` is diagnostic and does not block.
5. `apps/worker/src/app.module.ts:82-84` imports `ScheduleModule.forRoot()`, so the business scheduler is already registered in the module graph. The real cron methods are in `otp-delivery-worker.service.ts:781-810`, `notification-dispatch.service.ts:179-202`, `notification-reminder.service.ts:76-124`, `no-show-worker.service.ts:67-103`, and `cutoff-worker.service.ts:31-103`.

### Correct interpretation of `WORKER_METRICS_COLLECTOR_SCHEDULER`

`apps/worker/src/app.module.ts:153-155` provides `WORKER_METRICS_COLLECTOR_SCHEDULER` with `useFactory: () => undefined`. That is **not** a disabled timer and is not the readiness failure:

- `AuthoritativeMetricsCollectorScheduler` is the metrics-only interface at `apps/worker/src/metrics/authoritative-metrics-collector.ts:49-57`.
- `AuthoritativeMetricsCollector` has a default scheduler at `:54-57,91-96`; passing `undefined` invokes the default parameter, which calls real `globalThis.setInterval`.
- `AuthoritativeMetricsRuntimeService` passes that optional scheduler at `apps/worker/src/metrics/authoritative-metrics-runtime.service.ts:101-114`, runs initial collection, then starts the metrics timer at `:117-124`.
- The actual application transport has a bounded default request timeout of 5,000 ms and a maximum of 120,000 ms at `apps/worker/src/metrics/sources/authoritative-source-transport.ts:70-83,111-183`. This plan does not claim a production registry HTTP request is unbounded and does not change transport timeouts or add retries. The collector abstraction can accept an arbitrary custom provider, but that is a separate abstraction risk, not the observed listening-worker root cause.

### Verified Nest 12 lifecycle proof

The installed package is `@nestjs/schedule` 12.0.1 (`node_modules/@nestjs/schedule/package.json:1-18`):

- `node_modules/@nestjs/schedule/dist/schedule.explorer.js:33-35,59-89` discovers decorated `@Cron`/`@Interval` methods during `onModuleInit` and queues them in `SchedulerOrchestrator`.
- `node_modules/@nestjs/schedule/dist/scheduler.orchestrator.js:22-30,32-39,50-68` mounts interval and cron timers during `onApplicationBootstrap` and clears them during `beforeApplicationShutdown`.
- `node_modules/@nestjs/core/nest-application.js:103-123` runs module-init, router, and application-bootstrap hooks in `init()`; `:254-258` shows `listen()` invokes `init()` before resolving.

Therefore `await app.listen(...)` is the genuine post-bootstrap check. It proves the framework completed business schedule discovery/mounting; it does not claim that a job has run or succeeded. Marking from the metrics collector would be wrong, and a competing `OnApplicationBootstrap` provider would introduce an unnecessary ordering dependency against `SchedulerOrchestrator`.

---

## File map and ownership

### Implementation file in original plan

- **Modify only:** `apps/worker/src/main.ts:14,34-80`.
  - Reuse the already imported `HealthService`.
  - Preserve existing validation, worker metrics metadata setup, structured logger adapter, shutdown handlers, `listenReady`, error handling, startup log fields, and all current user changes/warnings.
  - Add no new service, provider, interface, cron label, registry lookup, metric producer, or environment variable.

### Existing behavior/spec files to preserve

- `apps/worker/src/health.service.ts:49-126` — current state ownership and healthy-array threshold remain unchanged.
- `apps/worker/src/health.service.spec.ts:72-126` — existing scheduler/DB/migration/drain tests remain valid. An optional single regression case may be added later for a deliberately set diagnostic `lastLoop='down'` while all real readiness gates pass; do not add a test that only asserts default property presence.
- `apps/worker/test/app.e2e-spec.ts:180-188` — keep unchanged. It creates `AppModule` and calls `app.init()`, deliberately bypassing `main.ts`, and therefore deliberately expects HTTP 503 before scheduler initialization. Do not repin it to 200 and do not manually mark the scheduler in this module-only harness.
- `apps/worker/src/metrics/authoritative-metrics-runtime.service.ts` and `apps/worker/src/metrics/metrics.service.ts` — no telemetry or collector changes.

### Evidence/doc updates after actual smoke

- Created after actual smoke: `docs/superpowers/evidence/2026-10-05-worker-readiness.md`, containing the real-entrypoint HTTP observations and limitations.
- Updated after observations: `docs/runbooks/staging-readiness.md` and `CHANGELOG.md`; these preserve the historical r5 record and conditional/no-go boundary.
- No canonical spec, deployment manifest, lockfile, schema, or generated metadata update is required for this one-line bootstrap wiring.

---

## Proposed interfaces and state transitions

### Existing signatures; no new runtime interface

```ts
export type WorkerHealthCheckState = 'ok' | 'down' | 'not_configured';

export declare class HealthService {
  markSchedulerInitialized(): void;
  setLastLoopState(state: WorkerHealthCheckState): void;
  live(requestId: string): WorkerHealthResult;
  ready(requestId: string): Promise<WorkerHealthResult>;
}

export interface AuthoritativeMetricsCollectorScheduler {
  setInterval(callback: () => void, intervalMs: number): NodeJS.Timeout;
  clearInterval(handle: NodeJS.Timeout): void;
}
```

The first interface is health-owned; the second is metrics-collector-owned. They must remain separate.

### Literal proposed bootstrap placement

Inside the existing `try` block in `apps/worker/src/main.ts`, the planned implementation was exactly this three-line transition after the existing `listen()` call and before the existing `resolveListenReady()` call:

```ts
await app.listen(port, '0.0.0.0');
app.get(HealthService).markSchedulerInitialized();
resolveListenReady();
```

A failed environment validation or failed `listen()` never reaches the marker. Resolving `listenReady` after the marker preserves the existing startup/shutdown barrier.

### State ownership and transitions

| State              | Owner                                                          | Initial state                            | Healthy transition                                      | Failure/drain behavior                                            |
| ------------------ | -------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| Environment        | `main.ts` validation and `WORKER_HEALTH_ENVIRONMENT_VALIDATED` | No app/listener before validation        | Validation returns                                      | Invalid env fails startup; no readiness bypass                    |
| Database           | `HealthService.checkDatabase()` (`health.service.ts:128-150`)  | Checked per request                      | `isReady()` plus bounded `SELECT 1` succeed             | `down` → HTTP 503; raw DB detail remains hidden                   |
| Migration          | `HealthService.checkMigration()` (`:152-163`)                  | `not_configured` without required inputs | Release/target-matched read-only marker is valid        | `not_configured`/`down` → HTTP 503                                |
| Business scheduler | `HealthService.schedulerInitialized` (`:52,68-70`)             | `false`                                  | Set once after successful `await app.listen()`          | Failed startup never marks; drain still independently returns 503 |
| Last loop          | `HealthService.lastLoop` (`:53,72-74`)                         | `not_configured`                         | Only a genuine future business-loop owner may update it | Diagnostic only; never a readiness gate                           |
| Draining           | `ShutdownCoordinator` (`shutdown-coordinator.ts:88-119`)       | `false`                                  | `beginDrain()` on signal/shutdown                       | `HealthService` reports `draining=down`, HTTP 503 before close    |
| Metrics snapshot   | `WorkerMetricsService` (`metrics.service.ts:355-400`)          | Incomplete until bound sources publish   | All required samples fresh and identity-valid           | `/metrics` remains 503; no health override or zero fallback       |

`lastLoop` currently has no production caller. It must not be set by metrics collection, the 30-second application observation interval, environment validation, or the bootstrap marker. A future meaningful loop producer is a separate contract.

### Metrics freshness/identity remains separate

`WorkerMetricsService.getCompleteSnapshot()` at `apps/worker/src/metrics/metrics.service.ts:355-400` requires worker metadata, all fresh required samples, all required worker job gauge series, no aged sample, and no collector failures. `MetricsController.getMetrics()` maps an incomplete snapshot to 503 at `apps/worker/src/metrics/metrics.controller.ts:53-60`.

Identity and freshness are already enforced by:

- `packages/observability/src/metrics-contract.ts:1145-1250,1331-1390` (snapshot/sample identity, evidence, and freshness validation);
- `packages/observability/src/metrics.ts:651-675` (source snapshot identity matching);
- PostgreSQL/object-storage/backup/security adapter checks in `apps/worker/src/metrics/sources/{postgres-metrics.adapter.ts,object-storage-metrics.adapter.ts,backup-restore-metrics.adapter.ts,security-boundary-metrics.adapter.ts}`; and
- collector failure propagation in `apps/worker/src/metrics/authoritative-metrics-collector.ts:147-245`.

No metric source, provider, producer, timeout, retry, or readiness relationship changes in this plan.

---

## Alternatives considered and rejected

1. **Mark from `AuthoritativeMetricsRuntimeService.onModuleInit()` or after `collectOnce()`: rejected.** The collector's raw timer is not the business scheduler, authority failure must not change health semantics, and metrics collection has a separate `/metrics` contract.
2. **Replace the undefined collector token with a Nest scheduler/`SchedulerRegistry`: rejected.** The collector token's exact interface is `setInterval/clearInterval`; Nest owns cron/interval mounting independently. Coupling would add framework reflection and blur source ownership without fixing `HealthService.schedulerInitialized`.
3. **Add a new `OnApplicationBootstrap` readiness service: rejected for this minimal change.** Its hook ordering against `SchedulerOrchestrator.onApplicationBootstrap()` would be an unnecessary DI/order dependency; `await app.listen()` already provides the framework's completed-bootstrap boundary.
4. **Inspect/count registry jobs or add cron labels: rejected.** Current cron decorators use generated names, and health is process-level scheduler initialization, not continuous per-job health. No new labels or brittle runtime copies are justified.
5. **Make `lastLoop` mandatory or set it to `ok` at startup: rejected.** The existing `healthy` array intentionally excludes it. Startup has not observed a business loop, so `not_configured` is truthful.
6. **Change transport timeouts, add retries, or redesign collector startup: rejected.** The real transport already has a 5-second default bounded request timeout and the observed worker was listening; no causal evidence authorizes telemetry changes.

---

## Original implementation tasks (historical record)

### Task 1: Add the post-listen health marker

**Files:** Modify only `apps/worker/src/main.ts:14,34-80`.

- [ ] Read the current `main.ts` and preserve all existing validation, metadata, logger, shutdown, error, and startup code.
- [ ] Insert the literal three-line sequence shown above inside the existing `try` block: successful `listen`, `HealthService` marker, then `resolveListenReady`.
- [ ] Do not edit `AppModule`, `HealthService` thresholds, collector wiring, metrics source code, manifests, lockfiles, schema, or generated metadata.
- [ ] Re-read the changed source and inspect only the intended diff in a separately authorized implementation turn.

### Task 2: Optional diagnostic regression coverage

**File:** `apps/worker/src/health.service.spec.ts` only if the existing focused suite does not already preserve this consumer contract.

- [ ] Read the existing health fixture before editing.
- [ ] Add at most one meaningful case that calls `markSchedulerInitialized()`, calls `setLastLoopState('down')`, keeps the real DB/migration/drain fixture healthy, and asserts `result.statusCode === 200` while `result.body.checks.lastLoop === 'down'`.
- [ ] The exact fixture-shaped case is:

  ```ts
  it('keeps lastLoop diagnostic and non-gating', async () => {
    const service = new HealthService(
      prisma as unknown as PrismaService,
      shutdown,
    );
    service.markSchedulerInitialized();
    service.setLastLoopState('down');

    const result = await service.ready('request-1');

    expect(result.statusCode).toBe(200);
    expect(result.body.checks.lastLoop).toBe('down');
  });
  ```

  The existing `beforeEach` fixture at `apps/worker/src/health.service.spec.ts:36-47` supplies the healthy Prisma, migration marker, release, target identity, and non-draining shutdown state.

- [ ] Do not add an AST/source-text test, a mock-only marker-call test, or a tautological default-property test.
- [ ] Keep `apps/worker/test/app.e2e-spec.ts:180-188` unchanged; its module-only `app.init()` path intentionally remains 503 before the main bootstrap marker.

### Task 3: Planned static/optional commands

These commands were listed in the original plan. The implementation-turn TypeScript check ran as recorded below; the optional focused suite was not run.

```powershell
$TsBuildInfoFile = Join-Path $env:TEMP ("imeal-worker-tsc-" + [guid]::NewGuid().ToString('N') + ".tsbuildinfo")
try {
  corepack yarn workspace @imeal/worker exec tsc --noEmit -p tsconfig.json --tsBuildInfoFile $TsBuildInfoFile
  if ($LASTEXITCODE -ne 0) { throw 'worker TypeScript check failed' }
} finally {
  Remove-Item -Force -LiteralPath $TsBuildInfoFile -ErrorAction SilentlyContinue
}
# Optional only when Task 2 adds the diagnostic regression and explicit authorization is provided:
corepack yarn workspace @imeal/worker exec vitest run src/health.service.spec.ts
```

The second command is optional and should run only if Task 2 adds the one diagnostic regression **and an explicit user request authorizes automated test execution**. Adding the case alone never authorizes a test run. No repository-wide suite is authorized by this plan.

### Task 4: Throwaway real-entrypoint HTTP smoke on Windows

The existing unit contracts remain; a throwaway real-entrypoint HTTP smoke provides proof of the bootstrap wiring. Do not add a fragile permanent startup-subprocess case solely to test one line of wiring. Run the smoke recipe only in an authorized implementation/qualification turn, with disposable resources and operator-injected values kept outside the checkout.

The smoke MUST use a Docker Linux container so signal behavior is real Linux behavior. Do not use PowerShell `Stop-Process` as a substitute for Unix SIGTERM. Provision an isolated disposable PostgreSQL 16 container on a smoke-owned Docker network; no external or approved PgBouncer is required. An unrelated operator pooler, if present, is not touched. The marker directory must contain the valid local marker produced by the existing migration gate after a genuine `prisma migrate deploy`; do not invent protected approval, provider secret, target, or fake digest.

The PowerShell recipe creates only smoke-owned disposable resources. It uses the shipped Node 24 worker image path (`apps/worker/Dockerfile`, normal `CMD ["node", "dist/main"]`, `USER node`) and the existing migration image/gate. Runtime values are injected through an external env file; no production credentials, provider values, target fingerprints, or image digests are placed in the repository.

```powershell
$ErrorActionPreference = 'Stop'

$RunId = [guid]::NewGuid().ToString('N')
$SmokeId = "imeal-worker-readiness-$RunId"
$Network = "${SmokeId}-net"
$PgContainer = "wr-$RunId-pg"
$MigrationContainer = "${SmokeId}-migration"
$Image = "imeal-worker-readiness:$RunId"
$MigrationImage = "imeal-worker-readiness-migration:$RunId"
$TempRoot = Join-Path $env:TEMP $SmokeId
$MarkerDir = Join-Path $TempRoot 'marker'
$EnvFile = Join-Path $TempRoot 'worker.env'
$LivePath = Join-Path $TempRoot 'live.json'
$ReadyPath = Join-Path $TempRoot 'ready.json'
$OutputPathsOwned = @($LivePath, $ReadyPath)
$Port = 13001
$Schema = "worker_readiness_$RunId"
$Release = 'release-worker-readiness-smoke'
# This is a local-only synthetic marker label, never a protected approval.
$LocalApproval = "local-worker-readiness-$RunId"
$OtpKey = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$TempRootCreated = $false
$script:SmokeCleanupFailed = $false
$NetworkCreated = $false
$PostgresStarted = $false
$WorkerStarted = $false
$CollisionStarted = $false
$ImageBuilt = $false
$MigrationImageBuilt = $false
$name = "imeal-worker-readiness-worker-$RunId"
$collision = $null

function Test-Smoke-Container([string] $Container) {
  if ([string]::IsNullOrWhiteSpace($Container)) { return $false }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $labelsJson = docker inspect --format '{{json .Config.Labels}}' $Container 2>$null
    $dockerExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($dockerExit -ne 0) { return $false }
  try {
    $labels = $labelsJson | ConvertFrom-Json
  } catch {
    return $false
  }
  return ([string]$labels.'imeal.smoke').Trim() -eq $SmokeId
}

function Test-Smoke-Network([string] $NetworkName) {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $labelsJson = docker network inspect --format '{{json .Labels}}' $NetworkName 2>$null
    $dockerExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($dockerExit -ne 0) { return $false }
  try {
    $labels = $labelsJson | ConvertFrom-Json
  } catch {
    return $false
  }
  return ([string]$labels.'imeal.smoke').Trim() -eq $SmokeId
}

function Test-Smoke-Image([string] $Tag) {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $labelsJson = docker image inspect --format '{{json .Config.Labels}}' $Tag 2>$null
    $dockerExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($dockerExit -ne 0) { return $false }
  try {
    $labels = $labelsJson | ConvertFrom-Json
  } catch {
    return $false
  }
  return ([string]$labels.'imeal.smoke').Trim() -eq $SmokeId
}

function Remove-Smoke-Container([string] $Container) {
  if (-not (Test-Smoke-Container $Container)) {
    $script:SmokeCleanupFailed = $true
    Write-Warning "refusing to remove unowned or missing container: $Container"
    return
  }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    docker rm --force $Container 2>$null | Out-Null
    $dockerExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($dockerExit -ne 0) {
    $script:SmokeCleanupFailed = $true
    Write-Warning "could not remove smoke-owned container: $Container"
  }
}

function Remove-Smoke-Postgres([string] $Container) {
  if (-not (Test-Smoke-Container $Container)) {
    $script:SmokeCleanupFailed = $true
    Write-Warning "refusing to remove unowned or missing PostgreSQL container: $Container"
    return
  }
  $mountPath = Join-Path $TempRoot 'postgres-mounts.json'
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $mountJson = docker inspect --format '{{json .Mounts}}' $Container 2>$null
    $inspectExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($inspectExit -ne 0) {
    $script:SmokeCleanupFailed = $true
    Write-Warning "could not capture PostgreSQL mounts: $Container"
    return
  }
  try {
    @($mountJson) | Set-Content -Encoding ascii $mountPath
  } catch {
    $script:SmokeCleanupFailed = $true
    Write-Warning "could not record PostgreSQL mounts: $Container"
    return
  }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    docker rm --force --volumes $Container 2>$null | Out-Null
    $dockerExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($dockerExit -ne 0) {
    $script:SmokeCleanupFailed = $true
    Write-Warning "could not remove smoke-owned PostgreSQL container and volumes: $Container"
  }
}

function Stop-Smoke-Container([string] $Container) {
  if (-not (Test-Smoke-Container $Container)) {
    throw "refusing to stop unowned or missing container: $Container"
  }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    docker stop $Container | Out-Null
    $dockerExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($dockerExit -ne 0) {
    throw "could not stop smoke-owned container: $Container"
  }
}

function Send-Smoke-Signal([string] $Container, [string] $Signal) {
  if (-not (Test-Smoke-Container $Container)) {
    throw "refusing to signal unowned or missing container: $Container"
  }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    docker kill --signal=$Signal $Container | Out-Null
    $dockerExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($dockerExit -ne 0) {
    throw "could not deliver $Signal to smoke-owned container: $Container"
  }
}

function Remove-Smoke-Image([string] $Tag) {
  if (-not (Test-Smoke-Image $Tag)) {
    $script:SmokeCleanupFailed = $true
    Write-Warning "refusing to remove unowned or missing image: $Tag"
    return
  }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    docker image rm $Tag 2>$null | Out-Null
    $dockerExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($dockerExit -ne 0) {
    $script:SmokeCleanupFailed = $true
    Write-Warning "could not remove smoke-owned image: $Tag"
  }
}

function Remove-Smoke-Network([string] $NetworkName) {
  if (-not (Test-Smoke-Network $NetworkName)) {
    $script:SmokeCleanupFailed = $true
    Write-Warning "refusing to remove unowned or missing network: $NetworkName"
    return
  }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    docker network rm $NetworkName 2>$null | Out-Null
    $dockerExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($dockerExit -ne 0) {
    $script:SmokeCleanupFailed = $true
    Write-Warning "could not remove smoke-owned network: $NetworkName"
  }
}

function Get-ContainerState([string] $Container) {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $state = docker inspect --format '{{.State.Status}}' $Container 2>$null
    $dockerExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($dockerExit -ne 0) { return 'missing' }
  return ([string]$state).Trim()
}

function Get-ContainerExitCode([string] $Container) {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $code = docker inspect --format '{{.State.ExitCode}}' $Container 2>$null
    $dockerExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($dockerExit -ne 0) { throw "cannot inspect container exit code: $Container" }
  return [int]$code
}


function Wait-ContainerExit([string] $Container, [int] $TimeoutSeconds = 35) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $state = Get-ContainerState $Container
    if ($state -eq 'exited' -or $state -eq 'dead') {
      return Get-ContainerExitCode $Container
    }
    if ($state -eq 'missing') { throw "container disappeared before exit: $Container" }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "container did not exit within ${TimeoutSeconds}s: $Container"
}

function Read-Health([string] $Uri, [string] $OutputPath) {
  Remove-Item -Force $OutputPath -ErrorAction SilentlyContinue
  $codeText = curl.exe --silent --show-error --max-time 5 `
    --output $OutputPath --write-out '%{http_code}' $Uri
  $curlExit = $LASTEXITCODE
  if ($curlExit -ne 0 -or [string]::IsNullOrWhiteSpace($codeText) -or
      ([string]$codeText).Trim() -eq '000') {
    return [pscustomobject]@{ Code = 0; Body = $null }
  }
  [int]$code = 0
  if (-not [int]::TryParse(([string]$codeText).Trim(), [ref]$code) -or $code -eq 0) {
    return [pscustomobject]@{ Code = 0; Body = $null }
  }
  $body = $null
  if (Test-Path $OutputPath) {
    try { $body = Get-Content -Raw $OutputPath | ConvertFrom-Json } catch {}
  }
  [pscustomobject]@{ Code = $code; Body = $body }
}

function Wait-Live([int] $HostPort) {
  $path = $LivePath
  $deadline = (Get-Date).AddSeconds(30)
  do {
    $response = Read-Health "http://127.0.0.1:$HostPort/health/live" $path
    if ($response.Code -eq 200) { return $response }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw "worker did not become live within 30s on port $HostPort"
}

function Start-WorkerSmoke([string] $Container, [string] $Marker, [int] $HostPort) {
  $mount = "type=bind,source=$Marker,target=/run/imeal,readonly"
  docker run --detach --name $Container --label "imeal.smoke=$SmokeId" --network $Network --env-file $EnvFile `
    --mount $mount --publish "${HostPort}:3001" --env PORT=3001 $Image | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Remove-Smoke-Container $Container
    throw "worker container failed to start: $Container"
  }
}

try {
  if (Test-Path $TempRoot) { throw "smoke temp root already exists: $TempRoot" }
  New-Item -ItemType Directory -Path $TempRoot | Out-Null
  $TempRootCreated = $true
  New-Item -ItemType Directory -Path $MarkerDir | Out-Null

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    docker image inspect $Image 2>$null | Out-Null
    $dockerExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($dockerExit -eq 0) { throw "smoke worker image tag already exists: $Image" }
  try {
    $ErrorActionPreference = 'Continue'
    docker image inspect $MigrationImage 2>$null | Out-Null
    $dockerExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($dockerExit -eq 0) { throw "smoke migration image tag already exists: $MigrationImage" }

  # Isolated direct PostgreSQL 16; no PgBouncer or shared network is required.
  docker network create --label "imeal.smoke=$SmokeId" $Network | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Remove-Smoke-Network $Network
    throw 'could not create smoke-owned Docker network'
  }
  $NetworkCreated = $true
  docker run --detach --name $PgContainer --label "imeal.smoke=$SmokeId" --network $Network `
    --env "POSTGRES_PASSWORD=$OtpKey" --env POSTGRES_DB=imeal `
    --health-cmd 'pg_isready -U postgres -d imeal' `
    --health-interval 1s --health-timeout 5s --health-retries 30 postgres:16 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Remove-Smoke-Postgres $PgContainer
    throw 'could not start smoke-owned PostgreSQL 16'
  }
  $PostgresStarted = $true

  # pg_isready can report success during the official image's temporary
  # initialization server; require bounded TCP access to the target database.
  $pgDeadline = (Get-Date).AddSeconds(45)
  do {
    docker exec $PgContainer psql -h 127.0.0.1 -U postgres -d imeal -v ON_ERROR_STOP=1 `
      -c 'SELECT 1;' | Out-Null
    $pgReadyExit = $LASTEXITCODE
    if ($pgReadyExit -eq 0) { break }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $pgDeadline)
  if ($pgReadyExit -ne 0) { throw 'smoke-owned PostgreSQL 16 target database did not become ready' }

  # The generated identifier is safe SQL and names the actual disposable target schema.
  docker exec $PgContainer psql -U postgres -d imeal -v ON_ERROR_STOP=1 `
    -c "CREATE SCHEMA $Schema;" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'could not create disposable target schema' }

  $DatabaseUrl = "postgresql://postgres:$OtpKey@${PgContainer}:5432/imeal?schema=$Schema"
  $markerMount = "type=bind,source=$MarkerDir,target=/run/imeal"
  $readonlyMarkerMount = "type=bind,source=$MarkerDir,target=/run/imeal,readonly"

  # The existing infra/migrations/Dockerfile entrypoint invokes
  # /app/infra/migrations/production-gate.sh, whose migration phase runs the
  # repository's genuine `yarn workspace @imeal/core prisma migrate deploy`,
  # preflight, backfill, and postflight against this actual schema before writing the marker.
  # The approval ID is an explicitly local-only synthetic test label, not protected evidence.
  docker build --file infra/migrations/Dockerfile --label "imeal.smoke=$SmokeId" --tag $MigrationImage . | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'could not build the existing migration image' }
  $MigrationImageBuilt = $true
  docker run --rm --name $MigrationContainer --label "imeal.smoke=$SmokeId" --network $Network --mount $markerMount `
    --env "MIGRATION_DATABASE_URL=$DatabaseUrl" `
    --env "MIGRATION_TARGET_SCHEMA=$Schema" `
    --env "MIGRATION_TARGET_IDENTITY=$Schema" `
    --env "MIGRATION_APPROVAL_ID=$LocalApproval" `
    --env "RELEASE_VERSION=$Release" `
    --env MIGRATION_EVIDENCE_PATH=/run/imeal/migration-evidence.json `
    $MigrationImage
  if ($LASTEXITCODE -ne 0) { throw 'existing disposable migration gate failed' }
  $markerPath = Join-Path $MarkerDir 'migration-evidence.json'
  if (-not (Test-Path $markerPath)) { throw 'migration gate did not produce the marker' }
  # Validate only redacted identity fields; never print marker contents.
  $marker = Get-Content -Raw $markerPath | ConvertFrom-Json
  if ($marker.release -ne $Release -or
      $marker.targetSchema -ne $Schema -or
      $marker.approvalId -ne $LocalApproval -or
      [string]::IsNullOrWhiteSpace([string]$marker.migration) -or
      [string]::IsNullOrWhiteSpace([string]$marker.completedAt)) {
    throw 'migration marker identity does not match the actual disposable run'
  }

  # Build the shipped Node 24 worker image; its Dockerfile builder compiles
  # inside Docker so no host Yarn build changes checkout-generated metadata.
  docker build --file apps/worker/Dockerfile --label "imeal.smoke=$SmokeId" --tag $Image . | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'could not build the shipped worker image' }
  $ImageBuilt = $true

  # Exact disposable runtime contract; all values are test-only and external to the checkout.
  @"
NODE_ENV=test
PORT=3001
DATABASE_URL=$DatabaseUrl
OTP_DELIVERY_ENCRYPTION_KEY=$OtpKey
RELEASE_VERSION=$Release
MIGRATION_EVIDENCE_PATH=/run/imeal/migration-evidence.json
MIGRATION_TARGET_IDENTITY=$Schema
SHUTDOWN_TIMEOUT_SECONDS=5
"@ | Set-Content -Encoding ascii -NoNewline $EnvFile

  # Verify UID 1000 (the shipped image's `node` user) can read the real marker.
  docker run --rm --name "${SmokeId}-uidcheck" --label "imeal.smoke=$SmokeId" `
    --user 1000 --mount $readonlyMarkerMount --entrypoint /bin/sh $Image `
    -c 'test -r /run/imeal/migration-evidence.json'
  if ($LASTEXITCODE -ne 0) { throw 'worker UID 1000 cannot read the migration marker' }

  Start-WorkerSmoke $name $MarkerDir $Port
  $WorkerStarted = $true
  $null = Wait-Live $Port
  $ready = Read-Health "http://127.0.0.1:$Port/health/ready" $ReadyPath
  if ($ready.Code -ne 200 -or
      $ready.Body.status -ne 'ok' -or
      $ready.Body.service -ne 'worker' -or
      $ready.Body.release -ne $Release -or
      $ready.Body.checks.environment -ne 'ok' -or
      $ready.Body.checks.database -ne 'ok' -or
      $ready.Body.checks.migration -ne 'ok' -or
      $ready.Body.checks.scheduler -ne 'ok' -or
      $ready.Body.checks.draining -ne 'ok' -or
      $ready.Body.checks.lastLoop -ne 'not_configured') {
    throw 'successful disposable worker startup did not expose the expected health contract'
  }

  # App-level listen failure: share the first Linux network namespace; no second
  # host publish is used, so Docker allocation cannot hide Node EADDRINUSE.
  $collision = "imeal-worker-readiness-collision-$RunId"
  docker run --detach --name $collision --label "imeal.smoke=$SmokeId" --network "container:$name" `
    --env-file $EnvFile --mount $readonlyMarkerMount --env PORT=3001 $Image | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'could not start app-level collision container' }
  $CollisionStarted = $true
  $collisionExit = Wait-ContainerExit $collision
  $collisionLogStartInfo = New-Object System.Diagnostics.ProcessStartInfo
  $collisionLogStartInfo.FileName = 'docker.exe'
  $collisionLogStartInfo.Arguments = 'logs --tail 200 "' + $collision + '"'
  $collisionLogStartInfo.UseShellExecute = $false
  $collisionLogStartInfo.CreateNoWindow = $true
  $collisionLogStartInfo.RedirectStandardOutput = $true
  $collisionLogStartInfo.RedirectStandardError = $true
  $collisionLogProcess = New-Object System.Diagnostics.Process
  $collisionLogProcess.StartInfo = $collisionLogStartInfo
  [void]$collisionLogProcess.Start()
  $collisionStdoutTask = $collisionLogProcess.StandardOutput.ReadToEndAsync()
  $collisionStderrTask = $collisionLogProcess.StandardError.ReadToEndAsync()
  $collisionLogProcess.WaitForExit()
  $collisionStdout = $collisionStdoutTask.Result
  $collisionStderr = $collisionStderrTask.Result
  $collisionLogsExit = $collisionLogProcess.ExitCode
  $collisionLogProcess.Dispose()
  if ($collisionLogsExit -ne 0) { throw 'could not capture collision logs' }
  $collisionLogs = $collisionStdout + $collisionStderr
  if ($collisionExit -eq 0 -or $collisionLogs -notmatch '(?i)EADDRINUSE|address already in use') {
    throw 'port-collision worker did not prove EADDRINUSE in bounded logs'
  }
  Write-Output $collisionLogs
  Remove-Smoke-Container $collision
  $CollisionStarted = $false
  $collision = $null

  # Linux Docker delivers SIGTERM; Windows process termination is not used here.
  Send-Smoke-Signal $name 'SIGTERM'
  $drainDeadline = (Get-Date).AddSeconds(10)
  $drainObserved = $false
  do {
    $drain = Read-Health "http://127.0.0.1:$Port/health/ready" $ReadyPath
    if ($drain.Code -eq 503 -and $drain.Body.checks.draining -eq 'down') {
      $drainObserved = $true
      break
    }
    if ((Get-ContainerState $name) -in @('exited', 'dead', 'missing')) { break }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $drainDeadline)
  $exitCode = Wait-ContainerExit $name
  if ($exitCode -ne 0) { throw "worker graceful shutdown exited with code $exitCode" }
  docker logs --tail 200 $name
  if ($LASTEXITCODE -ne 0) { throw 'could not capture worker shutdown logs' }
  if (-not $drainObserved) {
    Write-Warning 'drain HTTP response was not observable before close; retain bounded shutdown logs and report this limitation'
  }
}
finally {
  if ($CollisionStarted) { Remove-Smoke-Container $collision }
  if ($WorkerStarted) { Remove-Smoke-Container $name }
  if ($PostgresStarted) { Remove-Smoke-Postgres $PgContainer }
  if ($NetworkCreated) { Remove-Smoke-Network $Network }
  if ($ImageBuilt) { Remove-Smoke-Image $Image }
  if ($MigrationImageBuilt) { Remove-Smoke-Image $MigrationImage }
  if ($TempRootCreated) {
    if ($script:SmokeCleanupFailed) {
      Write-Warning "retaining smoke temp root because owned-resource cleanup failed: $TempRoot"
    } else {
      try {
        Remove-Item -Force -Recurse -LiteralPath $TempRoot -ErrorAction Stop
      } catch {
        $script:SmokeCleanupFailed = $true
        Write-Warning "could not remove smoke temp root: $TempRoot"
      }
    }
  }
}
if ($script:SmokeCleanupFailed) {
  throw "smoke cleanup failed; inspect retained evidence at $TempRoot"
}
```

The generated worker env file intentionally contains this exact contract: `NODE_ENV=test`; `PORT=3001`; direct `DATABASE_URL` for the actual disposable PostgreSQL schema; a locally generated `OTP_DELIVERY_ENCRYPTION_KEY` of at least 32 characters; `RELEASE_VERSION=release-worker-readiness-smoke`; `MIGRATION_EVIDENCE_PATH=/run/imeal/migration-evidence.json`; `MIGRATION_TARGET_IDENTITY` equal to the actual `$Schema`; and bounded disposable `SHUTDOWN_TIMEOUT_SECONDS=5`. The marker's local-only approval label is not a protected approval and must never be copied into production evidence.

Run the same setup with distinct smoke-owned names/ports for these bounded cases:

- **Migration failure:** use an empty smoke-owned marker directory at `/run/imeal`, start on host port `13002`, wait for `/health/live`, and request `/health/ready`. Expect HTTP 503 with migration `not_configured` or `down`; scheduler state must not mask the migration failure. Send Linux `SIGTERM`, require exit code 0, capture bounded logs, and remove only that worker/container.
- **Database failure after startup:** start with the valid marker on host port `13003`, wait for `/health/live`, then call the label-guarded `Stop-Smoke-Container $PgContainer` (which checks `$LASTEXITCODE`). Request `/health/ready` and expect HTTP 503 with database `down`; then send SIGTERM to the smoke-owned worker and require bounded exit code 0. If DB is unavailable before Prisma module initialization, no listener is expected and the process must not be treated as ready.
- **Invalid environment:** remove `OTP_DELIVERY_ENCRYPTION_KEY` from a copied smoke env file and start a distinct worker. Require bounded nonzero process exit, bounded logs, no listener, and no ready response; do not claim a startup marker.
- **Metrics authority unavailable:** with test-only `NODE_ENV` and no provider secrets or fabricated source records, `/metrics` may remain HTTP 503. This is allowed and separate from health scheduler initialization; do not turn it into a zero snapshot or use it to mark the worker ready.

All smoke results from an execution of this recipe must be captured without secrets, raw target values, provider payloads, employee/location data, fake protected approvals, or production claims.

---

## Acceptance table (planned verification)

| Scenario                                                   | Expected result                                                                                                                                                                         | Scope                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Existing source behavior before main marker                | Module-only `AppModule`/`app.init()` test remains 503; `apps/worker/test/app.e2e-spec.ts:180-188` is unchanged                                                                          | Preserve intentional test boundary |
| Successful real entrypoint                                 | Initial observed readiness failure is resolved to HTTP 200 after successful listen; environment/database/migration/scheduler/draining remain `ok`; `lastLoop=not_configured` is allowed | Minimal readiness fix              |
| `lastLoop='down'` diagnostic with all actual gates healthy | Optional focused health case remains HTTP 200 and reports `lastLoop=down`                                                                                                               | Preserve non-gating diagnostic     |
| Database failure after startup                             | HTTP 503 with safe `database=down`; no raw Prisma details                                                                                                                               | Existing guard preserved           |
| Missing/mismatched migration marker                        | HTTP 503 with safe migration `not_configured`/`down`                                                                                                                                    | Existing guard preserved           |
| Invalid worker environment                                 | Startup validation fails before a listener; no ready response                                                                                                                           | Fail closed                        |
| Listener bind failure                                      | `listen()` rejects; post-listen marker and startup barrier resolution are not reached                                                                                                   | Marker placement                   |
| SIGTERM drain                                              | While still serving, readiness becomes HTTP 503 with `draining=down`; Linux container exits through existing graceful shutdown path                                                     | Existing drain owner               |
| Authority unavailable or source identity/freshness invalid | `/metrics` remains HTTP 503; no synthetic metric/provider or health bypass                                                                                                              | Separate telemetry gate            |

## Risks, non-goals, and release boundary

- `AuthoritativeMetricsRuntimeService.onModuleInit()` awaits `collector.collectOnce()` before starting its own timer (`apps/worker/src/metrics/authoritative-metrics-runtime.service.ts:117-124`). The real transport used by this app has a bounded 5-second default request timeout (`authoritative-source-transport.ts:70-83,111-183`), so this plan does not claim an unbounded production registry HTTP request. A custom provider supplied through the abstraction could still fail to settle; that separate concern is not addressed here and does not authorize timeout/retry/telemetry changes.
- The scheduler marker is process-level initialization, not proof that every cron job has executed or succeeded. Continuous job freshness remains separate metrics/business behavior.
- Cron callback failure, protected source failure, missing provider authority, or stale metric evidence must not be suppressed to produce a green health or metrics response.
- Production remains blocked by protected environment inputs, real source/target/evidence binding, provider delivery, DNS/TLS, backup/restore, alert delivery, image/audit findings (including unresolved HIGH audit findings), and release approval. Readiness wiring does not fix those gates.
- During the original planning turn, `CHANGELOG.md`, evidence docs, and operational docs were intentionally deferred until the actual smoke and bounded observations were reviewed; the implementation-turn execution note below records those updates.

## Scope boundary

The original planning turn wrote only this plan file and performed no implementation, smoke, test, or documentation execution. The later authorized implementation/qualification turn is recorded above and modified only the listed `main.ts` marker plus the post-smoke evidence, runbook, changelog, and this execution note; it excluded all other source, runtime, telemetry, configuration, dependency, schema, test-suite, deployment, and release changes.

## Execution note — 2026-10-05 implementation and qualification turn

- Task 1 was implemented in `apps/worker/src/main.ts`: successful `await app.listen(...)`, then `HealthService.markSchedulerInitialized()`, then `resolveListenReady()`. The runtime evidence is recorded in [`../evidence/2026-10-05-worker-readiness.md`](../evidence/2026-10-05-worker-readiness.md).
- The valid disposable real-entrypoint run observed `/health/live` HTTP 200 with startup checks not configured except `draining=ok`, then `/health/ready` HTTP 200 with all five readiness gates `ok`; `lastLoop=not_configured` remained diagnostic. `/metrics` remained HTTP 503 without protected authority. Missing/mismatched migration markers, database-down, invalid environment, and port collision remained fail-closed.
- The optional Task 2 diagnostic regression was intentionally skipped. `lastLoop` behavior and existing health/test files remain untouched; no test checkbox is being marked and no unit/e2e suite was run.
- Focused implementation checks are recorded outside the checkout: TypeScript `--noEmit` exit 0 and entrypoint Prettier check exit 0. No host Yarn build was used for the runtime qualification.
- The harness now waits for bounded TCP `psql -h 127.0.0.1 -U postgres -d imeal -v ON_ERROR_STOP=1 -c 'SELECT 1;'` after the observed `pg_isready` initialization race; the UID helper is label/name-owned and `--rm`; PostgreSQL cleanup captures mounts and uses label-guarded `docker rm --force --volumes`.
- The captured SIGTERM response also had `database=down` because the database had already been stopped. The separate healthy-database supplement had pre-signal HTTP 200 with all five gates `ok`, native SIGTERM exit 0, and graceful shutdown logs, but the listener closed before a post-signal response (curl exit 52, HTTP 000/empty reply) could be captured. No healthy 200→503 drain transition is claimed. The earlier failed attempt's anonymous-volume identity is unavailable from bounded Docker events, so no all-session cleanup claim is made.
- A read-only native PowerShell probe of `docker.exe version --format '{{ print "imeal.smoke" }}'` returned exit 64 with `template parsing error: template: version:1: function "imeal" not defined`; the temporary probe script was removed and its log is retained at `C:\Users\Khoi Nguyen\AppData\Local\Temp\imeal-worker-readiness-quote-probe-20261005.log`. Only the three ownership helpers were corrected to inspect JSON labels and read the `'imeal.smoke'` property with `ConvertFrom-Json`, preserving scoped `$LASTEXITCODE` handling.
- The corrected Task 4 PowerShell recipe remains plan guidance: its JSON-label ownership helpers and TCP readiness wait were syntax-qualified only. The recorded runtime evidence came from the separate external harness and its retained command logs; the recipe itself was not rerun after these corrections.
