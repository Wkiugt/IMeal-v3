### Task 11: Update environment, documentation, and operational verification

**Files:**
- Modify: `.env.example`
- Modify: `apps/api/src/config/environment.ts`, worker config validation
- Modify: `docs/05-backend-structure.md`
- Modify: `docs/02-technical-requirements.md`
- Modify: `docs/03-product-flows.md`
- Modify: `docs/local-role-testing.md`
- Modify: `docs/README.md`
- Test/verification: focused config tests, contract/API/mobile/domain suites from prior tasks

**Interfaces:**
- Consumes: final auth, worker, location, pickup, mobile and admin behavior from Tasks 3–10.
- Produces: executable environment contract and documentation that describes only OTP production auth, harness-only bypass, foreground presenter GPS, four approved records, exact intent and residual risk.

- [ ] **Step 1: Write failing configuration/documentation checks**

Add focused configuration assertions that production rejects missing provider/session settings, unsafe local bypass, missing GPS policy bounds, and invalid serving-time configuration. Add a documentation review checklist test or script only if an existing repository convention supports it; otherwise use the explicit manual checklist in Step 3.

- [ ] **Step 2: Run the RED configuration check**

Run:

```sh
yarn workspace @imeal/api exec vitest run src/config/environment.spec.ts
```

Expected: FAIL for the new required OTP/session/provider/policy validation until `.env.example` and environment parsing are updated.

- [ ] **Step 3: Implement environment and documentation cutover**

Document variable names and safe semantics in `.env.example`, including provider configuration, session idle/absolute lifetimes, OTP expiry/attempt/rate limits, worker retry limits, GPS freshness/accuracy defaults and explicit production bypass prohibition. Never put secrets or real location/employee data in tracked files.

Update docs to state:

- OTP allowlist A is sole production authentication.
- Local bypass is harness-only and unavailable in production.
- Sessions are opaque/hash-backed and server-revalidated.
- Four real locations must be imported/approved before production; no fabricated names/coordinates/roster.
- Roster fixes employee-to-location assignment and registration snapshots history.
- Presenter-only foreground GPS has Retry/Refresh-only failure behavior.
- QR/session timing, exact intent, delegation and all-or-nothing/idempotency rules remain canonical.
- Kitchen sends no GPS.
- Residual screenshot/device/GPS-spoofing risk is reduced, not eliminated.
- Sensitive logs and retained evidence are minimized and audited.

Update `docs/local-role-testing.md` so test credentials/bypass are explicitly non-production and do not describe them as supported production auth.

- [ ] **Step 4: Run the GREEN configuration and verification commands**

Run:

```sh
yarn workspace @imeal/api exec vitest run src/config/environment.spec.ts
yarn workspace @imeal/contracts test
yarn workspace @imeal/api test -- --runInBand src/auth src/pickup src/admin
yarn workspace @imeal/worker exec vitest run src/otp-delivery-worker.service.spec.ts
yarn workspace @imeal/core test
```

Expected: configuration and focused suites pass. Do not claim production readiness until a real organization-approved four-location import and roster import have been performed outside source control.

- [ ] **Step 5: Commit operational contract updates**

```sh
git add .env.example apps/api/src/config/environment.ts docs/05-backend-structure.md docs/02-technical-requirements.md docs/03-product-flows.md docs/local-role-testing.md docs/README.md
git commit -m "docs: document otp presenter gps operational boundaries"
```
