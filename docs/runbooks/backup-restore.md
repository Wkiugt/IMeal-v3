# Backup and restore

These are operator targets. This document does not claim that a backup has
been taken, verified, or rehearsed. A green unit test is not restore evidence.
Production remains unqualified until an operator records a real offsite backup
and an isolated rehearsal outside this repository.

## Targets

- RPO: 24 hours.
- RTO: 4 hours.
- Retention: 35 days.
- Schedule: daily at 17:30 Asia/Ho_Chi_Minh (`30 17 * * *` with
  `TZ=Asia/Ho_Chi_Minh`).
- Rollback decision window: 4 hours.
- Destructive restore requires `IMEAL_BACKUP_RESTORE_OPERATOR` and
  `IMEAL_BACKUP_RESTORE_APPROVAL_ID`.

## Command

```bash
node scripts/backup/cli.mjs backup --output /var/lib/imeal/backup-evidence
node scripts/backup/cli.mjs verify --manifest /var/lib/imeal/backup-evidence/backup-manifest.json --output /var/lib/imeal/backup-evidence
node scripts/backup/cli.mjs restore --manifest /var/lib/imeal/backup-evidence/backup-manifest.json --output /var/lib/imeal/restore-evidence
node scripts/backup/cli.mjs rehearsal --manifest /var/lib/imeal/backup-evidence/backup-manifest.json --output /var/lib/imeal/rehearsal-evidence
```

The evidence directory must be outside the git checkout. The script exits
non-zero on failure, encrypts with AGE before any offsite write, and records a
SHA-256 of the ciphertext. It does not print database URLs, AGE identities, or
cloud credentials.

## Required environment

- `IMEAL_BACKUP_DATABASE_URL`: direct database URL, injected out of band.
- `IMEAL_BACKUP_SCHEMA`
- `IMEAL_BACKUP_RELEASE_ID`
- `IMEAL_BACKUP_ENV`: `production`, `staging`, or `rehearsal`.
- `AGE_RECIPIENT`: public AGE recipient.
- `IMEAL_BACKUP_AGE_IDENTITY`: private identity, required only for restore and
  rehearsal. Never write it into evidence.
- `IMEAL_BACKUP_S3_ENDPOINT`: HTTPS S3-compatible origin with no credentials.
- `IMEAL_BACKUP_S3_BUCKET`
- `IMEAL_BACKUP_S3_PREFIX`
- `IMEAL_BACKUP_RETENTION_DAYS`: operator target 35.
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, unless
  `IMEAL_BACKUP_S3_AUTH=ambient` is explicitly set for a workload role.
- `IMEAL_BACKUP_RESTORE_DATABASE`: isolated database. Required for restore.
- `IMEAL_BACKUP_RESTORE_SCHEMA`: defaults to `IMEAL_BACKUP_SCHEMA` inside the
  isolated database.

When `NODE_ENV=production` or `IMEAL_BACKUP_ENV=production`, the destination
must be a remote HTTPS S3-compatible target. An empty destination, a `file:`
URL, local disk, `localhost`, `127.0.0.1`, or the in-stack MinIO service or
`minio_data` volume is rejected. Local disk and the in-stack MinIO volume are
not a valid sole production target.

## Restore safety

Restore defaults to an isolated database. It refuses the source database
unless `IMEAL_BACKUP_RESTORE_ALLOW_SOURCE=1`. It refuses a production-named
database, or a production-environment restore onto the source database, unless
`IMEAL_BACKUP_RESTORE_ALLOW_PRODUCTION=1`. Both exceptions still require the
named operator and approval id. Rehearsal ignores those allow flags and always
refuses the source database, a production-named database, and
`IMEAL_BACKUP_ENV=production`.

Restore checks connectivity and unfinished or rolled-back Prisma migration
rows, then writes redacted evidence JSON. It does not drop the source database.

## Schedule

The overlay `docker-compose.backup.yml` is not included by the base, staging,
or production compose files and publishes no ports. It does not embed secret
values. Run it only as an explicit one-shot:

```bash
TZ=Asia/Ho_Chi_Minh docker compose -f docker-compose.backup.yml --profile backup run --rm --no-deps backup
```

Set `IMEAL_BACKUP_NETWORK_NAME` to the existing data network. Set
`IMEAL_BACKUP_IMAGE` to a digest-pinned image that contains Node, `pg_dump`,
`age`, and the AWS CLI. Set `IMEAL_BACKUP_EVIDENCE_DIR` to a host directory
outside the checkout and outside the MinIO volume.

A cron entry on the production host, not in the base compose file, can run
that command at 17:30 Asia/Ho_Chi_Minh. The cron entry must source credentials
from the operator environment, not from the repository.

## Metrics

`WORKER_METRICS_BACKUP_EVIDENCE_SOURCE` should point at the approved private
transport that reads the evidence directory `backup-manifest.json` and, after
a real rehearsal, `restore-rehearsal.json`. The backup command records
`metricsBinding.collectorObservation: false`. This repository does not invoke
the worker collector and does not emit a collector observation. A static file
cannot satisfy the collector request timestamp, so missing transport input
must remain a collector failure rather than a fabricated fresh metric.
