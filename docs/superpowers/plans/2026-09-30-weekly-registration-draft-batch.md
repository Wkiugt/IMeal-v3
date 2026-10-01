# Weekly Registration Draft and Home Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Staff a server-authoritative weekly registration calendar with local drafts and one dirty-date batch save, and make Home render backend menu/lifecycle data without hardcoded meal content.

**Architecture:** Keep transport parsing in the registration API adapter and normalize the response into a mobile-owned calendar model. The calendar screen will hold three layers: the last confirmed `serverState`, local `draft`, and a derived `presentation`; pure helpers own dirty comparison, eligibility, batch reconciliation, request gating, and stale-response protection. Home will use a pure projection over the backend’s registration status, serving evidence, and menu; the screen will only format the resulting status and dynamic menu/location strings.

**Tech Stack:** React Native + Expo + TypeScript strict mode, Zod contracts through `@imeal/contracts`, Vitest pure tests, existing `designTokens`/component barrel, existing `MobileApiError` and request-id patterns.

**Spec:** `docs/01-product-requirements.md` §§6–7; `docs/03-product-flows.md` §§3–4; `docs/04-ui-ux-design.md` §§6–7 and §18; approved mobile attachment in the director request.

## Global Constraints

- Mobile does not decide cutoff authority; server `editable` and server time remain canonical, with a local cutoff estimate used only to disable/selectively refresh the UI.
- One save request contains every currently dirty date, including a date that became locked after drafting; the backend decides per-date eligibility and returns canonical success/failure. No per-date save requests and no duplicate save while a batch is in flight.
- An inactive draft meal choice is retained for later activation but is never sent as a meaningless `CANCELLED` payload.
- `Chọn cả tuần` selects only eligible server dates and preserves an already selected `VEGETARIAN` choice when that choice remains available.
- Batch partial success commits successful dates and keeps failed-date drafts; a subsequent authoritative GET must overlay those failed drafts, even if the GET marks those dates locked.
- A whole PUT network failure keeps the last server data and every local draft; a GET failure after successful results keeps confirmed results as provisional and never resends them automatically.
- Stale GET/save responses and conflicting edits cannot overwrite newer local state; request gates use monotonically increasing IDs.
- Home uses backend menu/description/location and lifecycle data. The client trusts the backend registration status (including `SERVED`), counts `ACTIVE`, `SERVED`, and `NO_SHOW`, and enables QR only for `ACTIVE` with a complete published menu and server `canOpenQr`.
- No `/v2` path, hardcoded operational/menu/location data, `any`, unsafe casts, or new dependency.
- TDD is mandatory: every production helper is introduced only after its behavior test has failed for the intended reason.

---

### Task 1: Calendar normalized state and dirty-batch behavior

**Files:**
- Modify: `apps/mobile/src/screens/employee/calendarRegistrationState.ts`
- Test: `apps/mobile/src/screens/employee/calendarRegistrationState.test.ts`

**Interfaces:**
- `CalendarDayState = { active: boolean; mealChoice: MealChoice }`.
- `CalendarServerState = Readonly<Record<string, CalendarDayState>>`.
- `CalendarDraftState = Readonly<Record<string, CalendarDayState>>`.
- `CalendarDayAvailability = Pick<v1.WeekRegistrationDay, 'cutoffAt' | 'availableMealChoices' | 'canActivate' | 'canCancel' | 'canChangeMealChoice' | 'menu' | 'location' | 'unavailableReasons'>`; use `v1.WeekRegistrationDay` from the shared contract rather than a transport-equivalent local type.
- `CalendarBatchResult = v1.BatchRegistrationResult`.
- `setDraftDay(draftState, date, nextDay): CalendarDraftState` changes only local draft state; the screen invokes it only when the authoritative per-day action/choice flag and live server cutoff allow the requested transition.
- `getDirtyDates(serverState, draftState): string[]` compares `active`, and compares `mealChoice` only when both states are active; inactive choice-only edits are not dirty.
- `buildDirtyBatchPayload(serverState, draftState, dirtyDates): v1.BatchRegistrationItem[]` emits `ACTIVE` with choice for activation/active choice changes and emits `CANCELLED` only when server was active and draft is inactive.
- `isDateSelectable(day, nowAt): boolean` requires `canActivate`, a non-null published enabled non-holiday menu with a revision, at least one available meal choice, and `nowAt < cutoffAt`; it does not require a location snapshot because location absence is a server-owned display/reason state.
- `selectAllEligible(serverState, draftState, availabilityByDate, nowAt): CalendarDraftState` activates only server-eligible dates, defaults to `REGULAR`, and keeps an existing available `VEGETARIAN` choice.
- `reconcileBatchResults(serverState, draftState, submittedDraft, results): { serverState; draftState; provisionalDates }` commits only results for submitted dates, retains failed/missing drafts, and returns successful dates as provisional until GET confirmation.
- `overlayAuthoritativeWeek(authoritativeState, draftState, failedDates): { serverState; draftState }` replaces server state while retaining only failed-date drafts, including drafts for newly locked dates.
- `CalendarBatchTracker.begin()/isCurrent()/finish()` allows one batch and rejects stale completions; starting a save invalidates in-flight GET completions, and `beginLoad()/isCurrentLoad()` isolates stale GET responses.

**Tests to write first:**

```ts
it('only returns active or active-choice differences as dirty dates', () => {
  const server = {
    '2026-09-21': { active: false, mealChoice: 'REGULAR' },
    '2026-09-22': { active: true, mealChoice: 'REGULAR' },
  } satisfies CalendarServerState;
  const draft = {
    ...server,
    '2026-09-21': { active: false, mealChoice: 'VEGETARIAN' },
    '2026-09-22': { active: true, mealChoice: 'VEGETARIAN' },
  } satisfies CalendarDraftState;
  expect(getDirtyDates(server, draft)).toEqual(['2026-09-22']);
});

it('does not emit cancellation for an absent inactive date', () => {
  const server = { '2026-09-21': { active: false, mealChoice: 'REGULAR' } } satisfies CalendarServerState;
  const draft = { '2026-09-21': { active: false, mealChoice: 'VEGETARIAN' } } satisfies CalendarDraftState;
  expect(buildDirtyBatchPayload(server, draft, [])).toEqual([]);
});

it('emits activation choice and cancellation only for truly dirty dates', () => {
  const server = {
    '2026-09-21': { active: false, mealChoice: 'REGULAR' },
    '2026-09-22': { active: true, mealChoice: 'VEGETARIAN' },
  } satisfies CalendarServerState;
  const draft = {
    '2026-09-21': { active: true, mealChoice: 'REGULAR' },
    '2026-09-22': { active: false, mealChoice: 'VEGETARIAN' },
  } satisfies CalendarDraftState;
  expect(buildDirtyBatchPayload(server, draft, getDirtyDates(server, draft))).toEqual([
    { mealDate: '2026-09-21', status: 'ACTIVE', mealChoice: 'REGULAR' },
    { mealDate: '2026-09-22', status: 'CANCELLED' },
  ]);
});

it('selects eligible dates and preserves available vegetarian choices', () => {
  const server = {
    '2026-09-21': { active: true, mealChoice: 'VEGETARIAN' },
    '2026-09-22': { active: false, mealChoice: 'REGULAR' },
    '2026-09-23': { active: false, mealChoice: 'REGULAR' },
  } satisfies CalendarServerState;
  const draft = {
    ...server,
    '2026-09-21': { active: true, mealChoice: 'VEGETARIAN' },
  } satisfies CalendarDraftState;
  const availability = {
    '2026-09-21': { editable: true, published: true, holiday: false, availableMealChoices: ['REGULAR', 'VEGETARIAN'], cutoffAt: null },
    '2026-09-22': { editable: true, published: true, holiday: false, availableMealChoices: ['REGULAR'], cutoffAt: null },
    '2026-09-23': { editable: true, published: false, holiday: false, availableMealChoices: ['REGULAR'], cutoffAt: null },
  } satisfies Record<string, CalendarDayAvailability>;
  expect(selectAllEligible(server, draft, availability, Date.now())).toEqual({
    ...draft,
    '2026-09-21': { active: true, mealChoice: 'VEGETARIAN' },
    '2026-09-22': { active: true, mealChoice: 'REGULAR' },
  });
});

it('commits two successful dates but retains the failed draft', () => {
  const server = {
    '2026-09-21': { active: false, mealChoice: 'REGULAR' },
    '2026-09-22': { active: false, mealChoice: 'REGULAR' },
    '2026-09-23': { active: false, mealChoice: 'REGULAR' },
  } satisfies CalendarServerState;
  const draft = {
    '2026-09-21': { active: true, mealChoice: 'REGULAR' },
    '2026-09-22': { active: true, mealChoice: 'VEGETARIAN' },
    '2026-09-23': { active: true, mealChoice: 'REGULAR' },
  } satisfies CalendarDraftState;
  const result = reconcileBatchResults(server, draft, draft, [
    { date: '2026-09-21', success: true },
    { date: '2026-09-22', success: true },
    { date: '2026-09-23', success: false, code: 'CUTOFF_PASSED', reason: 'locked' },
  ]);
  expect(result.serverState).toMatchObject({
    '2026-09-21': { active: true, mealChoice: 'REGULAR' },
    '2026-09-22': { active: true, mealChoice: 'VEGETARIAN' },
  });
  expect(result.draftState['2026-09-23']).toEqual({ active: true, mealChoice: 'REGULAR' });
  expect(result.provisionalDates).toEqual(['2026-09-21', '2026-09-22']);
});

it('keeps all drafts and server data when the PUT never returns', () => {
  const tracker = new CalendarBatchTracker();
  const request = tracker.begin();
  expect(request).not.toBeNull();
  expect(tracker.begin()).toBeNull();
  expect(tracker.isCurrent(request as number)).toBe(true);
  expect(tracker.finish(request as number)).toBe(true);
});

it('rejects stale GET completion after a newer load starts', () => {
  const tracker = new CalendarBatchTracker();
  const first = tracker.beginLoad();
  const second = tracker.beginLoad();
  expect(tracker.isCurrentLoad(first)).toBe(false);
  expect(tracker.isCurrentLoad(second)).toBe(true);
});
```

- [x] Run the focused calendar helper tests; the normalized APIs and tracker now pass.
- [x] Implement immutable calendar helpers/tracker and remove obsolete transport-facing state helpers after screen cutover.
- [x] Re-run the focused calendar helper tests successfully.

---

### Task 2: Home lifecycle projection and weekly count

**Files:**
- Create: `apps/mobile/src/screens/employee/dashboardState.ts`
- Create: `apps/mobile/src/screens/employee/dashboardState.test.ts`

- `HomeDay = Pick<v1.WeekRegistrationDay, 'mealDate' | 'menu' | 'registration' | 'location'>`; this is a view of the shared transport type, not a second serving/menu contract.
- `HomeLifecycle = 'ACTIVE' | 'SERVED' | 'NO_SHOW' | 'CANCELLED' | 'UNREGISTERED' | 'NO_MENU'`.
- `projectHomeToday(day: HomeDay): { lifecycle; menu; location; registration; canOpenQr }` trusts the backend `registration.status`; the client does not derive `SERVED` from serving evidence.
- `countHomeWeekRegistrations(days: readonly HomeDay[]): number` counts backend statuses `ACTIVE`, `SERVED`, and `NO_SHOW`, and excludes `CANCELLED` and unregistered days.

**Tests to write first:**

```ts
it('uses the backend SERVED projection without inferring a client-side serving state', () => {
  const day = makeHomeDay({
    registration: {
      id: 'served-1',
      mealDate: '2026-09-30',
      status: 'SERVED',
      mealChoice: 'REGULAR',
      menuRevisionId: 'revision-1',
    },
  });
  expect(projectHomeToday(day)).toMatchObject({
    lifecycle: 'SERVED',
    canOpenQr: false,
    menu: day.menu,
    location: day.location,
  });
});

it.each([
  ['ACTIVE', true],
  ['SERVED', false],
  ['NO_SHOW', false],
  ['CANCELLED', false],
] as const)('allows QR only for active registration with menu (%s)', (status, expected) => {
  const day = makeHomeDay({
    registration: {
      id: 'registration-1',
      mealDate: '2026-09-30',
      status,
      mealChoice: 'REGULAR',
      menuRevisionId: 'revision-1',
    },
  });
  expect(projectHomeToday(day).canOpenQr).toBe(expected);
});

it('distinguishes unregistered and no-menu states', () => {
  expect(projectHomeToday(makeHomeDay({ registration: null })).lifecycle).toBe('UNREGISTERED');
  expect(projectHomeToday(makeHomeDay({ menu: null, registration: null })).lifecycle).toBe('NO_MENU');
});

it('counts ACTIVE, SERVED, and NO_SHOW but not CANCELLED', () => {
  expect(countHomeWeekRegistrations([
    makeHomeDay({ registration: { id: 'a', mealDate: '2026-09-30', status: 'ACTIVE', mealChoice: 'REGULAR', menuRevisionId: 'r' } }),
    makeHomeDay({ registration: { id: 'b', mealDate: '2026-10-01', status: 'SERVED', mealChoice: 'REGULAR', menuRevisionId: 'r' } }),
    makeHomeDay({ registration: { id: 'c', mealDate: '2026-10-02', status: 'NO_SHOW', mealChoice: 'REGULAR', menuRevisionId: 'r' } }),
    makeHomeDay({ registration: { id: 'd', mealDate: '2026-10-03', status: 'CANCELLED', mealChoice: 'REGULAR', menuRevisionId: 'r' } }),
  ])).toBe(3);
});
```

- [x] Run the focused Home projection tests; the initial RED step and implementation are complete.
- [x] Implement the pure projection over `v1.WeekRegistrationDay` without React or client-side serving inference.
- [x] Run the focused Home projection tests successfully.

---

### Task 3: Contract adapter and Calendar screen cutover

**Files:**
- Modify: `apps/mobile/src/api/registrationAPI.ts`
- Modify: `apps/mobile/src/screens/employee/EmployeeCalendarScreen.tsx`
- Modify: `apps/mobile/src/i18n/translations.ts`
- Modify: `apps/mobile/src/ui/components/index.ts` only if an existing component needs a public export

**Interfaces:**
- Consume shared `v1.WeekRegistrationResponse.days` (exactly seven `v1.WeekRegistrationDay` values: `menu`, `registration`, `location`, `lunarDate`, `availableMealChoices`, `cutoffAt`, action flags, unavailable reasons, delegation) and keep `registrationWindow` only for `serverNow`/timezone compatibility.
- Normalize each day’s registration to `{ active: registration?.status === 'ACTIVE', mealChoice: registration?.mealChoice ?? 'REGULAR' }`; use the day’s `canActivate`/`canCancel`/`canChangeMealChoice` flags and live cutoff for actions. Draft state is preserved only after an allowed local action and failed responses remain dirty before save.
- Render `presentation` from server+draft; server-owned menu, per-date location, lunar date, cutoff (`formatBusinessInstant` in `Asia/Ho_Chi_Minh`), holiday/disabled/no-menu/location/finalized explanations remain visible.
- Render all seven backend days; do not classify Saturday/Sunday as unavailable in client code. A backend-enabled weekend day is an ordinary selectable service day.
- Wire `Lưu thay đổi` to one dirty batch containing every dirty date, then reconcile results and refresh once; retain failed drafts and mark confirmed results provisional if refresh fails.
- Use `registrationWindow.serverNow` for Home today selection/business-date week lookup after the initial navigation baseline; do not use raw device local date for today matching.
- Reuse the existing request-id pattern and new batch tracker for focus changes, duplicate save taps, stale loads, and conflicting edits. While saving, synchronously disable navigation, edits, and select-all before awaiting the request.
- Warn before cancelling a server-active date with `delegation.status` `PENDING` or `ACCEPTED`, naming the delegate when supplied and explaining that pickup permission is revoked.

**Tests/smoke:**

- [x] Add focused adapter/API parsing tests for the approved shape, including server menu/location and lifecycle fields.
- [x] Run the focused registration adapter/calendar state tests successfully.
- [x] Run the Expo Calendar surface with load, select, select-all, partial save, cutoff lock, network failure, same-week navigation, neutral refresh retry and delegation warning coverage against a disposable API fixture.

---

### Task 4: Home screen cutover

**Files:**
- Modify: `apps/mobile/src/screens/employee/EmployeeDashboardScreen.tsx`
- Modify: `apps/mobile/src/api/registrationAPI.ts` only if the approved typed home fields share the week response and need adapter parsing
- Modify: `apps/mobile/src/i18n/translations.ts`

**Interfaces:**
- Feed `dashboardState.projectHomeToday` from a `Pick<v1.WeekRegistrationDay, 'menu' | 'registration' | 'location' | 'mealDate'>` built from backend `days`; trust backend `registration.status` for `SERVED` and use the VN business date from `registrationWindow.serverNow` to choose today.
- Render real menu meal name, optional description, and per-day location; status labels are client-owned localized copy.
- Render `ACTIVE`, `SERVED`, `NO_SHOW`, `CANCELLED`, `UNREGISTERED`, and `NO_MENU` distinctly; QR action is enabled only for `ACTIVE` with a complete published menu and `canOpenQr`.
- Count only backend statuses `ACTIVE + SERVED + NO_SHOW`; derive the denominator from enabled, published backend menu days rather than hardcoded `5`; preserve stale request-id protection and last safe view on refresh failure.

**Tests/smoke:**

- [x] Add adapter/projection tests for all backend day lifecycle payloads and verify the client trusts backend `SERVED` status instead of deriving it from an untyped serving object.
- [x] Run the focused Home projection and registration adapter tests successfully.
- [x] Run the actual Expo Home surface against dynamic menu/description/location, lifecycle-aware count, and QR visibility; pure projection tests cover the remaining lifecycle permutations.

---

## Verification checklist

- [x] `corepack yarn workspace @imeal/mobile test -- src/screens/employee/calendarRegistrationState.test.ts src/screens/employee/dashboardState.test.ts`
- [x] `corepack yarn workspace @imeal/mobile test -- src/api/registrationAPI.test.ts`
- [x] `corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json`
- [x] Actual Expo Calendar and Home surface smoke completed with the parent evidence artifact at `C:/Users/Khoi Nguyen/.omp/agent/sessions/-orca-workspaces-IMeal-deploy-staging/2026-09-30T13-52-31-504Z_01a0f296-9b10-7101-9258-a767e6837967/local/weekly-mobile-evidence.md`.
- [x] No `/v2`, hardcoded meal/location domain values, `any`, unsafe casts, or unrelated features were introduced.
