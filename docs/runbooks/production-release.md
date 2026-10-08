# Production release

`.github/workflows/production-release.yml` is `workflow_dispatch` only. A push
to `deploy/develop` does not deploy production. The job uses the GitHub
environment `production` and refuses to continue unless
`IMEAL_PRODUCTION_DEPLOY` is exactly `1`. This file does not create that
environment, does not approve a release, and does not prove production is
qualified.

Until an admin creates the `production` environment, restricts it to the
reviewed deployment branch, and requires a reviewer, the workflow cannot read
production secrets. Do not use a GitHub admin token from this repository to
create it.

## Required dispatch inputs

- `release_sha`: 40-character commit SHA. The checkout must match it.
- `release_id`
- `image_digests_json`: `api`, `worker`, and `adminWeb` as
  `repository@sha256:<64 hex>`.
- `migration_gate_digest`
- `rollback_artifact`
- `staging_evidence_run_id` and `staging_evidence_artifact`: a protected
  `staging-release-*` artifact for the same SHA. Secretless
  `staging-readiness-inputs-*` artifacts are rejected. A missing artifact
  fails the job. The workflow does not synthesize PASS.
- `approved_lineage`: approval id recorded beside the downloaded evidence. It
  is not a waiver.

## Environment secrets and variables

Secrets: `PRODUCTION_ENV_FILE`, `IMEAL_PRODUCTION_DEPLOY`,
`PRODUCTION_APPROVAL_ID`, `PRODUCTION_SMOKE_SESSION_TOKEN`,
`IMEAL_BACKUP_DATABASE_URL`, `AGE_RECIPIENT`, `IMEAL_BACKUP_S3_ENDPOINT`,
`IMEAL_BACKUP_S3_BUCKET`, `IMEAL_BACKUP_S3_PREFIX`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`.

Variables: `PRODUCTION_RUNNER_LABEL`, `PRODUCTION_API_ORIGIN`,
`PRODUCTION_WORKER_ORIGIN`, `PRODUCTION_ADMIN_ORIGIN`, `AWS_DEFAULT_REGION`,
and optional `IMEAL_BACKUP_RETENTION_DAYS` (default 35). Do not hardcode a
production domain or hostname in the workflow or this runbook.

`PRODUCTION_ENV_FILE` must contain `OTP_SMTP_USERNAME`, `OTP_SMTP_PASSWORD`
(a Google App Password, never the normal Google account password),
`OTP_SMTP_FROM`, and `EGRESS_NETWORK_NAME`. It must not contain
`OTP_PROVIDER_URL`, `OTP_PROVIDER_API_KEY`, or `OTP_PROVIDER_FROM`; the API
environment must not receive SMTP credentials. `OTP_SMTP_HOST` and
`OTP_SMTP_PORT` are hard-defaulted to `smtp.gmail.com` and `587` in production
Compose, with STARTTLS required. Do not add GitHub secrets for the mailbox; the
protected env file is the only source. See `docs/runbooks/otp-email.md`.
Rotate by creating a replacement App Password, updating the protected env file, restarting the worker, verifying delivery, and then revoking the previous App Password; no API credential is added.

`PRODUCTION_RUNNER_LABEL` must be a self-hosted runner label on the production
Compose host. It must be non-empty and must not be `ubuntu-latest` or
`ubuntu-24.04`. There is no GitHub-hosted fallback. An empty or hosted label
fails the job before checkout. The workflow does not start production
containers on a GitHub-hosted runner.

## Sequence

The job calls the checked-in commands and fails if any command fails:

1. Prove the event is `workflow_dispatch` and the deploy flag is `1`.
2. Download and verify protected staging evidence for the same SHA.
3. Validate immutable image digests, including migration-gate.
4. Re-scan those digests with `scripts/staging/image-scan.mjs`. A tag or a
   scanner failure fails the job. The scan is not skipped.
5. Run `yarn verify:production-boundary --env-file` against
   `PRODUCTION_ENV_FILE`. A missing file fails closed.
6. Back up with `node scripts/backup/cli.mjs backup` and verify the checksum
   before migration. A missing backup or failed verification fails the job.
7. Run `scripts/staging/phase0-preflight.mjs`.
8. Run the migration gate only when `IMEAL_PRODUCTION_DEPLOY=1`:

```bash
docker compose --env-file "$PRODUCTION_ENV_FILE" \
  -f docker-compose.yml -f docker-compose.production.yml \
  up --no-deps --abort-on-container-exit --exit-code-from migration-gate migration-gate
```

The workflow does not run that command from `pull_request`, and it does not
destroy volumes or the previous release.

9. After the gate exits 0, start only the approved application services. This
   does not rebuild images, remove orphans, or delete the previous release:

```bash
docker compose --env-file "$PRODUCTION_ENV_FILE" \
  -f docker-compose.yml -f docker-compose.production.yml \
  up --detach --no-build api worker admin-web caddy
```

10. Wait for gate evidence, runtime health, and deployed digest comparison.
11. Check API and worker health through the configured origins.
12. Run `yarn staging:smoke` for API, authenticated, and admin checks.
13. Write the release manifest and rollback reference.
14. Upload only artifacts that pass redaction. Environment files are not
    uploaded.

If `PRODUCTION_RUNNER_LABEL` is missing or names a GitHub-hosted runner, the
job fails closed. Do not treat a missing secret, a missing artifact, or a
failed health check as PASS.

Rollback is described in `docs/runbooks/production-rollback.md`. There is no
automatic irreversible database rollback.
