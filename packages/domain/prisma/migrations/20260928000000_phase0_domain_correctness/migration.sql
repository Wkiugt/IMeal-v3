-- Phase 0 domain correctness: additive expand only.
-- This migration adds nullable historical fields and constraints without mutating
-- existing rows or inserting operational data. Run preflight.sql and the
-- approved backfill.sql separately before validating the NOT VALID checks.

ALTER TABLE "daily_menu_revisions"
  ADD COLUMN "revision" INTEGER,
  ADD COLUMN "meal_name" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "image_url" TEXT,
  ADD COLUMN "created_by_user_id" TEXT;

ALTER TABLE "meal_days"
  ADD COLUMN "menu_name_snapshot" TEXT,
  ADD COLUMN "menu_description_snapshot" TEXT,
  ADD COLUMN "menu_image_snapshot" TEXT,
  ADD COLUMN "locked_at" TIMESTAMP(3),
  ADD COLUMN "service_start_at" TIMESTAMP(3),
  ADD COLUMN "service_end_at" TIMESTAMP(3);

ALTER TABLE "registrations"
  ADD COLUMN "menu_revision_id" TEXT,
  ADD COLUMN "owner_name_snapshot" TEXT,
  ADD COLUMN "employee_code_snapshot" TEXT,
  ADD COLUMN "menu_name_snapshot" TEXT,
  ADD COLUMN "menu_description_snapshot" TEXT,
  ADD COLUMN "menu_image_snapshot" TEXT,
  ADD COLUMN "registered_at" TIMESTAMP(3),
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "cancel_reason" TEXT,
  ADD COLUMN "cancelled_by_user_id" TEXT,
  ADD COLUMN "no_show_at" TIMESTAMP(3);

ALTER TABLE "meal_servings"
  ADD COLUMN "menu_name_snapshot" TEXT,
  ADD COLUMN "menu_description_snapshot" TEXT,
  ADD COLUMN "menu_image_snapshot" TEXT;

ALTER TABLE "penalties"
  ADD COLUMN "registration_id" TEXT,
  ADD COLUMN "meal_date" DATE;

CREATE UNIQUE INDEX "daily_menu_revisions_daily_menu_id_revision_key"
  ON "daily_menu_revisions" ("daily_menu_id", "revision");

CREATE INDEX "registrations_menu_revision_id_idx"
  ON "registrations" ("menu_revision_id");

CREATE INDEX "penalties_meal_date_idx"
  ON "penalties" ("meal_date");

CREATE UNIQUE INDEX "penalties_registration_id_key"
  ON "penalties" ("registration_id")
  WHERE "registration_id" IS NOT NULL;

ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_menu_revision_id_fkey"
  FOREIGN KEY ("menu_revision_id")
  REFERENCES "daily_menu_revisions" ("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "penalties"
  ADD CONSTRAINT "penalties_registration_id_fkey"
  FOREIGN KEY ("registration_id")
  REFERENCES "registrations" ("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "registrations"
  ADD CONSTRAINT "registration_lifecycle_snapshot_complete"
  CHECK (
    "registered_at" IS NULL
    OR (
      "menu_revision_id" IS NOT NULL
      AND "menu_name_snapshot" IS NOT NULL
      AND "owner_name_snapshot" IS NOT NULL
      AND "employee_code_snapshot" IS NOT NULL
      AND "service_location_id" IS NOT NULL
      AND "service_location_assignment_id" IS NOT NULL
      AND "service_location_code" IS NOT NULL
      AND "service_location_name" IS NOT NULL
      AND "service_location_address" IS NOT NULL
      AND "service_location_effective_from" IS NOT NULL
      AND "service_location_snapshot_at" IS NOT NULL
      AND ("status" <> 'NO_SHOW' OR "no_show_at" IS NOT NULL)
      AND ("status" <> 'CANCELLED'
        OR ("cancelled_at" IS NOT NULL
          AND "cancel_reason" IS NOT NULL
          AND "cancelled_by_user_id" IS NOT NULL))
    )
  ) NOT VALID;

CREATE FUNCTION "registration_serving_consistent"("r" "registrations")
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $function$
  SELECT NOT (
    ("r"."status" = 'SERVED' AND NOT EXISTS (
      SELECT 1
      FROM "meal_servings" AS ms
      WHERE ms."registration_id" = "r"."id"
    ))
    OR ("r"."status" IN ('NO_SHOW', 'CANCELLED') AND EXISTS (
      SELECT 1
      FROM "meal_servings" AS ms
      WHERE ms."registration_id" = "r"."id"
    ))
  )
$function$;

ALTER TABLE "registrations"
  ADD CONSTRAINT "registration_serving_consistency"
  CHECK ("registration_serving_consistent"("registrations")) NOT VALID;

CREATE FUNCTION "assert_registration_serving_consistency"(_registration_id TEXT)
RETURNS VOID
LANGUAGE PLPGSQL
AS $function$
DECLARE
  registration_row "registrations";
BEGIN
  SELECT r.*
  INTO registration_row
  FROM "registrations" AS r
  WHERE r."id" = _registration_id;

  IF registration_row."id" IS NULL THEN
    RETURN;
  END IF;

  IF NOT "registration_serving_consistent"(registration_row) THEN
    RAISE EXCEPTION 'registration and meal serving state is inconsistent'
      USING ERRCODE = '23514',
            CONSTRAINT = 'registration_serving_consistency';
  END IF;
END;
$function$;

CREATE FUNCTION "enforce_registration_serving_on_registration"()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $function$
BEGIN
  IF NOT "registration_serving_consistent"(NEW) THEN
    RAISE EXCEPTION 'registration and meal serving state is inconsistent'
      USING ERRCODE = '23514',
            CONSTRAINT = 'registration_serving_consistency';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION "enforce_registration_serving_on_meal_serving"()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM "assert_registration_serving_consistency"(OLD."registration_id");
  END IF;

  IF TG_OP <> 'DELETE' THEN
    PERFORM "assert_registration_serving_consistency"(NEW."registration_id");
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "registrations_serving_consistency_trigger"
AFTER INSERT OR UPDATE ON "registrations"
FOR EACH ROW
EXECUTE FUNCTION "enforce_registration_serving_on_registration"();

CREATE TRIGGER "meal_servings_registration_consistency_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "meal_servings"
FOR EACH ROW
EXECUTE FUNCTION "enforce_registration_serving_on_meal_serving"();
