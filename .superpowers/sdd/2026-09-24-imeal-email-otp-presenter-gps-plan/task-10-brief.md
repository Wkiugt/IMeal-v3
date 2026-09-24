### Task 10: Add Admin Web operations, audit views, and no-admin-role boundary

**Files:**
- Modify: `apps/admin-web/src/main.ts`
- Modify: `apps/admin-web/src/styles.css`
- Create: `apps/admin-web/src/admin-operations.ts`
- Modify: `apps/api/src/admin/locations/locations.controller.ts` and `apps/api/src/locations/locations.service.ts` only to keep policy coordinates server-side while supporting coordinate-free existing-policy updates
- Modify: `apps/api/test/admin-operations.e2e-spec.ts`
- SDD: `.superpowers/sdd/2026-09-24-imeal-email-otp-presenter-gps-plan/task-10-brief.md`, `task-10-report.md`, `progress.md`

**Interfaces:**
- Consumes Task 6 authorized location, allowlist, roster preview/commit endpoints and Task 4 opaque authenticated session (`/auth/otp/request`, `/auth/otp/verify`, `/auth/me`, `/auth/logout`).
- Produces named pure functions `toRosterPreviewRows`, `toSafeAuditEntry`, `toRosterImportRequest`, and `selectEffectiveLocationPolicy` with explicit types.
- Admin Web exposes only permission-gated location/policy/scanner, allowlist, roster preview/atomic commit, and redacted audit-result surfaces. It does not add admin-role lifecycle, seed actions, arbitrary exports, or raw OTP/session/GPS evidence views.
- Admin API location responses omit policy latitude/longitude. Existing policy update requests may omit coordinates; the service resolves and validates existing coordinates inside the same transaction. New policy creation still requires coordinates and remains server-only.

**Acceptance and verification:**
1. API e2e coverage proves permission denial, preview-before-commit, rejected-row/no-partial-commit behavior, policy coordinate redaction, coordinate-free existing-policy update, and absence of an admin-role lifecycle route.
2. OTP login requests and verifies the current opaque session; allowlist existence is not disclosed in copy; logout revokes the session.
3. Location forms update only approved records and effective policies, preserve server-provided optional fields, and assign scanner devices without carrying raw coordinates in Admin Web state/request/render.
4. Roster input is strict JSON, shaped through `toRosterImportRequest`, displayed with row-level preview outcomes, and commit is enabled only for a valid server preview with a batch ID.
5. `toSafeAuditEntry` is fail-closed for arbitrary/free-form details and sensitive values; audit cards show only scalar operation outcomes.
6. Future location policies are not treated as current; `selectEffectiveLocationPolicy` requires active/effective date bounds.
7. Admin Web has no Vitest setup or dependency; use typecheck/build plus browser smoke. API e2e tests use the repository's existing Vitest/Nest patterns.

**Known verification limitation:** the repository default API Vitest config includes only `**/*.spec.ts`, while this required file is `admin-operations.e2e-spec.ts`; focused execution therefore uses a throwaway equivalent config without the DB setup. The repository e2e config requires `DATABASE_URL` before discovery, unavailable in this workspace.
