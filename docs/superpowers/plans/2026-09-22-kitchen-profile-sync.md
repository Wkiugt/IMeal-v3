# Kitchen Profile Shared Composition Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Kitchen Profile screen to the Staff Profile composition through shared presentation primitives while preserving Staff behavior, Kitchen account data, local language persistence, logout semantics, routes, and role-specific API boundaries.

**Architecture:** Keep `EmployeeProfileScreen` and `KitchenProfileScreen` as separate controllers with their current route prop types and role-specific dependencies. Extract only prop-driven visual primitives from the Staff screen into `apps/mobile/src/screens/profile/ProfileComposition.tsx`; both screens compose those primitives with local data and callbacks. Kitchen keeps placeholder statistics and never imports notification, reminder, delegation, or new Kitchen-profile APIs.

**Tech Stack:** React Native + Expo, TypeScript, React Navigation 6, `lucide-react-native`, `react-native-safe-area-context`, existing IMeal design tokens/components, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-kitchen-profile-sync-design.md`

## Global Constraints

- Staff remains the visual and behavioral reference; no observable Staff identity, statistics, settings, notification, delegation, language, logout, route, or accessibility regression is acceptable.
- `EmployeeProfileScreen` keeps `ProfileStackScreenProps<'ProfileHome'>`; `KitchenProfileScreen` keeps `AppTabScreenProps<'KitchenProfile'>`.
- Do not modify `apps/mobile/src/navigation.ts`, `apps/mobile/App.tsx`, or `apps/mobile/src/ui/AppShell.tsx`; preserve nested `EmployeeProfile/ProfileHome`, direct `KitchenProfile`, and existing deep links.
- Shared presentation code must not import session/auth, notification, kitchen API, delegation API, navigation, or screen-specific translation hooks.
- Kitchen keeps `MobileProfile`-derived identity fields and literal `—` statistics; do not add a Kitchen Profile endpoint or infer profile metrics from `KitchenDashboardSnapshot`.
- Kitchen language changes call only `useLanguage().setLanguage`; do not add `notificationAPI.updatePreferences({ locale })` to Kitchen.
- Kitchen confirmation calls only the existing `logout()` callback; do not add `revokeCurrentDevice`, notification API calls, or new logout error behavior.
- Keep the existing compact breakpoint `width < 350 || fontScale > 1.2`, tokenized spacing, 44px touch targets, accessibility roles/states, and reduced-motion behavior.
- No new dependency, route, global store, role-union controller, snapshot suite, or broad repository test run.
- Implementation is source-only after this plan; the current documentation task commits only this plan and the spec.

---

## File map and ownership

| File | Action | Responsibility after migration |
| --- | --- | --- |
| `apps/mobile/src/screens/profile/ProfileComposition.tsx` | Create | Shared prop-driven identity, settings group/row, language sheet, sign-out entry, and logout modal presentation. No API/session/navigation/role logic. |
| `apps/mobile/src/screens/employee/EmployeeProfileScreen.tsx` | Modify | Staff controller and Staff-only presentation (`ToggleSettingRow`, `StatusSettingRow`, `WarningSurface`, `ProfileProgressMeter`, notification mapping, reminder/PATCH rollback, locale sync, Delegation navigation, device revocation). Import extracted shared primitives without changing output. |
| `apps/mobile/src/screens/kitchen/KitchenProfileScreen.tsx` | Modify | Kitchen controller with session identity, placeholder stats, local language persistence, and direct logout callback. Compose shared primitives; delete legacy inline selector and filled logout UI. |
| `apps/mobile/src/screens/employee/profilePresentation.ts` | Do not modify | Existing pure notification status mapper and tests remain Staff-specific. |
| `apps/mobile/src/ui/components/Cards.tsx` | Do not modify | Existing `StatisticsCard` remains the shared statistics foundation. `IdentityCard` remains available but is no longer imported by Kitchen after migration. |
| `apps/mobile/src/i18n/translations.ts` | Do not modify unless TypeScript exposes a missing existing key | Reuse existing `profile.groupApp`, `profile.language`, `profile.vietnamese`, `profile.english`, `profile.signOut`, `profile.signOutHint`, `profile.signOutConfirm`, `profile.closeLanguage`, and existing notice keys. No new copy is required by this migration. |
| `apps/mobile/src/navigation.ts`, `apps/mobile/App.tsx`, `apps/mobile/src/ui/AppShell.tsx` | Do not modify | Preserve route types, tab registration, role gate, tab-bar special case, and deep links. |

## Shared interfaces

The new module must export the following exact prop-driven interfaces. Use `AppLanguage` as a type import from `apps/mobile/src/i18n/translations.ts`; use `LucideIcon`, `StyleProp<ViewStyle>`, and `designTokens` from existing modules.

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

The shared implementation must preserve the Staff reference styles and behavior: unwrapped identity geometry, icon-tile/navigation-row grammar, 44px controls, compact reflow, language radio accessibility, safe-area/reduced-motion sheet behavior, pressed sign-out entry, and animated logout modal. Shared components accept resolved text and callbacks; they never call `useSession`, `useLanguage`, `notificationAPI`, `kitchenAPI`, `navigation`, or `useNotifications`.

---

### Task 1: Establish and verify shared Profile presentation primitives

**Files:**
- Create: `apps/mobile/src/screens/profile/ProfileComposition.tsx`
- Test/verification: existing `apps/mobile/src/screens/employee/profilePresentation.test.ts`, `apps/mobile/src/ui/AppShell.test.tsx`, and TypeScript check; no snapshot test

**Interfaces:**
- Consumes: the current private Staff helper implementations in `EmployeeProfileScreen.tsx` and existing `AppText`, `Avatar`, `Divider`, `Surface`, `Toggle`, `designTokens`, `getElevationStyle`, `useReducedMotion`, and `useSafeAreaInsets`.
- Produces: the seven exported component/prop pairs listed in the Shared interfaces section. Later tasks import these names directly from `ProfileComposition.tsx`.

- [ ] **Step 1: Run the focused baseline checks before extraction**

Run from the repository root:

```sh
yarn workspace @imeal/mobile exec vitest run src/screens/employee/profilePresentation.test.ts src/ui/AppShell.test.tsx
yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json
```

Expected: the existing focused tests pass and TypeScript exits 0. If the pre-existing workspace changes make either command fail, record the actual failure before touching source; do not broaden scope to unrelated files.

- [ ] **Step 2: Create the shared module with the Staff reference implementations**

Create `ProfileComposition.tsx` and move/copy only these presentation bodies from `EmployeeProfileScreen.tsx` without changing token values or interaction semantics:

- `ProfileIdentity`: current Staff `ProfileIdentity` body and identity styles.
- `ProfileSettingsGroup`: current `SettingsGroup` body and group-label/surface styles.
- `ProfileSettingRowLayout`: current `SettingRowLayout` body and row/icon/copy/trailing styles.
- `ProfileNavigationSettingRow`: current navigation row body, pressed state, chevron, and value accessibility label.
- `ProfileLanguageSheet`: current `ProfileSheet` body plus its two-option `vi`/`en` radio list, `Check`, close button, safe-area padding, and reduced-motion animation. The parent supplies `language`, labels, close callback, and selection callback.
- `ProfileSignOutEntry`: current `LogoutCard` body and reduced-motion press animation.
- `ProfileLogoutModal`: current `ProfileLogoutModal` body, animation-generation guard, safe-area/max-height calculations, scrim, scroll content, processing lock, cancel/confirm actions, and reduced-motion behavior.

Keep the internal generic sheet helper private unless it is needed by both exported sheet components. Do not import any screen controller or API module.

- [ ] **Step 3: Verify the module boundary and shared contract**

Run:

```sh
yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json
git diff --check
```

Expected: TypeScript has no diagnostics; `git diff --check` has no output. Review the module imports manually and reject any dependency on `auth/session`, `notifications`, `api`, `navigation`, or screen translation hooks.

- [ ] **Step 4: Commit the isolated presentation extraction**

```sh
git add apps/mobile/src/screens/profile/ProfileComposition.tsx
git commit -m "refactor(mobile): add shared profile composition"
```

Do not stage unrelated workspace modifications.

---

### Task 2: Refactor Staff Profile to consume the shared primitives without behavior change

**Files:**
- Modify: `apps/mobile/src/screens/employee/EmployeeProfileScreen.tsx` (`ProfileIdentity`, `SettingsGroup`, `SettingRowLayout`, `NavigationSettingRow`, `ProfileSheet`, `LogoutCard`, `ProfileLogoutModal`, and their moved styles)
- Test/verification: `apps/mobile/src/screens/employee/profilePresentation.test.ts`, `apps/mobile/src/ui/AppShell.test.tsx`, TypeScript check, Staff actual-surface smoke

**Interfaces:**
- Consumes: exports from `apps/mobile/src/screens/profile/ProfileComposition.tsx`.
- Produces: unchanged `EmployeeProfileScreen({ navigation }: ProfileStackScreenProps<'ProfileHome'>)` behavior, with Staff-only wrappers still able to render `ProfileSettingRowLayout` for reminder and notification rows.

- [ ] **Step 1: Replace Staff-local shared helper definitions with imports**

Import the shared symbols under their `Profile*` names. Remove only the local definitions and styles that are now owned by `ProfileComposition.tsx`. Keep these Staff-local symbols and logic intact:

```ts
ToggleSettingRow;
StatusSettingRow;
WarningSurface;
ProfileProgressMeter;
getNotificationPresentation;
handleReminderChange;
performLogout;
handleConfirmLogout;
handleLanguageChange;
```

Update `ToggleSettingRow` and `StatusSettingRow` to render `ProfileSettingRowLayout` with the same props and trailing content. Do not change `notificationAPI` or `useNotifications` imports, state dependencies, labels, or handler bodies.

- [ ] **Step 2: Preserve the Staff render order and callbacks**

The Staff screen must continue to call the same callbacks at these boundaries:

```tsx
<ProfileNavigationSettingRow
  icon={UsersRound}
  title={t('profile.delegations')}
  supportingText={t('profile.delegationsHint')}
  onPress={() => navigation.navigate('Delegation')}
  compactLayout={compactLayout}
  tallLayout
/>

<ProfileLanguageSheet
  visible={languageSheetVisible}
  language={language}
  title={t('profile.language')}
  closeLabel={t('profile.closeLanguage')}
  labels={{ vi: t('profile.vietnamese'), en: t('profile.english') }}
  onClose={() => setLanguageSheetVisible(false)}
  onSelect={(nextLanguage) => void handleLanguageChange(nextLanguage)}
/>

<ProfileLogoutModal
  visible={signOutModalVisible}
  title={t('profile.signOut')}
  message={t('profile.signOutConfirm')}
  cancelLabel={t('common.cancel')}
  confirmLabel={t('profile.signOut')}
  processingLabel={t('common.processing')}
  processing={logoutProcessing}
  onClose={() => setSignOutModalVisible(false)}
  onConfirm={() => void handleConfirmLogout()}
/>
```

Retain Staff's identity/statistics order, hardcoded `{ booked: 12, used: 8 }` values, progress meter, notification warning states, reminder rollback, locale PATCH, and `revokeCurrentDevice()` before `logout()`.

- [ ] **Step 3: Run the Staff regression checks**

Run:

```sh
yarn workspace @imeal/mobile exec vitest run src/screens/employee/profilePresentation.test.ts src/ui/AppShell.test.tsx
yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json
```

Expected: both existing test files pass and TypeScript exits 0. Then perform the Staff actual-surface smoke at 390x844 and confirm identity/statistics/groups, reminder persistence/rollback, notification states, Delegation navigation, language sheet, reduced-motion sheet behavior, and device-revoke-before-logout are unchanged.

- [ ] **Step 4: Commit the Staff consumer refactor**

```sh
git add apps/mobile/src/screens/employee/EmployeeProfileScreen.tsx
git commit -m "refactor(mobile): consume shared profile primitives in staff"
```

Do not stage Kitchen or unrelated files in this task.

---

### Task 3: Migrate Kitchen Profile to the shared composition and preserve role-specific actions

**Files:**
- Modify: `apps/mobile/src/screens/kitchen/KitchenProfileScreen.tsx` (`KitchenProfileScreen`, handlers, render, styles)
- Test/verification: `apps/mobile/src/ui/AppShell.test.tsx`, TypeScript check, Kitchen actual-surface smoke; no new API test

**Interfaces:**
- Consumes: `ProfileIdentity`, `ProfileSettingsGroup`, `ProfileNavigationSettingRow`, `ProfileLanguageSheet`, `ProfileSignOutEntry`, and `ProfileLogoutModal` from `ProfileComposition.tsx`; `IdentityCard` is no longer consumed.
- Produces: direct `KitchenProfile` route with unchanged session-derived identity, placeholder statistics, local language persistence, and `logout()` behavior.

- [ ] **Step 1: Add only Kitchen-local sheet state and handlers**

Keep the current profile-derived values and compact breakpoint. Add state for the shared sheets and a confirm handler that does not add Staff behavior:

```ts
const [languageSheetVisible, setLanguageSheetVisible] = useState(false);
const [signOutModalVisible, setSignOutModalVisible] = useState(false);

const handleLogout = () => {
  setSignOutModalVisible(true);
};

const handleConfirmLogout = () => {
  setSignOutModalVisible(false);
  void logout();
};
```

Keep the existing local-only `handleLanguageChange` operation, adjusted only to open/close the shared sheet:

```ts
const handleLanguageChange = async (nextLanguage: 'vi' | 'en') => {
  if (nextLanguage === language) {
    setLanguageSheetVisible(false);
    return;
  }
  try {
    await setLanguage(nextLanguage);
  } catch {
    showNotice({
      title: t('common.error'),
      message: t('profile.languagePersistenceFailed'),
      tone: 'warning',
    });
    return;
  }
  setLanguageSheetVisible(false);
};
```

Do not import `notificationAPI`, `useNotifications`, `kitchenAPI`, or `revokeCurrentDevice`. Do not add a logout notice or API call.

- [ ] **Step 2: Replace the legacy Kitchen render with the shared composition**

Keep `AppFrame`, `SectionHeader`, existing Kitchen subtitle, existing fallback identity values, and existing placeholder `StatisticsCard` metrics. Replace the `IdentityCard` and legacy preferences surface with this structure:

```tsx
<ProfileIdentity
  initials={initials(profile?.name, 'ME')}
  name={displayName}
  roleLabel={t('profile.kitchenAccount')}
  identifier={userCode}
/>

<ProfileSettingsGroup label={t('profile.groupStatistics')} surface={false}>
  <StatisticsCard
    eyebrow={t('profile.thisMonth')}
    metrics={[
      { label: t('profile.mealsBooked'), value: '—', tone: 'neutral' },
      { label: t('profile.mealsEnjoyed'), value: '—', tone: 'neutral' },
    ]}
  />
</ProfileSettingsGroup>

<ProfileSettingsGroup label={t('profile.groupApp')}>
  <ProfileNavigationSettingRow
    icon={Languages}
    title={t('profile.language')}
    currentValue={language === 'vi' ? t('profile.vietnamese') : t('profile.english')}
    onPress={() => setLanguageSheetVisible(true)}
    compactLayout={compactLayout}
  />
</ProfileSettingsGroup>

<ProfileSignOutEntry
  label={t('profile.signOut')}
  accessibilityHint={t('profile.signOutHint')}
  onPress={handleLogout}
/>

<ProfileLanguageSheet
  visible={languageSheetVisible}
  language={language}
  title={t('profile.language')}
  closeLabel={t('profile.closeLanguage')}
  labels={{ vi: t('profile.vietnamese'), en: t('profile.english') }}
  onClose={() => setLanguageSheetVisible(false)}
  onSelect={(nextLanguage) => void handleLanguageChange(nextLanguage)}
/>

<ProfileLogoutModal
  visible={signOutModalVisible}
  title={t('profile.signOut')}
  message={t('profile.signOutConfirm')}
  cancelLabel={t('common.cancel')}
  confirmLabel={t('profile.signOut')}
  processingLabel={t('common.processing')}
  processing={false}
  onClose={() => setSignOutModalVisible(false)}
  onConfirm={handleConfirmLogout}
/>
```

Do not add Staff's `MEAL`, `NOTIFICATIONS`, or `PERMISSIONS & SHARING` groups. Do not map Kitchen dashboard counters into profile statistics.

- [ ] **Step 3: Remove legacy Kitchen imports/styles and check role boundaries**

Remove imports used only by the old layout: `Alert`, `Pressable`, `Check`, `LogOut`, `Divider`, `IdentityCard`, `Surface`, and `ActionButton`. Retain only imports used by the new screen. Delete unused inline selector and filled logout styles. Keep any statistics margin style only if it is still applied; otherwise delete it.

Search the final Kitchen file and confirm these symbols do not occur:

```text
notificationAPI
useNotifications
revokeCurrentDevice
kitchenAPI
Delegation
IdentityCard
ActionButton
languageSelector
logoutDivider
```

- [ ] **Step 4: Run Kitchen route/type checks**

Run:

```sh
yarn workspace @imeal/mobile exec vitest run src/ui/AppShell.test.tsx
yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json
git diff --check
```

Expected: AppShell route assertions pass, TypeScript exits 0, and there are no whitespace errors. The existing AppShell assertions must still expect `navigation.navigate('KitchenProfile')` for the Kitchen dock and `navigation.navigate('EmployeeProfile', { screen: 'ProfileHome' })` for Staff.

- [ ] **Step 5: Run the Kitchen actual-surface smoke**

Start the existing Expo web surface using the repository's normal mobile command, sign in as a kitchen-only fixture, and check at 390x844:

- Section header, identity, and placeholder statistics render with Kitchen copy and account values.
- Staff-style grouped APP/language row is present; the old inline selector and filled critical button are absent.
- Language sheet closes for the current language; another language updates all copy and closes; a forced local storage failure shows the existing warning and leaves the sheet open.
- No notification preference or push-device request is sent by Kitchen.
- Cancel/back leaves the session active; confirm closes the shared modal and invokes only `logout()`.
- At 320px and 200% zoom, row content reflows and remains reachable above the unchanged dock.

- [ ] **Step 6: Commit the Kitchen migration**

```sh
git add apps/mobile/src/screens/kitchen/KitchenProfileScreen.tsx
git commit -m "refactor(mobile): align kitchen profile composition"
```

Do not stage route files, API files, contracts, or unrelated workspace modifications.

---

### Task 4: Final focused verification and migration review

**Files:**
- Modify: none expected; only fix files listed in Tasks 1-3 if a verification defect is observed
- Test/verification: focused mobile tests, TypeScript, diff checks, and manual Staff/Kitchen matrix

**Interfaces:**
- Consumes: completed shared composition and both screen consumers.
- Produces: evidence that the migration is complete without route/API/role drift.

- [ ] **Step 1: Run the final focused commands**

```sh
yarn workspace @imeal/mobile exec vitest run src/screens/employee/profilePresentation.test.ts src/ui/AppShell.test.tsx
yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json
git diff --check
```

Expected: both focused test files pass; TypeScript exits 0; diff check is clean. Do not claim the whole repository is green from these scoped commands.

- [ ] **Step 2: Review the changed-file dependency boundary**

Run:

```sh
git diff --name-only HEAD~3..HEAD
git diff -- apps/mobile/src/navigation.ts apps/mobile/App.tsx apps/mobile/src/ui/AppShell.tsx apps/mobile/src/api apps/mobile/src/auth/session.tsx packages/contracts/src
```

Expected: the first command lists only the shared presentation module and the two profile screens across the three implementation commits. The second command is empty; route, API, session, and contract files are unchanged.

- [ ] **Step 3: Recheck Staff and Kitchen acceptance criteria manually**

Use the design spec's manual smoke matrix. Record separately:

- Staff visual/behavioral equivalence.
- Kitchen composition and legacy UI removal.
- Kitchen local language persistence and no locale PATCH.
- Kitchen logout callback semantics and no device revoke.
- Placeholder metrics remain `—`.
- Route/deep-link preservation.
- Narrow-width, zoom, accessibility, and reduced-motion behavior.

- [ ] **Step 4: Commit only any final source corrections**

If a correction is required, stage only the affected profile source file and use a focused message:

```sh
git add apps/mobile/src/screens/profile/ProfileComposition.tsx apps/mobile/src/screens/employee/EmployeeProfileScreen.tsx apps/mobile/src/screens/kitchen/KitchenProfileScreen.tsx
git commit -m "fix(mobile): preserve profile migration contracts"
```

Do not stage `.env.example`, `README.md`, `apps/mobile/package.json`, `docs/local-role-testing.md`, `yarn.lock`, or any other pre-existing workspace changes.

## TDD and test policy summary

This work is a presentation/refactor task. Existing tests defend the highest-risk observable boundaries (notification-state mapping and route navigation). Do not add snapshots or tests that assert private style objects, component names, import paths, or implementation duplication. Use a test-first red-green cycle only if implementation introduces a new pure language/logout state helper; the required behaviors are current-language close, persistence failure leaves the language sheet open, and cancel/confirm separation. Otherwise, preserve the existing focused tests and prove the visual/modal contract with the actual Expo surface at the reference and narrow layouts.

## Completion checklist

- [ ] Shared `ProfileComposition.tsx` exports the exact prop-driven primitives and has no role/API/navigation dependencies.
- [ ] Staff imports shared primitives with no observable behavior or visual change.
- [ ] Kitchen uses shared identity/settings/language/sign-out composition and no legacy selector/filled logout UI.
- [ ] Kitchen retains current account fallbacks, literal placeholder metrics, local language persistence, and logout-only confirm callback.
- [ ] Notification/reminder/delegation/device-revoke behavior remains Staff-only.
- [ ] Routes, role gates, tab-bar behavior, and deep links are unchanged.
- [ ] Focused tests, TypeScript, diff checks, and manual smoke matrix are complete with evidence.
