# Kitchen Profile Shared Composition Migration

**Date:** 2026-09-22  
**Status:** Approved design; implementation intentionally deferred  
**Scope:** Mobile presentation/component refactor only. No API, contract, database, route, or role-policy change.

## Decision summary

Migrate the Kitchen Profile screen to the same visual composition and interaction primitives as the existing Staff Profile screen without turning the two screens into one role-agnostic controller. Staff remains the visual and behavioral reference. Shared code will contain prop-driven presentation only; each screen keeps ownership of its role-specific data, permissions, API calls, persistence, and navigation.

Kitchen will retain its current session-derived account identity, placeholder statistics, local language persistence, and logout operation. The legacy Kitchen preferences surface, inline segmented language selector, and filled logout button will be replaced by the Staff-style settings group, language sheet, and sign-out entry/modal. The shared modal will preserve Kitchen's existing logout semantics by invoking only `useSession().logout()`; it will not revoke a push device, call notification APIs, or add error/permission behavior.

No Kitchen profile metrics will be invented. The existing `—` values remain until a separately approved Kitchen profile contract and endpoint exist.

## Goals

1. Make Kitchen Profile visually consistent with Staff Profile: identity composition, statistics placement, settings-group/row grammar, language sheet, sign-out entry, spacing, tokens, accessibility, and responsive reflow.
2. Preserve Staff output and behavior while extracting only the presentation primitives needed by both screens.
3. Preserve the existing navigation graph and deep links:
   - Staff: `EmployeeProfile -> ProfileHome`, with nested `Delegation`.
   - Kitchen: direct `KitchenProfile` tab and `kitchen-profile` link.
4. Keep role-specific ownership explicit:
   - Staff owns reminder preferences, notification permission/device actions, delegation, and Staff-specific navigation.
   - Kitchen owns only its session identity, local language persistence, and logout callback.
5. Remove the legacy Kitchen UI without adding dependencies or a new API.

## Non-goals and hard constraints

- Do not change `apps/mobile/src/navigation.ts`, `apps/mobile/App.tsx`, or `apps/mobile/src/ui/AppShell.tsx` route behavior.
- Do not change `MobileProfile`/`AuthenticatedUser`; profile identity remains `{ id, userId, email, name?, roles, permissions }`.
- Do not add a Kitchen profile endpoint, metrics endpoint, or inferred statistics from the Kitchen dashboard snapshot.
- Do not add `useNotifications`, `notificationAPI`, reminder PATCHes, delegation actions, Staff calendar actions, or Staff permission UI to Kitchen.
- Do not change Staff's user-visible identity, statistics, reminder, notification, delegation, language, or logout behavior.
- Do not change the existing `StatisticsCard` contract or design tokens.
- Do not add a global settings store or role-aware hook. Screen controllers remain local.
- Do not modify production source while authoring this design and plan.

## Repository evidence and current boundaries

| Area | Current source and symbols | Design consequence |
| --- | --- | --- |
| Staff screen | `apps/mobile/src/screens/employee/EmployeeProfileScreen.tsx`, `EmployeeProfileScreen` line 643; local `ProfileIdentity` line 88; `SettingsGroup` line 58; `SettingRowLayout` line 123; `NavigationSettingRow` line 177; `ProfileSheet` line 369; `LogoutCard` line 414; `ProfileLogoutModal` line 462 | These helpers define the reference geometry, responsive behavior, accessibility, reduced-motion handling, and Staff settings semantics. Extract their presentation parts exactly, then keep Staff-only wrappers/controllers local. |
| Staff role behavior | `EmployeeProfileScreen` lines 643-737 and 772-908 | Preserve notification preference loading/PATCH rollback, permission mapping, locale sync, nested Delegation navigation, device revocation before logout, and custom modal state. |
| Kitchen screen | `apps/mobile/src/screens/kitchen/KitchenProfileScreen.tsx`, `KitchenProfileScreen` lines 20-22; handlers lines 31-49; render lines 51-118 | Replace only the presentation shell. Keep `profile`, `logout`, `showNotice`, `language`, `setLanguage`, the compact breakpoint, fallbacks, local language handler, and logout callback in this controller. |
| Existing shared cards | `apps/mobile/src/ui/components/Cards.tsx`, `IdentityCard` lines 209-236 and `StatisticsCard` lines 238-272; exports in `ui/components/index.ts` lines 62-76 | `StatisticsCard` is already a safe common foundation. The Staff identity is not the shared `IdentityCard`: Staff's local identity is an unwrapped reference composition, while Kitchen currently uses a Surface-wrapped `IdentityCard`. The migration intentionally uses the extracted Staff identity composition for both screens. `IdentityCard` remains available but is removed from Kitchen's imports. |
| Shell and route composition | `apps/mobile/src/ui/AppShell.tsx` nav arrays lines 39-56 and profile tab special case lines 187-203; `apps/mobile/App.tsx` `ProfileStackNavigator` lines 204-212 and `AppTabsNavigator` lines 224-255; linking lines 277-285; `apps/mobile/src/navigation.ts` lines 5-24 | No navigation edits. Hybrid users continue to receive employee navigation/profile; Kitchen Profile remains kitchen-only. |
| Session/account contract | `apps/mobile/src/auth/session.tsx` `MobileProfile` lines 34-54; API `AuthenticatedUser` has the same fields | Shared presentation receives already-resolved strings. It does not fetch or interpret role permissions. |
| Kitchen API | `apps/mobile/src/api/kitchenAPI.ts` lines 41-77; `packages/contracts/src/v1/kitchen.ts` lines 4-77 | Only dashboard counters/lists/logs and serving signal exist. None are a Kitchen Profile metric source. |
| Notifications | `apps/mobile/src/notifications/NotificationProvider.tsx` context lines 25-38 and actions lines 114-171; `apps/mobile/src/api/notificationAPI.ts` preference methods lines 107-125 | These remain Staff-only dependencies. Kitchen must not import them as a side effect of sharing Profile UI. |
| Copy and persistence | `apps/mobile/src/i18n/translations.ts` profile keys in VI lines 95-143 and EN lines 440-471; `LanguageProvider` `setLanguage` lines 38-42 | Reuse existing typed copy. Kitchen calls local `setLanguage` only; Staff retains its best-effort notification-locale sync. |

## Target architecture

### Screen/controller boundary

Keep the exported screens and their route prop types unchanged:

```ts
// Staff
export function EmployeeProfileScreen(
  { navigation }: ProfileStackScreenProps<'ProfileHome'>,
): React.JSX.Element;

// Kitchen
export function KitchenProfileScreen(
  _props: AppTabScreenProps<'KitchenProfile'>,
): React.JSX.Element;
```

`EmployeeProfileScreen` remains the Staff controller. Its existing API/provider imports, state, handlers, role-specific copy, `Delegation` navigation, notification status mapping, and logout sequence remain local. It may replace local implementations of shared visual helpers with imports from the new presentation module, but rendered structure and observable behavior must remain unchanged.

`KitchenProfileScreen` remains the Kitchen controller. It continues to derive:

```ts
const displayName = profile?.name
  || profile?.email.split('@')[0]
  || t('profile.kitchenAccount');
const userCode = profile?.userId || profile?.id || '—';
const compactLayout = width < 350 || fontScale > 1.2;
```

It continues to render the existing placeholder metrics:

```ts
[
  { label: t('profile.mealsBooked'), value: '—', tone: 'neutral' },
  { label: t('profile.mealsEnjoyed'), value: '—', tone: 'neutral' },
]
```

No controller receives a role-union view model. The screens pass resolved labels, values, icons, and callbacks to dumb shared components.

### Shared presentation module

Create `apps/mobile/src/screens/profile/ProfileComposition.tsx`. This module owns no API calls, session access, role checks, translation lookup, navigation, or persistence. It uses only React Native primitives, Lucide icon types, design tokens, `AppText`, `Avatar`, `Divider`, `Surface`, `Toggle` where required by an explicitly passed slot, `useReducedMotion`, and `useSafeAreaInsets`.

Export these prop-driven symbols:

```ts
export type ProfileIdentityProps = {
  initials: string;
  name: string;
  roleLabel: string;
  identifier?: string;
  style?: StyleProp<ViewStyle>;
};
export function ProfileIdentity(props: ProfileIdentityProps): React.JSX.Element;

export type ProfileSettingsGroupProps = {
  label: string;
  children: React.ReactNode;
  surface?: boolean;
  surfacePadding?: keyof typeof designTokens.space;
  surfaceStyle?: StyleProp<ViewStyle>;
};
export function ProfileSettingsGroup(props: ProfileSettingsGroupProps): React.JSX.Element;

export type ProfileSettingRowLayoutProps = {
  icon: LucideIcon;
  title: string;
  supportingText?: string;
  trailing: React.ReactNode;
  compactLayout: boolean;
  tallLayout?: boolean;
};
export function ProfileSettingRowLayout(props: ProfileSettingRowLayoutProps): React.JSX.Element;

export type ProfileNavigationSettingRowProps = {
  icon: LucideIcon;
  title: string;
  supportingText?: string;
  currentValue?: string;
  onPress: () => void;
  accessibilityHint?: string;
  compactLayout: boolean;
  tallLayout?: boolean;
};
export function ProfileNavigationSettingRow(props: ProfileNavigationSettingRowProps): React.JSX.Element;

export type ProfileLanguageSheetProps = {
  visible: boolean;
  language: AppLanguage;
  title: string;
  closeLabel: string;
  labels: { vi: string; en: string };
  onClose: () => void;
  onSelect: (language: AppLanguage) => void;
};
export function ProfileLanguageSheet(props: ProfileLanguageSheetProps): React.JSX.Element;

export type ProfileSignOutEntryProps = {
  label: string;
  accessibilityHint: string;
  onPress: () => void;
};
export function ProfileSignOutEntry(props: ProfileSignOutEntryProps): React.JSX.Element;

export type ProfileLogoutModalProps = {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  processingLabel: string;
  processing: boolean;
  onClose: () => void;
  onConfirm: () => void;
};
export function ProfileLogoutModal(props: ProfileLogoutModalProps): React.JSX.Element | null;
```

`AppLanguage` is imported as a type from `apps/mobile/src/i18n/translations.ts`. The shared module may keep an unexported generic sheet implementation behind `ProfileLanguageSheet`; callers do not receive arbitrary children or styling hooks that would create a second modal grammar.

The extracted implementations must preserve the Staff reference exactly:

- `ProfileIdentity` uses the current Staff avatar size, identity typography, identifier treatment, and unwrapped layout styles.
- `ProfileSettingsGroup`, `ProfileSettingRowLayout`, and `ProfileNavigationSettingRow` retain the current Staff icon tile, spacing, compact reflow, pressed state, and divider alignment.
- `ProfileLanguageSheet` retains the current safe-area-aware slide/none animation, max width, top-corner radius, close button, radio roles/states, selected check, and local-persistence sequencing delegated through `onSelect`.
- `ProfileSignOutEntry` retains the current animated pressed state and critical label styling.
- `ProfileLogoutModal` retains the current reduced-motion animation, scrim, safe-area/max-height handling, accessible cancel/confirm actions, and processing lock.

Do not move `ToggleSettingRow`, `StatusSettingRow`, `WarningSurface`, `ProfileProgressMeter`, `getNotificationPresentation`, or any notification/reminder logic into Kitchen-facing code. They may remain in Staff or be extracted later only if a separate consumer requires them; this migration does not broaden that surface.

### Staff composition after extraction

Staff still renders, in order:

1. `AppFrame` and `SectionHeader`.
2. Reference identity composition.
3. Existing statistics card and progress meter.
4. Existing Staff notification/reminder group.
5. Existing Staff app/language group.
6. Existing Staff permissions/delegation group.
7. Existing sign-out entry and modal.

Only the ownership location of the shared presentational helpers changes. The Staff screen keeps its current `mealStats`, `notificationAPI`, `useNotifications`, `performLogout`, `handleLanguageChange`, `handleReminderChange`, and nested `navigation.navigate('Delegation')` logic.

### Kitchen composition after migration

Kitchen renders, in order:

1. `AppFrame` and `SectionHeader` with `profile.kitchenSubtitle`.
2. Shared `ProfileIdentity` with Kitchen's existing fallback values and `profile.kitchenAccount` role label.
3. A shared statistics group (`ProfileSettingsGroup` with `surface={false}`) containing the existing `StatisticsCard` with the two unchanged placeholder metrics and `profile.thisMonth`; Kitchen does not render the Staff progress meter because it has no progress data.
4. One shared `ProfileSettingsGroup` labeled `t('profile.groupApp')`, containing one `ProfileNavigationSettingRow`:
   - icon: `Languages`;
   - title: `t('profile.language')`;
   - current value: localized Vietnamese/English label;
   - `onPress`: set `languageSheetVisible` true;
   - supporting text: omitted from the row because the group/row grammar carries the action; the existing `profile.languageHint` remains available for any explicitly retained explanatory copy and is not deleted.
5. Shared `ProfileSignOutEntry` below the settings group, using `profile.signOut` and `profile.signOutHint`.
6. Shared `ProfileLanguageSheet` and `ProfileLogoutModal` controlled by Kitchen-local state.

Kitchen does not render Staff's `MEAL`, `NOTIFICATIONS`, or `PERMISSIONS & SHARING` groups. This is the explicit role boundary, not a missing migration step.

### Kitchen action semantics

Language:

- Selecting the current language closes the sheet without persistence work.
- Selecting another language calls the existing `setLanguage(nextLanguage)` path.
- If local persistence rejects, show the existing `common.error` + `profile.languagePersistenceFailed` notice and keep the sheet open.
- On success, close the sheet. Do not call `notificationAPI.updatePreferences({ locale })`, because that is Staff's existing notification preference sync and is not part of Kitchen's current behavior.

Logout:

- The shared modal replaces the native `Alert.alert` presentation but preserves its destructive confirmation, cancel, and Android-back semantics.
- Kitchen's confirm callback closes the modal and calls only `void logout()`; it does not call `revokeCurrentDevice`, `notificationAPI`, or any Kitchen endpoint.
- Kitchen does not add a new logout error notice. The existing direct logout behavior remains the only session action.
- Modal state prevents duplicate confirmation while visible; cancel/back never mutate the session.

### Routing and authorization

No route or role-gate changes are part of this design:

- `ProfileStackParamList` continues to contain `ProfileHome` and `Delegation`.
- `AppTabParamList` continues to contain nested `EmployeeProfile` and direct `KitchenProfile`.
- `ProfileStackNavigator` continues to map `ProfileHome` to `EmployeeProfileScreen`.
- `AppTabsNavigator` continues to render Kitchen-only tabs only when `canUseEmployee` is false and `canUseKitchen` is true.
- `AppTabBar` continues to special-case only the nested Employee profile route.
- Existing `profile`, `kitchen-profile`, and `delegations` deep links remain unchanged.

Shared components receive callbacks; they cannot navigate or inspect roles. This prevents Kitchen from gaining Staff-only permissions through presentation reuse.

## Legacy Kitchen UI removal

Remove from `KitchenProfileScreen.tsx` after the shared composition is wired:

- `Alert`, `Pressable`, `Check`, and `LogOut` imports that existed solely for the inline selector/native alert/filled button.
- `IdentityCard`, `Surface`, `Divider`, and `ActionButton` imports used by the legacy Kitchen layout.
- The `preferencesCard`, `languageSection`, `preferenceCopy`, `preferenceHint`, `languageSelector`, `languageSelectorCompact`, `languageOption`, `languageOptionCompact`, `languageOptionSelected`, `logoutDivider`, and `logout` styles.
- The inline two-button radio/segmented control and filled critical `ActionButton`.

Retain only Kitchen controller state/handlers, `AppFrame`, `SectionHeader`, `StatisticsCard`, shared Profile composition imports, `useNotice`, `useLanguage`, `useSession`, and the compact breakpoint. Any remaining style must be used by the current placeholder statistics or an explicit Kitchen layout wrapper; remove unused styles rather than retaining compatibility aliases.

## Accessibility and responsive contract

- Preserve minimum 44px touch targets through `designTokens.size.touchMin`.
- Preserve accessible heading roles for group labels and sheet titles.
- Preserve radio roles and `checked` states in the language sheet.
- Preserve accessible identity labels and modal action labels.
- Preserve Staff's compact breakpoint `width < 350 || fontScale > 1.2` and reflow trailing content instead of clipping.
- Validate Kitchen at the same 390px reference width, 320px narrow width, and 200% browser zoom used by the Staff profile plan.
- Preserve reduced-motion behavior: both sheets use `animationType="none"` when `useReducedMotion()` is true and the current slide/animated behavior otherwise.

## Migration sequence

1. **Create the shared presentation module.** Copy the Staff reference implementations for identity, settings group/layout/navigation row, language sheet, sign-out entry, and logout modal into `apps/mobile/src/screens/profile/ProfileComposition.tsx`; make only naming/import/style-scope changes required for export. Keep behavior and token values byte-for-byte equivalent where practical.
2. **Refactor Staff to consume shared presentation.** Replace Staff-local copies of the extracted helpers with imports. Leave Staff-only `ToggleSettingRow`, `StatusSettingRow`, `WarningSurface`, `ProfileProgressMeter`, notification presentation, handlers, state, and styles local. Compare the pre/post rendered tree and accessibility/action contract before proceeding.
3. **Migrate Kitchen composition.** Replace the legacy identity/preferences/logout render with the shared identity, statistics card, settings group/navigation row, language sheet, sign-out entry, and logout modal. Add only Kitchen-local sheet state and handlers needed to preserve its current `setLanguage` and `logout` operations.
4. **Remove legacy Kitchen code.** Delete now-unused imports/styles and confirm no Kitchen screen imports notification/reminder/delegation APIs. Do not modify route files or add metrics/API calls.
5. **Run scoped verification and actual-surface smoke checks.** Use the commands and manual matrix below. Report native-only notification checks as not applicable to Kitchen and do not infer them from web.

## Verification plan

### Static and scoped commands

Run from the repository root after implementation (not during this documentation task):

```sh
yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json
yarn workspace @imeal/mobile exec vitest run src/screens/employee/profilePresentation.test.ts src/ui/AppShell.test.tsx
git diff --check
```

Expected results:

- TypeScript exits 0 with no diagnostics.
- Existing Staff notification-presentation tests pass.
- Existing AppShell tests still prove Employee nested profile and direct Kitchen profile tab navigation.
- `git diff --check` reports no whitespace errors.

No snapshot suite or broad repository test run is required for this presentation/refactor task. Add a focused test only for a new pure state/mapper function whose boundary is otherwise uncertain; do not assert source structure, style object identity, or duplicated implementation details.

### TDD note

This is a presentation extraction and role-boundary refactor, not a new business behavior. The implementation should still use a narrow red-green cycle for observable invariants:

1. Before changing a controller, make the smallest focused test adjustment needed to pin the existing navigation/permission boundary (the existing `AppShell.test.tsx` route assertions are the baseline).
2. If a pure helper is introduced for language selection or logout state, write a behavior test first for current-language close, persistence failure keeping the sheet open, and confirm/cancel separation; then implement the minimal helper. Do not create snapshot tests for the shared visual tree.
3. Run the scoped tests after each extraction/migration task.
4. Finish with the TypeScript check and actual Expo web smoke test because visual consistency, responsive wrapping, and modal reachability cannot be proven by unit tests alone.

### Manual smoke matrix

With the existing local API/Expo setup and a 390x844 viewport:

- Staff Profile is visually and behaviorally unchanged: identity/statistics, groups, reminder toggle rollback/loading, notification status/actions, language sheet, Delegation navigation, device-revoke-before-logout, and animated logout modal.
- Kitchen-only sign-in opens the unchanged `KitchenProfile` route and retains Kitchen identity values/fallbacks and placeholder `—` statistics.
- Kitchen shows the Staff-style identity/statistics/settings composition; legacy inline selector and filled logout button are gone.
- Kitchen language opens the shared sheet; current language closes without work; another language updates local `LanguageProvider` state; a forced local persistence failure shows the existing notice and leaves the sheet open; no notification preference request is made.
- Kitchen cancel/back leaves the session active; confirm closes the shared modal and calls only `logout()`; no push-device revoke or notification request occurs.
- At 320px and 200% zoom, titles/trailing values reflow, every action remains reachable, and no content is obscured by the bottom dock.
- Existing direct `kitchen-profile`, nested `profile`, and nested `delegations` links still resolve.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Extracting the Staff identity or modal changes Staff spacing, accessibility, or motion | Copy exact Staff implementation/styles first; run Staff route/presentation tests and compare the actual surface before Kitchen migration. |
| Shared presentation accidentally imports role-specific APIs | Enforce a dependency rule in review: `ProfileComposition.tsx` imports no `auth/session`, notification, kitchen API, delegation API, navigation, or screen-specific translation hooks. |
| Kitchen gains Staff-only settings or permissions | Keep Kitchen's render list explicit and limited to identity, placeholder stats, APP/language, and sign-out. No role union or shared controller. |
| Shared logout modal changes Kitchen session behavior | The Kitchen callback only calls `logout()`; no `revokeCurrentDevice`, API sync, or new notice. Cancel/back and destructive confirm semantics remain explicit. |
| Placeholder values become mistaken for real metrics | Keep literal `—` values and document that no Kitchen profile contract exists. Do not map dashboard counters into the profile. |
| Route/deep-link regressions | Do not edit route files; run existing AppShell tests and link smoke checks for both nested and direct profile paths. |

## Acceptance criteria

- [ ] `EmployeeProfileScreen` remains on `ProfileStackScreenProps<'ProfileHome'>` and has no observable Staff behavior or visual regression.
- [ ] `KitchenProfileScreen` remains on `AppTabScreenProps<'KitchenProfile'>`; its route, role gate, and deep link are unchanged.
- [ ] Kitchen uses the extracted Staff identity/settings/language/sign-out composition and no longer renders the legacy preferences card, inline selector, or filled logout button.
- [ ] Kitchen still displays the existing session-derived account fields and placeholder `—` metrics; no new Kitchen API/contract is added.
- [ ] Kitchen language persistence remains local-only with the existing warning notice on failure; Staff locale sync remains Staff-only.
- [ ] Kitchen logout invokes only existing `logout()` semantics through the shared modal; Staff retains device revocation before logout.
- [ ] Role-specific APIs, permissions, and navigation remain separate.
- [ ] Static commands and manual smoke matrix above pass; native-only checks are reported honestly if unexercised.
