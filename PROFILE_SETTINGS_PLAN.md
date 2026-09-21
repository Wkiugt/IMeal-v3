# Mobile Settings/Profile Redesign Plan

## Context

Redesign only the employee mobile Profile screen’s settings area so unrelated controls are split into compact, scannable groups with one consistent row grammar. Preserve the existing profile identity card, monthly statistics, application shell, bottom navigation, tokens, typography, surface recipes, reminder persistence/rollback, notification permission behavior, delegation flow, and logout semantics. The finished screen keeps the current IMeal visual language while replacing the oversized combined preferences card, inline language segmented control, oversized notification action, and disconnected delegation row.

## Approach

### 1. Preserve the existing screen boundary and navigation shell

- Modify `apps/mobile/src/screens/employee/EmployeeProfileScreen.tsx` in place; keep its exported `EmployeeProfileScreen({ navigation }: ProfileStackScreenProps<'ProfileHome'>)` signature, `AppFrame`, `SectionHeader`, `IdentityCard`, and `StatisticsCard` unchanged.
- Keep `apps/mobile/src/ui/AppShell.tsx`, `apps/mobile/src/navigation.ts`, and `apps/mobile/App.tsx` unchanged. The employee dock must retain its current destinations, selected lens, safe-area clearance, and `EmployeeProfile -> ProfileHome` behavior.
- Import `useNavigation` and `BottomTabNavigationProp<AppTabParamList>` using the same parent-tab navigation pattern as `NotificationDetailScreen`. Define `type TabNavigation = BottomTabNavigationProp<AppTabParamList>` and obtain `const tabNavigation = useNavigation<TabNavigation>()`; the meal-preferences row calls `tabNavigation.navigate('EmployeeCalendar')`. Do not add a profile route or meal-preference persistence contract: this repository models meal choice per eligible registration date, not as an account-level preference.
- Leave `KitchenProfileScreen.tsx` unchanged. The requested meal/reminder/notification/delegation structure exists only on the employee Profile screen.

### 2. Establish one screen-local settings-row grammar

Add these private helpers above `EmployeeProfileScreen` in `apps/mobile/src/screens/employee/EmployeeProfileScreen.tsx`; do not export them or add them to `apps/mobile/src/ui/components`:

- `SettingsGroup({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element` renders an accessible eyebrow/header followed by `Surface level={1} padding="lg"`. Use the existing Surface 1 recipe, not `GlassSurface`: canonical IMeal guidance reserves glass for floating docks/overlays and uses Surface 1 for dense content groups.
- `SettingRowLayout` owns the common icon tile, title/supporting-copy column, trailing slot, compact reflow, and alignment. Its props are `{ icon: LucideIcon; title: string; supportingText?: string; trailing: React.ReactNode; compactLayout: boolean }`.
- `NavigationSettingRow` wraps `SettingRowLayout` in a full-row `Pressable`, accepts `{ icon; title; supportingText?; currentValue?; onPress; accessibilityHint?; compactLayout }`, and renders a compact secondary value plus `ChevronRight` in the trailing slot.
- `ToggleSettingRow` accepts `{ icon; title; supportingText; value; loading; onValueChange; compactLayout }` and passes `showLabel={false}` to the existing `Toggle`; the row title remains the switch’s localized accessibility label.
- `StatusSettingRow` accepts `{ icon; title; supportingText; status: StatusDotStatus; statusLabel; compactLayout }` and renders the existing accessible `StatusDot` in the trailing slot.

All three rows share:

- 44px-or-larger interactive/control targets via `designTokens.size.touchMin`.
- An 18px Lucide icon centered in a `designTokens.size.controlSm` brand-tint tile.
- `AppText` body title and supporting/secondary explanation with `space.xs` separation.
- `space.md` horizontal gaps, `space.md` vertical row padding, flexing copy with `minWidth: 0`, and trailing content that never pushes the title off-screen.
- The existing `compactLayout = width < 350 || fontScale > 1.2` breakpoint: copy and trailing content reflow vertically while the icon remains aligned with the title; no text clipping or fixed one-line assumptions.
- A pressed brand-tint background for navigation rows rather than a new animation. Dividers use the existing `Divider` and start at the text column (`controlSm + space.md`) instead of spanning beneath the icon.

### 3. Replace the combined card with four compact groups

Keep the profile header, identity card, and monthly statistics first, then render the settings groups in this exact order with `space.lg` (16px) between groups:

1. **MEAL**
   - One `NavigationSettingRow` using `Leaf`, matching the existing meal-preference icon language.
   - Title: `Meal preferences`; trailing value: `Not set up`; supporting copy: `Choose meal types for eligible registration dates`.
   - Pressing the row opens the existing `EmployeeCalendar` tab. This is the selected product behavior; it must not create a fake preference editor or imply a saved account default.
2. **NOTIFICATIONS**
   - `ToggleSettingRow` with `Clock3`: `Registration reminder`; supporting copy `Notify before the weekly booking deadline`; preserve the existing initial load, disabled/loading state, PATCH, confirmed-value update, rollback, and warning notice in `handleReminderChange`.
   - An inset `Divider`.
   - `StatusSettingRow` with `Bell`: `System notifications`; supporting copy `Allow IMeal to send notifications`.
   - Map permission state without changing `NotificationProvider`:
     - `granted` -> `StatusDot status="active"`, label `Enabled`, no contextual surface.
     - `denied` -> `StatusDot status="inactive"`, label `Disabled`, then a compact warning-tint surface containing `AlertTriangle`, `Notifications are disabled on this device`, and a right-aligned quiet text-link `Open settings →` that calls `openSettings`.
     - `undetermined` -> `StatusDot status="pending"`, label `Not configured`, then a quiet text-link `Enable notifications →` that calls `enableNotifications`; do not render a primary/secondary button.
     - `simulator` -> `StatusDot status="inactive"`, label `Unavailable`, then a compact warning surface using the existing physical-device-required copy and no action.
     - `unavailable` -> `StatusDot status="inactive"`, label `Unavailable`, then compact secondary copy `System notifications are unavailable on this platform` and no action.
   - If `configurationError` exists, render it in the same compact warning-surface recipe beneath the status row. Do not combine a status badge with a large CTA, and do not leave any permission warning visible in the normal granted/no-error state.
3. **APP**
   - One `NavigationSettingRow` with `Languages`, title `Language`, current value `Vietnamese` or `English`, and no supporting text.
   - Pressing the row opens the language bottom sheet described in step 4.
4. **PERMISSIONS & SHARING**
   - One `NavigationSettingRow` with `UsersRound`, title `Delegation`, and supporting copy `Manage permissions for receiving meals`.
   - Preserve `navigation.navigate('Delegation')` exactly.

Remove the old combined `preferencesCard`, dietary `StatusBadge`, inline language radiogroup/segmented styles, external delegation divider, standalone delegation visual recipe, large notification `ActionButton`, and their now-unused imports/styles. Keep all API calls and provider ownership in their current modules.

### 4. Add screen-local language and sign-out bottom sheets

Use React Native `Modal` directly in `EmployeeProfileScreen.tsx`, modeled on `KitchenScannerScreen` because the repository has no shared bottom-sheet primitive. Reuse `useSafeAreaInsets()` for bottom padding and `useReducedMotion()` so `animationType` is `none` when reduced motion is enabled and `slide` otherwise. Each sheet uses the existing non-tappable scrim, standard Surface 1 color, max width 390, `radius.floating` top corners, tokenized padding/gaps, and an accessible heading. Dismiss only through the explicit close/cancel control or Android back, matching the scanner sheet rather than inventing backdrop-tap behavior. Do not introduce a global sheet component or new surface styling.

- Add `languageSheetVisible` and `signOutSheetVisible` booleans.
- **Language sheet:** title `Language`; its header includes a 44px icon-only `X` close button with a localized accessibility label. Render a `radiogroup` with two 44px-or-larger radio rows in this order: `Vietnamese`, `English`. The selected row uses the existing brand tint/selected border and `Check`; each row exposes `accessibilityRole="radio"` and `{ checked }`. Selecting the current language closes the sheet. Selecting a different language awaits the existing local `setLanguage` path; close after local persistence succeeds, then keep the existing best-effort notification-locale PATCH and warning notice if the server update fails. If local persistence fails, show the existing warning notice and leave the sheet open.
- **Sign-out entry:** below the final group, add `space.3xl` separation and a quiet unfilled `Pressable` containing the existing critical `LogOut` icon and localized `profile.signOut` label. Keep it left-aligned with the settings content and use only the existing destructive foreground token; do not render a filled red main-screen button.
- **Sign-out sheet:** title and destructive confirmation label use `profile.signOut`; message uses `profile.signOutConfirm`; render a `critical` `ActionButton` for confirmation and a `ghost` `ActionButton` for `common.cancel`. Confirmation closes the sheet, then runs the existing `performLogout`: best-effort `revokeCurrentDevice()` followed by session `logout()`. Cancel and Android back close the sheet without changing the session.

### 5. Update localized copy without changing translation infrastructure

Update both dictionaries in `apps/mobile/src/i18n/translations.ts` with exact VI/EN parity. Reuse existing keys where the concept is unchanged; add profile-scoped keys for new group/status/context copy.

- Change existing values:
  - `profile.dietaryPreferences`: `Tùy chọn suất ăn` / `Meal preferences`
  - `profile.notSet`: `Chưa thiết lập` / `Not set up`
  - `profile.bookingReminders`: `Nhắc hạn đăng ký` / `Registration reminder`
  - `profile.remindersHint`: `Nhắc trước hạn đăng ký hằng tuần` / `Notify before the weekly booking deadline`
  - `profile.delegations`: `Ủy quyền` / `Delegation`
  - `profile.delegationsHint`: `Quản lý quyền nhận suất ăn` / `Manage permissions for receiving meals`
- Add:
  - `profile.groupMeal`: `SUẤT ĂN` / `MEAL`
  - `profile.groupNotifications`: `THÔNG BÁO` / `NOTIFICATIONS`
  - `profile.groupApp`: `ỨNG DỤNG` / `APP`
  - `profile.groupPermissionsSharing`: `QUYỀN & CHIA SẺ` / `PERMISSIONS & SHARING`
  - `profile.mealPreferencesHint`: `Chọn loại suất cho các ngày đăng ký phù hợp` / `Choose meal types for eligible registration dates`
  - `profile.systemNotificationsHint`: `Cho phép IMeal gửi thông báo` / `Allow IMeal to send notifications`
  - `profile.notificationEnabled`: `Đã bật` / `Enabled`
  - `profile.notificationDisabled`: `Đã tắt` / `Disabled`
  - `profile.notificationNotConfigured`: `Chưa thiết lập` / `Not configured`
  - `profile.notificationUnavailable`: `Không khả dụng` / `Unavailable`
  - `profile.notificationsDisabledWarning`: `Thông báo đang bị tắt trên thiết bị này` / `Notifications are disabled on this device`
  - `profile.notificationsUnavailableHint`: `Thông báo hệ thống không khả dụng trên nền tảng này` / `System notifications are unavailable on this platform`
  - `profile.signOut`: `Đăng xuất` / `Sign out`
  - `profile.signOutConfirm`: `Đăng xuất khỏi thiết bị này?` / `Sign out of this device?`
  - `profile.closeLanguage`: `Đóng phần chọn ngôn ngữ` / `Close language selection`
- Keep `profile.languageHint` because `KitchenProfileScreen` still uses it. Remove `profile.managedByAccount` only after confirming its only reference was the deleted employee row; do not alter shared `notifications.enabled/denied/notEnabled` literals used by notification-list/detail screens.

## Critical files & anchors

- `apps/mobile/src/screens/employee/EmployeeProfileScreen.tsx` — `EmployeeProfileScreen`, its reminder/language/logout handlers, current combined settings card, and screen-local styles; all redesign behavior lives here.
- `apps/mobile/src/i18n/translations.ts` — VI source dictionary and EN parity dictionary for group labels, compact statuses, warnings, and revised row copy.
- `apps/mobile/src/screens/notifications/NotificationDetailScreen.tsx` — `TabNavigation`/`useNavigation` exemplar for navigating from a nested stack screen to `EmployeeCalendar`; read before copying the type pattern.
- `apps/mobile/src/screens/kitchen/KitchenScannerScreen.tsx` — existing safe-area-aware slide-up `Modal` recipe; copy its structural pattern, not scanner-specific styles/content.
- `apps/mobile/src/notifications/NotificationProvider.tsx` — authoritative permission-state semantics and `enableNotifications`/`openSettings`/`revokeCurrentDevice` actions; consume unchanged.

## Verification

Repository policy assigns manual QA to the user, so do not add or run automated test suites for this presentation-only redesign. Perform the following static check and actual-surface smoke checks:

1. From the repository root, run:
   - `yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json`
   - Expected: exit code 0 with no TypeScript diagnostics.
2. With the existing local PostgreSQL/API environment running and `.env` populated from `.env.example`, start the API and Expo web app from the repository root:
   - `yarn workspace @imeal/api start:dev`
   - `yarn workspace @imeal/mobile exec expo start --web`
   - Sign in with the local fixture `staff01` / `123`, open Profile, and verify at a 390×844 viewport that identity/statistics remain unchanged; the four labeled groups appear in order; cards, strokes, shadows, type, icon tiles, and spacing match existing IMeal surfaces; the bottom dock is unchanged.
3. Exercise the changed interactions on the running app:
   - Meal preferences opens the existing calendar tab.
   - Registration reminder shows a busy/disabled switch during persistence and settles on the server-confirmed value; a failed request restores the previous value and shows the existing notice.
   - Language opens a bottom sheet; the selected language has a check; choosing the other language updates all copy/current value and closes the sheet.
   - Delegation opens the existing delegation screen.
   - Sign out opens a bottom sheet; Cancel preserves the session; confirm revokes the device best-effort and returns to Auth.
4. Repeat the Profile visual pass at 320px width and at 200% browser zoom. Titles/supporting text must wrap, trailing values/statuses must reflow rather than overlap, every row/sheet action must remain reachable, and no content may sit behind the unchanged bottom dock.
5. On a physical iOS/Android device when available, check both notification permission states:
   - OS permission denied -> `Disabled`, one compact warning, and `Open settings →` launches device settings.
   - OS permission granted -> `Enabled` with no warning/action surface.
   - Also enable the platform’s reduced-motion setting and confirm both bottom sheets appear without slide animation.
   If a physical device is unavailable, report these native-only checks as unexercised; do not infer them from Expo web.

## Assumptions & contingencies

- The Meal preferences row intentionally opens `EmployeeCalendar`, as selected, and does not claim or persist an account-level preference. `Not set up` is the compact value requested for the main row; the supporting copy explains that actual choices are per eligible registration date.
- Identity and monthly statistics remain because the request targets the settings information architecture, not the existing profile summary. Their data and placeholder `—` values are untouched.
- No shared bottom-sheet primitive exists. Keep both sheets local to `EmployeeProfileScreen.tsx`; do not expand this task into a global design-system refactor.
- Expo web reports native push as unavailable by design. Use the unavailable status/copy there and reserve denied/enabled/open-settings claims for an actual device.