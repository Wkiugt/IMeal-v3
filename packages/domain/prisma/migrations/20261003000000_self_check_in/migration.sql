-- Self check-in foundation. Existing pickup/delegation rows remain untouched for history.
CREATE TABLE "check_in_sessions" (
    "id" TEXT NOT NULL,
    "meal_date" DATE NOT NULL,
    "location_id" TEXT NOT NULL,
    "qr_hash" TEXT NOT NULL,
    "active_from" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "check_in_sessions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "serving_confirm_requests"
  ADD COLUMN "check_in_session_id" TEXT;

ALTER TABLE "meal_servings"
  ADD COLUMN "check_in_session_id" TEXT;

CREATE UNIQUE INDEX "check_in_sessions_qr_hash_key"
  ON "check_in_sessions" ("qr_hash");

CREATE UNIQUE INDEX "check_in_sessions_meal_date_location_id_key"
  ON "check_in_sessions" ("meal_date", "location_id");

CREATE INDEX "check_in_sessions_expires_at_idx"
  ON "check_in_sessions" ("expires_at");

CREATE INDEX "serving_confirm_requests_check_in_session_id_idx"
  ON "serving_confirm_requests" ("check_in_session_id");

CREATE INDEX "meal_servings_check_in_session_id_idx"
  ON "meal_servings" ("check_in_session_id");

ALTER TABLE "check_in_sessions"
  ADD CONSTRAINT "check_in_sessions_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "check_in_sessions"
  ADD CONSTRAINT "check_in_sessions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "serving_confirm_requests"
  ADD CONSTRAINT "serving_confirm_requests_check_in_session_id_fkey"
  FOREIGN KEY ("check_in_session_id") REFERENCES "check_in_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meal_servings"
  ADD CONSTRAINT "meal_servings_check_in_session_id_fkey"
  FOREIGN KEY ("check_in_session_id") REFERENCES "check_in_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
