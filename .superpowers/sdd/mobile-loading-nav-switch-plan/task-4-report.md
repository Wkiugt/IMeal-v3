# Task 4 Report: Scope weekly toggle pending visual state per row

## Scope

Updated only `apps/mobile/src/screens/employee/EmployeeCalendarScreen.tsx`. The initial-loading migration and unrelated registration/API behavior were left unchanged.

## Root cause

The weekly row already serialized registration mutations at screen scope with `savingDate`: while one request was pending, every row received `disabled={savingDate !== null || locked}`. `AnimatedMealToggle` also used that interaction state in its visual style condition, `(disabled || saving) && styles.toggleSaving`, so all seven rows received the pending opacity even though only one date was being saved.

The thumb animation itself is owned by each `AnimatedMealToggle` instance through its own `useRef(new Animated.Value(...))`, and weekly rows retain the stable `key={dateKey}`. The issue was visual-state coupling to `disabled`, not shared animated state or unstable keys.

## Changes

- Added the row-local `isSaving` value (`savingDate === dateKey`) in the weekly row map and passed it as `saving={isSaving}`.
- Kept `disabled={savingDate !== null || locked}` unchanged so request serialization and accessibility/interaction behavior still apply to every row during a save.
- Changed pending styling to `saving && styles.toggleSaving`; only the row whose date is being mutated dims.
- Stopped any existing `progress` animation before each new target animation.
- Retained the animation handle and returned cleanup that stops both the handle and `progress.stopAnimation()` when the effect is invalidated or the toggle unmounts.
- Preserved reduced-motion behavior by setting the target value directly, with cleanup for the animated value.
- Left optimistic success behavior and all business/API/network rollback paths unchanged: failures still restore `weekState[dateKey]` to `previous`, so only that row animates back.
- Did not lift `Animated.Value`, add a global animation map, change row keys, or alter loading semantics.

## Verification

- TSX syntax/transpilation check passed:
  `bun -e "new Bun.Transpiler({loader: 'tsx'}).transformSync(await Bun.file('apps/mobile/src/screens/employee/EmployeeCalendarScreen.tsx').text()); console.log('TSX parse passed')"`
- `git diff --check -- apps/mobile/src/screens/employee/EmployeeCalendarScreen.tsx` passed with no output.
- No React Native component-test harness exists in the mobile package; the only mobile test is the unrelated `requestWithTimeout` API test, so no style-text assertion or implementation-coupled test was added.
- Per the task constraints, formatters, linters, project-wide TypeScript, and the project-wide mobile suite were not run; those belong to the integration pass after sibling tasks land.

## Self-review

Confirmed that the patch is limited to the requested row-scoped visual and animation cleanup. The seven-row interaction gate, stable date keys, per-instance animation values, optimistic update, success target retention, cutoff handling, and non-cutoff rollback paths remain intact.
