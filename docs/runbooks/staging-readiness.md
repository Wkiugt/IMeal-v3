# Staging readiness: backup and restore rehearsal

This runbook covers the staging backup and restore gates owned by the staging
operations team. It is intentionally limited to the isolated staging target;
never substitute a production database, bucket, credential, or endpoint.

## Ownership and cadence

| Responsibility                            | Owner                                   | Evidence                                                                        |
| ----------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| Backup execution and checksum review      | Staging operations on-call              | `backup-manifest.json`                                                          |
| AGE recipient lifecycle and access review | Platform security                       | recipient-environment ownership record (the value is never written to evidence) |
| Private object-storage retention          | Data platform                           | storage reference and retention review                                          |
| Restore rehearsal and RPO/RTO sign-off    | Release manager with staging operations | `restore-rehearsal.json`                                                        |
| Abort decision and incident handoff       | Release manager                         | redacted failure report and incident link                                       |

Run an encrypted backup at least daily during pilot operation and before every
Phase 0 backfill or release gate. Perform a restore rehearsal weekly and after
any change to PostgreSQL, object storage, encryption tooling, or the staging
network. Retain the manifest, checksum, and restore report for the release
retention period (the wrapper records 35 days by default).

Targets are measured, not assumed:

- **RPO target:** no more than 24 hours for the daily backup cadence. The
  restore wrapper records the elapsed time from the backup completion timestamp
  to restore start as `rpoSeconds`.
- **RTO target:** no more than 60 minutes for a rehearsal. The wrapper records
  restore start through readiness and smoke completion as `rtoSeconds`.
- A measured value over target is a failed readiness gate even when all commands
  return success.

## Preconditions and isolation

1. Use a dedicated staging PostgreSQL database and credentials. The source
   target must not have a production, primary, live, or similarly named host or
   database.
2. Use a private object-storage bucket and an isolated destination prefix. Do
   not use public buckets or a destination shared with production.
3. Set the AGE public recipient through the required environment variable, for
   example `AGE_RECIPIENT`. Never put the recipient's private key, database URL,
   object-storage credentials, OTP, bearer token, provider payload, raw GPS, or
   unredacted PII in a command line, manifest, or report.
4. Ensure `pg_dump`, `pg_restore`, `createdb`, `age`, and the selected
   S3-compatible client are installed and their versions are captured by the
   wrapper.
5. Create a release evidence directory with access control appropriate for
   staging operational evidence. The wrappers write files atomically.

## Create an encrypted staging backup

Use the checked-in wrapper and pass the database URL through an environment
variable. The object endpoint, bucket, and destination are staging-only values.
The command runner uses `shell:false`; it does not evaluate shell fragments.

```bash
node scripts/staging/backup-staging.mjs \
  --database-url-env TARGET_DATABASE_URL \
  --schema phase0_staging_20260928 \
  --release-id imeal-20260928-001 \
  --object-endpoint https://<private-staging-object-endpoint> \
  --object-bucket imeal-staging-private \
  --object-destination backups/imeal-20260928-001 \
  --output artifacts/imeal-20260928-001/staging
```

The wrapper performs these gates in order:

1. validates the source and destination isolation rules and requires the named
   AGE recipient environment variable;
2. runs a bounded read-only target fingerprint and requires its database/schema
   to match the requested source;
3. captures a PostgreSQL custom-format dump with `--no-owner` and
   `--no-privileges`. The database password is passed through the command
   environment, never as a `pg_dump` argument;
4. encrypts the dump with AGE before any object-storage copy;
5. computes the encrypted artifact size and SHA-256 checksum;
6. copies only the encrypted artifact to the private destination; and
7. writes `backup-manifest.json` atomically after every preceding step passes.

A failed encryption or copy is an abort. The wrapper removes the plaintext
intermediate dump and does not write a PASS manifest. Do not manually copy an
unencrypted dump as a workaround.

The manifest contains only the release ID, full read-only target fingerprint
(database, schema, server version, and migration rows), UTC timestamps, artifact
and object summaries, checksums, tool versions, non-secret storage references,
and retention ownership. Review that it contains no URL credentials, OTP, token,
provider payload, raw GPS, or unredacted PII before attaching it to release
evidence.

## Restore rehearsal

Restore only into a fresh, isolated database and private bucket whose names
identify the rehearsal. They must differ from the source target and must not be
production or public names.

```bash
node scripts/staging/restore-rehearsal.mjs \
  --manifest artifacts/imeal-20260928-001/staging/backup-manifest.json \
  --restore-database imeal_restore_20260928 \
  --restore-bucket imeal-restore-20260928 \
  --output artifacts/imeal-20260928-001/staging/restore-rehearsal.json
```

Before any restore command, the wrapper verifies the manifest, resolves the
artifact beneath the manifest directory, and recomputes its byte count and
SHA-256 checksum. It then decrypts the AGE artifact to a temporary local dump
(using the operator's configured AGE identity) and performs, in order:

1. AGE decryption to a temporary plaintext dump;
2. `createdb` for the fresh restore database;
3. `pg_restore --exit-on-error --no-owner --no-privileges` into that database;
4. an exact bounded row-count verification of the restored `"User"` table;
5. `aws s3api create-bucket` for the fresh private restore bucket. Existing
   buckets or any creation failure abort the rehearsal;
6. an object copy from the private source reference to the fresh restore
   bucket, followed by destination byte/checksum verification; and
7. readiness, migration-status, and smoke checks, supplied as callbacks by
   automation or run by the default command checks.

The temporary decrypted dump is removed after `pg_restore`, including when a
restore command fails. Never retain or upload that plaintext file.

The report records PASS/FAIL, checksum status, verified database row count,
verified object byte/checksum status, database/object restore status, readiness
and smoke results, UTC timestamps, and measured RPO/RTO. A failure
writes a redacted `result: FAIL` report atomically and propagates the failure;
no source database or source bucket is ever used as a restore destination.

## Abort and recovery rules

Abort immediately, without a manual override, for any of the following:

- source or destination resembles production, or restore names are not fresh
  isolated rehearsal targets;
- AGE recipient is missing or an object destination is public;
- `pg_dump`, encryption, private copy, `createdb`, `pg_restore`, object restore,
  readiness, or smoke returns nonzero;
- manifest, artifact checksum, or artifact byte count does not match;
- a plaintext intermediate remains after an encryption failure;
- measured RPO/RTO exceeds its target; or
- any evidence contains a credential, OTP, bearer/session token, provider
  payload, raw GPS, or unredacted PII.

Do not retry against a different target after an isolation failure. Preserve the
redacted failure report, command exit diagnostics, and release ID; notify the
release manager and platform security. If a restore database or bucket was
created before a later check failed, quarantine it as a rehearsal artifact and
record cleanup ownership. Never drop or overwrite a production resource as
part of recovery.

## Evidence checklist

Store these artifacts under the release evidence directory with restricted
access:

- `backup-manifest.json` — PASS backup target, timestamps, encrypted artifact
  checksum, object summary, storage reference, and tool versions;
- encrypted artifact checksum and private object-storage reference;
- `restore-rehearsal.json` — PASS or redacted FAIL report with checksum,
  readiness, smoke, RPO, and RTO results; and
- the release sign-off that records the operator, reviewer, measured values,
  abort decisions, and incident link when applicable.

Do not store raw `pg_dump` output, plaintext intermediate dumps, database URLs,
object-storage credentials, AGE private keys, OTPs, bearer tokens, or provider
payloads in the evidence directory.

## Staging smoke and evidence

Run the public smoke only against the approved staging HTTPS origins. The
session token is read from the named environment variable and is never placed
in the command line or report:

```bash
node scripts/staging/smoke-staging.mjs \
  --api-origin "$STAGING_API_ORIGIN" \
  --admin-origin "$STAGING_ADMIN_ORIGIN" \
  --session-token-env STAGING_SMOKE_SESSION_TOKEN \
  --output artifacts/imeal-20260928-001/staging/smoke-infrastructure.json
```

The runner uses bounded abort timeouts, checks the HTTP-to-HTTPS redirect,
API liveness/readiness, Admin `/health`, response `X-Request-Id`, an optional
authenticated `/auth/me`, and a safe error envelope. It records business
workflow status as `NOT_RUN`; execute the existing API/domain/worker suites
separately and retain their command/results as `smoke-business.json`. Do not
use local test mode as staging evidence.

Build the complete evidence manifest only after every required artifact,
including an operator-provided `signoff.json`, exists:

```bash
node scripts/staging/evidence.mjs \
  --release-id imeal-20260928-001 \
  --target phase0_staging_20260928 \
  --artifacts artifacts/imeal-20260928-001/staging
```

The evidence command never creates an approval or sign-off. Checksums can be
created only by an explicit operator action, after the sign-off artifact is
reviewed:

```bash
node scripts/staging/evidence.mjs \
  --release-id imeal-20260928-001 \
  --target phase0_staging_20260928 \
  --artifacts artifacts/imeal-20260928-001/staging \
  --write-checksums
```

Reject the release for a missing artifact, mutable image tag, missing rollback
reference, checksum mismatch, failed readiness/smoke, or any secret-bearing
report. Preserve failed reports; never overwrite an evidence artifact.
