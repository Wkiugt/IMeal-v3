-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'SERVED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "PickupDelegationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ServingConfirmStatus" AS ENUM ('PROCESSING', 'SUCCESS', 'REJECTED');

-- CreateEnum
CREATE TYPE "PenaltyStatus" AS ENUM ('PENDING', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","permission_id")
);

-- CreateTable
CREATE TABLE "weekly_menus" (
    "id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_menus" (
    "id" TEXT NOT NULL,
    "weekly_menu_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "is_holiday" BOOLEAN NOT NULL DEFAULT false,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_menu_revisions" (
    "id" TEXT NOT NULL,
    "daily_menu_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_menu_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_days" (
    "id" TEXT NOT NULL,
    "daily_menu_id" TEXT NOT NULL,
    "meal_type" TEXT NOT NULL,
    "is_serving_ready" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "meal_date" DATE NOT NULL,
    "status" "RegistrationStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_delegations" (
    "id" TEXT NOT NULL,
    "registration_id" TEXT NOT NULL,
    "delegate_user_id" TEXT NOT NULL,
    "status" "PickupDelegationStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickup_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serving_confirm_requests" (
    "id" TEXT NOT NULL,
    "caller_user_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "ServingConfirmStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serving_confirm_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_servings" (
    "id" TEXT NOT NULL,
    "registration_id" TEXT NOT NULL,
    "served_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_servings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_events" (
    "id" TEXT NOT NULL,
    "meal_serving_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "penalties" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PenaltyStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "waived_at" TIMESTAMP(3),
    "waive_reason" TEXT,
    "waived_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "penalties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "pickup_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "registration_ids" TEXT[],
    "qr_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickup_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_menus_start_date_key" ON "weekly_menus"("start_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_menus_date_key" ON "daily_menus"("date");

-- CreateIndex
CREATE UNIQUE INDEX "meal_days_daily_menu_id_key" ON "meal_days"("daily_menu_id");

-- CreateIndex
CREATE INDEX "registrations_user_id_meal_date_idx" ON "registrations"("user_id", "meal_date");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_user_id_meal_date_key" ON "registrations"("user_id", "meal_date");

-- CreateIndex
CREATE UNIQUE INDEX "serving_confirm_requests_caller_user_id_idempotency_key_key" ON "serving_confirm_requests"("caller_user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "meal_servings_registration_id_key" ON "meal_servings"("registration_id");

-- CreateIndex
CREATE INDEX "penalties_user_id_status_idx" ON "penalties"("user_id", "status");

-- CreateIndex
CREATE INDEX "penalties_status_idx" ON "penalties"("status");

-- CreateIndex
CREATE INDEX "penalties_created_at_idx" ON "penalties"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");

-- CreateIndex
CREATE INDEX "pickup_sessions_expires_at_idx" ON "pickup_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "pickup_sessions_qr_hash_key" ON "pickup_sessions"("qr_hash");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_menus" ADD CONSTRAINT "daily_menus_weekly_menu_id_fkey" FOREIGN KEY ("weekly_menu_id") REFERENCES "weekly_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_menu_revisions" ADD CONSTRAINT "daily_menu_revisions_daily_menu_id_fkey" FOREIGN KEY ("daily_menu_id") REFERENCES "daily_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_days" ADD CONSTRAINT "meal_days_daily_menu_id_fkey" FOREIGN KEY ("daily_menu_id") REFERENCES "daily_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_delegations" ADD CONSTRAINT "pickup_delegations_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_delegations" ADD CONSTRAINT "pickup_delegations_delegate_user_id_fkey" FOREIGN KEY ("delegate_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_servings" ADD CONSTRAINT "meal_servings_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_events" ADD CONSTRAINT "meal_events_meal_serving_id_fkey" FOREIGN KEY ("meal_serving_id") REFERENCES "meal_servings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain invariants not expressible in Prisma schema.
ALTER TABLE "daily_menus"
ADD CONSTRAINT "daily_menus_enabled_holiday_check"
CHECK (NOT ("is_holiday" AND "is_enabled"));

CREATE UNIQUE INDEX "pickup_delegations_active_idx"
ON "pickup_delegations" ("registration_id")
WHERE "status" IN ('PENDING', 'ACCEPTED');

-- Canonical roles and permissions required by application guards.
INSERT INTO "roles" ("id", "name") VALUES
  ('10000000-0000-4000-8000-000000000001', 'staff'),
  ('10000000-0000-4000-8000-000000000002', 'kitchen'),
  ('10000000-0000-4000-8000-000000000003', 'admin');

INSERT INTO "permissions" ("id", "name") VALUES
  ('20000000-0000-4000-8000-000000000001', 'menu.manage'),
  ('20000000-0000-4000-8000-000000000002', 'kitchen.serve'),
  ('20000000-0000-4000-8000-000000000003', 'registration.cutoff.manage'),
  ('20000000-0000-4000-8000-000000000004', 'penalty.read'),
  ('20000000-0000-4000-8000-000000000005', 'penalty.resolve');

INSERT INTO "role_permissions" ("role_id", "permission_id") VALUES
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000004'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000005');
