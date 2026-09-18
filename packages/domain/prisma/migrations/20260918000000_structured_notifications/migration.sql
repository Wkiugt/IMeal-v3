-- Notification contract enums.
DO $$
BEGIN
  CREATE TYPE "NotificationKind" AS ENUM (
    'LEGACY_MESSAGE',
    'REGISTRATION_OPENED',
    'REGISTRATION_REMINDER',
    'PICKUP_REMINDER',
    'DELEGATION_REQUESTED',
    'DELEGATION_ACCEPTED',
    'DELEGATION_DECLINED',
    'DELEGATION_REVOKED',
    'PROXY_PICKUP_COMPLETED',
    'REGISTERED_MENU_CHANGED',
    'NO_SHOW_PENALTY_CREATED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "PushPlatform" AS ENUM ('IOS', 'ANDROID', 'UNKNOWN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "NotificationLocale" AS ENUM ('VI', 'EN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- User preferences and the authoritative weekly-menu publication marker.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "notification_locale" "NotificationLocale" NOT NULL DEFAULT 'VI',
  ADD COLUMN IF NOT EXISTS "reminders_enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "weekly_menus"
  ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP(3);

UPDATE "weekly_menus" AS wm
SET "published_at" = revisions."first_revision_at"
FROM (
  SELECT dm."weekly_menu_id", MIN(dmr."created_at") AS "first_revision_at"
  FROM "daily_menus" AS dm
  LEFT JOIN "daily_menu_revisions" AS dmr
    ON dmr."daily_menu_id" = dm."id"
  GROUP BY dm."weekly_menu_id"
  HAVING COUNT(DISTINCT dm."id") = COUNT(DISTINCT dmr."daily_menu_id")
) AS revisions
WHERE revisions."weekly_menu_id" = wm."id"
  AND wm."published_at" IS NULL;

-- Extend existing inbox rows before removing the legacy columns. Every existing
-- row remains readable as LEGACY_MESSAGE and is permanently deduplicated by id.
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "kind" "NotificationKind" NOT NULL DEFAULT 'LEGACY_MESSAGE',
  ADD COLUMN IF NOT EXISTS "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "title_vi" TEXT NOT NULL DEFAULT 'Thông báo',
  ADD COLUMN IF NOT EXISTS "body_vi" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "title_en" TEXT NOT NULL DEFAULT 'Notification',
  ADD COLUMN IF NOT EXISTS "body_en" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT;

UPDATE "notifications"
SET "body_vi" = "content",
    "body_en" = "content",
    "read_at" = CASE WHEN "is_read" THEN "created_at" ELSE NULL END,
    "dedupe_key" = 'legacy:' || "id"
WHERE "dedupe_key" IS NULL;

ALTER TABLE "notifications"
  ALTER COLUMN "dedupe_key" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupe_key_key"
  ON "notifications" ("dedupe_key");

ALTER TABLE "notifications"
  DROP COLUMN IF EXISTS "content",
  DROP COLUMN IF EXISTS "is_read";

CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_id_idx"
  ON "notifications" ("user_id", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "notifications_user_id_read_at_created_at_id_idx"
  ON "notifications" ("user_id", "read_at", "created_at" DESC, "id" DESC);

-- Push registrations are retained across refreshes and revocations.
ALTER TABLE "push_devices"
  ADD COLUMN IF NOT EXISTS "platform" "PushPlatform" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMP(3);

-- Worker-owned delivery state is separate from the durable inbox item.
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" TEXT NOT NULL,
  "notification_id" TEXT NOT NULL,
  "push_device_id" TEXT NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_deliveries_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "notifications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notification_deliveries_push_device_id_fkey"
    FOREIGN KEY ("push_device_id") REFERENCES "push_devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_notification_id_push_device_id_key"
  ON "notification_deliveries" ("notification_id", "push_device_id");

CREATE INDEX IF NOT EXISTS "notification_deliveries_status_next_attempt_at_idx"
  ON "notification_deliveries" ("status", "next_attempt_at");

-- Outbox rows are claimable/retryable and can be safely upserted by dedupe key.
ALTER TABLE "outbox_events"
  ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT,
  ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "processed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_error" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "outbox_events_dedupe_key_key"
  ON "outbox_events" ("dedupe_key");

-- Drain cancellation events queued by the pre-deploy API processor. The old
-- event and every structured notification/outbox event are committed together.
DO $$
DECLARE
  event_row RECORD;
  delegation_row RECORD;
  event_registration_id TEXT;
  notification_id TEXT;
  meal_date_text TEXT;
  counterpart_name TEXT;
  dedupe_key_text TEXT;
BEGIN
  FOR event_row IN
    SELECT "id", "payload"
    FROM "outbox_events"
    WHERE "event_type" = 'REGISTRATION_CANCELLED'
      AND "status" = 'PENDING'
    ORDER BY "created_at", "id"
  LOOP
    event_registration_id := NULL;
    BEGIN
      event_registration_id := (event_row."payload"::jsonb ->> 'registrationId');
    EXCEPTION WHEN others THEN
      event_registration_id := NULL;
    END;

    IF event_registration_id IS NOT NULL THEN
      FOR delegation_row IN
        SELECT
          d."id" AS delegation_id,
          d."registration_id",
          d."delegate_user_id",
          r."meal_date",
          COALESCE(NULLIF(BTRIM(owner."name"), ''), NULLIF(BTRIM(owner."email"), ''), 'nhân viên') AS owner_name
        FROM "pickup_delegations" AS d
        INNER JOIN "registrations" AS r ON r."id" = d."registration_id"
        INNER JOIN "users" AS owner ON owner."id" = r."user_id"
        WHERE d."registration_id" = event_registration_id
          AND d."status" IN ('PENDING', 'ACCEPTED')
        ORDER BY d."id"
      LOOP
        UPDATE "pickup_delegations"
        SET "status" = 'REVOKED', "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = delegation_row.delegation_id
          AND "status" IN ('PENDING', 'ACCEPTED');

        meal_date_text := to_char(delegation_row."meal_date", 'YYYY-MM-DD');
        counterpart_name := delegation_row.owner_name;
        dedupe_key_text := 'delegation-revoked:' || delegation_row."delegate_user_id" || ':' || delegation_row.delegation_id;
        notification_id := md5('migration:notification:' || dedupe_key_text)::uuid::text;

        INSERT INTO "notifications" (
          "id", "user_id", "kind", "payload", "title_vi", "body_vi",
          "title_en", "body_en", "read_at", "dedupe_key", "created_at"
        ) VALUES (
          notification_id,
          delegation_row."delegate_user_id",
          'DELEGATION_REVOKED',
          jsonb_build_object(
            'delegationId', delegation_row.delegation_id,
            'registrationId', delegation_row."registration_id",
            'mealDate', meal_date_text,
            'counterpartName', counterpart_name,
            'reason', 'REGISTRATION_CANCELLED'
          ),
          'Ủy quyền đã thu hồi',
          'Yêu cầu nhận hộ từ ' || counterpart_name || ' cho ngày ' || meal_date_text || ' đã được thu hồi vì suất đã hủy.',
          'Pickup delegation revoked',
          'The pickup request from ' || counterpart_name || ' for ' || meal_date_text || ' was revoked because the registration was canceled.',
          NULL,
          dedupe_key_text,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT ("dedupe_key") DO NOTHING;

        SELECT n."id"
        INTO notification_id
        FROM "notifications" AS n
        WHERE n."dedupe_key" = dedupe_key_text;

        INSERT INTO "outbox_events" (
          "id", "aggregate_type", "aggregate_id", "event_type", "payload", "status",
          "dedupe_key", "attempt_count", "available_at", "created_at"
        ) VALUES (
          md5('migration:outbox:notification-delivery:' || notification_id)::uuid::text,
          'NOTIFICATION',
          notification_id,
          'NOTIFICATION_CREATED',
          json_build_object('notificationId', notification_id)::text,
          'PENDING',
          'notification-delivery:' || notification_id,
          0,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT ("dedupe_key") DO NOTHING;
      END LOOP;
    END IF;

    UPDATE "outbox_events"
    SET "status" = 'PROCESSED',
        "processed_at" = CURRENT_TIMESTAMP
    WHERE "id" = event_row."id";
  END LOOP;
END
$$;
