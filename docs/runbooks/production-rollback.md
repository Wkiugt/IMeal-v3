# Production rollback

This is an operator procedure. It is not evidence that a rollback has been
rehearsed, and it does not qualify production. There is no automatic
irreversible database rollback. Do not delete the previous release, its
volumes, or its encrypted backup while the decision window is open.

The rollback decision window is 4 hours after the release manager declares
the candidate unhealthy. That window is an operator target, not a measured
result.

## Image rollback

1. Confirm the previous release manifest and `rollback-reference.json` name
   the same prior artifact. If the reference is missing, stop.
2. Point the protected production environment at the previous immutable image
   digests for api, worker, admin-web, and migration-gate. Do not use a
   mutable tag.
3. Restart only those services with the previous digests. Do not run
   `docker compose down` and do not pass `--volumes`.
4. Check `/health/live` and `/health/ready` for the API and worker, and admin
   `/health`, through the approved origins. A failed check keeps the decision
   window open.
5. Record the previous digest, the failed digest, and the operator. Do not
   record secrets or credential URLs.

Image rollback does not undo a committed migration.

## Failed migration before commit

If the migration gate exits non-zero before it writes
`/run/imeal/migration-gate.json`, the gate has not published a success marker.
Leave the previous application release running. Do not start API or worker
processes that require the new marker. Capture the gate exit code and redacted
logs. Do not drop or recreate the database volume.

The production workflow uses:

```bash
docker compose --env-file "$PRODUCTION_ENV_FILE" \
  -f docker-compose.yml -f docker-compose.production.yml \
  up --no-deps --abort-on-container-exit --exit-code-from migration-gate migration-gate
```

That command must not be followed by `down` or `--volumes`.

## Migration already committed

If the gate marker exists and Prisma shows the migration finished, the schema
change is committed. Do not invent a down migration. Choose one of:

- keep the new schema and roll the application images back only if the
  previous images are compatible with the committed schema;
- or escalate to a data restore into an isolated database, then decide whether
  a named operator will restore onto production.

An incompatible previous image must not be started against the new schema.

## Data restore escalation

Data restore uses `scripts/backup/cli.mjs restore` only after:

- the backup manifest checksum verifies;
- the target is isolated, unless `IMEAL_BACKUP_RESTORE_ALLOW_SOURCE=1` and
  `IMEAL_BACKUP_RESTORE_ALLOW_PRODUCTION=1` are both set;
- `IMEAL_BACKUP_RESTORE_OPERATOR` names the operator;
- `IMEAL_BACKUP_RESTORE_APPROVAL_ID` records the approval.

Rehearsal cannot target production. Restoring onto production is a separate
decision inside the 4-hour window and still requires the flags above. It does
not delete the previous encrypted backup. After restore, check connectivity
and migration status from the redacted evidence file. Do not mark production
qualified from this runbook alone.
