# IMeal Email OTP, Presenter GPS, and Four-Location Serving Design

**Date:** 2026-09-24  
**Status:** Approved design for implementation planning  
**Scope:** Authentication recovery/presenter verification, location-aware serving, roster administration, privacy and residual-risk controls.

## 1. Purpose and canonical boundaries

IMeal remains a server-authoritative meal-registration and serving system. This design adds a controlled presenter-verification path and location attribution without changing the existing meal lifecycle:

- Email OTP through allowlist A is the sole production authentication method; the only exception is an explicitly enabled non-production harness bypass.
- A presenter is the foreground mobile user whose own device presents the QR. Presenter verification applies to the presenter only; it does not prove that a delegate owner is physically present.
- GPS is an additional serving-time signal. It never grants a serving entitlement, replaces authentication/authorization, or bypasses QR, pickup-session, delegation, registration, serving-window, or concurrency checks.
- Exactly four operational locations are in scope. Their real names, addresses, coordinates, and roster assignments have not been supplied; this design deliberately does not invent them.

Canonical product rules continue to govern registration, delegation, menu, serving, no-show, notifications, and role policy. In particular, QR scan resolves an intent but does not serve; Kitchen confirmation is explicit; the serving window is 10:30–13:30 Asia/Ho_Chi_Minh; QR TTL is 5 seconds with at most 2 seconds clock skew; a resolved pickup session lasts 30 seconds; batch confirmation is all-or-nothing and idempotent; and serving is final in core v2.

## 2. Decisions

### 2.1 Email OTP: allowlist A

Email OTP uses **allowlist A**: only an administrator-provisioned, active employee email may initiate or complete this flow. Allowlist membership is an IMeal authorization input stored server-side; an email domain, display name, or a user-supplied claim is never sufficient.

The allowlist record is tied to the canonical employee identity when known and contains normalized email, active/disabled state, intended purpose, effective dates, and administrative audit metadata. An email that is not allowlisted receives the same non-disclosing response as an unknown or disabled address. The endpoint must not reveal whether an address exists.

OTP properties:

- Cryptographically random, single-use code; persist only a verifier/hash and required expiry metadata, never the clear code.
- Short expiry, bounded attempts, resend throttling, per-address and per-client rate limits, and abuse/audit events.
- Successful use consumes the challenge atomically. Replays, expired codes, excessive attempts, and mismatched purpose fail closed.
- OTP does not create an IMeal role, employee assignment, delegation, registration, or serving entitlement.
- Email delivery is best effort and never exposes meal, QR, location, owner, or delegate data in the message beyond the minimum verification copy.
- All timestamps are UTC instants; business-day and serving-window decisions remain Asia/Ho_Chi_Minh server time.

The exact OTP delivery provider is an implementation choice, but provider logs and application logs must not contain OTP values, full email content, or session secrets.

### 2.2 Clean-cut production authentication boundary

Production authentication is **email OTP through allowlist A only**. There is no federated identity, production username/password, or second production authentication path. The allowlist email is normalized and resolved to the active IMeal employee record by server-side data; email domain, display name, client claims, or a user-supplied role are never sufficient.

The only exception is an explicitly enabled local test bypass for the harness in non-production environments. It is not an end-user login path, must be disabled for production, must not share production credentials or authorization data, and must not be represented as a supported authentication method in production documentation.

The cutover is clean: no compatibility alias, dual auth, email-domain authorization, client-supplied role, client-supplied employee code, or client-controlled account status. Every approved OTP session resolves the current account status and roles from PostgreSQL before protected operations.

### 2.3 Opaque database session

After successful approved OTP verification, the API creates an opaque, high-entropy random session identifier. The client receives only the opaque value over HTTPS; the database stores only a one-way hash plus session metadata. The session is not a JWT and contains no user ID, role, employee code, location, registration, or GPS data.

Session records include owner user ID, purpose/authentication method, created/last-used/absolute-expiry timestamps, revoked timestamp and reason, device/session metadata with minimization, and audit linkage. Every protected request resolves the hash server-side and rechecks account status and authorization. Logout, administrative disable, suspected compromise, OTP replay, and explicit revocation invalidate the session. Cookie/bearer transport, CSRF protection where browser transport is used, rotation rules, idle timeout, absolute lifetime, and secure storage are implementation controls; none may weaken the server-side checks.

This opaque session is the only production session bootstrap for this design. It must not be used to smuggle authorization state into the client.

## 3. Four operational locations

The system has four and only four configured serving locations for this design. Location configuration is data, not a hard-coded network boundary. Before production use, the organization must collect and approve the real records; the current repository contains no authoritative four-location names, addresses, coordinates, or assignments, so this document intentionally names no fabricated sites.

Each location record requires:

- Stable immutable `location_id` and human-readable short code.
- Official display name and serving-point name.
- Full site address, building/block, floor, room or counter description, and local contact.
- Latitude, longitude, coordinate accuracy/source, and approved geofence radius in meters.
- Timezone (`Asia/Ho_Chi_Minh` unless the organization explicitly approves another operational timezone), service-window applicability, and effective start/end dates.
- Active/retired state, holiday/non-service overrides, capacity/queue notes, accessibility and emergency instructions.
- Kitchen owner/operating team, approved scanner/device identifiers, network/HTTPS reachability notes, and last verification actor/time.

Coordinates and radius are operational verification data, not authentication secrets. A location is selected by server-side configuration and the serving request context; client-supplied coordinates cannot select a more permissive site. A location change is audited and effective-dated so historical serving retains the location snapshot that was used.

The same meal date may be served at more than one configured location only when the operational menu/roster explicitly permits it. The serving transaction must bind every serving to one resolved location; it must never silently substitute another location.

## 4. Employee roster and fixed-location assignment

Employee location is fixed by an administrator-managed roster/import, not by mobile input, email domain, GPS, or QR payload. Real employee data and the four location assignments are not present yet; production import is a prerequisite, not an excuse to invent seed data.

The roster/import contract contains only these employee assignment fields:

- Normalized `email`.
- Employee `name`.
- Unique `employeeCode`.
- `isActive`.
- Assigned `role`/capability.
- Fixed `serviceLocationCode`.
- Assignment effective-from/effective-to dates.
- Administrative audit fields: batch/source, imported-by actor, imported-at time, row result, reason, and audit event ID.

The import may assign serving/menu capabilities independently from staff registration capability. A kitchen assignment does not imply staff registration capability; a staff assignment does not imply serving capability. Administrative role assignment remains outside this import workflow.

Imports must be idempotent by normalized email and must reject ambiguous duplicate employee codes, unknown service-location codes, invalid date ranges, and inactive employees receiving active capabilities. A failed row must not partially rewrite an existing assignment. Historical serving/audit rows retain the employee, role, and service-location snapshots even after roster changes.

No client may self-assign a location, role, employee code, or serving capability. Administrative import and assignment changes require authorization and immutable audit records.

## 5. Presenter-only foreground GPS

GPS is collected only while the authenticated presenter is actively using the foreground pickup/serving flow. It is not collected continuously, in the background, from the owner merely because a delegation exists, or from unrelated staff devices.

At resolve/confirm time, the presenter device may provide a fresh foreground fix with timestamp, latitude, longitude, accuracy, and the location context selected by the server/roster. The server evaluates freshness, accuracy threshold, and the configured geofence for the intended location. Exact thresholds are configuration owned by the four-location operational records and must be published with their approval; a client cannot relax them.

Required behavior:

1. Presenter authenticates and has current eligible own/delegated pickup options.
2. Presenter selects the intended exact set on the presenter device; one eligible item is auto-selected, while multiple items require explicit selection.
3. Presenter presents a fresh signed QR. QR identifies presenter and exact intent only.
4. Kitchen resolves the QR as an authenticated principal with `kitchen.serve`; Kitchen does not send GPS and does not need a location match.
5. The server checks QR, presenter account, exact intent, registration/delegation eligibility, presenter/receiver relationship, registration service location, and GPS policy. The GPS signal is for the presenter only; it does not assert that the owner is at the site.
6. If GPS is unavailable, stale, inaccurate, denied, or outside the permitted geofence, the UI offers only **Retry** and **Refresh**. There is no manual bypass, silent location fallback, or automatic substitution.
7. A fresh QR/intent and a fresh pickup session are required after a failed or changed verification state. The expired/stale code is never presented as valid.

GPS failure is a recoverable verification failure, not a cancellation of the underlying registration or delegation. The server must return a stable failure code that does not disclose sensitive location detail beyond the safe recovery instruction. Do not store raw coordinate history beyond the minimum retention needed for audit, dispute, and operational monitoring; prefer a verification result, timestamp, accuracy, and location ID. Access to any retained GPS evidence is restricted and audited.

## 6. QR, intent, delegation, and serving transaction

### 6.1 Exact intent and no silent substitution

`GET /me/pickup-options` returns the presenter’s currently eligible own registration and accepted delegated registrations for today. The server and client enforce:

- Exactly one eligible item: select it automatically.
- More than one eligible item: require explicit presenter selection.
- Zero selected items: do not issue a usable QR.
- QR issuance validates every selected registration ID and signs the exact sorted set with presenter, meal date, expiry, nonce, and signature.
- Resolve revalidates every selected item against current registration/delegation state; it does not replace a stale or ineligible item with another item.
- The resolved session contains exactly the signed/validated set. Confirm accepts exactly that set, not an arbitrary subset or expanded set.

Changing selection, presenter, location evidence, GPS result, delegation state, registration state, or serving eligibility invalidates the prior resolution and requires a new resolve. No silent substitution is allowed.

### 6.2 Delegation

A delegation remains an explicit owner-to-delegate request requiring delegate acceptance. Pending delegation has no pickup authority. There is no self-delegation, delegation chain, concurrent active delegation for one registration, or re-delegation by a delegate. Cancellation/revocation races with acceptance and serving are serialized by the transaction; only the committed winner is authoritative. Serving consumes the accepted delegation; serving remains attributed to the registration owner, the presenter/receiver, and the Kitchen actor.

Presenter GPS does not prove owner presence and does not alter owner penalties/no-show rules. A delegate presents the delegate’s own QR and is evaluated as the presenter/receiver; the owner is retained as the registration owner in all audit and history.

### 6.3 QR and session timing

- QR lifetime: 5 seconds.
- Maximum accepted clock skew: 2 seconds.
- Resolved pickup-session lifetime: 30 seconds.
- Serving window: 10:30–13:30 on the meal date in server business time.
- QR replay is rejected; a resolved QR hash cannot create a second pickup session.
- Session expiry, QR expiry, GPS failure, stale intent, duplicate serving, and presenter-location-evidence mismatch return stable conflict/recovery codes.

### 6.4 Confirm semantics

Kitchen confirmation is one explicit final action after reviewing presenter identity, owner/delegate labels, exact item list, count, meal choices, location evidence, and verification status. The server transaction requires an authenticated principal with `kitchen.serve`; it does not require Kitchen GPS or a Kitchen-to-location match. The serving location is taken from the registration and valid presenter evidence, then the transaction locks all registrations and relevant delegations, revalidates all rules, and commits either every item or none.

The idempotency key is bound to caller and request body/intent. Retrying the same request returns the original result; reusing a key with a different body returns an idempotency conflict. A concurrent owner/delegate serve, revoke/serve, duplicate scanner, stale registration, disabled account, presenter-location-evidence mismatch, or GPS failure commits zero new servings for that batch. There is no reversal/re-serve API in core v2.

Each immutable serving/audit record must retain at minimum:

- Registration owner and registration ID.
- Presenter/receiver and whether pickup is `SELF` or `PROXY`.
- Kitchen actor, permission context, scanner/device ID, and serving location.
- Meal date, menu/revision snapshot reference, served time, request ID, pickup-session ID, intent hash, and verification outcomes.
- Delegation ID when proxy pickup is used.

GPS failure has no exception path: the presenter UI offers only Retry/Refresh, and the request does not serve or bypass any rule until a fresh valid presenter evidence check succeeds.

## 7. Administration, import, and audit

Admin Web may manage staff/kitchen assignments, allowlist records, four-location configuration, roster imports, scanner assignments, and audit views only under explicit permissions. It must not expose an admin-role grant/revoke action; administrative role lifecycle remains a separately audited server-side operation. Admin does not imply Kitchen serving permission.

Every sensitive mutation records actor, target, operation, before/after or effective values, timestamp, request ID, reason, import/batch ID where applicable, and outcome. Audit records are append-oriented and retained according to the canonical one-year meal lifecycle/audit retention policy. Security/access logs must minimize personal data and never log OTP cleartext, session secrets, QR payloads, or raw location data unnecessarily.

Location/roster changes cannot rewrite historical serving records. Disabling an account follows the canonical preview-and-confirm workflow: future registrations/delegations are cleaned atomically, excluded from preparation/no-show/penalty processing, and retained in audit history.
## 8. Privacy and threat model

### 8.1 Data minimization

Collect only data needed for identity, authorization, serving attribution, fraud resistance, operations, and audit. Email OTP, session, GPS, location, scanner, and roster data are access-controlled by purpose. Separate operational dashboards from raw security evidence.

Users must receive clear explanation that foreground GPS is used to verify the presenter’s serving location. GPS collection stops when the presenter leaves the flow or the request completes. No background tracking, owner GPS collection for proxy pickup, or location-based advertising is in scope.

### 8.2 Threats addressed

- OTP guessing, replay, enumeration, abuse, and provider/log leakage.
- Stolen bearer/session values through opaque server sessions, expiry, revocation, secure transport, and minimized metadata.
- QR screenshot/replay through 5-second TTL, 2-second skew, nonce/hash replay protection, exact intent, and 30-second resolved-session expiry.
- Unauthorized serving through current server-side roles/status, Kitchen capability, registration service location, presenter GPS verification, and transaction locks.
- Owner/delegate confusion through explicit presenter/receiver/owner records and delegation state checks.
- Concurrent scanners and retries through database uniqueness, row locking, exact-set all-or-nothing transaction, and idempotency.
- Location spoofing and stale fixes through server-side geofence evaluation, freshness/accuracy requirements, and no bypass on failure.

### 8.3 Residual screenshot and device risk

A short-lived QR reduces but cannot eliminate screenshots, cameras pointed at screens, rooted/jailbroken devices, malware, notification capture, or a presenter voluntarily sharing a valid code during its lifetime. GPS can be spoofed by compromised devices and is not proof of personhood or owner presence. Allowlist, authenticated Kitchen authorization, exact intent, server revalidation, audit, rate limits, and final transaction checks remain required defense in depth. This design does not claim biometric identity, hardware attestation, or perfect anti-sharing protection.

## 9. Acceptance criteria

1. Non-allowlisted, disabled, unknown, or expired-email OTP attempts have indistinguishable safe responses and never create a session or entitlement.
2. OTP is single-use, hashed at rest, rate-limited, expiry-bound, audited, and absent from logs/provider payloads visible to operators.
3. Production authentication accepts only allowlist-A email OTP; any local harness bypass is unavailable in production.
4. Approved OTP creates only an opaque server session; every request resolves current account status and permissions server-side; revocation works.
5. Exactly four real location records are imported/approved before production; each has stable identity, address, serving point, coordinates, geofence policy, operational metadata, effective dates, and audit history.
6. Active employees have a server-managed fixed service location and capability assignment from roster/import; client claims, email suffixes, GPS, and QR cannot change it.
7. Presenter-only foreground GPS is requested/evaluated during pickup; owner GPS is not collected solely for delegation.
8. GPS failure exposes only Retry/Refresh and never bypasses verification or silently switches location.
9. QR, exact intent, registration service location, 5s TTL/2s skew, 30s session, and server-side eligibility checks are enforced together.
10. A stale/ineligible intent is rejected without silent substitution; confirm cannot alter the resolved set.
11. Delegation requires acceptance, has no chain/self-delegation, and owner/delegate/revoke/serve races have one deterministic transaction outcome.
12. Multi-item serving is all-or-nothing; duplicate/concurrent requests and same idempotency retries cannot create a second serving.
13. Serving history records owner, presenter/receiver, Kitchen actor, pickup type, location, delegation, intent/session, time, and verification/audit context immutably.
14. Admin roster/location/allowlist import validates rows atomically, is repeatable, and records actor, batch, reason, effective dates, and results.
15. Privacy controls limit GPS/session/OTP retention and access; residual QR screenshot/device/GPS-spoofing risk is documented rather than represented as eliminated.

## 10. Explicit exclusions

The following are not part of this design: open email signup; production email/password accounts; email-domain authorization; background or continuous GPS; owner-device GPS requirement for proxy pickup; network/LAN/IP authorization; QR owner sharing; hardware attestation or biometric proof; check-out/exit tracking; location-based changes to registration eligibility; silent fallback to another location or item; kitchen per-item editing in the happy path; serving reversal/re-serve; new `finance`/`kitchen_lead` roles; Admin Web admin-role grant; Firebase migration/dual-write; unbounded administrative exports; and invented names, coordinates, addresses, employee identities, or roster assignments for the four locations.

## 11. Self-review and consistency decisions

- **Auth consistency:** PostgreSQL answers account state, roles, permissions, allowlist, roster, and fixed service location. Email OTP is the sole production authentication method; any local bypass is harness-only and non-production.
- **Pickup consistency:** presenter-only GPS supplements—not replaces—the canonical QR, delegation, pickup-session, serving-window, and database checks. Exact intent is preserved from mobile selection through resolve and confirm; no silent substitution is permitted.
- **Concurrency consistency:** all-or-nothing, row locking, delegation transitions, unique serving constraints, and idempotency preserve one final serving under races.
- **Location consistency:** there are four configured operational records, but no real data is fabricated. Location/network is not an authentication boundary. Historical records snapshot the effective location and actors.
- **Privacy consistency:** only foreground presenter GPS is collected; failure has no bypass; screenshot and compromised-device risk is reduced, not promised impossible.
- **Schema/contract implication:** implementation planning must reconcile the repository’s current registration-state naming and add explicit serving owner/receiver/Kitchen actor/pickup type/location/audit data before claiming these acceptance criteria are met.
