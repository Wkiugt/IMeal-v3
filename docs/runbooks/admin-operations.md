# Admin audit, serving audit, and jobs

These screens are read-only admin APIs. They do not add delegation, proxy pickup, Kitchen scanning, or manual job replay.

## Permissions

Migration `20261006120000_admin_audit_and_job_runs` grants the admin role:

- `audit.read` — `GET /v1/admin/audit`
- `serving.read` — `GET /v1/admin/servings`
- `jobs.read` — `GET /v1/admin/jobs`

The same paths are also mounted without the `/v1` prefix. Guards match the other admin routes. HTTP tests that override the session service do not prove production authentication.

## Persisted audit

The API queries `AuditLog` with page pagination. Filters are time range, action, actor (`userId`), target user, result, and resource type. Target, result, and resource type are nullable indexed columns. Rows written before the columns were populated can still match the exact JSON keys `targetUserId`, `result`, and `resourceType`.

Responses redact OTP, session tokens, hashes, GPS, raw QR, and secrets from `details`. The Admin Web “Nhật ký phiên trình duyệt” list is browser memory only. “Kiểm toán đã lưu” is the persisted API.

## Serving audit

The serving screen reads `MealServing` plus registration, location, menu snapshot, check-in session id, and the authenticated confirm caller when a successful confirm request recorded that serving. Current self check-in has the same owner and authenticated actor. `receiverType=PROXY`, delegation id, and pickup session id are historical evidence only.

Raw QR, GPS coordinates, OTP, and session tokens are not selected or returned.

## Jobs and health

The jobs screen returns the API health summary, a sanitized worker `/health/ready` summary read server-side from the private metrics transport origin, and recent `JobRun` rows. The worker URL, transport token, and request id are not returned. OTP delivery and notification dispatch loops write `otp_delivery_` and `notification_dispatch_` rows with sanitized codes and integer counts only.

There is no retry button. No idempotent admin replay operation exists, and this change does not add one. New job rows store a sanitized failure code, a fixed failure message, integer counts, and the already configured release version when it matches the safe token pattern.
