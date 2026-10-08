# IMeal staging readiness design

**Status:** Design only. This document defines the staging qualification and release-evidence architecture; it does not authorize production deployment and does not change runtime code or configuration.

**Date:** 2026-09-28

## 1. Decision summary

Staging is a controlled, production-like environment with a separate PostgreSQL database, separate object storage bucket, and a dedicated staging Gmail/Workspace mailbox with a worker-only App Password; no shared operator or OTP credentials are used with production. The release candidate is promoted by immutable image digest and a checked-in migration set, not by rebuilding an untracked working tree on the host.

The migration workflow is target-safe and approval-gated:

```text
candidate + immutable artifact
  -> migration status / schema assertion
  -> read-only preflight
  -> independent approval record
  -> exact transactional backfill (only if approved)
  -> read-only post-backfill preflight
  -> named constraint validation
  -> focused database/application verification
  -> end-to-end smoke
  -> staging sign-off
```

A nonzero preflight result, target mismatch, missing backup, failed validation, failed smoke, or missing independent approval aborts the sequence. There is no destructive down migration and no Firebase rollback path. Recovery is an approved PostgreSQL/object-storage restore or rollback to the prior compatible application artifact.

The current repository already provides the migration SQL, startup environment validators, focused domain/API/worker suites, local-only seed safety, a private worker `/metrics` endpoint, and a candid NO-GO assessment. It does not yet provide external authoritative metric collectors/source bindings, the staging wrapper scripts, CI workflow, backup job, or external approval records described here.

## 2. Goals

1. Prove that a release candidate can be installed in a clean, isolated staging target using the checked-in Yarn lockfile, Docker images, Prisma migrations, and runtime environment contract.
2. Safely qualify the Phase 0 domain-correctness migration against an approved representative target without guessing, fabricating, or silently rewriting legacy data.
3. Rehearse PostgreSQL and object-storage backup/restore, record measured RPO/RTO, and prove that restore is usable by the application.
4. Exercise API, worker, Admin Web, mobile, OTP, registration, pickup, serving, no-show/penalty, notification, and recovery paths with authorized synthetic or approved staging identities.
5. Provide structured, redacted evidence that an independent reviewer can reproduce and sign off.
6. Define observability, alert thresholds, ownership, escalation, and operator prerequisites before a pilot gate.

## 3. Non-goals

- This design does not provision real locations, employees, roster assignments, allowlist records, first-Admin access, provider accounts, DNS, certificates, signing keys, or cloud resources.
- It does not modify `docker-compose.yml`, `Caddyfile`, application source, Prisma schema/migrations, package scripts, mobile metadata, or CI configuration.
- It does not make local synthetic seed data production data. The workflow in `packages/domain/src/local-seed` remains local/dev/test/UAT only.
- It does not define a Firebase migration, dual-write, data reconciliation, or Firebase rollback path.
- It does not replace application feature qualification. Known product gaps in `docs/imeal-production-readiness-assessment.md` remain release gates.
- It does not prescribe Kubernetes, Redis, Kafka, or horizontal scaling for the 200–300-user baseline.

## 4. Existing repository contracts and evidence

### 4.1 Runtime topology

The intended topology is mobile/Admin Web/Kitchen client -> reverse proxy -> API -> PostgreSQL/PgBouncer, with worker scheduled jobs and OTP/object-storage egress. The canonical requirements are in `docs/02-technical-requirements.md:7-45,148-175,216-257` and `docs/README.md:79-94`.

Current deployment inputs and their design implications:

| File | Existing contract | Staging consequence |
| --- | --- | --- |
| `docker-compose.yml:1-250` | PostgreSQL 15, PgBouncer, MinIO, one-shot `migrate`, API, worker, Admin Web and Caddy | A production/staging override is required before public exposure; internal ports, image tags, TLS and bucket policy must be hardened. |
| `Caddyfile:1-18` | HTTP listener, API/storage path routing, Admin Web fallback | Staging must use an owned HTTPS hostname and must not expose storage anonymously. |
| `apps/api/Dockerfile:1-16` | Node 24, Yarn 4.18, Prisma 7.10 generate, API build | Build output must be produced from an immutable source/artifact and runtime secrets must stay out of the image. |
| `apps/worker/Dockerfile:1-16` | Same build baseline for worker | Worker artifact must carry the same domain/contracts migration compatibility as API. |
| `apps/admin-web/Dockerfile:1-11` | Vite build followed by Nginx static serving | Compose must explicitly select this Dockerfile. `VITE_API_URL` is a build-time public value. |
| `apps/mobile/app.config.ts:1-28` | Expo config and optional `EXPO_PUBLIC_EAS_PROJECT_ID` | Production-like staging requires a provisioned EAS project/release build or a documented device test build. |
| `apps/mobile/src/api/apiConfig.ts:47-66` | Explicit URL required outside development; LAN discovery only for development | Device smoke must use an HTTPS staging API origin and must never depend on localhost discovery. |

### 4.2 Environment validation

API startup validation is in `apps/api/src/config/environment.ts:79-147`: it requires authenticated OTP mode, database/signing/session/OTP secrets, numeric limits, GPS bounds and fixed Vietnam-time/QR/session invariants. The worker validator is in `apps/worker/src/otp-delivery-worker.service.ts:268-313` and additionally requires production database/Gmail SMTP/delivery retry settings and fixed operational values.

The staging contract deliberately runs the server processes with `NODE_ENV=production` to exercise production validation, while a separate deployment label identifies the environment:

```dotenv
NODE_ENV=production
DEPLOY_ENV=staging
AUTH_MODE=otp
REQUIRE_AUTH=true
```

`DEPLOY_ENV` is an operator/deployment label, not an authorization input. It must never enable a bypass. The only bypass remains the exact test pair `NODE_ENV=test` and `REQUIRE_AUTH=false`, as documented in `docs/local-role-testing.md:9-20,121-146`.

### 4.3 Database migration surface

Prisma schema and migrations are checked in under `packages/domain/prisma/schema.prisma` and `packages/domain/prisma/migrations`. The Phase 0 migration is explicitly additive (`20260928000000_phase0_domain_correctness/migration.sql:1-4`), while its preflight and backfill are separate files. The preflight is read-only and bounded (`preflight.sql:1-11,252-313`); the backfill is transactional, exact-one-to-one and repeatable (`backfill.sql:1-7`). The migration adds `NOT VALID` checks (`migration.sql:70-92,113-115`) so validation is intentionally a later gate.

The Compose `migrate` service currently only invokes `prisma migrate deploy` (`docker-compose.yml:86-97`). The design below keeps expansion and data correction separate rather than hiding a backfill inside Prisma migration deployment.

## 5. Staging environment contract

### 5.1 Isolation and ownership

Staging MUST have:

- A distinct Linux host or isolated VM/network segment, distinct database and database credentials, and a named technical owner.
- A distinct object-storage endpoint/bucket and access key. The bucket MUST be private; public anonymous access is not acceptable.
- A dedicated staging Gmail/Workspace mailbox with a Google App Password injected into the worker, an approved sender, and a documented delivery/support owner. The mailbox and App Password MUST be distinct from production.
- A staging HTTPS hostname and certificate trusted by the target Android/iOS/browser devices.
- No public PostgreSQL, PgBouncer, MinIO API, MinIO console, worker, or internal admin ports. Only the reverse proxy is internet-facing.
- Resource capacity representative of the proposed baseline (recommended 4 vCPU, 8 GB RAM, 100 GB SSD) and disk monitoring.
- Time synchronization and a declared host timezone. Business calculations remain `Asia/Ho_Chi_Minh`; timestamps remain UTC instants.
- A separate secret manager namespace or protected host environment. Values MUST NOT be committed, printed in CI, stored in evidence artifacts, or copied from production.

### 5.2 Server variables

The exact names are governed by `.env.example:5-76` and `docs/02-technical-requirements.md:226-256`. The staging secret manifest records names, source, owner, rotation date and validation status, never values.
The worker's authoritative metric source bindings are opaque deployment references:
`WORKER_METRICS_POSTGRES_SOURCE`,
`WORKER_METRICS_OBJECT_STORAGE_SOURCE`,
`WORKER_METRICS_BACKUP_EVIDENCE_SOURCE`, and
`WORKER_METRICS_SECURITY_BOUNDARY_SOURCE`. Staging and production Compose
require each reference; protected deployment environments must supply approved
opaque reference IDs. This repository supplies no values, credentials, URLs,
targets, or source payloads, and absent bindings remain fail-closed.

**API required:** `DATABASE_URL`, `AUTH_MODE`, `REQUIRE_AUTH`, `QR_SIGNING_SECRET`, `OTP_HASH_SECRET`, `OTP_DELIVERY_ENCRYPTION_KEY`, all `OTP_*` expiry/rate values, `SESSION_HASH_SECRET`, both session timeout values, all `GPS_DEFAULT_*` values, and the fixed `SERVING_*`, `NO_SHOW_PROCESSING_TIME`, `QR_*`, `PICKUP_SESSION_TTL_SECONDS` values. The API does not receive SMTP credentials or provider API keys.

**Worker required:** `DATABASE_URL`, `OTP_DELIVERY_ENCRYPTION_KEY`, `OTP_SMTP_USERNAME`, `OTP_SMTP_PASSWORD` (a Gmail App Password), `OTP_SMTP_FROM`, optional `OTP_SMTP_FROM_NAME`, every `OTP_DELIVERY_*` batch/retry/claim value, and the same fixed serving/QR/session values. `OTP_SMTP_HOST` and `OTP_SMTP_PORT` default to `smtp.gmail.com:587` with STARTTLS.

**Database/storage:** `POSTGRES_*`, `MINIO_ROOT_*`, `MINIO_BUCKET_NAME`, and service-specific runtime connection strings are injected only into the service that needs them. Migration connectivity MUST use the direct PostgreSQL endpoint; API/worker runtime MAY use PgBouncer transaction pooling as already modeled in `docker-compose.yml:94,108,168`.

**Clients:**

- Mobile build: `EXPO_PUBLIC_API_URL=https://<approved-staging-api>/api`; never expose database/provider/session/GPS secrets.
- Remote Metro is development-only (`EXPO_PACKAGER_PROXY_URL`) and is not a staging production artifact.
- Admin Web: `VITE_API_URL` is the approved staging API origin or same-origin path; it MUST NOT be `localhost` in a staging image.
- Push: `EXPO_PUBLIC_EAS_PROJECT_ID` must identify the approved non-production EAS project.

### 5.3 Network and proxy requirements

Caddy MUST terminate HTTPS, redirect HTTP, set a strict security-header policy, preserve a validated request ID, and apply edge rate limits to OTP and authenticated mutations. The API MUST configure a trusted proxy boundary so rate-limit client IP and audit metadata cannot be spoofed by arbitrary headers. CORS MUST be an explicit allowlist for any cross-origin staging Admin/Web topology; same-origin deployment is preferred.

The external API readiness path MUST be intentional. The current Caddy routing does not match `/health` (`Caddyfile:6-18`), so the staging contract uses a dedicated public-safe `/healthz` or an explicitly routed API readiness path. It returns no secret or database error detail.

## 6. Target-safe migration and approval runbook

### 6.1 Roles

- **Release engineer:** builds the candidate, runs checks, captures artifacts, and cannot approve their own data backfill.
- **Data owner/DBA:** reviews preflight rows, confirms target identity and backup, approves or rejects backfill.
- **Application owner:** confirms compatibility, smoke results and rollback artifact.
- **Operations/on-call owner:** confirms monitoring, alert delivery and recovery contacts.
- **Independent approver:** records the approval ID and decision after inspecting the redacted preflight and backup evidence.

The target name, schema name, release ID, commit SHA, migration list, operator and approver are mandatory in every report.

### 6.2 Preconditions

Abort before touching the target if any precondition fails:

1. The target is not an explicitly approved staging/disposable database, or the connection host/database/schema does not match the allowlisted target manifest.
2. The release commit, lockfile hash, image digests or migration directory differ from the reviewed candidate.
3. `prisma migrate status` is not clean, a migration is missing/failed, or the database is ahead/behind unexpectedly.
4. The target-safe backup has not completed, has no checksum/retention metadata, or a restore rehearsal for the target class is missing.
5. API/worker writers are still active during a backfill window, unless the reviewed procedure explicitly proves compatibility and lock behavior.
6. Any secret, OTP code, real email, employee/location PII or raw coordinate would be copied into logs or artifacts.

Before the first read, capture the target fingerprint using a restricted database account:

```bash
export TARGET_DATABASE_URL='postgresql://<staging-direct-endpoint>/<db>?sslmode=require'
export TARGET_SCHEMA='phase0_<approved-target>'

psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v target_schema="$TARGET_SCHEMA" \
  -c "SELECT current_database(), current_user, current_schema(), version();"
```

The implementation MUST validate `TARGET_SCHEMA` as a simple identifier and use an explicit `search_path`; it MUST NOT interpolate arbitrary shell input into SQL. The output is redacted to database host, database name, schema and server version as permitted by policy.

### 6.3 Expand and migration status

Build and install the reviewed candidate, then run the existing migration interface against the direct PostgreSQL endpoint:

```bash
yarn install --immutable
yarn workspace @imeal/core exec prisma validate
yarn workspace @imeal/core exec prisma generate
DATABASE_URL="$TARGET_DATABASE_URL" \
  yarn workspace @imeal/core exec prisma migrate deploy
DATABASE_URL="$TARGET_DATABASE_URL" \
  yarn workspace @imeal/core exec prisma migrate status
```

In Compose, the equivalent existing gate is:

```bash
docker compose run --rm migrate \
  yarn workspace @imeal/core prisma migrate status
```

`migrate deploy` is expansion only. It MUST NOT be treated as evidence that the Phase 0 data is complete or that `NOT VALID` checks are validated.

### 6.4 Read-only preflight

The proposed operator wrapper is `scripts/staging/phase0-preflight` (implementation not included in this design turn). Its interface is:

```text
phase0-preflight \
  --database-url-env TARGET_DATABASE_URL \
  --schema TARGET_SCHEMA \
  --release-id RELEASE_ID \
  --output artifacts/<release>/<target>/preflight.json
```

The wrapper MUST:

- Refuse non-approved target fingerprints and invalid schema names.
- Open a read-only transaction with `ON_ERROR_STOP=1`, a bounded statement timeout and explicit search path.
- Assert `current_schema()` equals the approved schema before running SQL.
- Run `packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/preflight.sql` unchanged or via a reviewed, hash-identified copy.
- Preserve every named check and every status count, including sample IDs only when the evidence policy permits redacted identifiers.
- Record migration table state, row counts, database/schema fingerprint and script SHA-256.
- Never write, lock rows for update, run backfill, or create operational data.

The result is **PASS** only when all named affected counts and all required status/mismatch counts are zero, the target identity matches, and the report is independently reviewable. Any nonzero result is a hard abort, including ambiguous roster assignments, incomplete menu revisions, serving mismatches, duplicate penalty candidates, or future active snapshot defects.

### 6.5 Approval record

The independent approver creates an immutable, signed or access-controlled record:

```json
{
  "approvalId": "<uuid>",
  "releaseId": "<release-id>",
  "target": {"database": "<redacted>", "schema": "<schema>"},
  "preflightSha256": "<sha256>",
  "backupManifestSha256": "<sha256>",
  "decision": "APPROVED_FOR_EXACT_BACKFILL",
  "scope": "phase0_domain_correctness",
  "approvedAt": "<utc>",
  "approver": "<operator-id>",
  "rollbackAuthority": "<owner-id>",
  "rollbackDecisionWindow": "<utc interval>"
}
```

An approval is scoped to one release, database and schema. It expires if the candidate, target, preflight output, data, backup or scope changes. A zero-row report alone is not approval.

### 6.6 Exact backfill

The proposed wrapper is `scripts/staging/phase0-backfill`:

```text
phase0-backfill \
  --database-url-env TARGET_DATABASE_URL \
  --schema TARGET_SCHEMA \
  --approval-id APPROVAL_ID \
  --input artifacts/<release>/<target>/preflight.json \
  --output artifacts/<release>/<target>/backfill.json
```

It MUST verify the approval ID, preflight hash, target fingerprint and release ID before invoking the reviewed SQL:

```bash
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v target_schema="$TARGET_SCHEMA" \
  -f packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/backfill.sql
```

Operational controls:

- Stop API and worker writers, or use a documented maintenance mode that guarantees no conflicting writes.
- Set a bounded lock/statement timeout and capture transaction start/end times.
- Run exactly one transaction. The script must remain repeatable; a retry is allowed only after confirming transaction rollback and target state.
- Capture update counts and transaction outcome without logging row contents or secrets.
- Do not alter rows outside the documented registration/menu/penalty snapshot fields.
- Do not fabricate locations, assignments, menu revisions, owner snapshots, coordinates or historical timestamps.

Any timeout, lock failure, unexpected update count, connection loss, deadlock, approval mismatch or partial transaction is an abort. Restore is preferred over an ad-hoc manual repair when the target state cannot be proven unchanged.

### 6.7 Post-backfill checks and validation

Run the same target-safe preflight again and require all checks to be zero. Then validate the named constraints only after preflight passes:

```bash
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v target_schema="$TARGET_SCHEMA" <<'SQL'
SET LOCAL statement_timeout = '30s';
ALTER TABLE "registrations"
  VALIDATE CONSTRAINT "registration_lifecycle_snapshot_complete";
ALTER TABLE "registrations"
  VALIDATE CONSTRAINT "registration_serving_consistency";
SELECT conname, convalidated
FROM pg_constraint
WHERE conname IN (
  'registration_lifecycle_snapshot_complete',
  'registration_serving_consistency'
)
ORDER BY conname;
SQL
```

The exact SQL must be run through the same schema-safe wrapper in implementation. A result is PASS only if both named constraints return `convalidated=true`, the post-preflight is zero, the migration table is complete, and focused verification passes. Do not claim a down migration; the rollback path is prior compatible application artifact plus approved backup restore.

## 7. Backup and restore rehearsal

### 7.1 Backup contract

Before every staging migration/backfill rehearsal:

1. Quiesce writes or use a transaction-consistent backup procedure.
2. Capture PostgreSQL in a restorable format with ownership/privilege policy documented.
3. Capture MinIO/object-storage data and metadata separately.
4. Encrypt at rest, write to storage physically/logically separate from the primary, and record retention and access owner.
5. Generate SHA-256 checksums and a manifest containing source fingerprint, start/end UTC, release ID, schema, object count/size and tool versions.
6. Never put connection strings, secret values, OTP codes, raw PII or provider payloads in the manifest.

A representative logical backup command for the current PostgreSQL stack is:

```bash
pg_dump "$TARGET_DATABASE_URL" \
  --format=custom --no-owner --no-privileges \
  --file artifacts/<release>/<target>/postgres.dump
sha256sum artifacts/<release>/<target>/postgres.dump \
  > artifacts/<release>/<target>/postgres.dump.sha256
```

The approved implementation may use managed/physical backup instead, but it must produce equivalent integrity, retention and restore evidence. MinIO backup MUST use a private staging bucket and a separate destination; the chosen `mc`/managed-storage command and version are recorded in the manifest.

### 7.2 Restore rehearsal

Restore into a fresh isolated database/schema and isolated object-storage bucket, never over the source:

```bash
createdb "$RESTORE_DATABASE"
pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname="$RESTORE_DATABASE" artifacts/<release>/<target>/postgres.dump
sha256sum --check artifacts/<release>/<target>/postgres.dump.sha256
```

Then:

1. Apply no new migration unless the rehearsal explicitly tests upgrade-after-restore; first prove the backup alone is usable.
2. Restore object data and verify expected object count/size/checksum sample.
3. Run `prisma migrate status`, API readiness, worker readiness and the smoke suite against restored endpoints.
4. Verify a representative read path, authenticated OTP path using staging Gmail/Workspace test addresses, registration read/write in a disposable scope, pickup resolve/confirm in the approved synthetic dataset, and notification inbox persistence.
5. Record restore start/end, measured RTO, latest recoverable timestamp/RPO, row/object counts, checksum results, failed steps and operator IDs.
6. Destroy the isolated restore target only after evidence is retained and no investigation hold exists.

Abort and classify restore as FAIL if checksum mismatch, migration mismatch, missing object, failed readiness, failed auth, stale/inconsistent dashboard, duplicate serving, or any data-integrity discrepancy occurs. Do not proceed to a pilot gate until the failure is remediated and the rehearsal is repeated.

## 8. Smoke and qualification checks

The smoke suite is layered. Every check emits a pass/fail result, timestamp, release ID and redacted target ID.

### 8.1 Infrastructure and release

```bash
docker compose config --quiet
yarn install --immutable
yarn typecheck
yarn lint
yarn build
yarn test:unit
```

`yarn test:db` MAY run only against a disposable staging schema with an explicitly supplied `DATABASE_URL`; never against production. Confirm:

- all expected images use immutable tags/digests;
- `migrate` exits 0 and `prisma migrate status` is clean;
- API, worker, Admin Web and Caddy are running with expected restart/health state;
- no PostgreSQL/PgBouncer/MinIO/worker internal port is externally reachable;
- HTTPS certificate, redirect, security headers and request-ID behavior are correct.

### 8.2 Authentication and authorization

Using approved synthetic/staging addresses and the real staging Gmail SMTP worker path:

1. Allowlisted address receives OTP; unknown/disabled address receives the same non-disclosing request response and creates no challenge/outbox row.
2. OTP is single-use, expires, respects attempts/resend/rate limits, and is never logged.
3. Verify returns an opaque session; database stores only the hash and metadata.
4. `/auth/me` resolves current roles/status; logout, expiry, disable and explicit revoke reject subsequent protected requests.
5. Staff cannot call Kitchen mutations; Kitchen requires `kitchen.serve`; Admin cannot grant `admin` through Admin Web.
6. Request IDs correlate client response, API log and audit row without exposing token/email contents.

### 8.3 Business and mobile/Admin workflows

Run the exact server-authoritative workflow from `README.md:207-223` and `docs/local-role-testing.md:148-206`, against authorized staging data:

- published weekly menu and cutoff boundary at 14:00 Vietnam time;
- staff weekly registration and failed mutation recovery;
- pickup intent exact sorted set, foreground GPS success/failure recovery, five-second QR and 30-second session;
- Kitchen QR-only resolve, all-or-nothing final confirm, duplicate/retry idempotency and two-device race;
- dashboard pending/served/no-show projection and reconnect/refetch behavior;
- delegation acceptance/revoke and proxy serving;
- notification inbox persistence and OTP/push delivery failure behavior;
- 13:45 no-show and one 50,000 VND penalty with paid/waived preservation;
- Admin menu/allowlist/roster/location/penalty operations and server-backed audit expectations;
- account disable preview, cleanup, session revocation and no-show exclusion where the feature is enabled.

Physical Android/iOS smoke MUST cover camera permission, foreground GPS, push permission/token registration, offline/timeout recovery, accessibility announcements and release-build deep links. A local Expo or simulator run is not sufficient evidence for this gate.

### 8.4 Worker and recovery checks

Trigger or observe a controlled staging job window:

- OTP outbox claim/send/retry/terminal failure and stale-claim recovery;
- cutoff, pickup-session cleanup, reminder and no-show job idempotency;
- failed job produces an alert and a `job_runs` record;
- worker restart does not duplicate penalties, notifications or serving state;
- backup freshness and restore alerts fire in a controlled test.

## 9. Observability design

### 9.1 Structured logs

API, worker and proxy logs are JSON and include: `timestamp`, `service`, `environment`, `releaseId`, `requestId` or `jobRunId`, route/job name, outcome code, duration, database operation class, and safe actor/target identifiers. They MUST NOT include OTP codes, bearer/session tokens, provider API keys, full email content, raw GPS coordinates, database URLs or unredacted employee/location data.

Required event classes include API request/error, authentication result, serving resolve/confirm result, idempotency replay/conflict, OTP delivery attempt/result, worker run start/end/failure, migration gate, backup/restore, and alert test.

### 9.2 Metrics and dashboards

The implementation should expose or export stable metric names (exact exporter is a deployment decision):

- `imeal_http_requests_total{route,method,status}` and request duration histogram;
- `imeal_auth_attempts_total{result}` and OTP delivery totals/retry/failure;
- `imeal_serving_confirm_total{result}` and serving latency;
- `imeal_idempotency_conflicts_total` and duplicate/replay outcomes;
- `imeal_worker_runs_total{job,status}`, last-success timestamp and job lag;
- `imeal_otp_outbox_oldest_age_seconds`, pending/processing/failed counts;
- PostgreSQL connection usage, transaction errors, lock waits, disk usage and backup age;
- object-storage capacity, error count and backup age.

Dashboards must show API availability/error/latency, authentication/OTP health, serving correctness, worker freshness, DB/storage capacity and backup status. Counters must distinguish rejected business operations from infrastructure failures.

### 9.3 Initial alert policy

Thresholds are initial staging defaults and must be tuned from observed baseline without weakening safety:

| Alert | Initial condition | Owner/action |
| --- | --- | --- |
| API unavailable | readiness fails for 2 of 3 checks over 1 minute | On-call; inspect API/DB/proxy and rollback if release-correlated |
| API errors | 5xx >5% for 5 minutes or any sustained auth/serving error spike | API owner; inspect release/request IDs |
| API latency | p95 >1 second for 10 minutes on normal traffic, or serving confirm p95 above agreed pilot SLO | API owner; investigate DB/locks/external dependencies |
| OTP backlog | oldest pending item >5 minutes, or terminal failures above approved rate | Worker/OTP delivery owner; inspect SMTP delivery and retries |
| Worker stale | any required job has no successful run by its deadline plus 10 minutes | Worker owner; run controlled retry only with audit |
| DB/storage | DB disk >80%, pool saturation/lock waits, object storage unavailable | DBA/operations |
| Backup | latest backup older than 26 hours, checksum failure or restore test failure | DBA; block release/pilot |
| Security boundary | any public internal port, HTTP bearer traffic, invalid certificate or unexpected CORS origin | Operations; immediate gate failure |

Alert delivery itself is tested during staging and the notification receipt is retained as evidence.

## 10. CI and release evidence design

No CI workflow currently exists. The proposed pipeline is required before staging approval and runs on pull requests, protected branch merges and release tags.

### 10.1 Required jobs

1. **Immutable install:** Corepack Yarn 4.18, `yarn install --immutable`, lockfile hash and Node version.
2. **Static checks:** contracts/domain/API/worker/mobile/Admin typecheck, lint and formatting check.
3. **Unit/contract checks:** `yarn test:unit` and contract schema tests.
4. **Disposable database checks:** start pinned PostgreSQL, deploy migrations, run domain/API/worker DB suites, run migration status and Prisma validate/generate.
5. **Build:** API, worker, Admin Web and mobile release/config validation. Compose syntax check with redacted staging-shaped variables.
6. **Security:** dependency audit, image vulnerability scan, secret scan, SBOM and base image digest verification.
7. **Artifact:** publish immutable API/worker/Admin image digests, mobile build identifier, source commit, lockfile hash, migration list, SBOM and test summary.
8. **Staging deploy gate:** deploy only those digests, run readiness and smoke, capture logs/metrics/alert test and migration evidence.
9. **Approval/promotion:** require independent data/operations approval before pilot or production promotion.

### 10.2 Release manifest

The release manifest is machine-readable and retained with the artifact:

```json
{
  "releaseId": "imeal-<date>-<tag>",
  "commit": "<sha>",
  "lockfileSha256": "<sha256>",
  "images": {"api": "<digest>", "worker": "<digest>", "adminWeb": "<digest>"},
  "migrations": ["<ordered migration names>"],
  "checks": {"typecheck": "PASS", "unit": "PASS", "db": "PASS", "security": "PASS"},
  "sbom": "<artifact reference>",
  "stagingSmoke": "<artifact reference>",
  "rollbackArtifact": "<prior release/digest>"
}
```

The release is invalid if any required result is missing, generated from a dirty tree, or references mutable `latest` tags.

## 11. Evidence artifact layout

The evidence bundle is retained outside the application database with access control and a retention period approved by operations:

```text
artifacts/<release-id>/<staging-target>/
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
  redacted-logs/
  checksums.txt
  signoff.json
```

Each artifact records release ID, target ID, UTC timestamps, command/tool version, result, operator and script/image hash. Evidence MUST be reproducible without secrets and MUST use redacted or synthetic identifiers. A failed artifact is retained with its failure reason; it is never overwritten by a later pass.

## 12. Abort, rollback and incident rules

### 12.1 Hard aborts

Stop immediately on:

- target/schema/database fingerprint mismatch;
- missing or failed backup/checksum/restore evidence;
- dirty or unexpected migration history;
- any nonzero preflight check;
- missing independent approval or changed candidate/target after approval;
- timeout, lock conflict, unexpected row count or partial backfill;
- any nonvalidated named constraint;
- failed API/worker readiness, smoke, OTP delivery, mobile, dashboard, backup or alert check;
- public internal port, HTTP credential transport, public object bucket, placeholder production secret or mutable image;
- missing rollback authority, decision window or prior compatible artifact.

### 12.2 Recovery

The release engineer does not improvise SQL repair or destructive migration. The named rollback authority chooses one of:

1. stop the candidate and restore the approved backup into the target under the recorded decision window;
2. retain the additive schema for diagnosis while serving traffic with the prior compatible artifact, if compatibility is proven;
3. quarantine exact rows and repeat the approval/preflight process after a reviewed remediation.

There is no `prisma migrate down` assumption and no Firebase rollback. Every recovery action receives a new incident/evidence ID and is included in the next independent review.

## 13. Explicit external gates

The following gates are outside repository code and MUST be recorded before staging is considered ready:

| Gate | Required evidence | Owner |
| --- | --- | --- |
| Organization/policy | Approved business timezone, cutoff/serving/no-show policy, four locations and scanner ownership | Product/operations |
| Identity | Allowlist-A source, role/permission matrix, first-Admin bootstrap owner, disable/revoke procedure | Security/identity owner |
| OTP delivery | Dedicated staging Gmail/Workspace mailbox, worker App Password, approved sender, limits, delivery test, rotation and support/escalation owner | Worker/operations owner |
| Network/TLS | DNS, certificate trust on target devices, firewall/private ports, egress allowlist, proxy/CORS policy | Infrastructure |
| Data | Staging dataset classification, roster/location import approval, preflight approval and backfill scope | Data owner/DBA |
| Recovery | Encrypted offsite DB/object backup, checksum, restore rehearsal, measured RPO/RTO and rollback authority | DBA/operations |
| Release | Immutable image/mobile artifacts, SBOM, security scan, migration compatibility and prior rollback artifact | Release owner |
| UAT | Native Android/iOS camera/GPS/push/accessibility, Admin browser, Kitchen two-device and outage/retry tests | QA/product |
| Operations | Central logs/metrics, alert routing test, on-call schedule, runbooks, retention/legal review | Operations |

No single local test, zero-row preflight, or successful Docker build can substitute for these gates.

## 14. Implementation boundary and verification plan

This design is intentionally not implementation. A follow-up implementation plan should be split into independently reviewable slices:

1. Add target-safe migration wrappers and evidence serialization around the existing Phase 0 SQL; unit-test target/schema validation and abort behavior.
2. Add the reviewed staging Compose/Caddy override, explicit Admin Dockerfile selection, private network/secret injection and readiness endpoints.
3. Add CI/release manifest, immutable image promotion, SBOM/scan and disposable migration job.
4. Add backup/restore scripts/runbook and object-storage verification.
5. Add structured observability, metrics, alert rules and worker/API health.
6. Run the full staging qualification and update `README.md`, `docs/06-execution-plan.md` and `docs/imeal-production-readiness-assessment.md` with observed evidence only.

Verification for the implementation must include:

- wrapper unit tests for wrong target, wrong schema, nonzero preflight, approval hash mismatch, timeout and rerun behavior;
- disposable PostgreSQL migration/preflight/backfill/post-validation run with a clean target and classified dirty fixtures;
- restore rehearsal from an actual staging backup into a fresh target;
- CI artifact/digest/SBOM and security-scan checks;
- external HTTPS/API/Admin/mobile smoke from representative devices;
- controlled alert firing and recovery acknowledgement;
- independent review of the complete evidence bundle.

### Acceptance decision

Staging is **READY FOR PILOT REVIEW** only when every internal check is PASS, every external gate has a named approval, backup restore and alert delivery are observed, no P0 remains, and the evidence bundle is immutable and complete. Otherwise the status remains **CONDITIONAL / NO-GO**, with the exact failing gate and owner recorded.
