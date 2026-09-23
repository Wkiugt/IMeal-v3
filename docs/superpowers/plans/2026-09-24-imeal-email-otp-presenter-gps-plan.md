# IMeal Email OTP, Presenter GPS, and Four-Location Serving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace production Entra/local authentication with allowlist-A email OTP and opaque database sessions, then add approved four-location roster data, presenter-only foreground GPS, exact QR intent, and auditable all-or-nothing serving without inventing operational location data.

**Architecture:** Keep PostgreSQL and the NestJS API authoritative for identity, authorization, OTP challenges, sessions, roster assignments, locations, pickup intent, GPS verification, and serving transactions. Add an OTP delivery outbox and worker so the API transaction never depends on provider delivery; expose versioned Zod contracts to mobile and Admin Web. Preserve the existing Vietnam business-time rules and delegation transaction model while binding each serving to a server-resolved location and immutable actor/location snapshots.

**Tech Stack:** TypeScript, NestJS/Fastify, Prisma/PostgreSQL, Yarn 4.18.0 workspaces, Zod contracts, Vitest, Supertest, Expo/React Native foreground location APIs, Admin Web/Vite, worker scheduled/outbox processing.

**Spec:** `docs/superpowers/specs/2026-09-24-imeal-email-otp-presenter-gps-design.md`

## Global Constraints

- Email OTP through allowlist A is the sole production authentication method; the only exception is an explicitly enabled non-production harness bypass.
- An email that is not allowlisted receives the same non-disclosing response as an unknown or disabled address; the endpoint must not reveal whether an address exists.
- Persist only an OTP verifier/hash and expiry metadata; never persist or log the clear OTP.
- OTP use is single-use and atomic, with bounded attempts, resend throttling, per-address/client rate limits, and abuse/audit events.
- Production authentication has no federated identity, username/password, email-domain authorization, client-supplied role, employee code, or account status path.
- A successful OTP creates only a high-entropy opaque session identifier; PostgreSQL stores only a one-way hash plus minimized session metadata.
- Every protected request resolves current account status and authorization server-side; logout, disable, compromise, replay, and explicit revocation invalidate sessions.
- Exactly four operational location records are in scope, but the repository has no authoritative real names, addresses, coordinates, or assignments; implementation MUST NOT fabricate seed data.
- Location selection is server-side; client coordinates cannot select a more permissive site. Historical serving retains an effective location snapshot.
- Employee location is fixed by administrator-managed roster/import, not mobile input, email domain, GPS, or QR payload.
- Presenter GPS is collected only during foreground pickup/serving use; owner GPS is never collected merely because delegation exists.
- GPS is an additional serving-time signal and never grants entitlement or bypasses authentication, authorization, QR, delegation, registration, serving-window, or concurrency checks.
- GPS failure exposes only Retry and Refresh; no manual bypass, silent fallback, or automatic substitution is allowed.
- QR lifetime is 5 seconds, maximum accepted clock skew is 2 seconds, and a resolved pickup session lasts 30 seconds.
- Exact sorted intent is preserved from selection through QR, resolve, and confirm. A stale/ineligible item is rejected without replacement; confirm cannot submit a subset or expansion.
- Delegation requires acceptance; no self-delegation, delegation chain, concurrent active delegation, or delegate re-delegation is permitted.
- Serving is within 10:30–13:30 in `Asia/Ho_Chi_Minh`; Kitchen confirmation is explicit and does not require Kitchen GPS.
- Multi-item confirmation is all-or-nothing and idempotent. Same caller/key/body returns the original result; same key with a different body/intent returns a conflict.
- Serving is final in core v2; no reversal/re-serve API is added.
- All timestamps are UTC instants; business-date and serving-window calculations use existing Vietnam-time helpers.
- Sensitive logs and provider payloads must not contain OTP values, full email content, session secrets, QR payloads, or unnecessary raw coordinates.
- Database changes require Prisma migrations. Generated Prisma output is never hand-edited.
- Existing callers are migrated in the same cutover; no compatibility aliases or dual production authentication paths remain.
- Current work creates only this plan and commits it; it does not modify production code, run tests, build, or create fabricated operational data.

---

## File map and ownership

| File | Action | Responsibility after implementation |
| --- | --- | --- |
| `packages/domain/prisma/schema.prisma` | Modify | OTP allowlist/challenge/outbox, opaque sessions, locations, roster assignments, serving verification and immutable attribution models; preserve effective/history relations. |
| `packages/domain/prisma/migrations/20260924000000_email_otp_presenter_gps/migration.sql` | Create via Prisma migration | Relational tables, enums, indexes, constraints, and no fabricated location/employee rows. |
| `packages/contracts/src/v1/auth.ts` | Create | OTP request/verify, session/logout, safe auth errors, and current-user response schemas. |
| `packages/contracts/src/v1/locations.ts` | Create | Four-location records, roster import rows/results, GPS policy and admin import contracts. |
| `packages/contracts/src/v1/pickup.ts` | Modify | Exact intent, QR, resolve/confirm, presenter evidence, location context, stable GPS/session/idempotency errors. |
| `packages/contracts/src/v1/index.ts` | Modify | Export the new auth/location contracts and revised pickup types. |
| `packages/contracts/src/v1/errors.ts` | Modify | Stable non-disclosing OTP, session, GPS, exact-intent, and serving conflict codes. |
| `apps/api/src/auth/allowlist.service.ts` | Create | Normalize and resolve allowlist-A records without enumeration. |
| `apps/api/src/auth/otp.service.ts` | Create | Generate/hash/consume challenges, enforce attempts/throttles, audit and enqueue delivery. |
| `apps/api/src/auth/session.service.ts` | Create | Hash opaque tokens, create/resolve/revoke sessions, enforce expiry and current account state. |
| `apps/api/src/auth/auth.service.ts` | Modify | Replace production Entra/local bootstrap with OTP session bootstrap; retain only explicitly non-production harness injection. |
| `apps/api/src/auth/auth.controller.ts` | Modify | OTP request/verify/logout endpoints and safe response behavior. |
| `apps/api/src/auth/session.guard.ts` | Create/Modify | Resolve bearer/cookie session through `SessionService`, then recheck permissions. |
| `apps/api/src/auth/authenticated-user.ts` | Modify | Represent server-resolved principal and session metadata without client-asserted role/location claims. |
| `apps/api/src/auth/local-auth.ts` | Modify/Delete production path | Make bypass impossible in production and unavailable as a documented production method. |
| `apps/api/src/auth/*.spec.ts` | Modify/Create | OTP, session, enumeration, revocation, bypass and audit tests. |
| `apps/api/src/otp/otp-outbox.service.ts` | Create | Claim/retry/mark OTP delivery outbox records without logging secret values. |
| `apps/api/src/otp/otp-provider.ts` | Create | Provider abstraction accepting only minimal verification copy and clear OTP at the final delivery boundary. |
| `apps/worker/src/otp-delivery-worker.service.ts` | Create | Process OTP outbox with bounded retry/backoff and provider-safe logging. |
| `apps/worker/src/app.module.ts` | Modify | Register OTP delivery worker. |
| `apps/worker/src/otp-delivery-worker.service.spec.ts` | Create | Retry, claim, success/failure, and secret-redaction tests. |
| `apps/api/src/locations/locations.service.ts` | Create | Server-side active/effective location resolution and geofence policy lookup. |
| `apps/api/src/locations/locations.module.ts` | Create | Location service/controller wiring. |
| `apps/api/src/admin/locations/locations.controller.ts` | Create | Authorized location configuration and audit endpoints; no seed endpoint. |
| `apps/api/src/admin/roster/roster-import.service.ts` | Create | Atomic, idempotent email/employee-code/location assignment imports and row results. |
| `apps/api/src/admin/roster/roster.controller.ts` | Create | Authorized import preview/commit endpoints. |
| `apps/api/src/admin/allowlist/allowlist.controller.ts` | Create | Authorized allowlist management without admin-role lifecycle. |
| `apps/api/src/admin/**/*.spec.ts` | Create/Modify | Permission, atomic import, audit, no-fabricated-data tests. |
| `apps/api/src/pickup/pickup.service.ts` | Modify | Exact QR/intent resolution, presenter GPS verification, location binding, transaction revalidation, actor snapshots, idempotency. |
| `apps/api/src/pickup/pickup.controller.ts` | Modify | Generate QR accepts authenticated presenter evidence; resolve/confirm accept authenticated Kitchen actor and stable errors. |
| `apps/api/src/pickup/pickup.module.ts` | Modify | Inject location, session, roster, and audit collaborators. |
| `apps/api/src/pickup/pickup.service.spec.ts` | Modify | Exact-set, GPS, location, timing, delegation, race, idempotency and all-or-nothing tests. |
| `apps/api/test/pickup.e2e-spec.ts` | Modify | HTTP contract and authorization coverage for resolve/confirm. |
| `packages/domain/src/RegistrationService.ts` | Modify | Registration service-location snapshot and derived serving state; preserve existing cutoff/delegation rules. |
| `packages/domain/test/registration.test.ts` | Modify | Snapshot/effective-location and serving-state invariants. |
| `apps/mobile/src/api/authAPI.ts` | Create | OTP request/verify/logout authenticated fetch wrappers. |
| `apps/mobile/src/api/pickupAPI.ts` | Modify | Exact selection, resolve, confirm, and presenter evidence transport. |
| `apps/mobile/src/api/locationAPI.ts` | Create | Effective presenter location context/policy fetch if required by API contract. |
| `apps/mobile/src/screens/auth/EmailOtpScreen.tsx` | Create/Modify | Non-enumerating request/verify UX, retry/throttle messaging, session bootstrap. |
| `apps/mobile/src/screens/pickup/PickupIntentScreen.tsx` | Modify | Explicit multi-item intent, foreground Expo GPS, Retry/Refresh-only recovery, QR invalidation. |
| `apps/mobile/src/screens/kitchen/KitchenScannerScreen.tsx` | Modify | Resolve/confirm exact intent; Kitchen sends no GPS and reviews verification status. |
| `apps/mobile/src/i18n/translations.ts` | Modify | Safe OTP, GPS explanation, Retry/Refresh, conflict and privacy copy. |
| `apps/mobile/src/api/*.test.ts` and pickup screen tests | Modify/Create | Transport and observable recovery behavior. |
| `apps/admin-web/src/main.ts` | Modify | Admin Web entry point for location, allowlist, roster, scanner and audit operations. |
| `apps/admin-web/src/styles.css` | Modify | Admin operation layout, validation states and redacted evidence presentation. |
| `apps/admin-web/src/admin-operations.ts` | Create | Named pure functions for roster preview rendering data, safe audit projection and operation request shaping. |
| `.env.example` | Modify | OTP provider/config, session secrets/expiry, GPS thresholds defaults/overrides and production bypass guard, without secrets. |
| `apps/api/src/config/environment.ts` and worker config | Modify | Validate production-safe configuration and reject unsafe bypass/provider settings. |
| `docs/05-backend-structure.md` | Modify | Canonical auth/session/location/serving table and flow updates. |
| `docs/local-role-testing.md` | Modify | Harness-only bypass instructions, explicitly marked non-production. |
| `docs/02-technical-requirements.md`, `docs/03-product-flows.md` | Modify | OTP, presenter GPS, exact intent and audit behavior aligned with approved spec. |
| `docs/README.md` | Modify | Reading order/canonical source references if new docs sections are added. |
| `docs/superpowers/specs/2026-09-24-imeal-email-otp-presenter-gps-design.md` | Do not modify | Approved source of truth. |

## Cross-task interfaces

The implementation must use these interfaces consistently; later tasks must not invent alternate names or shapes.

```ts
// packages/contracts/src/v1/auth.ts
export type RequestOtpInput = {
  email: string;
  purpose: 'SESSION_LOGIN';
};
export type RequestOtpResponse = {
  accepted: true;
  retryAfterSeconds?: number;
};
export type VerifyOtpInput = {
  email: string;
  purpose: 'SESSION_LOGIN';
  code: string;
};
export type VerifyOtpResponse = {
  sessionToken: string;
  expiresAt: string; // UTC ISO instant ending in Z
  user: { id: string; email: string; name: string | null };
};
export type LogoutResponse = { revoked: true };

// apps/api/src/auth/session.service.ts
export interface SessionService {
  create(input: { userId: string; purpose: 'SESSION_LOGIN'; requestId: string; metadata: SessionMetadata }): Promise<{ token: string; expiresAt: Date }>;
  resolve(rawToken: string): Promise<AuthenticatedUser | null>;
  revoke(sessionId: string, reason: SessionRevocationReason, requestId: string): Promise<void>;
}

// packages/contracts/src/v1/locations.ts
export type PresenterLocationEvidence = {
  capturedAt: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
};
export type LocationPolicy = {
  locationId: string;
  shortCode: string;
  timeZone: 'Asia/Ho_Chi_Minh';
  geofenceRadiusMeters: number;
  maxFixAgeSeconds: number;
  maxAccuracyMeters: number;
};
export type RosterImportRow = {
  email: string;
  name: string;
  employeeCode: string;
  isActive: boolean;
  role: string;
  serviceLocationCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

// packages/contracts/src/v1/pickup.ts
export type ExactPickupIntent = {
  presenterUserId: string;
  mealDate: string;
  registrationIds: string[]; // sorted, unique, non-empty
  nonce: string;
};
export type GenerateQrInput = {
  registrationIds: string[];
  presenterEvidence: PresenterLocationEvidence;
};
export type ResolvePickupInput = {
  qr: string;
};
export type ConfirmPickupInput = {
  pickupSessionId: string;
  idempotencyKey: string;
};
export type ServingVerification = {
  presenterUserId: string;
  receiverType: 'SELF' | 'PROXY';
  locationId: string;
  gps: { result: 'VALID'; capturedAt: string; accuracyMeters: number };
};
```

`AuthenticatedUser` is server-resolved and contains `id`, normalized email, current account status, permissions, and session ID. It never trusts role, employee code, location, or status supplied by a client or decoded token. `SessionRevocationReason` is the closed set `LOGOUT | ACCOUNT_DISABLED | COMPROMISED | OTP_REPLAY | ADMIN_REVOKED | EXPIRED`.

---

### Task 1: Establish versioned contracts and stable security/serving error codes

**Files:**
- Create: `packages/contracts/src/v1/auth.ts`
- Create: `packages/contracts/src/v1/locations.ts`
- Modify: `packages/contracts/src/v1/pickup.ts`
- Modify: `packages/contracts/src/v1/errors.ts`
- Modify: `packages/contracts/src/v1/index.ts`
- Test: `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Consumes: existing `MealDateSchema`, UTC schema conventions, existing pickup option schemas and envelope/error conventions.
- Produces: `RequestOtpInput`, `RequestOtpResponse`, `VerifyOtpInput`, `VerifyOtpResponse`, `LogoutResponse`, `PresenterLocationEvidence`, `LocationPolicy`, `RosterImportRow`, `ExactPickupIntent`, `GenerateQrInput`, `ResolvePickupInput`, `ConfirmPickupInput`, and stable codes consumed by all API/mobile/Admin tasks.

- [ ] **Step 1: Write the failing contract tests**

Add tests that assert strict schemas reject unknown fields and invalid values, while accepting these exact examples:

```ts
expect(v1.RequestOtpSchema.parse({ email: 'employee@example.test', purpose: 'SESSION_LOGIN' })).toEqual({
  email: 'employee@example.test',
  purpose: 'SESSION_LOGIN',
});
expect(v1.PresenterLocationEvidenceSchema.parse({
  capturedAt: '2026-09-24T03:00:00.000Z',
  latitude: 10.77,
  longitude: 106.69,
  accuracyMeters: 12,
})).toMatchObject({ accuracyMeters: 12 });
expect(() => v1.ConfirmPickupSchema.parse({ pickupSessionId: 's', idempotencyKey: '' })).toThrow();
expect(v1.PickupErrorCodeSchema.options).toEqual(expect.arrayContaining([
  'OTP_REQUEST_ACCEPTED',
  'OTP_INVALID_OR_EXPIRED',
  'SESSION_REVOKED',
  'GPS_RETRY_REQUIRED',
  'PICKUP_INTENT_CONFLICT',
  'PICKUP_SESSION_EXPIRED',
  'IDEMPOTENCY_CONFLICT',
]));
```

- [ ] **Step 2: Run the RED contract test**

Run:

```sh
yarn workspace @imeal/contracts exec vitest run test/contracts.test.ts
```

Expected: FAIL because the auth/location schemas and the new exact-intent/evidence fields and error codes are not exported yet.

- [ ] **Step 3: Implement the minimal schemas and exports**

Implement strict Zod schemas with these rules:

- Normalize/validate email at the API boundary but keep schema representation as a string.
- OTP response never contains the OTP code.
- UTC timestamps must be ISO instants ending in `Z`.
- Evidence latitude/longitude and non-negative accuracy are finite; registration IDs are non-empty, unique, and sorted by the service before schema output.
- `ConfirmPickupSchema` requires a non-empty idempotency key and non-empty exact registration set.
- GPS failure details contain only safe recovery instruction, never coordinates or precise distance.
- Export all symbols through `v1/index.ts`.

- [ ] **Step 4: Run the GREEN contract test**

Run:

```sh
yarn workspace @imeal/contracts exec vitest run test/contracts.test.ts
```

Expected: PASS with strict auth, location, pickup, and error contracts.

- [ ] **Step 5: Commit the contract boundary**

```sh
git add packages/contracts/src/v1/auth.ts packages/contracts/src/v1/locations.ts packages/contracts/src/v1/pickup.ts packages/contracts/src/v1/errors.ts packages/contracts/src/v1/index.ts packages/contracts/test/contracts.test.ts
git commit -m "feat(contracts): add otp location and exact pickup schemas"
```

---

### Task 2: Add the persistence model and migration without fabricated operational data

**Files:**
- Modify: `packages/domain/prisma/schema.prisma`
- Create: `packages/domain/prisma/migrations/20260924000000_email_otp_presenter_gps/migration.sql`
- Modify: `packages/domain/test/db-connection.spec.ts` if migration fixtures require assertions
- Test: `packages/domain/test/registration.test.ts`, new `packages/domain/test/emailOtpLocationServing.test.ts`

**Interfaces:**
- Consumes: contract types from Task 1 and existing `User`, `Registration`, `PickupDelegation`, `PickupSession`, `MealServing`, `AuditLog`, `OutboxEvent` models.
- Produces: Prisma models and relations used by Tasks 3–9: `OtpAllowlist`, `OtpChallenge`, `AuthSession`, `Location`, `LocationPolicy`, `EmployeeLocationAssignment`, `RosterImportBatch`, `OtpDeliveryOutbox`, `ServingVerification`, and expanded immutable `MealServing`/`PickupSession` records.

- [ ] **Step 1: Write failing persistence tests**

Add DB-backed assertions that:

```ts
it('has no location or employee rows after migration', async () => {
  expect(await prisma.location.count()).toBe(0);
  expect(await prisma.employeeLocationAssignment.count()).toBe(0);
});

it('requires one unique active session hash and one serving per registration', async () => {
  // create two rows with the same session hash and two servings for one registration;
  // each operation must reject at the database constraint boundary.
});

it('retains registration service-location snapshot after assignment changes', async () => {
  // create effective assignment and registration snapshot, change assignment, and
  // assert the registration snapshot remains unchanged.
});
```

- [ ] **Step 2: Run the RED persistence test**

Run:

```sh
yarn workspace @imeal/core exec vitest run test/emailOtpLocationServing.test.ts
```

Expected: FAIL because the new Prisma models, constraints, and registration/location snapshot fields do not exist.

- [ ] **Step 3: Add schema models and constraints**

Add fields/models with these required properties:

- `OtpAllowlist`: normalized email, optional canonical user ID, active/disabled state, purpose, effective dates, administrative audit fields.
- `OtpChallenge`: allowlist/email binding, purpose, verifier hash, expiry, attempt count/limit, consumed timestamp, resend metadata, client/address throttling metadata, request/audit linkage. Never store clear code.
- `OtpDeliveryOutbox`: challenge ID, minimal provider payload reference, status, attempts, next attempt, processed/error timestamps. Do not store full email content or clear OTP in durable logs.
- `AuthSession`: token hash, owner user ID, purpose/auth method, created/last-used/idle/absolute expiry, revoked timestamp/reason, minimized device metadata, audit linkage, unique hash.
- `Location`: immutable ID, short code, approved official names/addresses/serving point, timezone, active/effective dates, operational metadata, verification actor/time. Do not seed rows.
- `LocationPolicy`: location, latitude/longitude, accuracy source, radius, freshness and accuracy thresholds, effective dates.
- `EmployeeLocationAssignment`: normalized email/employee identity, employee code, capability/role, location code relation, effective dates, import batch and audit result. Enforce unique active employee code and reject ambiguous imports in service logic.
- `RosterImportBatch` and row results: actor, source, imported-at, row outcome/reason, audit event ID.
- `ServingVerification`: presenter, resolved location, evidence result/timestamp/accuracy, safe verification code, retention fields; avoid raw coordinate history.
- Expand `Registration` with effective service-location snapshot fields and assignment reference/snapshot values.
- Expand `PickupSession` with exact sorted intent hash/set, presenter identity, resolved location and verification linkage; preserve 30-second expiry and one-use QR hash.
- Expand `MealServing` with owner registration/user snapshot, presenter/receiver, pickup type, Kitchen actor, permission context, scanner/device, location snapshot, meal/menu revision reference, request ID, pickup session ID, intent hash, verification outcome, delegation ID.
- Expand `ServingConfirmRequest` with request body/intent hash and immutable original result linkage.
- Add indexes for OTP lookup/expiry, session lookup/revocation, effective location assignment, pickup-session expiry, serving audit queries.
- Preserve derived serving semantics rather than allowing a second mutable registration status source of truth; reconcile current `SERVED` usage through the migration plan and callers.

Run the Prisma migration generation command from the repository root with a descriptive name:

```sh
yarn workspace @imeal/core exec prisma migrate dev --name email_otp_presenter_gps --create-only
```

Review the generated SQL and remove any fabricated `Location` or roster inserts before applying it. The migration must be additive/transformative only and must preserve historical serving/audit data.

- [ ] **Step 4: Run the GREEN persistence tests**

Run:

```sh
yarn workspace @imeal/core exec vitest run test/emailOtpLocationServing.test.ts test/registration.test.ts
```

Expected: PASS; migration constraints hold, zero operational location/employee seed rows remain, and registration location snapshots survive assignment changes.

- [ ] **Step 5: Commit the schema boundary**

```sh
git add packages/domain/prisma/schema.prisma packages/domain/prisma/migrations packages/domain/test/emailOtpLocationServing.test.ts packages/domain/test/registration.test.ts
git commit -m "feat(domain): add otp session location roster and serving snapshots"
```

---

### Task 3: Implement allowlist-A OTP authentication and safe audit behavior

**Files:**
- Create: `apps/api/src/auth/allowlist.service.ts`
- Create: `apps/api/src/auth/otp.service.ts`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/auth/authenticated-user.ts`
- Modify: `apps/api/src/auth/local-auth.ts`
- Create/Modify: `apps/api/src/auth/otp.service.spec.ts`, `apps/api/src/auth/auth.controller.spec.ts`
- Modify: `apps/api/src/config/environment.ts`, `apps/api/src/config/environment.spec.ts`

**Interfaces:**
- Consumes: `RequestOtpInput`, `VerifyOtpInput`, `OtpAllowlist`, `OtpChallenge`, `AuditLog`, and `OtpDeliveryOutbox` from Tasks 1–2.
- Produces:
  - `AllowlistService.normalizeEmail(email: string): string`
  - `AllowlistService.findEligible(email: string, purpose: 'SESSION_LOGIN', at: Date): Promise<AllowlistResolution>`
  - `OtpService.request(input: RequestOtpInput, context: OtpRequestContext): Promise<RequestOtpResponse>`
  - `OtpService.verify(input: VerifyOtpInput, context: OtpVerifyContext): Promise<VerifiedOtpPrincipal>`
  - `AuthController.requestOtp()` and `AuthController.verifyOtp()` with indistinguishable safe responses.

- [ ] **Step 1: Write failing OTP tests**

Cover these observable behaviors:

```ts
it.each([
  ['unknown@example.test'],
  ['disabled@example.test'],
  ['not-allowlisted@example.test'],
])('returns the same safe request response for %s', async (email) => {
  const response = await service.request({ email, purpose: 'SESSION_LOGIN' }, context);
  expect(response).toEqual({ accepted: true });
});

it('does not create a challenge for an ineligible address', async () => {
  await service.request({ email: 'unknown@example.test', purpose: 'SESSION_LOGIN' }, context);
  expect(prisma.otpChallenge.create).not.toHaveBeenCalled();
});

it('stores only a verifier hash and atomically consumes a valid code', async () => {
  // assert the clear code is absent from create/audit arguments and second verify fails closed
});

it('rejects expired, replayed, excessive-attempt and mismatched-purpose codes', async () => {
  // assert one stable safe failure code for each condition without account enumeration
});
```

- [ ] **Step 2: Run the RED OTP tests**

Run:

```sh
yarn workspace @imeal/api exec vitest run src/auth/otp.service.spec.ts src/auth/auth.controller.spec.ts
```

Expected: FAIL because allowlist resolution, OTP challenge persistence, atomic consume, and controller endpoints are not implemented.

- [ ] **Step 3: Implement normalization, challenge generation and verification**

Implement the minimum behavior:

1. Normalize email deterministically before every lookup.
2. Resolve only an active allowlist record whose purpose and effective dates match.
3. Return the same accepted/non-disclosing request response for unknown, disabled, expired, and non-allowlisted addresses.
4. Generate cryptographically random OTP code, hash it with a server-side verifier strategy, persist only verifier/metadata, and enqueue delivery in the same transaction.
5. Enforce expiry, maximum attempts, resend throttle, per-address and per-client limits.
6. Consume the challenge atomically with a conditional update/transaction so replay cannot succeed.
7. Resolve the current canonical User after verification; do not create roles, employee assignment, delegation, registration or serving entitlement.
8. Write audit events with redacted purpose/result/request ID; do not log code, full email content, session token or provider payload.
9. Reject production startup/configuration when local bypass is enabled or required OTP/session settings are absent. Keep the bypass injectable only for explicit non-production harness tests.

- [ ] **Step 4: Run the GREEN OTP tests**

Run:

```sh
yarn workspace @imeal/api exec vitest run src/auth/otp.service.spec.ts src/auth/auth.controller.spec.ts src/config/environment.spec.ts
```

Expected: PASS for indistinguishable responses, one-time hash-backed verification, throttles, audit redaction and production bypass rejection.

- [ ] **Step 5: Commit the OTP authentication boundary**

```sh
git add apps/api/src/auth apps/api/src/config/environment.ts apps/api/src/config/environment.spec.ts
git commit -m "feat(api): add allowlist email otp authentication"
```

---

### Task 4: Add opaque database sessions and remove production Entra/local bootstrap

**Files:**
- Create: `apps/api/src/auth/session.service.ts`
- Create/Modify: `apps/api/src/auth/session.guard.ts`
- Modify: `apps/api/src/auth/jwt-auth.guard.ts`, `apps/api/src/auth/auth.module.ts`, `apps/api/src/auth/auth.controller.ts`
- Modify/Delete production path: `apps/api/src/auth/jwt.strategy.ts`, `apps/api/src/auth/local-auth.ts`, `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/session.service.spec.ts`, `apps/api/src/auth/session.guard.spec.ts`
- Modify: protected-controller specs under `apps/api/src/**`

**Interfaces:**
- Consumes: `VerifiedOtpPrincipal` from Task 3 and `AuthSession` from Task 2.
- Produces: `SessionService.create`, `SessionService.resolve`, `SessionService.revoke`, and a guard that attaches only a server-resolved `AuthenticatedUser` to requests.

- [ ] **Step 1: Write failing session tests**

```ts
it('returns an opaque token while storing only its one-way hash', async () => {
  const result = await service.create({ userId: 'u1', purpose: 'SESSION_LOGIN', requestId: 'r1', metadata: minimalMetadata });
  expect(result.token).not.toEqual(expect.stringContaining('u1'));
  expect(prisma.authSession.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ tokenHash: expect.any(String), userId: 'u1' }),
  }));
  expect(JSON.stringify(prisma.authSession.create.mock.calls)).not.toContain(result.token);
});

it('rechecks current account status and permissions on every resolve', async () => {
  // active resolves; disabled or revoked returns null even with an unexpired token
});

it('revokes logout, disable, compromise, replay and administrative sessions', async () => {
  // assert revokedAt/reason and subsequent resolve failure
});
```

- [ ] **Step 2: Run the RED session tests**

Run:

```sh
yarn workspace @imeal/api exec vitest run src/auth/session.service.spec.ts src/auth/session.guard.spec.ts
```

Expected: FAIL because no opaque session service/guard exists and protected routes still expect JWT claims.

- [ ] **Step 3: Implement opaque session resolution and clean cutover**

Implement high-entropy random token generation, one-way hash lookup, idle/absolute expiry, last-used update, revocation reason, minimized metadata, and request audit linkage. Wire `VerifyOtp` to create exactly one session and return only the opaque token over HTTPS. Replace production authentication guard usage with session resolution. Remove production Entra/local authentication paths and any client-claim role/status/employee-code trust. Keep only an explicitly test-configured harness bypass that fails closed under production configuration and is absent from production docs.

Update logout and account-disable paths to call `SessionService.revoke`. Ensure all protected API callers receive current permissions from PostgreSQL.

- [ ] **Step 4: Run the GREEN session tests**

Run:

```sh
yarn workspace @imeal/api exec vitest run src/auth/session.service.spec.ts src/auth/session.guard.spec.ts src/auth/auth.controller.spec.ts
```

Expected: PASS; token contents are opaque, DB stores only hashes, revocation/status/permission checks are server-side, and production has no alternate auth bootstrap.

- [ ] **Step 5: Commit the clean authentication cutover**

```sh
git add apps/api/src/auth apps/api/src/**/__tests__ apps/api/src/config/environment.ts
 git commit -m "feat(api): replace production jwt bootstrap with opaque sessions"
```

---

### Task 5: Add OTP delivery outbox and worker processing

**Files:**
- Create: `apps/api/src/otp/otp-provider.ts`
- Create: `apps/api/src/otp/otp-outbox.service.ts`
- Modify: `apps/api/src/auth/otp.service.ts`, `apps/api/src/app.module.ts`
- Create: `apps/worker/src/otp-delivery-worker.service.ts`
- Modify: `apps/worker/src/app.module.ts`
- Create: `apps/worker/src/otp-delivery-worker.service.spec.ts`
- Modify: `.env.example`, `apps/api/src/config/environment.ts`, worker config

**Interfaces:**
- Consumes: `OtpDeliveryOutbox` rows created by Task 3.
- Produces:
  - `OtpProvider.send(input: { destination: string; code: string; purpose: 'SESSION_LOGIN' }): Promise<void>`
  - `OtpOutboxService.claimBatch(now: Date, limit: number): Promise<ClaimedOtpDelivery[]>`
  - `OtpDeliveryWorker.processOnce(now: Date): Promise<DeliveryRunResult>`

- [ ] **Step 1: Write failing worker tests**

```ts
it('claims pending deliveries and marks successful sends without logging the code', async () => {
  // provider receives the code only at the final delivery boundary;
  // logger arguments must not contain it or full message content.
});

it('uses bounded retry/backoff and marks permanent failure after the configured limit', async () => {
  // assert nextAttemptAt/status transitions and redacted error audit
});

it('does not send an already claimed, processed or expired challenge', async () => {
  // assert conditional claim prevents duplicate provider delivery
});
```

- [ ] **Step 2: Run the RED worker test**

Run:

```sh
yarn workspace @imeal/worker exec vitest run src/otp-delivery-worker.service.spec.ts
```

Expected: FAIL because the outbox service, provider abstraction and worker do not exist.

- [ ] **Step 3: Implement the outbox boundary**

Create the outbox row in the same transaction as the challenge. Claim rows atomically, apply bounded exponential backoff, stop after the configured maximum attempts, and record only redacted provider error metadata. The provider adapter may receive the clear code only immediately before transmission; no application logger, audit record, database row or metrics label may contain it. Delivery copy includes only minimum verification text and no meal, QR, location, owner or delegate data.

- [ ] **Step 4: Run the GREEN worker test**

Run:

```sh
yarn workspace @imeal/worker exec vitest run src/otp-delivery-worker.service.spec.ts
```

Expected: PASS for atomic claiming, successful delivery, bounded retries, expiry suppression and secret redaction.

- [ ] **Step 5: Commit the OTP delivery worker**

```sh
git add apps/api/src/otp apps/api/src/auth/otp.service.ts apps/api/src/app.module.ts apps/worker/src apps/api/src/config/environment.ts .env.example
git commit -m "feat(worker): deliver otp through transactional outbox"
```

---

### Task 6: Implement four-location configuration, roster import, and registration snapshots

**Files:**
- Create: `apps/api/src/locations/locations.service.ts`, `apps/api/src/locations/locations.module.ts`
- Create: `apps/api/src/admin/locations/locations.controller.ts`
- Create: `apps/api/src/admin/roster/roster-import.service.ts`, `apps/api/src/admin/roster/roster.controller.ts`
- Create: `apps/api/src/admin/allowlist/allowlist.controller.ts`
- Modify: `apps/api/src/admin/admin.module.ts` or current admin module graph
- Modify: `packages/domain/src/RegistrationService.ts`
- Create: `apps/api/src/admin/locations/locations.service.spec.ts`, `apps/api/src/admin/roster/roster-import.service.spec.ts`
- Modify: `packages/domain/test/registration.test.ts`

**Interfaces:**
- Consumes: `LocationPolicy`, `RosterImportRow`, `EmployeeLocationAssignment`, allowlist/session principal and existing permission guards.
- Produces:
  - `LocationsService.resolveEffectiveLocation(code: string, at: Date): Promise<ResolvedLocation>`
  - `LocationsService.evaluatePresenterEvidence(locationId: string, evidence: PresenterLocationEvidence, at: Date): Promise<GpsVerificationResult>`
  - `RosterImportService.preview(batch: RosterImportBatchInput): Promise<RosterPreview>`
  - `RosterImportService.commit(batchId: string, actorId: string): Promise<RosterImportResult>`
  - Registration creation/update that snapshots the effective service location and assignment values.

- [ ] **Step 1: Write failing location/roster tests**

```ts
it('rejects unknown location codes, duplicate employee codes, invalid dates, and inactive active capabilities', async () => {
  const result = await service.preview({ rows: invalidRows, source: 'approved-import.csv' });
  expect(result.rows.map((row) => row.reason)).toEqual(expect.arrayContaining([
    'UNKNOWN_SERVICE_LOCATION',
    'DUPLICATE_EMPLOYEE_CODE',
    'INVALID_EFFECTIVE_RANGE',
    'INACTIVE_CAPABILITY',
  ]));
});

it('does not partially rewrite an existing assignment when one row fails', async () => {
  // assert one transaction rolls back every row in the failed batch
});

it('evaluates GPS against the server-selected location policy', async () => {
  // valid fresh accurate fix inside radius succeeds; stale/inaccurate/outside fix
  // returns GPS_RETRY_REQUIRED without exposing distance or raw coordinates.
});
```

- [ ] **Step 2: Run the RED location/roster tests**

Run:

```sh
yarn workspace @imeal/api exec vitest run src/admin/locations/locations.service.spec.ts src/admin/roster/roster-import.service.spec.ts
```

Expected: FAIL because no effective location resolver, GPS policy evaluator, or atomic roster import exists.

- [ ] **Step 3: Implement approved-data-only administration**

Require explicit admin permissions for location/allowlist/roster mutations. Accept exactly the approved roster fields: normalized email, employee name, unique employee code, active state, capability, fixed service location code, effective dates, and audit fields. Make import idempotent by normalized email, reject all listed invalid rows before commit, and preserve existing assignment on any failed row. Do not add a seed migration or endpoint that fabricates four locations.

Store location configurations with stable immutable IDs, official address/serving point, coordinate source/accuracy, radius, timezone, effective dates, active state, operational metadata, approved scanner identifiers, and last verification actor/time. Resolve only effective active records server-side. Store registration location/assignment snapshots at registration time; later roster changes cannot rewrite historical serving.

- [ ] **Step 4: Run the GREEN location/roster tests**

Run:

```sh
yarn workspace @imeal/api exec vitest run src/admin/locations/locations.service.spec.ts src/admin/roster/roster-import.service.spec.ts
yarn workspace @imeal/core exec vitest run test/registration.test.ts
```

Expected: PASS for validation, atomicity, idempotency, no fabricated rows, server-side geofence policy and immutable registration snapshots.

- [ ] **Step 5: Commit administration and snapshots**

```sh
git add apps/api/src/locations apps/api/src/admin packages/domain/src/RegistrationService.ts packages/domain/test/registration.test.ts
git commit -m "feat(admin): add approved locations roster imports and snapshots"
```

---

### Task 7: Enforce exact QR intent, presenter GPS, and location-aware resolve

**Files:**
- Modify: `apps/api/src/pickup/pickup.service.ts`
- Modify: `apps/api/src/pickup/pickup.controller.ts`, `apps/api/src/pickup/pickup.module.ts`
- Consumes: `SessionService`, `LocationsService`, registration snapshots, accepted delegations, `GenerateQrInput`, `ResolvePickupInput`, and QR timing helpers.
- Produces:
  - `PickupService.getPickupOptions(presenterUserId: string): Promise<PickupOptionsResponse>`
  - `PickupService.generateQr(presenterUserId: string, input: GenerateQrInput): Promise<GenerateQrResponse>`
  - `PickupService.resolvePickup(input: ResolvePickupInput, kitchenActor: AuthenticatedUser): Promise<ResolveServingResponse>`
  - `PickupService.verifyExactIntent(qr: SignedQr, current: EligiblePickupSet): ExactPickupIntent`
  - `PickupService.verifyStoredPresenterEvidence(sessionOrIntentId: string, at: Date): Promise<ServingVerification>`
- [ ] **Step 1: Write failing exact-intent/GPS tests**

```ts
it('rejects zero selection and does not issue a usable QR', async () => {
  await expect(service.generateQr('presenter-1', {
    registrationIds: [],
    presenterEvidence: validEvidence,
  })).rejects.toMatchObject({ response: { code: 'PICKUP_INTENT_REQUIRED' } });
});

it('requires presenter evidence on every QR generation or refresh', async () => {
  await expect(service.generateQr('presenter-1', {
    registrationIds: ['reg-a'],
    presenterEvidence: staleEvidence,
  })).rejects.toMatchObject({ response: { code: 'GPS_RETRY_REQUIRED' } });
});

it('preserves the signed sorted set and rejects a stale item without substitution', async () => {
  // QR contains [reg-a, reg-b]; after reg-b becomes ineligible, resolve rejects the
  // entire intent instead of returning reg-a.
});

it('resolve accepts only a QR and authenticated Kitchen actor, then revalidates stored evidence', async () => {
  const resolved = await service.resolvePickup({ qr }, kitchenActor);
  expect(resolved.items.map((item) => item.registrationId)).toEqual(['reg-a']);
  // No presenter evidence is sent by Kitchen; stored evidence and current policy
  // are revalidated server-side.
});

it('rejects a changed resolved intent at confirm time', async () => {
  await expect(service.confirmPickup({
    pickupSessionId: 's',
    idempotencyKey: 'k',
  }, kitchenActor)).rejects.toMatchObject({ response: { code: 'PICKUP_INTENT_CONFLICT' } });
});

it('requires valid fresh presenter evidence before QR generation', async () => {
  // stale, inaccurate, denied/missing and outside-geofence evidence all return
  // GPS_RETRY_REQUIRED at generate/refresh; Kitchen supplies no GPS.
});
```

- [ ] **Step 2: Run the RED pickup tests**

Run:

```sh
yarn workspace @imeal/api exec vitest run src/pickup/pickup.service.spec.ts test/pickup.e2e-spec.ts
```

Expected: FAIL because current QR generation accepts only registration IDs, resolve accepts no authenticated Kitchen actor, presenter evidence is not stored at generate/refresh, and confirm still accepts arbitrary registration ID bodies.

- [ ] **Step 3: Implement exact-set and presenter-only verification**

Canonicalize registration IDs by sorting and rejecting duplicates before signing. Require `GenerateQrInput = { registrationIds, presenterEvidence }` on every generate/refresh call. Include presenter, meal date, exact set, expiry, nonce and signature in the QR, while persisting the validated presenter evidence result against the generated intent/session context.

At resolve, accept only `{ qr }` plus the authenticated Kitchen actor. Do not accept presenter GPS from Kitchen. The server must:

1. Authenticate Kitchen and require `kitchen.serve`.
2. Revalidate every signed item, current registration/delegation state, presenter/receiver relationship, registration service-location snapshot and serving eligibility.
3. Resolve one exact location from server-side registration/roster context; never accept client location selection.
4. Revalidate the stored presenter evidence against the current effective location policy, freshness and accuracy rules.
5. Persist only safe verification result/timestamp/accuracy/location ID according to retention controls.
6. Create a 30-second session bound to exact set, QR hash, presenter, location and verification record.
7. Reject all stale, changed, missing, invalid, replayed or mismatched state with stable recovery codes and no substitution.

Require one item to be auto-selected only in the mobile presentation layer; the API must always receive an explicit non-empty exact set and fresh presenter evidence at generate/refresh.

- [ ] **Step 4: Run the GREEN pickup tests**

Run:

```sh
yarn workspace @imeal/api exec vitest run src/pickup/pickup.service.spec.ts test/pickup.e2e-spec.ts
```

Expected: PASS for QR 5-second TTL/2-second skew, exact-set rejection, 30-second session binding, presenter-only GPS captured at generate/refresh, Kitchen resolve without GPS, server-side location selection and safe failure codes.

- [ ] **Step 5: Commit exact intent and resolve**

```sh
git add apps/api/src/pickup apps/api/test/pickup.e2e-spec.ts
git commit -m "feat(pickup): enforce exact intent and presenter gps at qr generation"
```

---

### Task 8: Complete all-or-nothing confirm, delegation races, idempotency, and immutable serving audit

**Files:**
- Modify: `apps/api/src/pickup/pickup.service.ts`
- Modify: `apps/api/src/pickup/pickup.service.spec.ts`, `apps/api/test/pickup.e2e-spec.ts`
- Modify: `packages/domain/prisma/schema.prisma` only if Task 2 requires a narrowly scoped confirm/audit field adjustment
- Create/Modify: `packages/domain/test/concurrency.test.ts`

**Interfaces:**
- Consumes: exact resolved session and `ConfirmPickupInput` from Task 7, current permissions from session guard, registration/delegation snapshots.
- Produces: `confirmPickup(input: ConfirmPickupInput, kitchenActor: AuthenticatedUser): Promise<ConfirmPickupResponse>` with all-or-nothing result and immutable serving/audit records.

- [ ] **Step 1: Write failing transaction tests**

Cover observable races and retry semantics:

```ts
it('commits every item or none when one registration is stale', async () => {
  // make one locked registration invalid; assert zero MealServing rows are created
});

it('serializes accepted delegation revoke/serve and chooses one committed winner', async () => {
  // concurrent transactions produce either completed serving or committed revoke,
  // never both and never a partial delegation state
});

it('returns the original result for the same caller/key/body and conflicts on a changed body', async () => {
  // same exact request is idempotent; changed registration set/location/session fails
});

it('records owner, presenter/receiver, Kitchen actor, pickup type, location, delegation, intent/session and verification snapshots', async () => {
  // assert immutable serving/audit fields are populated from server state
});
```

- [ ] **Step 2: Run the RED transaction tests**

Run:

```sh
yarn workspace @imeal/api exec vitest run src/pickup/pickup.service.spec.ts test/pickup.e2e-spec.ts
yarn workspace @imeal/core exec vitest run test/concurrency.test.ts
```

Expected: FAIL because confirm currently accepts arbitrary session subsets, records only registration/served time, and does not bind caller/body/location/verification snapshots.

- [ ] **Step 3: Implement the transaction cutover**

Require `kitchen.serve` on the current Kitchen principal. Bind idempotency to caller and the canonical pickup session/intent body. In one transaction, load the exact sorted registration set from `pickupSessionId`, lock registrations and relevant delegations in deterministic order, revalidate account status, exact set, session expiry, serving window, menu/registration/delegation state, stored presenter evidence, and duplicate serving constraints. Insert either all serving/audit rows or none. Mark accepted delegation completed only in the same transaction. Set session consumed/expired atomically. Return the original result on exact idempotent retry and an idempotency conflict for a changed key/body.

Do not require Kitchen GPS or Kitchen-to-location match. Preserve owner attribution for proxy pickup and record presenter/receiver separately. Emit realtime events only after commit.

- [ ] **Step 4: Run the GREEN transaction tests**

Run:

```sh
yarn workspace @imeal/api exec vitest run src/pickup/pickup.service.spec.ts test/pickup.e2e-spec.ts
yarn workspace @imeal/core exec vitest run test/concurrency.test.ts
```

Expected: PASS for all-or-nothing behavior, deterministic delegation races, duplicate/concurrent safety, exact idempotency and immutable actor/location/verification history.

- [ ] **Step 5: Commit serving transaction behavior**

```sh
git add apps/api/src/pickup apps/api/test/pickup.e2e-spec.ts packages/domain/test/concurrency.test.ts packages/domain/prisma/schema.prisma
 git commit -m "feat(pickup): make serving exact atomic and auditable"
```

---

### Task 9: Add mobile Expo foreground GPS, explicit intent, and Retry/Refresh recovery

**Files:**
- Create: `apps/mobile/src/api/authAPI.ts`
- Create: `apps/mobile/src/api/locationAPI.ts`
- Modify: `apps/mobile/src/api/pickupAPI.ts`
- Create/Modify: `apps/mobile/src/screens/auth/EmailOtpScreen.tsx`
- Modify: `apps/mobile/src/screens/pickup/PickupIntentScreen.tsx`
- Modify: `apps/mobile/src/screens/kitchen/KitchenScannerScreen.tsx`
- Modify: `apps/mobile/src/auth/session.tsx`
- Modify: `apps/mobile/src/i18n/translations.ts`
- Modify: `apps/mobile/app.config.ts`, `apps/mobile/package.json` only if the approved Expo location dependency is not already present
- Test: `apps/mobile/src/api/pickupAPI.test.ts`, new `apps/mobile/src/screens/pickup/PickupIntentScreen.test.tsx`

- Consumes: auth/location/pickup contracts from Tasks 1, 3, 6–8.
- Produces:
  - `authAPI.requestOtp(email): Promise<RequestOtpResponse>`
  - `authAPI.verifyOtp(input): Promise<VerifyOtpResponse>`
  - `pickupAPI.generateQr(token, input: GenerateQrInput): Promise<GenerateQrResponse>`
  - `pickupAPI.resolvePickup(token, input: ResolvePickupInput): Promise<ResolveServingResponse>` for Kitchen QR scanning; `input` contains only `qr`
  - `pickupAPI.confirmPickup(token, input: ConfirmPickupInput): Promise<ConfirmPickupResponse>` where `input` contains only `pickupSessionId` and `idempotencyKey`
  - `PickupIntentScreen` foreground lifecycle that captures presenter evidence before every QR generate/refresh and stops location collection after leaving the flow or completion.

- [ ] **Step 1: Write failing mobile tests**

```ts
it('auto-selects exactly one option but requires explicit selection for multiple options', () => {
  // render options and assert no QR request is made until a multi-item selection is explicit
});

it('sends presenter evidence with every QR generation and refresh', async () => {
  // assert generateQr receives { registrationIds, presenterEvidence } and refresh repeats
  // the evidence capture; no evidence is sent from KitchenScannerScreen.
});

it.each(['GPS_RETRY_REQUIRED', 'GPS_UNAVAILABLE', 'GPS_STALE', 'GPS_INACCURATE'])('offers only Retry and Refresh for %s', async (code) => {
  // assert no manual bypass, alternate location, or successful confirm action is rendered
});

it('stops foreground location collection when screen loses focus or QR generation completes', async () => {
  // mock Expo location subscription and assert cleanup on blur/completion
});
```

- [ ] **Step 2: Run the RED mobile tests**

Run:

```sh
yarn workspace @imeal/mobile exec vitest run src/api/pickupAPI.test.ts src/screens/pickup/PickupIntentScreen.test.tsx
```

Expected: FAIL because `generateQr` does not accept presenter evidence, resolve/confirm wrappers have not adopted their reduced request bodies, and foreground evidence lifecycle is not implemented.

- [ ] **Step 3: Implement mobile transport and foreground flow**

Add thin authenticated fetch wrappers with strict response parsing and stable `MobileApiError` codes. Add OTP request/verify screen/session bootstrap without displaying allowlist existence. In pickup:

- Keep one eligible item auto-selected.
- For multiple options, require an explicit selection before QR generation.
- Capture a fresh foreground presenter fix and call `pickupAPI.generateQr(token, { registrationIds, presenterEvidence })` on initial generation and every refresh.
- Keep KitchenScannerScreen's `pickupAPI.resolvePickup(token, { qr })` request free of GPS/evidence; the API revalidates evidence stored during presenter generation.
- Call `pickupAPI.confirmPickup(token, { pickupSessionId, idempotencyKey })`; never send registration IDs in the confirm body because the server loads the exact set from the session.
- Sort selected IDs and clear the QR whenever selection, focus, registration/delegation state, GPS verification state, or eligibility changes.
- Use the approved Expo foreground location API only while the presenter is actively generating/refreshing the QR; request permission just-in-time and stop watch/collection on blur, cancel, successful completion or unmount.
- Render only Retry and Refresh after unavailable/denied/stale/inaccurate/outside-geofence results; never offer a manual bypass or silent location/item fallback.
- Do not collect owner GPS for delegated items.
- Explain foreground GPS purpose and retention in Vietnamese/English copy.

Kitchen scanner calls resolve with only the QR and authenticated Kitchen session, then confirms only the resolved pickup session ID and idempotency key. Kitchen sends no GPS.

- [ ] **Step 4: Run the GREEN mobile tests**

Run:

```sh
yarn workspace @imeal/mobile exec vitest run src/api/pickupAPI.test.ts src/screens/pickup/PickupIntentScreen.test.tsx
```

Expected: PASS for explicit intent, evidence-at-generate/refresh, foreground-only collection, cleanup, safe recovery, Kitchen no-GPS resolve and session-only confirm transport.


---

### Task 10: Add Admin Web operations, audit views, and no-admin-role boundary

**Files:**
- Modify: `apps/admin-web/src/main.ts`
- Modify: `apps/admin-web/src/styles.css`
- Create: `apps/admin-web/src/admin-operations.ts`
- Modify: `apps/api/test/admin-operations.e2e-spec.ts`
- Verification: `apps/admin-web/src/main.ts`, `apps/admin-web/src/styles.css`, `apps/admin-web/src/admin-operations.ts`, `yarn workspace @imeal/admin-web typecheck`, `yarn workspace @imeal/admin-web build`, and manual browser smoke

**Interfaces:**
- Consumes: admin contracts and endpoints from Task 6, current authenticated session from Task 4.
- Produces: named pure functions in `admin-operations.ts` for shaping roster preview rows, safe audit projections and operation request payloads; `main.ts` and `styles.css` render authorized location, allowlist, roster, scanner and audit operations without admin-role grant/revoke.

- [ ] **Step 1: Define pure Admin Web operation functions and API/e2e RED coverage**

Create these named pure functions with explicit types:

```ts
export function toRosterPreviewRows(result: RosterPreview): ReadonlyArray<RosterPreviewRow>;
export function toSafeAuditEntry(entry: AuditEntry): SafeAuditEntry;
export function toRosterImportRequest(rows: ReadonlyArray<RosterImportRow>): RosterImportRequest;
```

Add or extend `apps/api/test/admin-operations.e2e-spec.ts` for preview-before-commit, atomic row failure, permission denial, redaction and no admin-role mutation. Do not add a Vitest setup or dependency to Admin Web; its package currently provides only `dev`, `build`, and `typecheck`.

- [ ] **Step 2: Run the RED API/e2e and Admin Web checks**

Run:

```sh
yarn workspace @imeal/api exec vitest run test/admin-operations.e2e-spec.ts
yarn workspace @imeal/admin-web typecheck
```

Expected: API/e2e assertions fail until admin endpoints and pure operation projections exist; Admin Web typecheck fails until the named functions and UI are implemented. There is no Admin Web unit-test command in the current package.

- [ ] **Step 3: Implement the authorized administrative surfaces**

Add forms/tables in `main.ts` and styles in `styles.css` for approved location records, effective dates/policies, allowlist A, roster preview/commit, scanner assignment and audit results. Use `admin-operations.ts` for pure request shaping and redaction. Require explicit permissions in the API and display row-level import outcomes. Do not provide admin-role lifecycle controls, arbitrary exports, fabricated location seed actions, or raw OTP/session/GPS evidence dashboards.

- [ ] **Step 4: Run the GREEN Admin Web checks**

Run:

```sh
yarn workspace @imeal/api exec vitest run test/admin-operations.e2e-spec.ts
yarn workspace @imeal/admin-web typecheck
yarn workspace @imeal/admin-web build
```

Expected: API/e2e coverage passes; Admin Web typecheck and build pass. Then perform a manual browser smoke covering preview-before-commit, atomic import messaging, permission boundaries, no admin-role action and redacted security evidence.

- [ ] **Step 5: Commit Admin Web operations**

```sh
git add apps/admin-web/src/main.ts apps/admin-web/src/styles.css apps/admin-web/src/admin-operations.ts apps/api/test/admin-operations.e2e-spec.ts
git commit -m "feat(admin-web): manage locations roster allowlist and audit"
```

---

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

---

## Verification matrix before declaring the implementation complete

The implementation owner must run the following after all tasks are integrated; these commands are listed for execution, not run while creating this plan:

```sh
yarn typecheck
yarn workspace @imeal/contracts test
yarn workspace @imeal/api test
yarn workspace @imeal/worker test
yarn workspace @imeal/core test
yarn workspace @imeal/api test:e2e
yarn workspace @imeal/worker test:e2e
```

The reviewer must verify observable behavior for every approved acceptance criterion:

1. Unknown, non-allowlisted, disabled and expired-email OTP attempts are indistinguishable and create no session/entitlement.
2. OTP is hashed, one-use, throttled, expiry-bound, audited, and absent from logs/provider operator payloads.
3. Production accepts only allowlist-A OTP; local harness bypass is impossible in production.
4. Approved OTP creates only an opaque session; current account state/permissions are rechecked; revocation works.
5. Exactly four real location records are imported/approved before production; no fabricated seed exists.
6. Active employees have fixed server-managed location/capability; client claims cannot change them.
7. Only foreground presenter GPS is collected/evaluated; owner GPS is not collected for proxy pickup.
8. GPS failure offers Retry/Refresh only and never bypasses or switches location.
9. QR exact intent, location, TTL 5, skew 2, session 30 and server eligibility checks compose correctly.
10. Stale/ineligible intent rejects without substitution; confirm cannot alter the resolved set.
11. Delegation acceptance/no-chain/no-self and revoke/serve races have one deterministic transaction outcome.
12. Multi-item serving is atomic; duplicate/concurrent requests and same idempotency retry cannot double-serve.
13. Serving history immutably records owner, presenter/receiver, Kitchen actor, pickup type, location, delegation, intent/session, time and verification context.
14. Admin imports validate atomically, are repeatable and audit actor/batch/reason/effective dates/results.
15. Privacy controls minimize OTP/session/GPS retention and access; residual screenshot/device/GPS-spoofing risk is documented.

## Self-review and scope guard

- [x] Spec sections 1–2 are covered by Tasks 3–5 and the global constraints.
- [x] Spec sections 3–4 are covered by Task 6 and Task 2, with no fabricated operational data.
- [x] Spec sections 5–6 are covered by Tasks 7–9, including evidence at QR generate/refresh, exact intent, GPS, QR/session timing, delegation and atomic confirm.
- [x] Spec section 7 is covered by Tasks 6, 8 and 10–11, including audit and account/session disable boundaries.
- [x] Spec section 8 is covered by Tasks 3, 5, 7, 9 and 11, including minimization and residual risk.
- [x] All 15 acceptance criteria have an explicit task and verification assertion.
- [x] No task contains an unassigned type/function name; cross-task interfaces above are canonical.
- [x] No implementation step invents location names, addresses, coordinates, employee identities or roster assignments.
- [x] No implementation step adds password auth, domain auth, background GPS, owner GPS, network auth, biometric proof, hardware attestation, serving reversal, admin-role grant, or Firebase dual-write.
- [x] No production code, build, or test is changed or run as part of creating this plan.

Plan complete and saved to `docs/superpowers/plans/2026-09-24-imeal-email-otp-presenter-gps-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with review checkpoints.
2. **Inline Execution** — execute tasks in this session using executing-plans with checkpoints.
