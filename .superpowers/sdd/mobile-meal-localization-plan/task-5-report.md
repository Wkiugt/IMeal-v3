# Task 5 — Calendar meal-choice selector and mutation state report

## Status

Complete for the current mobile foundation. Employee calendar state now tracks `{ active, mealChoice }` per date, consumes server-provided lunar/choice metadata, and keeps off-day drafts separate from server registration state. The existing Task 4 calendar rows, fixed markers, and `bottomClearance={0}` remain unchanged.

## Behavior delivered

- Active registrations hydrate their stored `mealChoice`; missing or inactive dates default to `REGULAR`.
- The switch remains the register/cancel control. Active requests include the selected choice; cancellation requests omit `mealChoice`.
- The selector is rendered only when the server advertises `VEGETARIAN`, with 44px option targets, radio accessibility state, check icon, and existing accent palette. Bilingual labels and lunar badge copy are defined in one local copy table; the screen currently resolves English because Task 6's language provider is not present yet.
- Lunar badges are rendered from `lunarDate.day` metadata only; no lunar calculation exists in mobile.
- Off-day selector changes update `draftChoiceByDate`; switching on persists that draft. Week refetch reconciles active choices from the server, preserves an available off-day draft, and resets unavailable drafts to `REGULAR`.
- `CalendarMutationTracker` enforces one in-flight mutation per date, monotonic per-date request IDs, and stale-result protection. Optimistic state and draft changes roll back only for the latest request; cutoff failures lock the date and refresh server metadata. Result handling branches on failure `code`, never `reason` literals.
- `registrationAPI` now uses v1 contract aliases and parses week and batch responses with their schemas before returning success data.

## Focused test evidence

### RED

```text
corepack yarn workspace @imeal/mobile exec vitest run src/screens/employee/calendarRegistrationState.test.ts
```

Failed before the helper existed with `Cannot find module './calendarRegistrationState'` (0 tests ran), confirming the new behavior test was initially red.

### GREEN

```text
corepack yarn workspace @imeal/mobile exec vitest run src/screens/employee/calendarRegistrationState.test.ts src/screens/employee/calendarGrid.test.ts
```

Passed: 2 test files, 7 tests. Coverage includes state hydration/defaults, draft retention/reset, active/cancel payload semantics, mutation serialization and stale request IDs, plus the Task 4 September geometry helper.

### Scoped typecheck

```text
corepack yarn workspace @imeal/mobile exec tsc --noEmit --pretty false
```

Passed with no output.

## Files changed

- `apps/mobile/src/screens/employee/EmployeeCalendarScreen.tsx`
- `apps/mobile/src/screens/employee/calendarRegistrationState.ts`
- `apps/mobile/src/screens/employee/calendarRegistrationState.test.ts`
- `apps/mobile/src/api/registrationAPI.ts`

## Concerns

- No LanguageProvider/i18n foundation exists in the current branch. Both VI and EN selector/badge labels are present in `CALENDAR_COPY`, with English selected as the current app's existing copy; Task 6 should replace that resolution with `useLanguage()` and localized notice strings.
- No web/native visual smoke test or project-wide validation was run, per Task 5 scope.

## Review follow-up

- Accessibility review: child options keep independent `radio` elements with checked/disabled state; an earlier parent radiogroup experiment was removed to avoid native accessibility trees absorbing the children.

- Re-review follow-up: the parent no longer carries `accessible`/`radiogroup`; an accessible non-container label and group-prefixed option labels provide native-safe context.

- Final accessibility follow-up: the selector uses an accessible 1×1 sibling `Text` label (not an accessible container), and each option label includes the group context, so VoiceOver/TalkBack can focus and operate both radios independently.
