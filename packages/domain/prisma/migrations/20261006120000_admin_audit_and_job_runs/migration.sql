-- Indexed audit filters and sanitized job bookkeeping.
-- New columns stay nullable so existing rows remain valid. Backfill copies only
-- safe identifiers already stored under known JSON keys. It does not copy OTP,
-- tokens, hashes, GPS, raw QR, or secrets.

ALTER TABLE "audit_logs"
  ADD COLUMN "target_user_id" TEXT,
  ADD COLUMN "result" TEXT,
  ADD COLUMN "resource_type" TEXT;

CREATE INDEX "audit_logs_created_at_idx"
  ON "audit_logs" ("created_at");

CREATE INDEX "audit_logs_action_created_at_idx"
  ON "audit_logs" ("action", "created_at");

CREATE INDEX "audit_logs_user_id_created_at_idx"
  ON "audit_logs" ("user_id", "created_at");

CREATE INDEX "audit_logs_target_user_id_created_at_idx"
  ON "audit_logs" ("target_user_id", "created_at");

CREATE INDEX "audit_logs_result_created_at_idx"
  ON "audit_logs" ("result", "created_at");

CREATE INDEX "audit_logs_resource_type_created_at_idx"
  ON "audit_logs" ("resource_type", "created_at");

UPDATE "audit_logs"
SET "target_user_id" = substring(
  "details"
  from '"targetUserId"[[:space:]]*:[[:space:]]*"([0-9A-Za-z_-]{1,80})"'
)
WHERE "target_user_id" IS NULL
  AND "details" IS NOT NULL
  AND "details" ~ '"targetUserId"[[:space:]]*:[[:space:]]*"[0-9A-Za-z_-]{1,80}"';

UPDATE "audit_logs"
SET "result" = substring(
  "details"
  from '"result"[[:space:]]*:[[:space:]]*"([A-Z][A-Z0-9_]{0,63})"'
)
WHERE "result" IS NULL
  AND "details" IS NOT NULL
  AND "details" ~ '"result"[[:space:]]*:[[:space:]]*"[A-Z][A-Z0-9_]{0,63}"';

UPDATE "audit_logs"
SET "resource_type" = substring(
  "details"
  from '"resourceType"[[:space:]]*:[[:space:]]*"([A-Za-z][A-Za-z0-9_.-]{0,63})"'
)
WHERE "resource_type" IS NULL
  AND "details" IS NOT NULL
  AND "details" ~ '"resourceType"[[:space:]]*:[[:space:]]*"[A-Za-z][A-Za-z0-9_.-]{0,63}"';

ALTER TABLE "job_runs"
  ADD COLUMN "failure_code" TEXT,
  ADD COLUMN "failure_message" TEXT,
  ADD COLUMN "success_count" INTEGER,
  ADD COLUMN "failure_count" INTEGER,
  ADD COLUMN "release_version" TEXT;

ALTER TABLE "job_runs"
  ADD CONSTRAINT "job_runs_success_count_check"
  CHECK ("success_count" IS NULL OR "success_count" >= 0),
  ADD CONSTRAINT "job_runs_failure_count_check"
  CHECK ("failure_count" IS NULL OR "failure_count" >= 0),
  ADD CONSTRAINT "job_runs_failure_code_check"
  CHECK (
    "failure_code" IS NULL
    OR "failure_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  ADD CONSTRAINT "job_runs_failure_message_check"
  CHECK (
    "failure_message" IS NULL
    OR char_length("failure_message") <= 200
  ),
  ADD CONSTRAINT "job_runs_release_version_check"
  CHECK (
    "release_version" IS NULL
    OR "release_version" ~ '^[A-Za-z0-9._:+-]{1,80}$'
  );

CREATE INDEX "job_runs_job_name_started_at_idx"
  ON "job_runs" ("job_name", "started_at");

CREATE INDEX "job_runs_status_started_at_idx"
  ON "job_runs" ("status", "started_at");

INSERT INTO "permissions" ("id", "name")
VALUES
  ('20000000-0000-4000-8000-000000000007', 'audit.read'),
  ('20000000-0000-4000-8000-000000000008', 'serving.read'),
  ('20000000-0000-4000-8000-000000000009', 'jobs.read')
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '10000000-0000-4000-8000-000000000003', "id"
FROM "permissions"
WHERE "name" IN ('audit.read', 'serving.read', 'jobs.read')
ON CONFLICT DO NOTHING;
