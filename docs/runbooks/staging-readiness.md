# Staging readiness and release qualification

This runbook is for the isolated staging target only. It is an operator
procedure, not proof that staging or production has been provisioned. Do not
enter credentials, OTP values, employee data, location data, GPS data, provider
payloads, or secret-bearing URLs in this document or in evidence. Approved
staging API/Admin origins may appear only as restricted operational metadata in
the smoke evidence; they are never committed to docs or source.

The current repository evidence is **CONDITIONAL / NO-GO**. Local tests prove
only the checked-in tooling and disposable fixtures. The release manager must
keep the gate closed until the external staging gates in this runbook have
independent approval.

## CI qualification modes

The checked-in workflow has two independent gates. Pull requests and pushes to
`deploy/develop` run **secretless qualification** only. That job uses the
disposable PostgreSQL service at
`postgresql://postgres:postgres@127.0.0.1:5432/imeal_ci?schema=public` for
Prisma validation/generation, migrations, and database-backed checks; it never
reads a repository or GitHub staging secret.

Pushes to `deploy/staging` may enter **protected staging qualification** after
the secretless job passes. A manual `workflow_dispatch` defaults to
qualification only; the protected job is eligible only when the caller
explicitly sets `deploy_staging=true` and the selected ref is exactly
`deploy/staging`. Dispatching any other ref, omitting the protected input, or
providing incomplete/malformed protected environment values cannot deploy.

The protected job runs the approved Compose release on its GitHub-hosted runner
only for ephemeral qualification. Its `always()` teardown removes the
containers, networks, and volumes before the runner is discarded. This is not a
persistent staging deployment and is not evidence that a long-lived staging
host, DNS/TLS endpoint, provider, backup, or alert route exists.

## Ownership, prerequisites, and decision authority

| Responsibility                                               | Owner                                     | Required evidence                                                                                                                                        |
| ------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release identity, candidate commit, image digest review      | Release manager                           | `release-manifest.json`                                                                                                                                  |
| Target fingerprint, migration status, preflight and backfill | Database/platform operator                | `target-fingerprint.json`, `migration-status.txt`, `preflight-before.json`, `backfill-result.json`, `preflight-after.json`, `constraint-validation.json` |
| Encrypted backup, restore rehearsal, RPO/RTO                 | Staging operations and data platform      | `backup-manifest.json`, `restore-rehearsal.json`                                                                                                         |
| Security, image and dependency review                        | Platform security                         | CI checks, SBOM references, immutable image references                                                                                                   |
| OTP, identity, roster and location approval                  | Product operations and identity owner     | `smoke-auth-rbac.json`, approval record, UAT sign-off                                                                                                    |
| WAF, rate limiting, TLS and alert delivery                   | Network/observability owner               | `observability-alert-test.json`, edge and alert approval                                                                                                 |
| Final go/no-go and rollback authority                        | Release manager with independent reviewer | `signoff.json`, incident or decision record                                                                                                              |

Before starting, the release manager records a release ID, reviewed commit,
rollback decision window, and target database/schema in the restricted
release evidence directory. The target must be disposable or an approved
staging representative; it must not be production or a shared developer
resource.

The protected staging environment uses these manifest names. Values are
injected out of band and must never be copied into this runbook or printed:

- GitHub secret `STAGING_ENV_FILE`: complete staging Compose environment file;
- GitHub secret `STAGING_SMOKE_SESSION_TOKEN`: short-lived smoke session token;
- GitHub variables `STAGING_API_ORIGIN`, `STAGING_WORKER_ORIGIN`, and
  `STAGING_ADMIN_ORIGIN`: approved HTTPS origins;
- GitHub variable `STAGING_IMAGE_DIGESTS_JSON`: exactly `api`, `worker`, and
  `adminWeb` immutable image references;
- GitHub variable `STAGING_ROLLBACK_ARTIFACT`: prior-release rollback artifact
  reference;
- operator environment `TARGET_DATABASE_URL`: direct target connection used
  only through the staging tooling;
- operator environment `AGE_RECIPIENT`: public AGE recipient; the private
  identity is kept out of commands and evidence;
- operator environment `STAGING_OBJECT_ENDPOINT`, `STAGING_OBJECT_BUCKET`, and
  `STAGING_OBJECT_DESTINATION`: private backup destination values.

Install the checked-in toolchain before operator work: Node, Corepack/Yarn,
Docker Compose, PostgreSQL client tools, AGE, and the selected private
S3-compatible client. Capture versions in the operator record. The runbook
commands use `shell:false` wrappers where a staging script is involved.

## Local implementation evidence and current blockers

The following commands exercise repository tooling without staging credentials:

```bash
yarn test:staging-tools
node --test scripts/staging/compose-config.test.mjs
```

These checks do not establish external staging readiness. Current blockers
that MUST remain visible in the release decision are:

- the worker owns an internal `/metrics` endpoint and the API-to-worker
  application snapshot route is a private structured JSON `POST` on the worker:
  `APPLICATION_SNAPSHOT_TRANSPORT_PATH` (`/metrics/application-snapshot`).
  The staging API and worker MUST share the protected
  `WORKER_METRICS_TRANSPORT_TOKEN`; the API also requires the private
  `WORKER_METRICS_TRANSPORT_URL` and `API_METRICS_EVIDENCE_DIGEST`, while the
  worker requires `WORKER_METRICS_EVIDENCE_DIGEST` plus `RELEASE_VERSION`.
  Values MUST remain in the protected deployment secret/configuration store and
  MUST NOT appear in logs, metric output, or this repository;
- missing URL, transport token, API evidence digest, release metadata, or
  worker evidence digest leaves the API publisher unavailable or the worker
  snapshot incomplete, so `/metrics` remains non-success;
- API and worker share only the existing private `data` network for this
  transport. The worker declares no public ports and Caddy MUST NOT proxy the
  worker or either metrics route;
- The worker authoritative adapters and four concrete source providers are
  repository-complete: typed private HTTPS registry/feed transport plus
  PostgreSQL/PgBouncer, object-storage, backup/restore-evidence, and
  security-boundary providers are DI-wired, strict-schema validated, and
  fail-closed. The collector orchestrator performs an initial collection, then
  schedules a fixed 60-second collection and stops on shutdown. Missing
  protected inputs produce no fabricated observations;
- the source registry URL/protocol, protected source identifiers,
  credentials/workload identity/mTLS, exporter semantics, and target
  fingerprints/digests remain external inputs. No credentials or real
  endpoints were used. M-23 remains registry-bound and has no cryptographic
  target binding;
- the worker publishes its local application snapshot on the 30-second
  `APPLICATION_OBSERVATION_INTERVAL_SECONDS` interval. Commit `84edd67` adds
  the API publisher's initial non-blocking flush and fixed 30-second interval;
  each attempt has a 5-second timeout, single-flight state is retained until
  the underlying call settles after timeout, and shutdown drain registration
  waits for in-flight work while skipping new attempts;
- production binding hardening is recorded in commit `fd4d0aa`; it requires
  opaque API transport URL/token and API evidence digest plus worker transport
  token/evidence digest values without repository defaults;
- the typed provider and registry transport are implementation evidence only:
  the protected source registry URL/protocol, source identifiers,
  credentials/workload identity/mTLS, exporter semantics, target fingerprints
  and digests, and provider payloads are unavailable for bootstrap. The
  worker MUST NOT start with fake providers, inferred target values, or
  synthetic source observations;
- Staging and production Compose require the four opaque worker source-reference
  names plus the target-bound `WORKER_METRICS_TARGET_FINGERPRINT`; the protected
  staging environment must supply approved reference IDs, registry
  configuration, and fingerprint. This repository supplies no values,
  credentials, targets, or source payloads;
- the approved edge WAF/rate-limit control and the alert delivery route are not
  provisioned;
- no real staging environment, DNS, TLS certificate, Gmail SMTP OTP path,
  backup/restore rehearsal, alert delivery, UAT, identity approval, or
  location/roster approval has been observed;
- no production data, credentials, or real operational domains are present in
  this repository.

The workflow is the only protected path for runtime integration and smoke
qualification. It uses `.github/workflows/staging-readiness.yml`, the
immutable image references from `STAGING_IMAGE_DIGESTS_JSON`, and
`STAGING_SMOKE_SESSION_TOKEN` through `--session-token-env`. A missing runtime
collector or endpoint is a failed gate, not a reason to mark PASS manually.

## Worker readiness bootstrap smoke evidence (2026-10-05)

The disposable Docker/Linux real-entrypoint qualification is recorded in [`docs/superpowers/evidence/2026-10-05-worker-readiness.md`](../superpowers/evidence/2026-10-05-worker-readiness.md). It is implementation evidence only and does not change the repository decision: staging and production remain **CONDITIONAL / NO-GO**.

- With the valid disposable migration marker and database, `/health/live` returned HTTP 200 with startup checks not configured except `draining=ok`; `/health/ready` returned HTTP 200 with `environment=ok`, `database=ok`, `migration=ok`, `scheduler=ok`, and `draining=ok`, while `lastLoop=not_configured` remained diagnostic. This supersedes only the earlier source-wiring qualification that lacked the post-listen scheduler marker; it does not supersede the historical r5 image record.
- `/metrics` returned HTTP 503 because protected metrics authority inputs were unavailable. No synthetic snapshot, provider, target, credential, or health bypass was introduced.
- Missing and mismatched migration markers remained HTTP 503 with `migration=down`; stopping the disposable database after startup remained HTTP 503 with `database=down`; invalid OTP configuration exited before a listener; and the planned app-level collision exited with `EADDRINUSE`.
- The healthy-database SIGTERM supplement had pre-signal `/health/ready` HTTP 200 with all five gates `ok` and `lastLoop=not_configured`, then native SIGTERM exit 0. The listener closed before the post-signal curl could capture a response (exit 52, HTTP 000/empty reply); graceful shutdown completed, but no HTTP 503 was captured and no healthy 200→503 drain transition is claimed. The earlier database-down/draining sample remains a combined case.
- The smoke harness corrected the PostgreSQL initialization race by waiting on bounded TCP `psql -h 127.0.0.1 -U postgres -d imeal -v ON_ERROR_STOP=1 -c "SELECT 1;"`, rather than treating early `pg_isready` success as target-database readiness. Images were built through the genuine Dockerfiles without a host Yarn build.
- The final corrected run captured the exact PostgreSQL mount and removed only label-owned resources, including `docker rm --force --volumes`; final read-only verification found its containers, network, and images absent. The healthy-database supplement captured its own mount and likewise verified its worker, PostgreSQL container, network, and images absent. An earlier failed attempt left anonymous-volume identity unavailable from bounded Docker events, so this evidence does not claim every resource from every attempt was proven clean.
- The separate earlier debug cleanup proof records exact smoke-owned container/network names and labels and successful label-guarded removals, but its exact container ID was not retained. No later exact-ID or all-session cleanup claim is made.

No unit/e2e suite was run for this qualification. Protected environment values, source endpoints, target fingerprints, provider credentials, approval records, real metrics authority, DNS/TLS, alert delivery, and production approval remain external prerequisites.

## 1. Candidate, fingerprint, and migration status

Create a restricted evidence directory on a protected filesystem outside the
git checkout. Inject `RELEASE_COMMIT` as the exact reviewed checkout commit
SHA; the command below rejects an empty, malformed, or different checkout
commit before any release evidence is generated. The release-manifest command
checks that its `repository` is a clean worktree, so a repo-relative
`artifacts/` path is not acceptable for release evidence: generated manifests,
checksums, and rollback files must not make the checkout dirty. These are
synthetic identifiers; replace them with the approved release record without
exposing secrets:

```bash
export RELEASE_ID=imeal-20260928-001
export EVIDENCE_ROOT=/var/lib/imeal/staging-evidence
export EVIDENCE_DIR="$EVIDENCE_ROOT/$RELEASE_ID"
export TARGET_SCHEMA=phase0_staging_20260928
export TARGET_DATABASE_NAME=imeal_staging_20260928
export RESTORE_DATABASE=imeal_restore_20260928
export RESTORE_BUCKET=imeal-restore-20260928
: "${RELEASE_COMMIT:?inject exact reviewed checkout commit SHA}"
case "$RELEASE_COMMIT" in
  ''|*[!0-9a-fA-F]*)
    echo 'RELEASE_COMMIT must be hexadecimal' >&2
    exit 1
    ;;
esac
if [ "${#RELEASE_COMMIT}" -lt 7 ] || [ "${#RELEASE_COMMIT}" -gt 64 ]; then
  echo 'RELEASE_COMMIT length is invalid' >&2
  exit 1
fi


REPOSITORY_ROOT="$(git rev-parse --show-toplevel)"
if [ "$(git -C "$REPOSITORY_ROOT" rev-parse HEAD)" != "$RELEASE_COMMIT" ]; then
  echo 'checked-out commit does not match RELEASE_COMMIT' >&2
  exit 1
fi

case "$(realpath -m "$EVIDENCE_ROOT")" in
  "$REPOSITORY_ROOT"|"$REPOSITORY_ROOT"/*)
    echo 'EVIDENCE_ROOT must be outside the git checkout' >&2
    exit 1
    ;;
esac
umask 077
install -d -m 0750 "$EVIDENCE_DIR"
```

Inject the direct target connection as `TARGET_DATABASE_URL`; do not place its
value in a command line or report. Check migration status before any write:

```bash
DATABASE_URL="$TARGET_DATABASE_URL" \
  yarn workspace @imeal/core exec prisma migrate status \
  > "$EVIDENCE_DIR/migration-status.txt"
```

A clean migration status is required. A missing, failed, pending, unexpected,
or target-mismatched migration is an abort. The staging Compose migration gate
also requires `MIGRATION_TARGET_SCHEMA`, `MIGRATION_TARGET_IDENTITY`,
`MIGRATION_APPROVAL_ID`, `RELEASE_VERSION`, and
`MIGRATION_EVIDENCE_PATH`; the API and worker consume its read-only gate
marker only after the gate succeeds.

Run the read-only preflight against the exact target. It records the target
fingerprint, migration rows, SQL hash, seven named checks, status counts, and a
PASS/FAIL result without running the backfill:

```bash
node scripts/staging/phase0-preflight.mjs \
  --database-url-env TARGET_DATABASE_URL \
  --schema "$TARGET_SCHEMA" \
  --release-id "$RELEASE_ID" \
  --expected-database "$TARGET_DATABASE_NAME" \
  --output "$EVIDENCE_DIR/preflight-before.json"
```

Review the `targetFingerprint` in `preflight-before.json` against the intended
staging target. Write the reviewed fingerprint as
`target-fingerprint.json` using the controlled extraction below; it copies no
secrets and does not query or mutate the database:

```bash
node --input-type=module - \
  "$EVIDENCE_DIR/preflight-before.json" \
  "$EVIDENCE_DIR/target-fingerprint.json" <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
const [inputPath, outputPath] = process.argv.slice(2);
const report = JSON.parse(await readFile(inputPath, 'utf8'));
if (
  report.result !== 'PASS' ||
  typeof report.releaseId !== 'string' ||
  !report.targetFingerprint ||
  !report.target ||
  typeof report.target.database !== 'string' ||
  typeof report.target.schema !== 'string'
) {
  throw new Error('preflight target fingerprint is not a PASS record');
}
await writeFile(
  outputPath,
  `${JSON.stringify({
    result: 'PASS',
    releaseId: report.releaseId,
    target: report.target,
    targetFingerprint: report.targetFingerprint,
  }, null, 2)}\n`,
  { encoding: 'utf8', mode: 0o440 },
);
NODE
```

The operator records the target database, schema, server version, migration
rows, release ID, and the SHA-256 of every input/report in the decision record.
No row payloads are copied into evidence.

## 2. Encrypted backup and restore prerequisite

Complete the encrypted backup before approval or backfill. The endpoint,
bucket, and destination must be private staging-only references. The database
URL and AGE recipient are read from environment variables:

```bash
node scripts/staging/backup-staging.mjs \
  --database-url-env TARGET_DATABASE_URL \
  --schema "$TARGET_SCHEMA" \
  --release-id "$RELEASE_ID" \
  --object-endpoint "$STAGING_OBJECT_ENDPOINT" \
  --object-bucket "$STAGING_OBJECT_BUCKET" \
  --object-destination "$STAGING_OBJECT_DESTINATION" \
  --output "$EVIDENCE_DIR"
```

The command writes `backup-manifest.json` only after the target fingerprint,
custom-format dump, AGE encryption, private copy, byte count, and SHA-256
checksum pass. The plaintext dump must be removed. Review the manifest for
redaction, target identity, retention ownership, and measured timestamps.

Schedule and retain a restore rehearsal for the same target class. Restore
only to fresh isolated names containing a restore/rehearsal identifier:

```bash
node scripts/staging/restore-rehearsal.mjs \
  --manifest "$EVIDENCE_DIR/backup-manifest.json" \
  --restore-database "$RESTORE_DATABASE" \
  --restore-bucket "$RESTORE_BUCKET" \
  --output "$EVIDENCE_DIR/restore-rehearsal.json"
```

The rehearsal verifies the encrypted artifact checksum and bytes before AGE
decryption, restores PostgreSQL and object data to separate targets, checks the
`User` row count and migration status, runs readiness and smoke callbacks, and
records RPO/RTO. A missing or failed restore, checksum mismatch, RPO/RTO breach,
or leftover plaintext is an abort. Do not restore over the source target.

## 3. Phase 0 approval, backfill, and validation

Do not proceed when any preflight check or migration status is nonzero. An
independent approver creates `approval.json` after reviewing both the preflight
and backup manifest hashes. The approval is bound to this exact release and
target and contains `APPROVED_FOR_EXACT_BACKFILL`, a distinct rollback
authority, and an active rollback decision window. It is not generated by the
repository tooling.

Run the exact transactional backfill only after the backup and approval exist:

```bash
node scripts/staging/phase0-backfill.mjs \
  --database-url-env TARGET_DATABASE_URL \
  --schema "$TARGET_SCHEMA" \
  --approval "$EVIDENCE_DIR/approval.json" \
  --preflight "$EVIDENCE_DIR/preflight-before.json" \
  --backup-manifest "$EVIDENCE_DIR/backup-manifest.json" \
  --release-id "$RELEASE_ID" \
  --output "$EVIDENCE_DIR/backfill-result.json"
```

The backfill is safe to rerun only when its exact approval, target, and
preflight bindings still match. It is not a destructive down migration. If
writers, dirty checks, target identity, approval, or checksum validation fail,
stop and quarantine/remediate the target under the named authority.

Run post-backfill preflight and validate the two named constraints:

```bash
node scripts/staging/phase0-validate.mjs \
  --database-url-env TARGET_DATABASE_URL \
  --schema "$TARGET_SCHEMA" \
  --release-id "$RELEASE_ID" \
  --preflight-after-output "$EVIDENCE_DIR/preflight-after.json" \
  --output "$EVIDENCE_DIR/constraint-validation.json"
```

The command must produce PASS records for all seven checks, all four status
counts, the exact target fingerprint, and both named constraints. Keep the
before/after artifacts even on failure; never overwrite a failed record.

## 4. Protected staging Compose and deployment gate

The protected staging environment supplies a complete environment file at a
local path referred to here as `STAGING_ENV_FILE_PATH`. The file must contain
the approved immutable `API_IMAGE`, `WORKER_IMAGE`, and `ADMIN_WEB_IMAGE`
values matching `STAGING_IMAGE_DIGESTS_JSON`; other `_IMAGE` values must also
be digest-pinned. Do not print the file or its values.

Render the exact checked-in Compose pair before starting services:

```bash
docker compose --env-file "$STAGING_ENV_FILE_PATH" \
  -f docker-compose.yml \
  -f docker-compose.staging.yml \
  config --quiet
```

Deploy only after the release manager confirms the migration, backup, Phase 0,
security, and external network gates. The protected workflow performs an exact
pull and pinned Trivy scan of each `api`, `worker`, and `admin-web` digest before
this invocation:

```bash
docker compose --env-file "$STAGING_ENV_FILE_PATH" \
  -f docker-compose.yml \
  -f docker-compose.staging.yml \
  up --detach --wait --remove-orphans

docker compose --env-file "$STAGING_ENV_FILE_PATH" \
  -f docker-compose.yml \
  -f docker-compose.staging.yml \
  ps --all
```

Require `migrate` to complete successfully, API and worker readiness to pass,
Admin Web health to pass, and Caddy to expose only the approved HTTPS edge.
The staging overlay keeps database, PgBouncer, MinIO, and worker internals off
the public edge and forces application authentication on. Capture the workflow
artifact bundle named `staging-release-<release-id>`; its deployed-image SBOM
index is `deployed-image-sbom-index.json`.

## 5. Smoke, runtime integration, WAF, and alert delivery

The package command invokes the checked-in `scripts/staging/smoke-staging.mjs`
CLI:

```text
scripts/staging/smoke-staging.mjs
```

Run network smoke only against the approved HTTPS origins. The token is read by
name from the protected environment and never placed in the command line,
report, or logs:

```bash
yarn staging:smoke \
  --api-origin "$STAGING_API_ORIGIN" \
  --admin-origin "$STAGING_ADMIN_ORIGIN" \
  --session-token-env STAGING_SMOKE_SESSION_TOKEN \
  --output "$EVIDENCE_DIR/smoke-infrastructure.json"
```

This runner checks exactly `https-redirect` (PASS, or SKIP only in explicit local
test mode), `api-live`, `api-ready`, `admin-health`, and
`safe-error-envelope`, plus optional `auth-me` when a session token is supplied.
Every required check must PASS; arbitrary check names and omitted required
checks are invalid. Its business workflow field remains `NOT_RUN`. Operators
must provide separately reviewed, target-bound PASS artifacts named
`smoke-auth-rbac.json`, `smoke-business.json`, `smoke-mobile-admin.json`, and
`smoke-worker.json` for the corresponding identity, business, client, and
worker paths. Do not turn local test mode into staging evidence.

### 5.1 Mobile platform boundary (Phase A6)

Staging and production support native Android and iOS builds only. Expo Web is
not a supported client and must not be used as mobile release evidence; local
Expo Web/Metro checks are limited to development and UI compatibility. The API
does not enable browser CORS for this unsupported surface. Before treating the
mobile qualification lanes as native release evidence, a later qualification
maintenance change must remove any web-bundle assertions from those lanes.

If product scope changes and Expo Web becomes required, stop native-only
qualification and add an explicit production-origin allowlist, browser preflight
handling, and an `OPTIONS /auth/otp/request` regression check before approval.

### 5.2 Current Staff self check-in qualification (external UAT gate)

The following checklist is required for the current cutover and is **not**
evidence that staging has been provisioned. Each box must be independently
observed against the target release and recorded in the target-bound
`smoke-business.json`/`smoke-mobile-admin.json` artifacts. Never mark a box
PASS from a local seed, a mocked provider, a guessed endpoint or source review.

- [ ] Product operations provision approved staging identities, `staff` and
      `kitchen` roles, `kitchen.serve`, active roster/location assignments, menus
      and registrations; record the approval outside this repository.
- [ ] Kitchen `GET /api/kitchen/check-in/qr` returns the same stable day/location
      QR on repeated reads, exposes only server `date`/`location`/window metadata,
      and contains no employee identity. Confirm it is not a rotating per-Staff QR.
- [ ] Staff `GET /api/me/check-in` shows the authenticated caller's own
      registration/status only. Staff scans the shared Kitchen QR and
      `POST /api/me/check-in/resolve` accepts a fresh foreground GPS sample and
      returns only that caller's normalized registration/menu/location/eligibility;
      when eligible it persists a `VALID` `ServingVerification` and returns a
      scoped opaque `intentNonce` bound to caller/session/registration/location,
      nullable when `eligibility=false`.
- [ ] Staff reviews the result, captures a **new** fresh foreground GPS sample,
      and `POST /api/me/check-in/confirm` with the same `sessionId`, non-empty
      `intentNonce` and unique idempotency key; confirm validates the persisted
      verification and returns `CHECKED_IN` plus one
      `registrationId`/`servingId`/`servedAt`.
- [ ] Retry the same confirm after an intentionally lost/timeout response;
      verify the same caller/key/body replays safely or `GET /api/me/check-in`
      reconciles to `CHECKED_IN`, with no second `MealServing`.
- [ ] Independently exercise wrong/expired QR, no own registration, canceled
      registration, already checked-in, outside window, wrong location and each
      GPS failure (`GPS_REQUIRED`, `GPS_STALE`, `GPS_INACCURATE`,
      `OUTSIDE_GEOFENCE`) and capture the canonical safe recovery behavior.
- [ ] Kitchen `GET /api/kitchen/check-in/dashboard?date=YYYY-MM-DD` returns
      aggregate-only counts and `lastUpdated`; verify focused/foreground polling
      every 10 seconds, immediate refresh on re-entry, normal visible convergence
      within approximately 15 seconds under healthy polling, and indefinite
      retention/`stale` marking of the last good snapshot after a refresh failure.
- [ ] Confirm there is no Kitchen employee scanner, employee search/list,
      per-person serving log, delegation/proxy check-in or SSE/WebSocket
      requirement in the current staging surface.
- [ ] Verify `MealServing.registrationId` is the unique canonical outcome
      source, concurrent/retried confirm creates at most one serving, historical
      pickup/delegation tables remain retained/readable, and raw GPS coordinates
      do not appear in logs or evidence.

Until every applicable box has target-bound evidence and independent review,
the staging qualification remains **CONDITIONAL / NO-GO**.
The protected workflow invokes `runRuntimeIntegration` from
`scripts/staging/runtime-integration.mjs` after deployment and before it records
`runtimeIntegration: PASS`. A qualification PASS requires API and worker live
and readiness endpoints to return HTTP 200 with body `status: "ok"` and the
expected release marker; HTTP 503 readiness is a failed gate, not a diagnostic
PASS. It must also observe the actual hardening endpoints. This repository
contains the worker `/metrics` endpoint, private Compose isolation, and the
typed strict-schema/fail-closed source providers, but no external source
registry inputs, source observations, or target bindings are provisioned; that
gate MUST remain FAIL until the deployed sources and their redacted evidence
exist.

Before sign-off, the network owner must prove the approved edge WAF and
rate-limit policy, trusted-proxy/client-IP handling, TLS certificate and
redirect, and an alert route that reaches the named on-call destination. Record
only redacted results in `observability-alert-test.json`: it must bind the
exact release and target, use `runtime-integration.json` as the approved metric
snapshot artifact, record that artifact's SHA-256 provenance, and carry a
`snapshotDigest` equal to `runtime-integration.json.evidence.metricsSnapshotDigest`
computed from the fetched worker metrics body. It must also name an approved source identity
with `fresh` freshness and include an explicit acknowledgement, route,
destination, and canonical `observedAt`.
The snapshot digest must equal the worker metrics body hash; the verifier never creates an acknowledgement. Stale, unknown, `collector_failure`, missing,
conflicting, or unsafe fields fail closed. The alert route is an external
prerequisite and there is no repository command
that can manufacture this evidence. Missing WAF/rate-limit approval or
missing alert delivery is a NO-GO.

## 6. Evidence bundle, checksums, and sign-off

The release evidence directory must contain exactly the target-bound,
redacted artifacts consumed by `scripts/staging/evidence.mjs`:

```text
release-manifest.json
target-fingerprint.json
migration-status.txt
preflight-before.json
backup-manifest.json
approval.json
backfill-result.json
preflight-after.json
constraint-validation.json
restore-rehearsal.json
smoke-infrastructure.json
smoke-auth-rbac.json
smoke-business.json
smoke-mobile-admin.json
smoke-worker.json
observability-alert-test.json
runtime-integration.json
staging-smoke.json
checksums.txt
signoff.json
```

`runtime-integration.json` and `staging-smoke.json` are required PASS phase
artifacts in every evidence bundle. They are checksum inputs and must carry
the exact release and target bindings. Runtime evidence must show API and worker
live/readiness HTTP 200, internal-only metrics, `metricsSnapshotSource:
worker-internal`, and a SHA-256 `metricsSnapshotDigest` computed from the fetched
worker metrics body. Staging smoke evidence must
carry HTTPS origin fields, at least one named PASS check, and a `NOT_RUN`
business workflow marker. A missing or mismatched field, failed/unknown result,
missing migration clean marker, or malformed target fingerprint fails closed. The
protected workflow emits references named
`deployed-image-sbom-index.json` and the per-service deployed-image SBOMs.
These are references, not local evidence files, until an approved artifact
download/provisioning step places them under `$EVIDENCE_DIR` and verifies their
release/target binding. Do not claim that a referenced file exists merely
because its path appears in a manifest.

The final protected workflow upload also includes `images.json` and
`release-version.txt`; the operator must review both against the exact workflow
run, reviewed commit, and deployment target before provisioning them.

Before generating the manifest, require the protected inputs directory and an
explicit operator review marker:

```bash
: "${PROTECTED_RELEASE_INPUTS_DIR:?inject the external protected release inputs directory}"
: "${PROTECTED_RELEASE_INPUTS_REVIEWED:?set only after reviewing exact release and target binding}"
test "$PROTECTED_RELEASE_INPUTS_REVIEWED" = reviewed
PROTECTED_INPUTS_REALPATH="$(realpath -m "$PROTECTED_RELEASE_INPUTS_DIR")"
case "$PROTECTED_INPUTS_REALPATH" in
  "$REPOSITORY_ROOT"|"$REPOSITORY_ROOT"/*)
    echo 'protected release inputs must be outside the git checkout' >&2
    exit 1
    ;;
esac
test -d "$PROTECTED_INPUTS_REALPATH"
```

The operator review must confirm that this directory came from the exact
protected `staging-release-<release-id>` workflow artifact/run and commit, that
`release-version.txt` matches the reviewed release identity, that the
deployment target and release ID match this evidence directory, and that the
image/check results and runtime/SBOM/smoke files are from that same run.
Do not continue, and record an abort, if the review cannot establish those
bindings. The marker does not create evidence; it records the completed
out-of-band review.

Install every protected input needed by the manifest references. Each source
must be a non-symlink regular file; any missing or non-regular source aborts
before manifest generation. The loop emits no source values or file contents:

```bash
protected_inputs=(
  'images.json:images.json'
  'check-results.json:check-results.json'
  'release-version.txt:release-version.txt'
  'runtime-integration.json:runtime-integration.json'
  'staging-smoke.json:artifacts/staging-smoke.json'
  'deployed-image-sbom-index.json:artifacts/deployed-image-sbom-index.json'
  'deployed-image-sbom-api.spdx.json:artifacts/deployed-image-sbom-api.spdx.json'
  'deployed-image-sbom-worker.spdx.json:artifacts/deployed-image-sbom-worker.spdx.json'
  'deployed-image-sbom-admin-web.spdx.json:artifacts/deployed-image-sbom-admin-web.spdx.json'
)
install -d -m 0750 "$EVIDENCE_DIR/artifacts"
for mapping in "${protected_inputs[@]}"; do
  source_name="${mapping%%:*}"
  destination_name="${mapping#*:}"
  source_path="$PROTECTED_INPUTS_REALPATH/$source_name"
  destination_path="$EVIDENCE_DIR/$destination_name"
  if [ ! -f "$source_path" ] || [ -L "$source_path" ]; then
    echo 'required protected release input is absent or not a regular file' >&2
    exit 1
  fi
  install -m 0440 "$source_path" "$destination_path" >/dev/null 2>&1 || {
    echo 'protected release input installation failed' >&2
    exit 1
  }
  if [ ! -f "$destination_path" ] || [ -L "$destination_path" ]; then
    echo 'installed protected release input is not a regular file' >&2
    exit 1
  fi
done
```

Only after all nine inputs are installed may the operator describe the
release-version, runtime integration, smoke, SBOM index, and per-service SBOM
references as provisioned files. A reference without a provisioned source is
an abort; do not substitute a locally generated or guessed file.

Before generating the manifest or checksums, provision the approved prior
rollback artifact from the named out-of-band source. The source path and
expected SHA-256 are injected by the rollback authority; no source value is
written to the runbook or evidence:

```bash
: "${PRIOR_ROLLBACK_ARTIFACT_SOURCE:?inject the approved external rollback source path}"
: "${PRIOR_ROLLBACK_ARTIFACT_SHA256:?inject the approved rollback SHA-256}"
if [ -L "$PRIOR_ROLLBACK_ARTIFACT_SOURCE" ]; then
  echo 'rollback source must not be a symlink' >&2
  exit 1
fi
SOURCE_REALPATH="$(realpath -m "$PRIOR_ROLLBACK_ARTIFACT_SOURCE")"
case "$SOURCE_REALPATH" in
  "$REPOSITORY_ROOT"|"$REPOSITORY_ROOT"/*)
    echo 'rollback source must be outside the git checkout' >&2
    exit 1
    ;;
esac
test -f "$SOURCE_REALPATH"
install -d -m 0750 "$EVIDENCE_DIR/rollback"
install -m 0440 \
  "$SOURCE_REALPATH" \
  "$EVIDENCE_DIR/rollback/previous-release.tar"
test -s "$EVIDENCE_DIR/rollback/previous-release.tar"
printf '%s  %s\n' \
  "$PRIOR_ROLLBACK_ARTIFACT_SHA256" \
  "$EVIDENCE_DIR/rollback/previous-release.tar" |
  sha256sum --check --strict -
```

Only after that command succeeds may the operator claim that
`$EVIDENCE_DIR/rollback/previous-release.tar` is provisioned. A missing source,
unexpected source location, empty file, or checksum mismatch is an abort.

The command is implemented by the checked-in
`scripts/staging/release-manifest.mjs` CLI.

The release manifest is generated only after all required checks are PASS and
its image/migration/lockfile references have been reviewed:

```bash
yarn staging:manifest \
  --release-id "$RELEASE_ID" \
  --commit "$RELEASE_COMMIT" \
  --images-json "$EVIDENCE_DIR/images.json" \
  --checks-json "$EVIDENCE_DIR/check-results.json" \
  --rollback-artifact rollback/previous-release.tar \
  --output "$EVIDENCE_DIR/release-manifest.json"
```

`images.json` must contain the exact immutable `api`, `worker`, and `adminWeb`
references. `check-results.json` must contain PASS for typecheck, lint, unit,
Prisma, database, Compose, staging tools, security, runtime integration, and
staging smoke; `sbom` and the smoke reference remain artifact references. The
manifest command rejects mutable references and secret-like values.

After an independent reviewer confirms the complete bundle, create checksums
with the repository evidence command. It refuses an incomplete bundle, failed
status, target mismatch, missing rollback artifact, or mismatched checksum:

```bash
node scripts/staging/evidence.mjs \
  --release-id "$RELEASE_ID" \
  --target "$TARGET_SCHEMA" \
  --artifacts "$EVIDENCE_DIR" \
  --write-checksums
```

The operator then writes `signoff.json` with `result: "PASS"`,
`decision: "REVIEWED"`, distinct non-secret `operator` and `reviewer` names,
`releaseId`, exact target, and an ISO `signedAt`. `approval.json` and
`signoff.json` are separate records; approval grants the exact backfill, while
sign-off reviews the complete release evidence. A missing or duplicate identity
is a failure.

## 7. Abort, restore, and rollback

Abort without manual override for a target mismatch, dirty preflight check,
unclean migration, missing approval, backup or restore failure, image scan
finding, failed readiness/smoke/runtime integration, WAF or alert prerequisite
failure, secret-bearing evidence, checksum mismatch, or any UAT/identity/
location approval gap. Preserve redacted logs and reports and notify the release
manager and platform security.

Before deployment, no application writer may run after an abort. After a
failed deployment, keep the failed evidence bundle, stop the isolated Compose
services without deleting retained evidence, and quarantine the target. The
rollback authority chooses one of these reviewed actions:

1. restore the approved backup into the isolated restore target using
   `scripts/staging/restore-rehearsal.mjs`, then re-run migration/readiness and
   smoke checks; or
2. redeploy the prior immutable image digest and matching reviewed migration
   state from the rollback artifact, followed by readiness and smoke checks.

Never perform a down migration, overwrite an unknown target, or substitute a
legacy data provider for a PostgreSQL restore. A rollback is not complete until
its target fingerprint, image references, measured RPO/RTO, readiness/smoke
results, checksums, decision window, and independent reviewer are recorded.

## 8. Canonical CI entry point and closeout

The checked-in protected workflow is
`.github/workflows/staging-readiness.yml`. It runs immutable source checks,
database checks, Compose boundary validation, dependency and image security
checks, source secret scanning, SBOM generation, exact protected deployment
digest scanning, runtime integration, token-backed smoke, release manifest
creation, artifact upload, and disposable service teardown. CI PASS is not a
substitute for the external staging approvals listed above.

The release manager closes the gate only when all required artifacts and
checksums are present, the independent approval and sign-off are distinct and
valid, WAF/rate-limit and alert delivery are observed, runtime integration is
PASS on a deployed implementation, backup restore is rehearsed, and UAT,
identity, roster, location, DNS, TLS, and OTP owners have signed. Until then,
record **CONDITIONAL / NO-GO** and keep the rollback decision window open.
