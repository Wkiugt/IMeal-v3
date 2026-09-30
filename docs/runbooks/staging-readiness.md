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

- the worker now owns an internal `/metrics` endpoint, but the checked-in
  Compose boundary only declares required opaque source references; protected
  deployment values and external source evidence are absent, so runtime
  integration fails closed until those sources and evidence exist;
- Staging and production Compose require the four opaque worker source-reference
  names. The protected staging environment must supply approved reference IDs;
  this repository supplies no values, credentials, targets, or source payloads.
- the approved edge WAF/rate-limit control and the alert delivery route are not
  provisioned;
- no real staging environment, DNS, TLS certificate, OTP provider path,
  backup/restore rehearsal, alert delivery, UAT, identity approval, or
  location/roster approval has been observed;
- no production data, credentials, or real operational domains are present in
  this repository.

The workflow is the only protected path for runtime integration and smoke
qualification. It uses `.github/workflows/staging-readiness.yml`, the
immutable image references from `STAGING_IMAGE_DIGESTS_JSON`, and
`STAGING_SMOKE_SESSION_TOKEN` through `--session-token-env`. A missing runtime
collector or endpoint is a failed gate, not a reason to mark PASS manually.

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

The protected workflow invokes `runRuntimeIntegration` from
`scripts/staging/runtime-integration.mjs` after deployment and before it records
`runtimeIntegration: PASS`. A qualification PASS requires API and worker live
and readiness endpoints to return HTTP 200 with body `status: "ok"` and the
expected release marker; HTTP 503 readiness is a failed gate, not a diagnostic
PASS. It must also observe the actual hardening endpoints. This repository
contains the worker `/metrics` endpoint and private Compose isolation, but no
real PostgreSQL/storage/backup/security collectors or target bindings are
provisioned; that gate MUST remain FAIL until the deployed sources and their
redacted evidence exist.

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
The snapshot digest must equal the worker metrics body hash; the verifier never creates an acknowledgement;
Stale, unknown, `collector_failure`, missing, conflicting, or unsafe fields fail closed.
alert route is an external prerequisite and there is no repository command
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
