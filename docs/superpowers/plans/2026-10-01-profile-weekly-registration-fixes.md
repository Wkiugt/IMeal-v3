# Weekly Registration Window Fixes Implementation Plan

> **For agentic workers:** Execute the tasks in order with TDD. Do not commit; the parent worker owns integration and final delivery.

**Goal:** Make weekly registration mutations and read-side editability obey the Vietnam Monday–Sunday window while preserving per-meal cutoff, finalized lifecycle, snapshot, menu, location, choice, delegation, and partial-success safeguards.

**Architecture:** Add one deterministic Vietnam-time resolver in `apps/api/src/common/business-time.ts`; each service request captures one `Date` and passes it through the resolver/classifier. `getWeekData` remains readable for any requested week, but its `registrationWindow.days[].editable` and existing action flags/reason arrays reflect weekly eligibility. `batchRegister` checks the weekly classifier before the existing per-meal cutoff gate, then leaves all transaction safeguards and existing finalized/cutoff precedence intact after that gate.

**Contract:** Extend shared Zod failure/reason enums with `REGISTRATION_WEEK_NOT_OPEN` and `OUTSIDE_REGISTRATION_WINDOW`; keep the existing `registrationWindow` shape and legacy `cutoffAt` field unchanged. The mobile worker maps the shared enum and existing day flags/reasons; no extra wire metadata is added.

**Rule:** Business timezone is `Asia/Ho_Chi_Minh`; weeks run Monday through Sunday. Before the current week’s Saturday 17:00, only current-week dates are weekly-eligible. At exactly Saturday 17:00, next week joins the still-eligible current week; the current week remains eligible through Sunday subject to its separate per-meal cutoff. On the following Monday, the former current week is historical/outside and the new next week is closed until its Saturday 17:00 boundary. Dates earlier than current or later than next are outside.

---

### Task 1: Deterministic resolver, service behavior, and tests

**Files:**
- Modify: `apps/api/src/common/business-time.ts`
- Test: `apps/api/src/common/business-time.spec.ts`
- Modify: `apps/api/src/registrations/registrations.service.ts`
- Test: `apps/api/src/registrations/registrations.service.spec.ts`

**Interface produced by `business-time.ts`:**

```ts
export type RegistrationWeekRestriction =
  | null
  | 'REGISTRATION_WEEK_NOT_OPEN'
  | 'OUTSIDE_REGISTRATION_WINDOW';

export type RegistrationWeekWindow = {
  businessDate: string;
  currentWeekStart: string;
  currentWeekEnd: string;
  nextWeekStart: string;
  nextWeekEnd: string;
  nextWeekOpenAt: Date;
  nextWeekOpen: boolean;
};

export function resolveRegistrationWeekWindow(
  now: Date,
): RegistrationWeekWindow;

export function resolveRegistrationWeekRestriction(
  window: RegistrationWeekWindow,
  mealDate: string,
): RegistrationWeekRestriction;
```

- `businessDate` is the Vietnam business date for `now`.
- Date boundaries are canonical `YYYY-MM-DD` strings; `nextWeekOpenAt` is the Saturday 17:00 Vietnam instant for the current week. `nextWeekOpen` is `now >= nextWeekOpenAt`.
- The classifier always returns `null` for dates in the current week. It returns `null` for dates in the next week only when `nextWeekOpen` is true, otherwise `REGISTRATION_WEEK_NOT_OPEN`; every other date returns `OUTSIDE_REGISTRATION_WINDOW`. It must use UTC date arithmetic only after deriving the Vietnam business date.

**Tests first:**
- Add deterministic UTC cases for Monday, Friday, Saturday `16:59:59`, exact Saturday `17:00:00`, Saturday after boundary, and Sunday; assert all required fields and classification for current, next, past, and `+2` weeks.
- In service tests, assert `getWeekData` remains readable for current, closed-next, open-next, and `+2` weeks; assert `registrationWindow.days[].editable` includes weekly eligibility; assert weekly reasons append to existing arrays without removing `CUTOFF_PASSED`, `REGISTRATION_FINALIZED`, `ALREADY_ACTIVE`, `NOT_ACTIVE`, menu, location, or choice reasons.
- Add batch cases for a mixed request containing a successful eligible item, a closed-next item (`REGISTRATION_WEEK_NOT_OPEN`), and an outside item (`OUTSIDE_REGISTRATION_WINDOW`), with result order and partial success preserved. Add exact-boundary next-week success using a fixture whose per-meal cutoff is still future (the default `14:00` setting would otherwise make a Sunday meal date fail its existing cutoff).
- Retain and run existing exact cutoff, finalized/SERVED/NO_SHOW/penalty, menu/choice/location/snapshot, delegation revocation, and concurrency-related service assertions. Weekly restriction is checked before the existing per-meal cutoff gate; existing finalized-vs-cutoff ordering inside the mutation flow is not refactored.

**Implementation:**
- Capture one `serverNow` per `getWeekData`/`batchRegister` call and pass it to `resolveRegistrationWeekWindow`; do not call `new Date()` again for eligibility.
- In `getWeekData`, calculate the weekly restriction per returned date. Set `registrationWindow.days[].editable` only when both weekly restriction is `null` and the existing per-meal cutoff has not passed. Keep historical/future reads and the legacy window fields.
- For each day’s `canActivate`, `canCancel`, and `canChangeMealChoice`, preserve the current reason construction/order, then append the weekly reason when non-null; action booleans remain false while a weekly restriction exists. Do not replace finalized or cutoff reasons.
- In `batchRegister`, after valid date/lunar parsing and before the existing per-meal mutation cutoff check, return the exact new failure code/reason for weekly restriction. Continue through the existing transaction for eligible items so menu, snapshot, location, finalized, serving, no-show, penalty, delegation, event, and unique-retry behavior is untouched.

**Scoped proof:** Run the focused business-time and registration service test files after each red/green cycle.

---

### Task 2: Shared contracts, HTTP integration coverage, and documentation

**Files:**
- Modify: `packages/contracts/src/v1/registrations.ts`
- Test: `packages/contracts/test/contracts.test.ts`
- Modify: `apps/api/test/registrations.e2e-spec.ts`
- Modify: `docs/01-product-requirements.md`
- Modify: `docs/03-product-flows.md`
- Modify: `docs/05-backend-structure.md`
- Modify: `docs/README.md`
- Modify: `README.md` only if a relevant registration timing statement exists; do not alter unrelated deployment/config sections.

**Contract changes:**
- Add `REGISTRATION_WEEK_NOT_OPEN` and `OUTSIDE_REGISTRATION_WINDOW` to `RegistrationFailureCodeSchema`.
- Add the same two machine-readable values to `RegistrationDayUnavailableReasonSchema` so existing per-day arrays can explain locked reads; do not add new wire metadata fields.
- Add contract tests for both failure codes, both reason values, strict unknown-code rejection, and a valid seven-day window with `editable: false` for weekly-locked days.

**HTTP E2E changes:**
- Preserve existing route/body-validation tests, but add a real `RegistrationsService` integration setup rather than echoing a mocked service for weekly behavior. Use a Nest app with the actual controller/service and a mocked Prisma persistence boundary only when disposable PostgreSQL is unavailable; make the service’s `new Date()` deterministic with Vitest fake timers and provide the minimum Prisma responses needed for read projection and successful mutation.
- Exercise `GET /api/registrations/week` and `PUT /api/registrations/batch` through the real route, including closed next week, exact Saturday 17:00 opening, `+2` outside, and mixed partial results. Keep the existing Zod request rejection assertions.
- Use a configurable cutoff fixture (for example `18:00`) when a Sunday current/next-week item must demonstrate weekly eligibility; do not change the default `CUTOFF_TIME` domain behavior. Do not add code-echo mocks for weekly semantics.

**Documentation:** Update only the relevant weekly-registration passages to state Monday–Sunday Vietnam weeks, current-week availability before Saturday 17:00, exact-boundary opening of next week, outside-window locking, server-authoritative read/mutation flags, and that per-meal `CUTOFF_TIME` remains a separate safeguard. Keep serving-window timing unchanged.

---

### Task 3: Mobile profile/calendar presentation (mobile worker)

**Files:**
- Modify: `apps/mobile/src/api/mobileApiError.ts`
- Modify: `apps/mobile/src/i18n/translations.ts`
- Modify: `apps/mobile/src/screens/employee/EmployeeCalendarScreen.tsx`
- Test: `apps/mobile/src/api/registrationAPI.test.ts`
- Test: `apps/mobile/src/screens/employee/calendarRegistrationState.test.ts`
- Modify: `apps/mobile/src/screens/employee/EmployeeProfileScreen.tsx`
- Modify: `apps/mobile/src/screens/employee/profilePresentation.ts`
- Test: `apps/mobile/src/screens/employee/profilePresentation.test.ts`

- Consume the shared `v1.RegistrationFailureCode` and `v1.RegistrationDayUnavailableReason` values `REGISTRATION_WEEK_NOT_OPEN` and `OUTSIDE_REGISTRATION_WINDOW`.
- Map both codes to stable localized calendar messages while continuing to trust server `editable`, action flags, and reason arrays; do not infer weekday/week eligibility locally.
- Resolve profile display identity as `name.trim()` when present, otherwise `email.trim()` local-part, otherwise the translated unavailable label; derive initials from that same resolved source. Leave identifier and stats behavior unchanged.

---

### Validation (after all tasks; no commit)

1. Run red/green focused tests for the new helper and service cases, then the targeted contracts suite and real registration HTTP E2E suite.
2. Run API/contracts typecheck and lint commands and record exact exit status and test counts.
3. Launch the real Nest API route with a throwaway HTTP smoke harness (not a permanent script) and assert closed-next, exact-boundary opening, `+2` outside, and mixed partial batch responses. Use fake time or a test-only deterministic clock fixture and a disposable/mock persistence boundary; remove the harness after the run.
4. Run mobile profile/calendar/API focused tests and mobile TypeScript validation; smoke the actual Profile/Calendar surfaces to verify resolved fallback identity/initials, unchanged identifier/stats, and server-owned weekly messages.
5. Report every command, exact exit code/count, and any PostgreSQL/environment blocker. Do not commit or modify `packages/domain/src/RegistrationService.ts`; its legacy `isAllowed`/cancellation callers are compatibility-domain tests and are not API mutation callers for this fix.
