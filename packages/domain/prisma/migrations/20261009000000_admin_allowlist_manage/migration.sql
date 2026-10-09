-- Canonical permission for the admin allow-list management API.
INSERT INTO "permissions" ("id", "name")
VALUES ('20000000-0000-4000-8000-000000000010', 'allowlist.manage')
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '10000000-0000-4000-8000-000000000003', "id"
FROM "permissions"
WHERE "name" = 'allowlist.manage'
ON CONFLICT DO NOTHING;
