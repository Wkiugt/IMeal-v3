-- Email OTP, opaque sessions, location policy, roster assignments, and serving evidence.
-- This migration intentionally creates no operational Location or employee rows.

DO $$
BEGIN
  CREATE TYPE "OtpPurpose" AS ENUM ('SESSION_LOGIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "OtpAllowlistState" AS ENUM ('ACTIVE', 'DISABLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "AuthSessionPurpose" AS ENUM ('SESSION_LOGIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "AuthSessionMethod" AS ENUM ('EMAIL_OTP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "SessionRevocationReason" AS ENUM (
    'LOGOUT',
    'ACCOUNT_DISABLED',
    'COMPROMISED',
    'OTP_REPLAY',
    'ADMIN_REVOKED',
    'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "RosterImportRowOutcome" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "ServingVerificationResult" AS ENUM (
    'VALID',
    'GPS_UNAVAILABLE',
    'GPS_STALE',
    'GPS_INACCURATE',
    'OUTSIDE_GEOFENCE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "PickupReceiverType" AS ENUM ('SELF', 'PROXY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE "otp_allowlists" (
  "id" TEXT NOT NULL,
  "normalized_email" TEXT NOT NULL,
  "user_id" TEXT,
  "state" "OtpAllowlistState" NOT NULL DEFAULT 'ACTIVE',
  "purpose" "OtpPurpose" NOT NULL DEFAULT 'SESSION_LOGIN',
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_to" TIMESTAMP(3),
  "reason" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "otp_allowlists_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "otp_allowlists_effective_dates_check"
    CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from")
);

CREATE TABLE "otp_challenges" (
  "id" TEXT NOT NULL,
  "allowlist_id" TEXT NOT NULL,
  "normalized_email" TEXT NOT NULL,
  "purpose" "OtpPurpose" NOT NULL,
  "verifier_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "attempt_limit" INTEGER NOT NULL DEFAULT 5,
  "consumed_at" TIMESTAMP(3),
  "resend_after" TIMESTAMP(3),
  "last_sent_at" TIMESTAMP(3),
  "client_fingerprint_hash" TEXT,
  "client_ip_hash" TEXT,
  "request_id" TEXT,
  "audit_event_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "otp_challenges_attempts_check"
    CHECK ("attempt_count" >= 0 AND "attempt_limit" > 0 AND "attempt_count" <= "attempt_limit")
);

CREATE TABLE "otp_delivery_outboxes" (
  "id" TEXT NOT NULL,
  "challenge_id" TEXT NOT NULL,
  "provider_payload_ref" TEXT NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "otp_delivery_outboxes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "otp_delivery_outboxes_attempts_check" CHECK ("attempt_count" >= 0)
);

CREATE TABLE "auth_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "purpose" "AuthSessionPurpose" NOT NULL DEFAULT 'SESSION_LOGIN',
  "auth_method" "AuthSessionMethod" NOT NULL DEFAULT 'EMAIL_OTP',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMP(3),
  "idle_expires_at" TIMESTAMP(3),
  "absolute_expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "revoked_reason" "SessionRevocationReason",
  "device_id_hash" TEXT,
  "client_ip_hash" TEXT,
  "user_agent_hash" TEXT,
  "request_id" TEXT,
  "audit_event_id" TEXT,

  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "locations" (
  "id" TEXT NOT NULL,
  "short_code" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "serving_point_name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "building" TEXT NOT NULL,
  "floor" TEXT NOT NULL,
  "room_or_counter" TEXT NOT NULL,
  "local_contact" TEXT NOT NULL,
  "time_zone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_to" TIMESTAMP(3),
  "operational_metadata" JSONB,
  "holiday_overrides" JSONB,
  "capacity_notes" TEXT,
  "accessibility_instructions" TEXT,
  "emergency_instructions" TEXT,
  "kitchen_team" TEXT,
  "approved_scanner_device_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "network_notes" TEXT,
  "last_verified_by" TEXT,
  "last_verified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "locations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "locations_effective_dates_check"
    CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from")
);

CREATE TABLE "location_policies" (
  "id" TEXT NOT NULL,
  "location_id" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "accuracy_source" TEXT NOT NULL,
  "geofence_radius_meters" INTEGER NOT NULL,
  "max_fix_age_seconds" INTEGER NOT NULL,
  "max_accuracy_meters" DOUBLE PRECISION NOT NULL,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_to" TIMESTAMP(3),
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "location_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "location_policies_coordinate_check"
    CHECK (
      "latitude" NOT IN ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
      AND "longitude" NOT IN ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
      AND "latitude" >= -90 AND "latitude" <= 90
      AND "longitude" >= -180 AND "longitude" <= 180
    ),
  CONSTRAINT "location_policies_thresholds_check"
    CHECK (
      "geofence_radius_meters" > 0
      AND "max_fix_age_seconds" >= 0
      AND "max_accuracy_meters" NOT IN ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
      AND "max_accuracy_meters" >= 0
    ),
  CONSTRAINT "location_policies_effective_dates_check"
    CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from")
);

CREATE TABLE "roster_import_batches" (
  "id" TEXT NOT NULL,
  "imported_by_user_id" TEXT,
  "source" TEXT NOT NULL,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "audit_event_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "roster_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_location_assignments" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "normalized_email" TEXT NOT NULL,
  "employee_name" TEXT NOT NULL,
  "employee_code" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL,
  "role" TEXT NOT NULL,
  "service_location_code" TEXT NOT NULL,
  "location_id" TEXT NOT NULL,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_to" TIMESTAMP(3),
  "roster_import_batch_id" TEXT,
  "audit_event_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "employee_location_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_location_assignments_effective_dates_check"
    CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from")
);

CREATE TABLE "roster_import_rows" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "normalized_email" TEXT NOT NULL,
  "employee_name" TEXT NOT NULL,
  "employee_code" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL,
  "role" TEXT NOT NULL,
  "service_location_code" TEXT NOT NULL,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_to" TIMESTAMP(3),
  "outcome" "RosterImportRowOutcome" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "assignment_id" TEXT,
  "audit_event_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "roster_import_rows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "roster_import_rows_effective_dates_check"
    CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from")
);

CREATE TABLE "serving_verifications" (
  "id" TEXT NOT NULL,
  "presenter_user_id" TEXT NOT NULL,
  "location_id" TEXT NOT NULL,
  "location_policy_id" TEXT,
  "result" "ServingVerificationResult" NOT NULL,
  "captured_at" TIMESTAMP(3) NOT NULL,
  "verified_at" TIMESTAMP(3),
  "accuracy_meters" DOUBLE PRECISION,
  "safe_verification_code" TEXT NOT NULL,
  "retention_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "serving_verifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "serving_verifications_accuracy_check"
    CHECK (
      "accuracy_meters" IS NULL
      OR (
        "accuracy_meters" NOT IN ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
        AND "accuracy_meters" >= 0
      )
    )
);

ALTER TABLE "registrations"
  ADD COLUMN "service_location_id" TEXT,
  ADD COLUMN "service_location_assignment_id" TEXT,
  ADD COLUMN "service_location_code" TEXT,
  ADD COLUMN "service_location_name" TEXT,
  ADD COLUMN "service_location_address" TEXT,
  ADD COLUMN "service_location_effective_from" TIMESTAMP(3),
  ADD COLUMN "service_location_snapshot_at" TIMESTAMP(3);

ALTER TABLE "pickup_sessions"
  ADD COLUMN "presenter_user_id" TEXT,
  ADD COLUMN "meal_date" DATE,
  ADD COLUMN "intent_registration_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "intent_hash" TEXT,
  ADD COLUMN "intent_nonce" TEXT,
  ADD COLUMN "location_id" TEXT,
  ADD COLUMN "serving_verification_id" TEXT,
  ADD COLUMN "consumed_at" TIMESTAMP(3);

-- The legacy array was nullable. Normalize NULL to an empty set before copying
-- it into the new NOT NULL intent snapshot; no registration IDs are invented.
UPDATE "pickup_sessions"
SET "registration_ids" = ARRAY[]::TEXT[]
WHERE "registration_ids" IS NULL;

UPDATE "pickup_sessions" AS ps
SET "presenter_user_id" = CASE
      WHEN EXISTS (SELECT 1 FROM "users" AS u WHERE u."id" = ps."user_id")
        THEN ps."user_id"
      ELSE NULL
    END,
    "intent_registration_ids" = COALESCE(ps."registration_ids", ARRAY[]::TEXT[])
WHERE ps."presenter_user_id" IS NULL;

ALTER TABLE "meal_servings"
  ADD COLUMN "owner_user_id" TEXT,
  ADD COLUMN "owner_email_snapshot" TEXT,
  ADD COLUMN "owner_name_snapshot" TEXT,
  ADD COLUMN "presenter_user_id" TEXT,
  ADD COLUMN "receiver_type" "PickupReceiverType",
  ADD COLUMN "kitchen_user_id" TEXT,
  ADD COLUMN "kitchen_permission_context" TEXT,
  ADD COLUMN "scanner_device_id" TEXT,
  ADD COLUMN "location_id" TEXT,
  ADD COLUMN "location_short_code" TEXT,
  ADD COLUMN "location_name_snapshot" TEXT,
  ADD COLUMN "location_address_snapshot" TEXT,
  ADD COLUMN "meal_date" DATE,
  ADD COLUMN "menu_revision_id" TEXT,
  ADD COLUMN "request_id" TEXT,
  ADD COLUMN "pickup_session_id" TEXT,
  ADD COLUMN "intent_hash" TEXT,
  ADD COLUMN "verification_outcome" TEXT,
  ADD COLUMN "serving_verification_id" TEXT,
  ADD COLUMN "delegation_id" TEXT;

UPDATE "meal_servings" AS ms
SET "owner_user_id" = r."user_id",
    "meal_date" = r."meal_date"
FROM "registrations" AS r
WHERE r."id" = ms."registration_id";

UPDATE "meal_servings" AS ms
SET "owner_email_snapshot" = u."email",
    "owner_name_snapshot" = u."name"
FROM "users" AS u
WHERE u."id" = ms."owner_user_id";

ALTER TABLE "serving_confirm_requests"
  ADD COLUMN "request_body_hash" TEXT,
  ADD COLUMN "intent_hash" TEXT,
  ADD COLUMN "pickup_session_id" TEXT,
  ADD COLUMN "result_serving_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "result_snapshot" JSONB,
  ADD COLUMN "original_result_request_id" TEXT,
  ADD COLUMN "completed_at" TIMESTAMP(3),
  ADD COLUMN "conflict_code" TEXT;

CREATE UNIQUE INDEX "otp_allowlists_normalized_email_purpose_key"
  ON "otp_allowlists" ("normalized_email", "purpose");
CREATE INDEX "otp_allowlists_normalized_email_state_effective_idx"
  ON "otp_allowlists" ("normalized_email", "state", "effective_from", "effective_to");

CREATE INDEX "otp_challenges_normalized_email_purpose_expires_at_idx"
  ON "otp_challenges" ("normalized_email", "purpose", "expires_at");
CREATE INDEX "otp_challenges_allowlist_id_consumed_at_expires_at_idx"
  ON "otp_challenges" ("allowlist_id", "consumed_at", "expires_at");
CREATE INDEX "otp_challenges_expires_at_consumed_at_idx"
  ON "otp_challenges" ("expires_at", "consumed_at");

CREATE INDEX "otp_delivery_outboxes_status_next_attempt_at_idx"
  ON "otp_delivery_outboxes" ("status", "next_attempt_at");
CREATE INDEX "otp_delivery_outboxes_challenge_id_status_idx"
  ON "otp_delivery_outboxes" ("challenge_id", "status");

CREATE UNIQUE INDEX "auth_sessions_token_hash_key"
  ON "auth_sessions" ("token_hash");
CREATE INDEX "auth_sessions_user_id_revoked_at_idx"
  ON "auth_sessions" ("user_id", "revoked_at");
CREATE INDEX "auth_sessions_absolute_expires_at_revoked_at_idx"
  ON "auth_sessions" ("absolute_expires_at", "revoked_at");
CREATE INDEX "auth_sessions_idle_expires_at_revoked_at_idx"
  ON "auth_sessions" ("idle_expires_at", "revoked_at");

CREATE UNIQUE INDEX "locations_short_code_key"
  ON "locations" ("short_code");
CREATE INDEX "locations_is_active_effective_idx"
  ON "locations" ("is_active", "effective_from", "effective_to");

CREATE INDEX "location_policies_location_id_active_effective_idx"
  ON "location_policies" ("location_id", "is_active", "effective_from", "effective_to");

CREATE INDEX "roster_import_batches_imported_at_idx"
  ON "roster_import_batches" ("imported_at");
CREATE INDEX "employee_location_assignments_normalized_email_effective_idx"
  ON "employee_location_assignments" ("normalized_email", "effective_from", "effective_to");
CREATE INDEX "employee_location_assignments_employee_code_active_idx"
  ON "employee_location_assignments" ("employee_code", "is_active");
CREATE INDEX "employee_location_assignments_location_id_effective_idx"
  ON "employee_location_assignments" ("location_id", "effective_from", "effective_to");
CREATE INDEX "employee_location_assignments_roster_batch_idx"
  ON "employee_location_assignments" ("roster_import_batch_id");
CREATE UNIQUE INDEX "employee_location_assignments_active_employee_code_key"
  ON "employee_location_assignments" ("employee_code")
  WHERE "is_active";

CREATE INDEX "roster_import_rows_batch_id_outcome_idx"
  ON "roster_import_rows" ("batch_id", "outcome");
CREATE INDEX "roster_import_rows_normalized_email_idx"
  ON "roster_import_rows" ("normalized_email");

CREATE INDEX "serving_verifications_presenter_user_id_created_at_idx"
  ON "serving_verifications" ("presenter_user_id", "created_at");
CREATE INDEX "serving_verifications_location_id_result_captured_at_idx"
  ON "serving_verifications" ("location_id", "result", "captured_at");
CREATE INDEX "serving_verifications_retention_until_idx"
  ON "serving_verifications" ("retention_until");

CREATE INDEX "registrations_service_location_id_meal_date_idx"
  ON "registrations" ("service_location_id", "meal_date");
CREATE INDEX "registrations_service_location_assignment_id_idx"
  ON "registrations" ("service_location_assignment_id");

CREATE INDEX "pickup_sessions_presenter_user_id_meal_date_idx"
  ON "pickup_sessions" ("presenter_user_id", "meal_date");
CREATE INDEX "pickup_sessions_location_id_meal_date_idx"
  ON "pickup_sessions" ("location_id", "meal_date");
CREATE INDEX "pickup_sessions_serving_verification_id_idx"
  ON "pickup_sessions" ("serving_verification_id");
CREATE INDEX "pickup_sessions_intent_hash_idx"
  ON "pickup_sessions" ("intent_hash");

CREATE INDEX "meal_servings_owner_user_id_served_at_idx"
  ON "meal_servings" ("owner_user_id", "served_at");
CREATE INDEX "meal_servings_presenter_user_id_served_at_idx"
  ON "meal_servings" ("presenter_user_id", "served_at");
CREATE INDEX "meal_servings_kitchen_user_id_served_at_idx"
  ON "meal_servings" ("kitchen_user_id", "served_at");
CREATE INDEX "meal_servings_location_id_meal_date_idx"
  ON "meal_servings" ("location_id", "meal_date");
CREATE INDEX "meal_servings_pickup_session_id_idx"
  ON "meal_servings" ("pickup_session_id");
CREATE INDEX "meal_servings_request_id_idx"
  ON "meal_servings" ("request_id");
CREATE INDEX "meal_servings_intent_hash_idx"
  ON "meal_servings" ("intent_hash");
CREATE INDEX "meal_servings_served_at_idx"
  ON "meal_servings" ("served_at");
CREATE UNIQUE INDEX "meal_servings_delegation_id_key"
  ON "meal_servings" ("delegation_id")
  WHERE "delegation_id" IS NOT NULL;

CREATE INDEX "serving_confirm_requests_pickup_session_id_idx"
  ON "serving_confirm_requests" ("pickup_session_id");
CREATE INDEX "serving_confirm_requests_intent_hash_idx"
  ON "serving_confirm_requests" ("intent_hash");

ALTER TABLE "otp_allowlists"
  ADD CONSTRAINT "otp_allowlists_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "otp_challenges"
  ADD CONSTRAINT "otp_challenges_allowlist_id_fkey"
  FOREIGN KEY ("allowlist_id") REFERENCES "otp_allowlists" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "otp_delivery_outboxes"
  ADD CONSTRAINT "otp_delivery_outboxes_challenge_id_fkey"
  FOREIGN KEY ("challenge_id") REFERENCES "otp_challenges" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "location_policies"
  ADD CONSTRAINT "location_policies_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "roster_import_batches"
  ADD CONSTRAINT "roster_import_batches_imported_by_user_id_fkey"
  FOREIGN KEY ("imported_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_location_assignments"
  ADD CONSTRAINT "employee_location_assignments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_location_assignments_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_location_assignments_roster_import_batch_id_fkey"
  FOREIGN KEY ("roster_import_batch_id") REFERENCES "roster_import_batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "roster_import_rows"
  ADD CONSTRAINT "roster_import_rows_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "roster_import_batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "roster_import_rows_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "employee_location_assignments" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "serving_verifications"
  ADD CONSTRAINT "serving_verifications_presenter_user_id_fkey"
  FOREIGN KEY ("presenter_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "serving_verifications_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "serving_verifications_location_policy_id_fkey"
  FOREIGN KEY ("location_policy_id") REFERENCES "location_policies" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_service_location_id_fkey"
  FOREIGN KEY ("service_location_id") REFERENCES "locations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "registrations_service_location_assignment_id_fkey"
  FOREIGN KEY ("service_location_assignment_id") REFERENCES "employee_location_assignments" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Legacy pickup rows predate the user foreign key. Preserve any historical
-- orphan rows and enforce ownership for future writes; validation can occur
-- after a later ownership-reconciliation migration.
ALTER TABLE "pickup_sessions"
  ADD CONSTRAINT "pickup_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;
ALTER TABLE "pickup_sessions"
  ADD CONSTRAINT "pickup_sessions_presenter_user_id_fkey"
  FOREIGN KEY ("presenter_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "pickup_sessions_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "pickup_sessions_serving_verification_id_fkey"
  FOREIGN KEY ("serving_verification_id") REFERENCES "serving_verifications" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meal_servings"
  ADD CONSTRAINT "meal_servings_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "meal_servings_presenter_user_id_fkey"
  FOREIGN KEY ("presenter_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "meal_servings_kitchen_user_id_fkey"
  FOREIGN KEY ("kitchen_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "meal_servings_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "meal_servings_pickup_session_id_fkey"
  FOREIGN KEY ("pickup_session_id") REFERENCES "pickup_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "meal_servings_serving_verification_id_fkey"
  FOREIGN KEY ("serving_verification_id") REFERENCES "serving_verifications" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "meal_servings_delegation_id_fkey"
  FOREIGN KEY ("delegation_id") REFERENCES "pickup_delegations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "serving_confirm_requests"
  ADD CONSTRAINT "serving_confirm_requests_pickup_session_id_fkey"
  FOREIGN KEY ("pickup_session_id") REFERENCES "pickup_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "serving_confirm_requests_original_result_request_id_fkey"
  FOREIGN KEY ("original_result_request_id") REFERENCES "serving_confirm_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
