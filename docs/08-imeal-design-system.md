# IMeal v2 — Design System Guideline

This is the canonical, platform-neutral visual-system contract for IMeal v2. The first reference implementation is the Expo mobile client in `apps/mobile`; other clients may adopt the same tokens and component contracts without changing business authority. `docs/System-design-UI/DESIGN.md` remains the preserved HTML/prototype baseline and visual provenance. It is not the canonical contract for new runtime work.

## A. Design Philosophy

IMeal is an operational product: a person must understand what can be changed, what is confirmed, and what action is safe while moving quickly on a phone. The system therefore makes hierarchy, state, and recovery visible before decoration. Visual decisions are justified by comprehension, accessibility, tactile feedback, or implementation consistency; taste alone is not a design requirement.

The target balance is **70% solid functional UI, 20% selectively translucent/floating material, and 10% restrained motion/personality**. Solid content carries meal names, forms, QR pixels, dates, warnings, and other decisions that must remain legible in every environment. The smaller glass/material layer gives navigation and temporary controls spatial separation without turning every card into a novelty surface. The small motion/personality allowance makes the product feel current through response to a real action—selection, confirmation, refresh, or navigation—rather than through decorative animation. This keeps enterprise trust while allowing a younger tone through interaction.

The system is an evolution of the existing mobile workflow, not a replacement application. It preserves role-aware navigation, server-authoritative state, the established recovery language, and the static prototype assets as historical reference. Screens own data fetching, workflow state, and recovery; reusable components own visual recipes, semantic indicators, tactile response, and accessibility defaults.

## B. Core Principles

1. **Hierarchy before material.** Surface role, typography, spacing, and one primary action make the next safe decision obvious. Glass, shadow, and motion may reinforce hierarchy but must never be the only signal.
2. **State is redundant by design.** Important states combine color, icon, shape, and a human-readable label. This supports comprehension for color-vision differences, small screens, poor lighting, and screen readers.
3. **The server remains authoritative.** The UI never claims that a registration, reminder, delegation, pickup intent, or serving change succeeded before the server confirms it. Optimistic drafts may be shown only where the existing workflow already defines rollback and never as a saved state.
4. **Tactile feedback is proportional.** Press scales and short transitions acknowledge an action without moving the user’s content out of reach. Motion is bounded, stateful, and removed or made immediate for reduced-motion users.
5. **Solid where accuracy matters.** Forms, dense lists, long text, QR modules, and consequential recovery states use Surface 1 or another opaque surface. A calm background and adequate contrast are prerequisites for any translucency.
6. **One vocabulary, one owner.** `designTokens`, the semantic tone map, and the focused component families are the only runtime visual dialect. Screens do not recreate palette pairs, arbitrary spacing, shadow recipes, or status badges.
7. **Content stays understandable.** Indicators can remove repeated boilerplate, but not meal names/descriptions, locations, primary actions, cutoff/service-window warnings, or unfamiliar/consequential states.
8. **Safe areas and target sizes are structural.** Every actionable target is at least 44×44 points, the floating dock respects physical insets, and content clearance prevents the dock from covering controls.
9. **Recovery is a first-class state.** Loading, expired, invalid, unavailable, no-data, and network failure states each explain what happened and offer the next valid action where one exists.
10. **Preserve the existing product invariants.** The guideline does not relax strict per-day cutoff enforcement, no optimistic saved registration state, the 5-second QR TTL, no stale visible QR, the 10:30–13:30 service window, selected pickup intent across refresh, safe areas, 44×44 targets, reduced motion, or accessible live announcements.

The visual authority boundary is explicit: use this guideline for tokens, surfaces, component ownership, indicator language, motion, and accessibility; use `docs/04-ui-ux-design.md` for workflow and recovery behavior; use `docs/03-product-flows.md` and `docs/01-product-requirements.md` for product/domain policy. Do not rewrite `docs/System-design-UI/**` or wire `packages/ui/**` into the mobile runtime.

## C. Design Tokens

### Token ownership and TypeScript contract

The mobile runtime exports one `as const` object from `apps/mobile/src/ui/designTokens.ts`. The names below are copy-pastable and are the contract for future platform adapters. The loaded Be Vietnam Pro families are retained; the token names, not screen-local literals, are the stable API.

```ts
export type SurfaceRole = 0 | 1 | 2 | 3 | 4;
export type SemanticTone =
  | 'information'
  | 'success'
  | 'warning'
  | 'critical'
  | 'neutral';

export const designTokens = {
  color: {
    brand: {
      primary: '#005EA8',
      secondary: '#78BDF2',
      soft: '#DCEEFF',
      tint: '#F1F8FF',
    },
    background: { page: '#F4F8FC' },
    surface: {
      standard: '#FFFFFF',
      elevated: '#FBFDFF',
      glass: 'rgba(248,252,255,0.74)',
      glassFallback: 'rgba(248,252,255,0.94)',
      brand: '#005EA8',
    },
    text: {
      strong: '#172033',
      secondary: '#475569',
      tertiary: '#64748B',
      onBrand: '#FFFFFF',
    },
    border: {
      standard: '#D7E2EC',
      subtle: 'rgba(23,32,51,0.08)',
      selected: '#2F80ED',
      glassHighlight: 'rgba(255,255,255,0.72)',
      disabled: '#E5EAF0',
    },
    divider: '#E7EDF3',
    disabled: { fill: '#E8EEF4', text: '#8A97A7' },
    semantic: {
      information: { base: '#075EA8', tint: '#EAF4FF' },
      success: { base: '#137A48', tint: '#E7F7EE' },
      warning: { base: '#8A5700', tint: '#FFF3D6' },
      critical: { base: '#B4232C', tint: '#FDEBEC' },
      neutral: { base: '#526174', tint: '#EEF2F6' },
    },
    scrim: 'rgba(15,23,42,0.52)',
  },
  typography: {
    family: {
      regular: 'BeVietnamPro_400Regular',
      medium: 'BeVietnamPro_500Medium',
      semiBold: 'BeVietnamPro_600SemiBold',
      bold: 'BeVietnamPro_700Bold',
      mono: 'monospace',
    },
    pageTitle: { fontSize: 28, lineHeight: 34, fontFamily: 'BeVietnamPro_700Bold', letterSpacing: -0.3 },
    heroTitle: { fontSize: 32, lineHeight: 38, fontFamily: 'BeVietnamPro_700Bold', letterSpacing: -0.4 },
    sectionTitle: { fontSize: 20, lineHeight: 26, fontFamily: 'BeVietnamPro_700Bold', letterSpacing: -0.2 },
    cardTitle: { fontSize: 17, lineHeight: 23, fontFamily: 'BeVietnamPro_600SemiBold' },
    body: { fontSize: 15, lineHeight: 22, fontFamily: 'BeVietnamPro_400Regular' },
    supporting: { fontSize: 13, lineHeight: 19, fontFamily: 'BeVietnamPro_400Regular' },
    caption: { fontSize: 12, lineHeight: 16, fontFamily: 'BeVietnamPro_400Regular' },
    eyebrow: { fontSize: 11, lineHeight: 15, fontFamily: 'BeVietnamPro_600SemiBold', letterSpacing: 0.8 },
    buttonLabel: { fontSize: 15, lineHeight: 20, fontFamily: 'BeVietnamPro_600SemiBold' },
    badgeLabel: { fontSize: 12, lineHeight: 16, fontFamily: 'BeVietnamPro_600SemiBold' },
    metric: { fontSize: 32, lineHeight: 38, fontFamily: 'BeVietnamPro_700Bold', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
    monoCaption: { fontSize: 12, lineHeight: 16, fontFamily: 'monospace' },
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24, '3xl': 32, '4xl': 40, '5xl': 48 },
  radius: { smallControl: 8, inputButton: 12, chip: 10, card: 16, heroCard: 20, floating: 24, full: 999 },
  size: {
    touchMin: 44,
    controlSm: 36,
    controlMd: 44,
    controlLg: 48,
    avatarSm: 40,
    avatarLg: 64,
    qr: 200,
    qrFrame: 232,
    navMinHeight: 60,
    primaryCtaMinHeight: 84,
  },
  border: {
    standard: { width: 1, color: '#D7E2EC' },
    subtle: { width: 1, color: 'rgba(23,32,51,0.08)' },
    selected: { width: 1.5, color: '#2F80ED' },
    glass: { width: 1, color: 'rgba(255,255,255,0.72)' },
    disabled: { width: 1, color: '#E5EAF0' },
  },
  elevation: {
    level0: { offset: { width: 0, height: 0 }, opacity: 0, radius: 0, android: 0 },
    level1: { offset: { width: 0, height: 1 }, opacity: 0.05, radius: 3, android: 1 },
    level2: { offset: { width: 0, height: 6 }, opacity: 0.09, radius: 16, android: 4 },
    level3: { offset: { width: 0, height: 12 }, opacity: 0.12, radius: 28, android: 8 },
    level4: { offset: { width: 0, height: 18 }, opacity: 0.16, radius: 40, android: 12 },
  },
  motion: {
    duration: { instant: 80, fast: 140, standard: 220, emphasized: 320, shimmerCycle: 1400 },
    easing: {
      standard: 'cubic-bezier(0.2,0,0,1)',
      emphasized: 'cubic-bezier(0.16,1,0.3,1)',
      linear: 'linear',
    },
    spring: { stiffness: 280, damping: 26, mass: 0.8 },
    distance: { micro: 4, entrance: 8, overlay: 12 },
    pressScale: { card: 0.985, button: 0.98, compact: 0.96 },
  },
  camera: {
    background: '#050b16',
    scrim: 'rgba(5,11,22,0.45)',
    guide: 'rgba(255,255,255,0.88)',
  },
} as const;
```

All elevation levels use shadow color `#172033`; `level4` is reserved for temporary overlays. Surface-role numbers and elevation numbers are separate axes: Surface 4 normally uses elevation 2–3, never level 4 merely because it is branded. `designTokens` also contains the named camera tokens used by the scanner (`camera.background`, `camera.scrim`, and `camera.guide`) so scanner-specific dark colors do not return as screen literals.

### Component-family ownership

The runtime public barrel is `apps/mobile/src/ui/components/index.ts`; it has no default export and no compatibility aliases:

| File | Owned exports |
| --- | --- |
| `Foundation.tsx` | `AppText`, `Surface`, `GlassSurface`, `FloatingSurface`, `Divider`, `Avatar` |
| `Controls.tsx` | `ActionButton`, `TicketActionCard`, `Toggle`, `SelectionIndicator`, `TextField` |
| `Indicators.tsx` | `StatusBadge`, `MealTypeChip`, `StatusDot`, `ProgressMeter` |
| `Feedback.tsx` | `EmptyState`, `LoadingState`, `QrSkeleton` |
| `Cards.tsx` | `MealCard`, `MealSelectionCard`, `IdentityCard`, `StatisticsCard` |
| `QrTicket.tsx` | `QrTicket`, `QrRefreshIndicator` |

`ProgressRing` and `Stepper` are guideline/API entries only until a live flow consumes them. The obsolete `theme.ts`, `PrototypePrimitives.tsx`, and `PrototypeShell.tsx` names are not runtime vocabulary after cutover.

## D. Color & Semantic Tokens

### Canonical color table

| Token | Value | Role and usage constraint |
| --- | --- | --- |
| `color.brand.primary` | `#005EA8` | Primary action, focus, selected icon |
| `color.brand.secondary` | `#78BDF2` | Supporting sky accent; never body text |
| `color.brand.soft` | `#DCEEFF` | Selected fills and icon tiles |
| `color.brand.tint` | `#F1F8FF` | Subtle informational wash |
| `color.background.page` | `#F4F8FC` | Surface 0 cool page background |
| `color.surface.standard` | `#FFFFFF` | Surface 1 content |
| `color.surface.elevated` | `#FBFDFF` | Raised solid content |
| `color.surface.glass` | `rgba(248,252,255,0.74)` | Blur-capable Surface 3 fill |
| `color.surface.glassFallback` | `rgba(248,252,255,0.94)` | No-blur/Android fallback |
| `color.surface.brand` | `#005EA8` | Surface 4 branded action |
| `color.text.strong` | `#172033` | Headings and primary values |
| `color.text.secondary` | `#475569` | Body and supporting text |
| `color.text.tertiary` | `#64748B` | Metadata, IDs, captions |
| `color.text.onBrand` | `#FFFFFF` | Text and icons on primary blue |
| `color.border.standard` | `#D7E2EC` | Default outline |
| `color.border.subtle` | `rgba(23,32,51,0.08)` | Low-priority separation |
| `color.border.selected` | `#2F80ED` | Selected outline |
| `color.border.glassHighlight` | `rgba(255,255,255,0.72)` | Glass rim/top highlight |
| `color.border.disabled` | `#E5EAF0` | Disabled outline |
| `color.divider` | `#E7EDF3` | Internal separators |
| `color.disabled.fill` | `#E8EEF4` | Disabled control fill |
| `color.disabled.text` | `#8A97A7` | Disabled text/icon only |
| `color.semantic.information.base` | `#075EA8` | Informational icon/text |
| `color.semantic.information.tint` | `#EAF4FF` | Informational fill |
| `color.semantic.success.base` | `#137A48` | Success icon/text |
| `color.semantic.success.tint` | `#E7F7EE` | Success fill |
| `color.semantic.warning.base` | `#8A5700` | Warning icon/text |
| `color.semantic.warning.tint` | `#FFF3D6` | Warning fill |
| `color.semantic.critical.base` | `#B4232C` | Error/expired icon/text |
| `color.semantic.critical.tint` | `#FDEBEC` | Error/expired fill |
| `color.semantic.neutral.base` | `#526174` | Inactive/no-data icon/text |
| `color.semantic.neutral.tint` | `#EEF2F6` | Inactive/no-data fill |
| `color.scrim` | `rgba(15,23,42,0.52)` | Modal/camera overlay |

There is no second accent hue, rainbow/neon material, or gradient dependency. `color.surface.brand` is the solid primary CTA; depth comes from the named border, highlight, and elevation tokens.

### Semantic tone map

One map owns semantic foreground, tint, and default icon. Components require an explicit human-readable label; a tone never synthesizes, hides, or changes the spoken label.

```ts
export const semanticToneMap = {
  information: { foreground: designTokens.color.semantic.information.base, tint: designTokens.color.semantic.information.tint, icon: 'Info' },
  success: { foreground: designTokens.color.semantic.success.base, tint: designTokens.color.semantic.success.tint, icon: 'CheckCircle2' },
  warning: { foreground: designTokens.color.semantic.warning.base, tint: designTokens.color.semantic.warning.tint, icon: 'Clock3' },
  critical: { foreground: designTokens.color.semantic.critical.base, tint: designTokens.color.semantic.critical.tint, icon: 'XCircle' },
  neutral: { foreground: designTokens.color.semantic.neutral.base, tint: designTokens.color.semantic.neutral.tint, icon: 'MinusCircle' },
} as const satisfies Record<SemanticTone, { foreground: string; tint: string; icon: string }>;
```

Use the map for `AppText`, `StatusBadge`, `StatusDot`, meters, notices, and recovery surfaces. Screens choose a semantic meaning, not a color pair. The mapping is informational for meal period/type/location/schedule, success for confirmed/selected/ticket active/completed, warning for closing soon/near expiry/limited, critical for expired/unavailable/error/closed, and neutral for not booked/inactive/paused/no data.

## E. Typography

The reference runtime continues using `BeVietnamPro_400Regular`, `BeVietnamPro_500Medium`, `BeVietnamPro_600SemiBold`, `BeVietnamPro_700Bold`, and `monospace` only for machine-like metadata. Typography recipes are reusable so screens do not invent font size, line height, weight, or tracking.

| Recipe | Size / line height | Family / weight | Tracking and use |
| --- | --- | --- | --- |
| `pageTitle` | 28 / 34 | Be Vietnam Pro bold | `-0.3`; screen title |
| `heroTitle` | 32 / 38 | Be Vietnam Pro bold | `-0.4`; exceptional hero only |
| `sectionTitle` | 20 / 26 | Be Vietnam Pro bold | `-0.2`; section heading |
| `cardTitle` | 17 / 23 | Be Vietnam Pro semiBold | Card subject |
| `body` | 15 / 22 | Be Vietnam Pro regular | Main explanatory copy |
| `supporting` | 13 / 19 | Be Vietnam Pro regular | Supporting copy and metadata |
| `caption` | 12 / 16 | Be Vietnam Pro regular | Compact captions |
| `eyebrow` | 11 / 15 | Be Vietnam Pro semiBold | `0.8`; terse category/system label |
| `buttonLabel` | 15 / 20 | Be Vietnam Pro semiBold | Action label |
| `badgeLabel` | 12 / 16 | Be Vietnam Pro semiBold | Badge/chip label |
| `metric` | 32 / 38 | Be Vietnam Pro bold | `-0.4`, `fontVariant: ['tabular-nums']` |
| `monoCaption` | 12 / 16 | monospace | Machine IDs/timestamps only |

Sentence/title case is the default. Uppercase is limited to terse eyebrows or system categories; never uppercase buttons, card titles, meal names, warnings, or paragraphs. Dynamic type remains enabled: never set `allowFontScaling={false}`. Every recipe must wrap or reflow without clipping the primary action at large text sizes.

## F. Spacing & Radius

### Spacing scale

| Token | Value | Use |
| --- | ---: | --- |
| `space.xs` | 4 | Icon/text micro-gap |
| `space.sm` | 8 | Related inline controls |
| `space.md` | 12 | Dense internal grouping |
| `space.lg` | 16 | Default component gap |
| `space.xl` | 20 | Compact card padding |
| `space.2xl` | 24 | Standard card/screen section padding |
| `space.3xl` | 32 | Section separation |
| `space.4xl` | 40 | Hero separation |
| `space.5xl` | 48 | Major page break |

Spacing is structural: 4 supports a single visual relationship, 8 groups related controls, 12 handles dense internals, 16 separates default siblings, 20 keeps compact cards readable, 24 marks a normal content section, 32 separates sections, 40 separates a hero from its action, and 48 marks a major page break.

### Radius and size scale

| Token | Value | Use |
| --- | ---: | --- |
| `radius.smallControl` | 8 | Small controls |
| `radius.inputButton` | 12 | Inputs and ordinary buttons |
| `radius.chip` | 10 | Semantic chips |
| `radius.card` | 16 | Standard cards |
| `radius.heroCard` | 20 | Hero/CTA cards |
| `radius.floating` | 24 | Dock/floating surfaces |
| `radius.full` | 999 | True circular/pill semantics only |
| `size.touchMin` | 44 | Minimum actionable target |
| `size.controlSm` | 36 | Compact visual control inside a 44 target |
| `size.controlMd` | 44 | Standard target |
| `size.controlLg` | 48 | Prominent control |
| `size.avatarSm` | 40 | Small avatar |
| `size.avatarLg` | 64 | Identity avatar |
| `size.qr` | 200 | QR/skeleton content |
| `size.qrFrame` | 232 | Fixed QR frame |
| `size.navMinHeight` | 60 | Dock footprint |
| `size.primaryCtaMinHeight` | 84 | Ticket CTA |

Use `radius.chip` for chips unless the content/state semantically needs a pill; do not apply `radius.full` to every button or card. A 36px icon may sit inside a 44px touch target, but the hit area remains at least 44×44.

### Borders and elevation

| Token | Definition |
| --- | --- |
| `border.standard` | `{ width: 1, color: '#D7E2EC' }` |
| `border.subtle` | `{ width: 1, color: 'rgba(23,32,51,0.08)' }` |
| `border.selected` | `{ width: 1.5, color: '#2F80ED' }` |
| `border.glass` | `{ width: 1, color: 'rgba(255,255,255,0.72)' }` |
| `border.disabled` | `{ width: 1, color: '#E5EAF0' }` |

| Elevation | Offset | Opacity | Radius | Android | Intended use |
| --- | --- | ---: | ---: | ---: | --- |
| Level 0 | `(0,0)` | 0 | 0 | 0 | Surface 0 |
| Level 1 | `(0,1)` | `.05` | 3 | 1 | Standard content |
| Level 2 | `(0,6)` | `.09` | 16 | 4 | Raised/brand action |
| Level 3 | `(0,12)` | `.12` | 28 | 8 | Glass dock/floating |
| Level 4 | `(0,18)` | `.16` | 40 | 12 | Temporary overlays only |

All shadows use `#172033`. Border and elevation are complementary: an outline provides a stable edge in low light and for color-vision differences, while elevation separates overlapping surfaces. Avoid nested shadows and avoid using a shadow as the sole separator.

## G. Surface & Elevation System

Surface roles express material intent; elevation expresses depth. They are separate axes and must not be conflated.

| Surface | Material and token | Default elevation | Allowed content |
| --- | --- | --- | --- |
| **0 — page** | Solid `color.background.page`; no shadow | Level 0 | Page background, unboxed greeting/date |
| **1 — content** | Solid/near-solid `color.surface.standard` or `surface.elevated`; standard/subtle border | Level 0–1 | Cards, forms, QR, long text, lists |
| **2 — selected** | `color.brand.tint`/`brand.soft`, selected border, semantic selected state | Level 1 | Selected/interactive rows and language option |
| **3 — glass/floating** | `color.surface.glass`, border highlight, blur or fallback | Level 3 | Dock, lens, floating controls, temporary overlays |
| **4 — brand action** | `color.surface.brand`, on-brand text, white top highlight | Level 2–3 | One dominant primary action per view |

Surface 0 is calm and solid so reading does not depend on background detail. Surface 1 is the default for information and input because opaque contrast makes dense content and QR scanning reliable. Surface 2 is transient: it shows which option matters now rather than decorating every row. Surface 3 is scarce and spatial: it distinguishes a dock or temporary control from the page. Surface 4 is the action anchor; one strong action is more comprehensible than several competing blue controls.

The mobile reference maps these roles through `Surface({ level: 0|1|2|4 })`, `GlassSurface` as the sole Surface 3 implementation, and `FloatingSurface` as a constrained Surface 3 wrapper. Surface 4 normally uses elevation 2–3, not overlay level 4.

## H. Liquid Glass Material

Liquid Glass is a selective material, not a card default. `GlassSurface` uses `BlurView` on iOS/web with intensity 64 and `color.surface.glass`; Android and no-blur paths use opaque-enough `color.surface.glassFallback`. Both paths keep the same border, contrast, radius, and level-3 separation so behavior does not depend on blur support.

The only added material dependency is Expo SDK-compatible `expo-blur`, installed with `corepack yarn workspace @imeal/mobile expo install expo-blur`. Do not add Reanimated or a gradient package; core `Animated` and the existing SVG/QR packages cover the motion and indicator contracts.

```tsx
<GlassSurface intensity={64} style={...}>
  {/* short navigation/floating content only */}
</GlassSurface>
<FloatingSurface>
  {/* dock, overlay, or compact floating control */}
</FloatingSurface>
```

The component contract is:

```ts
type GlassSurfaceProps = React.PropsWithChildren<{
  intensity?: number; // defaults to 64
  style?: StyleProp<ViewStyle>;
}> & ViewProps;

declare function GlassSurface(props: GlassSurfaceProps): React.ReactElement;
declare function FloatingSurface(props: React.PropsWithChildren<ViewProps>): React.ReactElement;
```

Glass requires a varied but calm background, readable foreground contrast, and explicit fallback validation. It is appropriate for the floating bottom dock, its selected lens, compact floating controls, and temporary overlays. It is prohibited for every content card, QR pixels/modules, data-dense lists or tables, text-entry surfaces, destructive confirmations, and low-contrast backgrounds. Never put dense body copy, long lists, form fields, or scannable pixels directly on glass. The fallback is not a degraded meaning: it is a tested material with 94% opacity and the same border/spacing contract.

## I. Visual Indicator Language

Indicators reduce repeated phrases only when the meaning remains obvious. Their role is semantic, not decorative.

- **Status dots** are compact live-state markers: `active`, `inactive`, `live`, `paused`, `pending`, and `expired`. A dot always has an adjacent or accessible label; `live` may have a static outer ring but never a perpetual pulse under reduced motion.
- **Badges** carry categorical state: meal period/type, confirmation, availability, selected count, and state labels. Important badges use an icon plus label plus semantic fill; an informational meal-period/type badge may omit the icon when the adjacent text already names it.
- **Meters** show a quantity over a known range: QR freshness, real quota/usage, selection count when a contractual maximum exists, monthly usage, and deadline progress. Progress is primary, numeric text is support; never communicate meaning through fill color alone.
- **Rings** are reserved for compact circular contexts where circumference beats a line, such as compact QR/monthly/quota displays. A ring is not a default replacement for a readable rail.
- **Steppers** show explicit user-controlled stages only. The documented example is `Select Meal → Confirm → Create Ticket → Redeem`; do not render it when the current registration or one-item QR flow has no user-controlled stages.
- **Selection states** combine outline/fill, check/lock/X shape, and label. **Loading/error/empty states** use their dedicated contracts rather than a blank colored box or unexplained spinner.

Required examples are deliberately broad: a ticket uses `StatusDot('active')` and `QrRefreshIndicator`; a paused ticket uses `StatusDot('paused')` plus “Ticket paused”; registration uses a selected-count badge and locked/unavailable badge; a future quota may use a meter only when the API supplies a maximum; a compact monthly summary may use a ring; a genuinely staged redemption experience may use the stepper.

## J. Semantic Status System

The semantic tone is selected by meaning, then rendered redundantly:

| Tone | Meaning examples | Default icon family | Required treatment |
| --- | --- | --- | --- |
| `information` | Meal period/type, location, schedule | `Info`, calendar, pin | Blue foreground/tint, readable label |
| `success` | Confirmed, selected, ticket active, completed | `CheckCircle2` | Green foreground/tint, check shape, label |
| `warning` | Closing soon, refresh near expiry, limited | `Clock3` or `AlertTriangle` | Amber foreground/tint, time/alert shape, label |
| `critical` | Expired, unavailable, error, closed | `XCircle` or `Lock` | Red foreground/tint, invalid/lock shape, recovery text/action |
| `neutral` | Not booked, inactive, paused, no data | `MinusCircle` or pause | Neutral foreground/tint, quiet but explicit label |

`StatusBadge({ label, tone, icon?, size = 'sm' })` owns the fill and icon choice. `AppText` semantic tones resolve foreground only and never replace a label. A state is never red/green alone: selected has a check and selected border, locked has lock/X and explanation, expired has invalidated shape/pattern and retry, and paused has pause icon plus reactivation.

Business/UI invariants represented by status are exact: per-day cutoff is independently enforced by server time and locks at `14:00:00` the day before; saved registration appears only after confirmation; QR TTL is five seconds, stale QR is never left visible after expiry/failure, and service usability is bounded by `10:30–13:30`. Pickup intent selected by the user persists across refresh; outside the service window the screen explains the window rather than presenting a usable ticket.

## K. Component Guidelines

### Runtime contracts

These signatures are the shared implementation contract. Screen files pass data and workflow state; component files own visual tokens, press states, semantic roles, and accessibility. `AppText` supports every typography recipe listed in section E; `Surface` excludes level 3 because `GlassSurface` owns it.

```ts
type AppTextTone = 'strong' | 'secondary' | 'tertiary' | 'onBrand' | SemanticTone;
type AppTextProps = React.PropsWithChildren<{
  variant: keyof typeof designTokens.typography;
  tone?: AppTextTone;
}> & TextProps;
declare function AppText(props: AppTextProps): React.ReactElement;

type SurfaceProps = React.PropsWithChildren<{
  level?: Exclude<SurfaceRole, 3>;
  selected?: boolean;
  padding?: keyof typeof designTokens.space;
  style?: StyleProp<ViewStyle>;
}> & ViewProps;
declare function Surface(props: SurfaceProps): React.ReactElement;

declare function Divider(props: {
  inset?: number;
  orientation?: 'horizontal' | 'vertical';
}): React.ReactElement;

declare function Avatar(props: {
  initials: string;
  size?: 'sm' | 'lg';
  label?: string;
}): React.ReactElement;

type ActionButtonProps = {
  variant: 'primary' | 'secondary' | 'ghost' | 'critical';
  size: 'md' | 'lg';
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};
declare function ActionButton(props: ActionButtonProps): React.ReactElement;

declare function TicketActionCard(props: {
  title: string;
  supportingText?: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}): React.ReactElement;

declare function Toggle(props: {
  value: boolean;
  disabled?: boolean;
  loading?: boolean;
  label: string;
  onValueChange: (value: boolean) => void;
}): React.ReactElement;

declare function SelectionIndicator(props: {
  state: 'default' | 'pressed' | 'selected' | 'disabled' | 'unavailable';
  label: string;
}): React.ReactElement;

type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  icon?: React.ReactNode;
  hint?: string;
  error?: string;
  disabled?: boolean;
} & TextInputProps;
declare function TextField(props: TextFieldProps): React.ReactElement;

declare function StatusBadge(props: {
  label: string;
  tone: SemanticTone;
  icon?: React.ReactNode;
  size?: 'sm' | 'md';
}): React.ReactElement;

declare function MealTypeChip(props: {
  type: 'REGULAR' | 'VEGETARIAN';
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityLabel: string;
}): React.ReactElement;

declare function StatusDot(props: {
  status: 'active' | 'inactive' | 'live' | 'paused' | 'pending' | 'expired';
  label: string;
}): React.ReactElement;

declare function ProgressMeter(props: {
  value: number;
  max: number;
  tone?: SemanticTone;
  size?: 'sm' | 'md';
  label: string;
  showValue?: boolean;
}): React.ReactElement;

declare function QrRefreshIndicator(props: {
  state: 'active' | 'refreshing' | 'paused' | 'expired';
  secondsRemaining: number;
  totalSeconds: number;
  label: string;
}): React.ReactElement;

declare function EmptyState(props: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}): React.ReactElement;

declare function LoadingState(props: {
  variant: 'content' | 'card' | 'qr';
  label: string;
}): React.ReactElement;

declare function QrSkeleton(props: { size?: typeof designTokens.size.qr }): React.ReactElement;

declare function MealCard(props: {
  periodLabel: string;
  status: { label: string; tone: SemanticTone; icon?: React.ReactNode };
  title: string;
  description?: string;
  location?: string;
  footer?: React.ReactNode;
}): React.ReactElement;

declare function MealSelectionCard(props: {
  title: string;
  subtitle?: string;
  mealType?: 'REGULAR' | 'VEGETARIAN';
  state: 'default' | 'pressed' | 'selected' | 'disabled' | 'unavailable';
  saving?: boolean;
  badges?: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
  trailing?: React.ReactNode;
}): React.ReactElement;

declare function IdentityCard(props: {
  initials: string;
  name: string;
  roleLabel: string;
  identifier?: string;
}): React.ReactElement;

type StatisticsMetric = { label: string; value: string | number; tone?: SemanticTone };
declare function StatisticsCard(props: {
  eyebrow: string;
  metrics: StatisticsMetric[];
}): React.ReactElement;

declare function QrTicket(props: {
  state: 'loading' | 'active' | 'refreshing' | 'paused' | 'expired' | 'invalid';
  value?: string;
  ownerName: string;
  ownerId: string;
  mealLabel: string;
  mealTypeLabel: string;
  selectedCount: number;
  secondsRemaining: number;
  totalSeconds: number;
  onRetry: () => void;
  onToggleActive: () => void;
}): React.ReactElement;

declare function ProgressRing(props: {
  value: number;
  max: number;
  size?: number;
  strokeWidth?: number;
  tone?: SemanticTone;
  label: string;
}): React.ReactElement;

declare function Stepper(props: {
  steps: string[];
  currentStep: number;
  label: string;
}): React.ReactElement;
```

`QrSkeleton` has fixed 200×200 geometry, finder-pattern blocks, and a low-contrast 1400ms shimmer; reduced motion uses a structured static skeleton. `QrTicket` always reserves a 232×232 frame and 200×200 state content, so refreshing, paused, and expired states cannot cause layout jumps. `ProgressRing` and `Stepper` remain specification contracts rather than unused runtime files.

### 1. Bottom Navigation

#### Purpose
Provide role-aware global navigation while keeping content visible above a safe, floating dock.

#### Anatomy
A Surface 3 dock, equal tab targets, icon, optional unread badge, and one absolute selected lens.

#### Variants
Employee, hybrid, and kitchen nav arrays retain existing route behavior; Pickup Intent may be registered but intentionally absent from the employee dock.

#### Sizes
Dock minimum height is `size.navMinHeight`; each tab is at least 44×48 with `flex: 1`; edge spacing is `max(bottomInset, 16)`.

#### States
Selected, inactive, unread, pressed, and active-route-not-represented. The last state hides the lens and leaves all icons inactive rather than falsely selecting a tab.

#### Tokens
Surface 3, `radius.floating`, level-3 elevation, icon primary stroke 2.1 selected/tertiary stroke 1.8 inactive, `color.border.glassHighlight`.

#### Correct usage
Derive `focusedVisibleIndex` by matching the active route against visible `navItems`, divide measured inner width by visible count, and preserve safe-area clearance.

#### Incorrect usage
Never use raw navigator `state.index` for the lens, add a background card per tab, reflow labels, or allow the dock to occlude content.

#### Motion
Animate one lens `translateX` with the shared spring; selected icon changes immediately; no bounce. Fade the lens out when the active route is not represented.

#### Accessibility
Each tab has a translated label, button/tab role, selected state, 44×44 target, and unread badge announced without replacing the label.

### 2. Navigation Selected Indicator

#### Purpose
Make the active route understandable through shape, placement, color, and accessibility state.

#### Anatomy
One translucent lens behind the selected tab, selected border/top highlight, and a brand-colored icon with increased stroke.

#### Variants
Visible selected route and hidden/not-represented route; no per-tab surface variant.

#### Sizes
Lens segment equals inner dock width divided by visible tab count; it fills the tab’s 44×48 minimum footprint.

#### States
Selected, moving, reduced-motion immediate, and hidden when no visible route matches.

#### Tokens
Lens fill `rgba(255,255,255,0.68)`, `color.border.selected`, `color.brand.primary`, motion spring.

#### Correct usage
Use the lens plus `accessibilityState.selected`, not color alone, and keep all tabs equal width.

#### Incorrect usage
Do not use a separate colored card for every tab, bounce the icon, or infer selected state from raw route index.

#### Motion
Spring translate uses stiffness 280, damping 26, mass 0.8; reduced motion jumps to the final segment and omits translation.

#### Accessibility
Selected state is exposed on the tab; icon weight/color and lens are supporting visual cues, not the spoken name.

### 3. Meal Card

#### Purpose
Show today’s meal and its confirmed availability/status as the primary Home information block.

#### Anatomy
Period eyebrow, title, optional description/location, semantic status badge, and optional footer.

#### Variants
Confirmed/success, not registered/neutral, unavailable/warning, loading, and recovery supplied by the owning screen.

#### Sizes
Surface 1 with standard card padding (`space.2xl` default), readable body line height, and no less than 44px action targets in the footer.

#### States
Data loaded, no registration, unavailable, and error/recovery; text remains present in every consequential state.

#### Tokens
Surface 1, `radius.card`, level 0–1, cardTitle/body/supporting recipes, semantic tone map.

#### Correct usage
Keep meal name, description, service period, and location textual; use an icon plus label for status.

#### Incorrect usage
Never put a meal card on glass, hide the meal behind a status color, or invent quota/usage data.

#### Motion
Only a short status transition or screen entrance once per mount; no decorative card animation on focus.

#### Accessibility
Expose a descriptive group/heading, status label and icon semantics, and all location/service-window warnings as text.

### 4. Meal Selection Card

#### Purpose
Represent one editable registration or pickup-intent choice with explicit state and safe selection feedback.

#### Anatomy
Day/date or owner/date title, meal name/type, optional badges, selection indicator, and optional trailing control.

#### Variants
Default, pressed, selected, selected+saving, disabled/locked, and unavailable/no published meal.

#### Sizes
Use Surface 1/2, 44px minimum row target, `radius.card` or `radius.inputButton` according to context, and spacing tokens.

#### States
Selection is confirmed only after server response; saving applies opacity/state only to the affected row; locked/unavailable remains actionable only through its recovery/explanation path.

#### Tokens
Surface 2 selected fill/border, `SelectionIndicator`, `MealTypeChip`, `motion.pressScale.card`, `duration.fast`.

#### Correct usage
Keep day/date, meal name/type, cutoff or unavailable explanation, and radio/checkbox semantics visible.

#### Incorrect usage
Do not infer vegetarian eligibility, show quota without an API maximum, or style saving as a global loading overlay.

#### Motion
Card compresses to `.985`; selected border/fill transitions over 140ms; check scales `.9→1`; deselection fades over 80ms.

#### Accessibility
Expose checkbox/radio semantics as appropriate, selected/disabled/busy state, full label, and localized consequence/recovery copy.

### 5. Selection Indicator

#### Purpose
Communicate default, pressed, selected, disabled, and unavailable state without relying on color.

#### Anatomy
Shape/border, fill, check/lock/X icon, and explicit label.

#### Variants
`default`, `pressed`, `selected`, `disabled`, `unavailable`.

#### Sizes
The visual mark may be compact, but its control container is at least 44×44; labels wrap under dynamic type.

#### States
Selected uses check and selected border; unavailable uses lock/X and explanation; disabled is not opacity-only.

#### Tokens
`color.border.selected`, `color.brand.soft`, `color.disabled.fill/text`, semantic critical/neutral, `radius.smallControl`.

#### Correct usage
Use with meal registration, language radio groups, and pickup options where the state changes meaning.

#### Incorrect usage
Never show a bare colored dot or hide the label for a consequential choice.

#### Motion
Check scales `.9→1` over 140ms; deselection fades over 80ms; reduced motion applies end state immediately.

#### Accessibility
Expose `accessibilityState.selected`, disabled/unavailable description, and a human-readable label independent of icon/color.

### 6. Status Badge

#### Purpose
Show categorical semantic status compactly while preserving label comprehension.

#### Anatomy
Semantic fill, optional default/custom icon, and concise label.

#### Variants
Information, success, warning, critical, neutral; small and medium sizes.

#### Sizes
Use `badgeLabel`; `sm` is compact metadata, `md` supports primary state context; hit targets expand to 44px when interactive.

#### States
Confirmed, active, selected, available, closing soon, expired, unavailable, not booked, paused, selected count.

#### Tokens
`semanticToneMap`, `radius.chip`, `color.border.subtle`, badge typography.

#### Correct usage
Pair icon + label for consequential statuses; allow an informational meal type badge to omit an icon when adjacent text is explicit.

#### Incorrect usage
Do not use a badge as a button without target semantics, or use arbitrary screen-local colors.

#### Motion
Material state changes fade and scale `.96→1` over 140ms; no looping shimmer after loading.

#### Accessibility
Expose the label and semantic meaning; icon is supplementary and tone never changes spoken content.

### 7. Meal Type Chip

#### Purpose
Identify and, where eligible, select `REGULAR` or `VEGETARIAN` meal choice.

#### Anatomy
Plate/utensils motif for regular, leaf for vegetarian, text label, selected border/check state.

#### Variants
Regular/vegetarian, selected/default, disabled, and non-interactive metadata.

#### Sizes
Interactive chip is at least 44px high; visual radius is `radius.chip`, not an automatic full pill.

#### States
Radio-selected, unselected, unavailable by server policy, and disabled after cutoff.

#### Tokens
`color.brand.soft/tint`, `color.border.selected`, `badgeLabel`, Lucide `Utensils`/`Leaf`.

#### Correct usage
Render vegetarian only when server data says the lunar date permits it; expose radio selection and text.

#### Incorrect usage
Do not infer lunar eligibility client-side, use emoji, or replace the meal type text with the icon alone.

#### Motion
Selected indicator uses the standard 140ms selection transition; no decorative leaf animation while static.

#### Accessibility
Provide an explicit radio label including type and date/context; expose selected and disabled state.

### 8. Primary CTA

#### Purpose
Offer one unmistakable next action for the current view.

#### Anatomy
Solid Surface 4 action, readable label, optional icon, and press feedback; Home uses `TicketActionCard`.

#### Variants
`ActionButton` primary medium/large and `TicketActionCard` with optional support line and arrow.

#### Sizes
Buttons are 44/48px targets; Ticket CTA minimum height is 84px with a 46px translucent icon tile.

#### States
Default, pressed, disabled, loading, confirmed result, and recovery/retry as defined by the workflow.

#### Tokens
`color.surface.brand`, `color.text.onBrand`, `radius.inputButton`/`heroCard`, level 2–3, `pressScale.button`.

#### Correct usage
Use one dominant action per view; label the result/action (“Open Meal Ticket”, “Create new code”) rather than generic “OK”.

#### Incorrect usage
Do not add gradients, all-caps paragraphs, multiple competing primary actions, or an optimistic success label.

#### Motion
Button scales `.98`; TicketActionCard arrow translates +4px over 140ms; content remains readable without motion.

#### Accessibility
Use button role, label, hint when useful, disabled/busy state, 44×44 target, and sufficient on-brand contrast.

### 9. Secondary CTA

#### Purpose
Expose useful but non-dominant navigation or recovery without competing with the primary action.

#### Anatomy
Ghost/secondary action with text/icon and an explicit destination or recovery verb.

#### Variants
Secondary, ghost, critical recovery, retry, Reactivate, and weekly-registration link.

#### Sizes
At least 44px high; use `buttonLabel` and spacing tokens rather than a tiny text link for touch actions.

#### States
Default, pressed, disabled, loading, and unavailable with explanation.

#### Tokens
`color.brand.primary` outline/text, `color.border.standard`, `radius.inputButton`, `pressScale.button`.

#### Correct usage
Place weekly registration below the Home ticket CTA; use “Create new code” for expired QR recovery.

#### Incorrect usage
Do not style every action as primary or hide a recovery action behind an icon-only control.

#### Motion
Short `.98` press response; no large navigation slide or decorative entrance.

#### Accessibility
Label the destination/action, expose disabled/busy state, and keep the target at least 44×44.

### 10. QR Ticket

#### Purpose
Present a fresh, readable pickup credential with identity, intent, and recovery context.

#### Anatomy
Fixed 232×232 Surface 1 frame, 200×200 QR/state content, status badge/dot, owner identity, meal metadata, selected count, freshness rail, and action.

#### Variants
`loading`, `active`, `refreshing`, `paused`, `expired`, `invalid`.

#### Sizes
QR pixels are exactly 200×200 with clear quiet zone; frame and content geometry never resize between states.

#### States
Loading skeleton; active valid QR; refreshing retains current frame; paused removes scannable code; expired/invalid invalidates it and offers retry; stale QR is never visible after expiry/failure.

#### Tokens
Surface 1/white QR, strong black modules, `size.qr`, `size.qrFrame`, 4px freshness rail, semantic tones, no glass/gradient.

#### Correct usage
Show owner, meal, meal type, selected count, five-second freshness, and service-window context; preserve pickup intent across refresh.

#### Incorrect usage
Never render QR on glass, leave a stale value after refresh failure, resize/slide the frame, or read the encoded payload aloud.

#### Motion
New QR crossfades opacity `.82→1` and scale `.995→1` over 140ms; no layout shift. Material state transitions are announced once.

#### Accessibility
QR label describes owner, selected meal count, and freshness; progressbar exposes min 0/max total/now remaining and localized text; announce active, paused, expired/invalid, and refresh failure only.

### 11. QR Refresh Indicator

#### Purpose
Show the five-second QR freshness timeline in a linear, scannable form.

#### Anatomy
A `ProgressMeter` rail plus a compact localized countdown/status label.

#### Variants
Active, refreshing, paused, expired; fixed-height rail.

#### Sizes
Rail is 4px in the ticket; surrounding component keeps fixed height during state changes.

#### States
Progress decreases to expiry; refreshing can retain a valid value; paused/expired show zero/no-freshness state with text.

#### Tokens
Meter information/success/critical tone, `duration.fast`, `size.touchMin` only when wrapped in an action.

#### Correct usage
Treat progress as primary and countdown text as support; keep the total at the server-defined five seconds.

#### Incorrect usage
Do not use an unbounded spinner, announce every second, or imply a valid QR after expiry.

#### Motion
Only the rail’s transform changes; no distracting pulse. Linear easing is reserved for time progress.

#### Accessibility
Use progressbar min/max/now/text and announce material transitions, not each countdown tick.

### 12. Progress Meter

#### Purpose
Represent a known quantity over a maximum, including freshness, usage, count, and deadlines.

#### Anatomy
Track, transformed fill, label, and optional numeric value.

#### Variants
Small/medium, information/success/warning/critical/neutral tones, with or without displayed value.

#### Sizes
Use fixed height appropriate to context; QR rail is 4px, while other meters retain a touch-safe wrapper if interactive.

#### States
Empty, partial, complete, invalid/clamped input, paused, expired; values clamp to `[0,max]` and invalid maxima are handled safely.

#### Tokens
Semantic tone map, `motion.easing.linear` for time, spacing scale, progressbar role.

#### Correct usage
Use for QR freshness, a real API quota/usage maximum, monthly usage, selection count with a contractual maximum, or deadline progress.

#### Incorrect usage
Do not invent a meal capacity/quota or encode status by color alone.

#### Motion
Animate transform rather than width/layout; standard duration for discrete changes; reduced motion jumps to the final value.

#### Accessibility
Expose progressbar min, max, now, and localized value text; retain a visible label.

### 13. Progress Ring

#### Purpose
Provide compact circular progress only where circumference communicates quantity better than a rail.

#### Anatomy
`react-native-svg` circle/arc, track, semantic foreground, center or adjacent label.

#### Variants
Information/success/warning/critical/neutral and compact QR/monthly/quota contexts.

#### Sizes
Contract defaults to `size = 40`, `strokeWidth = 4`; text must remain readable at dynamic type.

#### States
Empty, partial, complete, paused, expired, and indeterminate only when the owning workflow explicitly supports it.

#### Tokens
Semantic tone map, `radius.full` conceptually, motion standard/easing; no runtime implementation until consumed by a live flow.

#### Correct usage
Choose a ring when a compact circular slot is clearer than a line and the label supplies exact meaning.

#### Incorrect usage
Do not replace the QR freshness rail, add it merely for decoration, or omit a numeric/accessible label.

#### Motion
Arc transform may animate over 220ms; reduced motion applies the final arc immediately.

#### Accessibility
Expose progressbar values and a human-readable label; contrast and non-color state remain sufficient.

### 14. Status Dot

#### Purpose
Mark a compact live/status condition without taking over the layout.

#### Anatomy
Small semantic dot, optional static outer ring, and adjacent/accessibly associated label.

#### Variants
`active`, `inactive`, `live`, `paused`, `pending`, `expired`.

#### Sizes
Visual dot is compact; never reduce its associated target or label below 44px when it is interactive.

#### States
Each named state has distinct tone/icon/label treatment; `live` may have a ring.

#### Tokens
Semantic tone map, `color.border.subtle`, no perpetual pulse under reduced motion.

#### Correct usage
Use beside a QR active state or compact service/session state with text nearby.

#### Incorrect usage
Never use a dot as the only signal for a meal booking, expiry, or permission state.

#### Motion
No loop is required; a brief state change may fade in. Reduced motion is static.

#### Accessibility
The label is always adjacent or included in the accessibility name; status is not color-only.

### 15. Toggle

#### Purpose
Change a boolean preference while communicating confirmed server state.

#### Anatomy
Native switch semantics, track/thumb, label, and optional saving/busy state.

#### Variants
Enabled/disabled, on/off, loading, and error rollback.

#### Sizes
Use at least 44×44 target and a readable adjacent label; visual compact control may be 36px within the target.

#### States
Visual state changes only after confirmation for reminder preference; failed mutation restores the confirmed server value.

#### Tokens
`duration.standard` 220ms, semantic success/neutral, `radius.full`, touch minimum.

#### Correct usage
Use for reminder setting and preserve system notification permission as a separate status/action.

#### Incorrect usage
Do not claim saved state optimistically, disable all unrelated content, or make a toggle replace explanatory copy for an unfamiliar preference.

#### Motion
Thumb transitions over 220ms with standard easing; reduced motion snaps to confirmed state.

#### Accessibility
Expose switch role, checked state, label, busy/disabled status, and polite confirmation/recovery announcement where appropriate.

### 16. Profile / Identity Card

#### Purpose
Establish who owns a meal/ticket and present account role without overpromoting technical identifiers.

#### Anatomy
Avatar/initials, name, role label, optional tertiary identifier.

#### Variants
Staff, kitchen, owner, receiver/delegate; compact ticket identity and full profile identity.

#### Sizes
Small avatar 40, large avatar 64; Surface 1 card with dynamic-type-safe wrapping.

#### States
Loaded identity, loading, unavailable/recovery; owner versus receiver remains explicit.

#### Tokens
Surface 1, `avatarSm/avatarLg`, `cardTitle`, `supporting`, `monoCaption` tertiary identifier.

#### Correct usage
Keep name and role primary; show ID as tertiary mono text where operationally useful.

#### Incorrect usage
Do not render IDs as large badges, hide owner/receiver distinction, or use decorative illustrations.

#### Motion
Only compact pressed state when the card is actionable; retained focus does not replay entrance animation.

#### Accessibility
Expose name, role, owner/receiver relationship, and identifier as separate understandable text.

### 17. Statistics Card

#### Purpose
Show honest profile metrics in a compact, scannable surface.

#### Anatomy
Eyebrow, metric value(s), labels, optional semantic tone.

#### Variants
One or multiple metrics; loaded values and honest no-data `—` values.

#### Sizes
Surface 1, metric recipe 32/38 with tabular numerals; stack at narrow width or large text.

#### States
Loaded, no data, and recovery; no fabricated usage/quota.

#### Tokens
Surface 1, `metric`, `caption/supporting`, semantic tone map, divider where needed.

#### Correct usage
Keep current absent data as `—` until a real endpoint provides metrics; reduce technical ID prominence around it.

#### Incorrect usage
Do not invent totals, imply a quota not in the API, or use a dashboard-like bento solely for decoration.

#### Motion
Metric changes may fade/scale subtly after confirmed data update; no looping count-up animation.

#### Accessibility
Read eyebrow, value, and label together; provide exact textual value and meaning independent of formatting.

### 18. Empty State

#### Purpose
Explain no-data or not-yet-available state and provide one valid recovery action when applicable.

#### Anatomy
One functional icon, plain title, optional one-sentence description, optional action.

#### Variants
No meal, no booking, no ticket, no monthly history, and context-specific empty lists.

#### Sizes
Surface 0 or 1 based on context; maintain comfortable spacing without a large illustration.

#### States
No meal, no booking, no ticket, no history, and loaded-empty versus error/retry distinction.

#### Tokens
Neutral tone, `supporting`/`body`, `space.2xl`, no decorative food art.

#### Correct usage
Use plain titles (“No meal today”, “No booking yet”, “No ticket”, “No monthly history”) and one recovery sentence only when actionable.

#### Incorrect usage
Do not present a network failure as empty, add a large mascot, or offer an action that cannot succeed.

#### Motion
Appear once after the resolved empty state; no decorative shimmer or bounce.

#### Accessibility
Use a meaningful group/heading, readable description, and a labeled action with at least 44×44 target.

### 19. Loading State

#### Purpose
Communicate that content is being obtained without implying a value or success.

#### Anatomy
Structured placeholder or progress treatment with an accessible label.

#### Variants
`content`, `card`, and `qr`; `QrSkeleton` is the fixed QR variant.

#### Sizes
Match the eventual content geometry; QR uses 232 frame/200 content to prevent jumps.

#### States
Initial loading, revalidation, mutation saving, and QR refresh; never use loading for a known empty/error state.

#### Tokens
Neutral/brand tint, `motion.duration.shimmerCycle` 1400ms, reduced-motion static fallback.

#### Correct usage
Keep the existing initial loading gate timing and replace only its visual treatment; scope saving opacity to the affected row.

#### Incorrect usage
Do not show `0/0`, an empty colored QR square, or an infinite shimmer after content has loaded.

#### Motion
Shimmer cycles at 1400ms only while loading; reduced motion renders the structured static skeleton.

#### Accessibility
Expose “Loading …”/localized label and avoid announcing every shimmer frame or countdown tick.

### 20. Stepper

#### Purpose
Show explicit, user-controlled multi-stage progress when the flow genuinely exposes those decisions.

#### Anatomy
Ordered labels, current/completed/upcoming state, and optional connector.

#### Variants
Horizontal/vertical based on available width; current/completed/locked stages.

#### Sizes
Labels remain readable at dynamic type; step targets are at least 44×44 when interactive.

#### States
`Select Meal → Confirm → Create Ticket → Redeem` is the reference example; current registration and one-item QR do not render it.

#### Tokens
Information/success/neutral tones, `space.lg`, `radius.full` marker, selected border/check.

#### Correct usage
Use only when a user can make or review each meaningful stage and needs orientation.

#### Incorrect usage
Do not add it to a one-tap happy path, turn passive loading into fake stages, or rely on connector color alone.

#### Motion
Advance with a short 220ms state transition; reduced motion changes marker/label immediately.

#### Accessibility
Expose ordered step names and current/completed state; do not force a screen reader through decorative connector nodes.

### 21. Divider

#### Purpose
Separate related groups without adding a card or shadow.

#### Anatomy
One horizontal or vertical line with optional inset.

#### Variants
Horizontal/vertical and inset/full-width.

#### Sizes
One tokenized line; surrounding spacing comes from the scale rather than divider thickness.

#### States
Static; semantic grouping changes through placement and adjacent headings.

#### Tokens
`color.divider`, `border.standard` width convention, spacing scale.

#### Correct usage
Use within the Profile preferences surface and other related groups where a line improves scan order.

#### Incorrect usage
Do not use empty cards/shadows as separators or place dividers between every short label.

#### Motion
Static; add/remove only with the owning content group, not as decorative animation.

#### Accessibility
Do not expose decorative dividers as controls; ensure grouping has headings/labels for assistive technology.

### 22. Floating Surface

#### Purpose
Contain scarce floating controls, docks, and temporary overlays above page content.

#### Anatomy
Surface 3 glass/fallback material, floating radius, level-3 elevation, and concise controls.

#### Variants
Bottom dock, selected lens container, compact floating control, temporary overlay.

#### Sizes
Use `radius.floating`; respect safe-area edge spacing and avoid covering content.

#### States
Blur-capable, fallback, visible, hidden, and reduced-motion immediate placement.

#### Tokens
Surface 3, `color.surface.glass/glassFallback`, `border.glass`, level 3, `space.lg`.

#### Correct usage
Use the signature glass dock over page content and temporary controls with a calm varied background.

#### Incorrect usage
Do not stack glass cards, put QR/text-entry/data-dense content directly on it, or use level 4 for ordinary floating UI.

#### Motion
Dock enters once per mount if needed; lens uses spring; overlays may translate no more than 12px; reduced motion removes translation/scale.

#### Accessibility
Fallback maintains contrast and outline; overlay focus/order and dismiss behavior are explicit; dock tabs expose labels and selection.

## L. Motion Tokens

Motion is a response to a cause, not background decoration. These values are shared across screens:

| Token | Value |
| --- | --- |
| `motion.duration.instant` | 80ms |
| `motion.duration.fast` | 140ms |
| `motion.duration.standard` | 220ms |
| `motion.duration.emphasized` | 320ms |
| `motion.duration.shimmerCycle` | 1400ms |
| `motion.easing.standard` | `cubic-bezier(0.2,0,0,1)` / `Easing.bezier(0.2,0,0,1)` |
| `motion.easing.emphasized` | `cubic-bezier(0.16,1,0.3,1)` |
| `motion.easing.linear` | `linear`, time progress only |
| `motion.spring` | `{ stiffness: 280, damping: 26, mass: 0.8 }` |
| Maximum micro translation | 4px |
| Maximum page/state entrance translation | 8px |
| Maximum temporary overlay translation | 12px |
| Card press | `.985` |
| Button press | `.98` |
| Compact nav press | `.96` |

The motion matrix is normative: badge fade plus `.96→1` over 140ms; selection check `.9→1` over 140ms; QR refresh opacity `.82→1` and scale `.995→1` over 140ms; first entrance opacity `0→1` plus Y `8→0` over 220ms; the tab lens uses the shared spring. There are no large horizontal screen slides, perpetual status pulses, or decorative shimmer after loading.

`useReducedMotion` removes translation, scale, looping shimmer, and nonessential entrance movement, but preserves immediate end-state icons, borders, labels, status values, progress values, and accessibility announcements. Screen entrance runs once per mounted screen and does not replay merely because a retained tab receives focus.

## M. Microinteraction Guidelines

Every interaction below specifies cause, effect, timing, result, reduced-motion behavior, and announcement policy. Server-confirmed outcomes are distinct from local press feedback.

| Interaction | Trigger | Visual response | Duration / easing | Resulting state | Reduced-motion response | Announcement behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Select a meal | User taps an editable default meal/choice | Row presses `.985`; selected border/fill appears; check scales `.9→1` | 140ms standard easing | Draft/confirmed selection follows existing registration contract; “saving” only while mutation is in flight | Apply selected border/check/fill immediately; no scale | Announce selected choice when it is material; do not announce animation |
| Deselect a meal | User taps an active selected row | Row releases; check fades; selected fill/border clears | 80ms for check fade, standard easing | Draft/confirmed deselection follows server response and rollback rules | Clear check/border immediately | Announce deselection or server rejection/recovery, not the fade |
| Open a ticket | User activates Home Ticket CTA | CTA presses `.98`; arrow translates +4px; destination enters once | 140ms standard; first entrance 220ms Y 8→0 | Pickup Intent loads selected pickup intent; no full-screen decorative transition | Immediate pressed/end layout and one-time destination state | Announce destination/ticket loading only if needed; do not announce press animation |
| Refresh QR | TTL expiry or explicit refresh requests a new code | Keep frame and valid context; skeleton/previous-code transition; new QR opacity `.82→1`, scale `.995→1` | 140ms standard; time rail linear | Valid code replaces old code, or code is cleared and ticket is expired on failure | Swap to end state without crossfade/scale; preserve fixed geometry | Announce refreshed active code or refresh failure once; never every countdown second |
| Change navigation tabs | User activates a visible tab | One lens translates; selected icon color/stroke updates; unread badge remains | Shared spring; no bounce | Navigator changes route; active route not in dock hides lens | Place lens immediately; icon/accessibility state still changes | Standard navigation announcement from platform; no custom animation announcement |
| Enable reminders after server confirmation | User toggles reminder on and `PATCH` succeeds | Thumb transitions; optional badge/status fade | 220ms standard easing | Confirmed reminder preference is on | Thumb/status updates immediately after confirmed value | Polite “Reminders enabled” after success; on failure restore value and announce recovery |
| Confirm a booking after server confirmation | Registration mutation returns success | Affected card check/status settles; selected count updates | 140ms standard easing | Saved registration is confirmed; no optimistic saved copy before response | Apply settled icon/border/count immediately | Polite success/live announcement with date/count; partial failure identifies affected day |
| Pause a ticket | User chooses pause while code exists | QR disappears immediately; neutral paused tile/status remains in fixed frame | 140ms standard for status fade; no code retention | Ticket is paused; identity/meal context remains; Reactivate is available | Show paused tile immediately | Announce “Ticket paused” once |
| Reactivate a ticket | User chooses Reactivate | CTA press; loading/active state uses same fixed frame; new code only when valid | 140ms standard; QR crossfade contract on success | Ticket returns active with fresh code, or expired/retry on failure | Immediate loading/end state; no scale/crossfade | Announce active code or failure once |

Press response must never be mistaken for a server result. A reminder toggle changes visual state only after confirmation; a booking card may show a scoped saving state but never “saved” before the API response. Countdown progress is accessible but intentionally quiet between material transitions.

## N. Screen-Level Application

The four target screens share the same hierarchy; their workflows remain in `docs/04-ui-ux-design.md` and server/API contracts.

| Screen | Surface composition | Indicators and content that stay textual | Motion and action hierarchy |
| --- | --- | --- | --- |
| **Home** | Surface 0 page; Surface 1 meal; Surface 4 Ticket CTA; Surface 3 dock | Success/neutral meal badge; keep meal name, location, service period, and action text; date/technical account metadata remains tertiary | Ticket CTA press and one-time entrance only. Primary = today’s meal/ticket action; secondary = weekly registration; tertiary = date/technical account metadata. |
| **Meal Registration** | Surface 0 page; Surface 1 calendar/list; Surface 2 selected rows; Surface 3 dock | Selection indicator, meal-type chip, lock/unavailable badge, honest selected count; keep dates, meal names, cutoff warning, legend/lunar metadata | Motion only on the changed row. Primary = editable meal selection; secondary = month overview; tertiary = legend/lunar metadata. |
| **Meal Ticket/QR** | Surface 1 QR and identity; Surface 2 selected pickup items; Surface 3 dock; brand action only for create/reactivate | Freshness rail/status dot/badge; keep owner, meal, validity, service window, and errors textual; fixed-size crossfade only | Primary = readable valid QR/status; secondary = selected meals/refresh; tertiary = owner ID. Paused/expired/invalid states remove scannable code immediately. |
| **Profile** | Surface 0 page; Surface 1 identity/stats/preferences; Surface 2 selected language; Surface 3 dock | Reminder toggle, notification badge, honest metrics; technical ID is tertiary; preference meaning/recovery stays text | Motion only for confirmed controls. Primary = identity/settings requiring action; secondary = usage/delegation; tertiary = ID/supporting metadata. |

### Screen-specific invariants

- **Home:** Greeting/date is unboxed; today’s meal maps confirmed to success, not registered to neutral, unavailable to warning. The Ticket CTA is one dominant action and never a decorative full-screen transition.
- **Meal Registration:** The server supplies meal availability and lunar eligibility. Cutoff remains independently enforced per date; the client does not infer vegetarian eligibility. No contractual capacity maximum means selected count is a badge, not a quota meter.
- **Meal Ticket/QR:** One eligible item auto-selects; multiple pickup intent remains user-controlled and persists across refresh. QR TTL remains five seconds; no stale QR remains visible after expiry or refresh failure. Outside 10:30–13:30, show the distinct service-window state instead of implying current serving usability.
- **Profile:** Reminder preference rollback and system notification permission remain separate. Metrics with no real data show `—`; delegation, language, logout, permission recovery, and preference meaning remain textual.

## O. Accessibility

Accessibility is part of the component contract and is verified against the real surface, not inferred from color or screenshots.

- **Contrast:** Meet WCAG AA: at least 4.5:1 for normal text and 3:1 for large text and non-text controls. Validate both blur and the 94% no-blur fallback against likely backgrounds.
- **Targets:** Every actionable target is at least 44×44. Icon-only controls have a label/hint and an expanded hit area; visual compactness must not shrink the target.
- **Dynamic type:** Keep font scaling enabled. Text wraps/reflows, metrics stack where necessary, and primary actions remain reachable at large text settings and 200% web zoom. Never clip or hide a warning to preserve a single-line layout.
- **Roles and states:** Use button, switch, radio, checkbox, tab, progressbar, image, heading, and live-region semantics as appropriate. Expose selected, checked, disabled, busy, expanded, min/max/now/text values, and unavailable/expired meaning.
- **Labels and hints:** Labels name the real object and action (“Create new code”, owner/meal/count/freshness for QR), not implementation values. Hints explain an unusual consequence or destination; icons are supplementary.
- **Color independence:** Important states pair semantic color with icon, shape/pattern, border/fill, and label. A status dot always has a label. Expired/invalid states include an invalidated shape/pattern and recovery action.
- **Announcements:** Use polite live announcements for ordinary confirmed reminder/booking outcomes; use assertive announcements for material expiry, invalidation, or blocking recovery when immediate attention is required. QR announces active, paused, expired/invalid, and refresh failure only; never announce each countdown second.
- **Reduced motion:** Respect `prefers-reduced-motion`/native reduced-motion settings. Remove scale, translation, looping shimmer, and decorative pulses while retaining immediate final icons, borders, labels, progress values, and state announcements.
- **Blur fallback:** Android/no-blur uses the opaque fallback with the same outline and elevation. Meaning and contrast do not depend on translucent pixels.
- **Operational checks:** Manually check VoiceOver/TalkBack, keyboard/switch navigation where supported, color-vision resilience, large text/dynamic type, reduced motion, safe areas, exact cutoff/service-window boundaries, QR expiry, and recovery paths on the device or emulator. Report unexercised device-only checks rather than inferring them from web.

## P. Do / Don’t Rules

| Do | Don’t |
| --- | --- |
| Use a glass dock over page content with one small selected lens. | Stack glass cards or make every content card translucent. |
| Keep QR pixels in a fixed white Surface 1 frame with a quiet zone. | Render QR modules on glass, a gradient, or an unstable colored placeholder. |
| Pair semantic badges/dots with icons and human-readable labels. | Use color-only dots, red copy alone, or unexplained pills. |
| Use selected cards with border + check + fill. | Make selection distinguishable by fill color alone. |
| Use solid Surface 4 for one dominant CTA and create depth with named elevation/highlight tokens. | Add a second accent hue, neon/rainbow reflection, or a new gradient package. |
| Keep meal names, locations, primary actions, cutoff/service-window warnings, and unfamiliar states as text. | Replace consequential copy with iconography or technical IDs. |
| Use meters for real quantities and rings only when a compact circle is clearer. | Invent quota/capacity data or use rings for every progress value. |
| Use a stepper only when stages are explicit and user-controlled. | Add a stepper to the current one-item happy path or passive loading. |
| Animate a real press/state change within the motion bounds. | Add large horizontal screen slides, bouncing tabs, or decorative post-load shimmer. |
| Preserve server-confirmed state and scoped rollback/loading feedback. | Show “saved”, “enabled”, or valid QR before server confirmation. |
| Use restrained Utensils/Soup/Leaf/plate-like Lucide motifs where functional. | Use emoji, mascots, large decorative food art, or generic banking-dashboard visuals. |
| Keep `docs/System-design-UI/**` as provenance and this guideline as visual authority. | Rewrite the preserved prototypes or wire `packages/ui` into mobile. |

## Q. Recommended Migration Plan

Follow this sequence to avoid introducing a second visual dialect while preserving server authority. The twelve step names are the preferred migration sequence and are intentionally recorded verbatim:

1. **normalize tokens** — Replace `apps/mobile/src/theme.ts`/`theme` with `apps/mobile/src/ui/designTokens.ts`/`designTokens`; update `App.tsx`, `BrandMotion.tsx`, `BrandNotice.tsx`, `NotificationProvider.tsx`, Delegation, Notifications, Kitchen Dashboard, Kitchen Scanner, Kitchen Profile, and the four target screens through LSP references. Keep camera tokens in `designTokens`.
2. **typography/spacing** — Apply the E typography recipes and F spacing/radius/size tokens to `apps/mobile/src/screens/employee/EmployeeDashboardScreen.tsx`, `EmployeeCalendarScreen.tsx`, `EmployeeProfileScreen.tsx`, `apps/mobile/src/screens/pickup/PickupIntentScreen.tsx`, and secondary callers; preserve dynamic type and safe areas.
3. **surfaces/elevation** — Split reusable primitives into `apps/mobile/src/ui/components/Foundation.tsx`, `Controls.tsx`, `Indicators.tsx`, `Feedback.tsx`, `Cards.tsx`, `QrTicket.tsx`, and `index.ts`; implement Surface 0–4 and delete prototype-named runtime files only after callers move.
4. **bottom navigation** — Rename `apps/mobile/src/ui/PrototypeShell.tsx` to `AppShell.tsx`, rename `PrototypeNavItem`/`PrototypeTabBar`/`PrototypeFrame`/`PrototypeSectionTitle`/`prototypeStyles` to `AppNavItem`/`AppTabBar`/`AppFrame`/`SectionHeader`/`appStyles`, update the shell test name, and implement the safe floating lens.
5. **primary CTA** — Replace Home’s local CTA in `EmployeeDashboardScreen.tsx` with `TicketActionCard`; keep weekly registration as secondary and preserve focus refresh, Profile, Calendar, and Pickup Intent navigation.
6. **indicator language** — Migrate `BrandNotice.tsx`, Home meal status, registration feedback, ticket states, profile notification status, and secondary screens to `semanticToneMap`, `StatusBadge`, `StatusDot`, and the explicit labels/icons in I/J.
7. **meal selection** — Refactor `EmployeeCalendarScreen.tsx` and pickup option rows in `PickupIntentScreen.tsx` to `MealSelectionCard`, `SelectionIndicator`, and `MealTypeChip`; preserve `calendarRegistrationState.ts`, `CalendarMutationTracker`, API rollback, cutoff, lunar policy, and selected pickup semantics.
8. **QR states** — Refactor `PickupIntentScreen.tsx` and `pickupAPI.ts` integration around `QrTicket`, `QrRefreshIndicator`, `QrSkeleton`, `qrError`, and `qrRetryVersion`; keep the server TTL source, clear stale values on failure/expiry, add the specified VI/EN keys, and announce material transitions only.
9. **motion/microinteractions** — Update `BrandMotion.tsx`, `useReducedMotion.ts`, selection/toggle behavior, Ticket CTA, dock lens, QR crossfade, and loading skeletons to the L motion matrix; entrance runs once per mounted screen and retained focus does not replay it.
10. **profile/statistics simplification** — Refactor `EmployeeProfileScreen.tsx` and `KitchenProfileScreen.tsx` to `SectionHeader`, `IdentityCard`, `StatisticsCard`, `Toggle`, `Divider`, and honest `—` values; preserve preference rollback, permission recovery, locale persistence, delegation navigation, and logout confirmation.
11. **food personality** — Use functional Lucide `Utensils`/`Soup`/`Leaf`/plate-like motifs in Home, meal type, profile, and recovery states; allow restrained stateful steam/leaf motion only where it conveys an action, never emoji/mascots/decorative food art.
12. **accessibility/consistency audit** — Review all `apps/mobile/App.tsx` and `apps/mobile/src/**` consumers for old prototype/theme names, hard-coded visual recipes, missing labels/roles/live announcements, target-size violations, stale QR paths, service-window/cutoff wording, reduced-motion behavior, and no-blur fallback. Compare Home, Meal Registration, Meal Ticket/QR, and Profile to section N; leave `docs/System-design-UI/**` and `packages/ui/**` unchanged.

Workflow and recovery behavior remain authoritative in `docs/04-ui-ux-design.md`; this document is authoritative for visual tokens/components and should be linked from the documentation map. Any later Admin Web adoption should consume this contract rather than create a parallel mobile/prototype vocabulary.
