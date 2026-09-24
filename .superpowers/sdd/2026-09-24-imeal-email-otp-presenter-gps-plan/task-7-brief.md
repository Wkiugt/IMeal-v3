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
