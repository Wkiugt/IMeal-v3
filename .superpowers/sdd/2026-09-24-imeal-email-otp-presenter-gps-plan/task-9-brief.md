### Task 9: Add mobile Expo foreground GPS, explicit intent, and Retry/Refresh recovery

**Files:**
- Create: `apps/mobile/src/api/authAPI.ts`
- Create: `apps/mobile/src/api/locationAPI.ts`
- Modify: `apps/mobile/src/api/pickupAPI.ts`
- Create/Modify: `apps/mobile/src/screens/auth/EmailOtpScreen.tsx`
- Modify: `apps/mobile/src/screens/pickup/PickupIntentScreen.tsx`
- Modify: `apps/mobile/src/screens/kitchen/KitchenScannerScreen.tsx`
- Modify: `apps/mobile/src/auth/session.tsx`, `apps/mobile/src/i18n/translations.ts`, `apps/mobile/App.tsx`
- Modify: `apps/mobile/app.config.ts`, `apps/mobile/package.json`, `yarn.lock`
- Test: `apps/mobile/src/api/authAPI.test.ts`, `apps/mobile/src/api/pickupAPI.test.ts`, `apps/mobile/src/screens/pickup/PickupIntentScreen.test.tsx`

**Interfaces:**
- Consumes: versioned auth/location/pickup contracts from Tasks 1, 3, and 6–8.
- Produces: strict OTP/session transport and bootstrap, exact pickup QR/resolve/confirm wrappers, and presenter-only foreground location lifecycle.

- [ ] **Step 1: Write failing mobile tests**

Cover non-enumerating OTP request/strict verification parsing, sorted exact QR intent with presenter evidence, QR-only Kitchen resolve, session/idempotency-only Kitchen confirm, one-item auto-selection, explicit multi-selection, GPS Retry/Refresh recovery, and foreground location cleanup.

- [ ] **Step 2: Run the RED mobile tests**

```sh
corepack yarn workspace @imeal/mobile exec vitest run src/api/pickupAPI.test.ts src/api/authAPI.test.ts src/screens/pickup/PickupIntentScreen.test.tsx
```

Expected: fail until OTP transport, exact pickup wrappers, and intent rules exist.

- [ ] **Step 3: Implement the transport and foreground flow**

Use strict Zod parsing and stable `MobileApiError` codes. Persist only the opaque OTP session token via the existing platform storage. Request foreground Expo location just-in-time for each QR generate/refresh; stop the capture on blur, cancellation, completion, or unmount. Keep one eligible option auto-selected, require explicit selection for multiple options, sort IDs, clear QR on any selection/eligibility/evidence change, and expose only Retry/Refresh after GPS failures. Kitchen sends only the QR to resolve and only the resolved session ID plus idempotency key to confirm.

- [ ] **Step 4: Run the GREEN mobile tests and checks**

```sh
corepack yarn workspace @imeal/mobile exec vitest run src/api/pickupAPI.test.ts src/api/authAPI.test.ts src/screens/pickup/PickupIntentScreen.test.tsx
corepack yarn workspace @imeal/mobile test
corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json
```

If native Expo runtime is unavailable, use deterministic mocked location callbacks and report that limitation; do not fabricate operational location data.
