-- Canonical permission for the admin user/account lifecycle API.
INSERT INTO "permissions" ("id", "name")
VALUES ('20000000-0000-4000-8000-000000000006', 'user.manage');

INSERT INTO "role_permissions" ("role_id", "permission_id")
VALUES (
  '10000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000006'
);
