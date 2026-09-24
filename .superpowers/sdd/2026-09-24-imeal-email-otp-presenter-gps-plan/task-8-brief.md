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
  // same exact request is idempotent; changed session/intent context fails
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

Expected: FAIL because confirm currently accepts arbitrary registration subsets instead of the exact set owned by the `PickupSession`, records only registration/served time, and does not bind caller/body/location/verification snapshots.

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
