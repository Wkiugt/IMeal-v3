# Task 1 Report — Shared Brand and Motion Surface

## Status

DONE_WITH_CONCERNS

## Files changed

- `apps/mobile/src/ui/BrandMotion.tsx` — added the shared mobile brand and motion components.
- `.superpowers/sdd/mobile-loading-transitions-plan/task-1-report.md` — recorded this implementation and its verification evidence.

No app shell, navigation shell, or screen file was edited.

## Implemented behavior

### `BrandMark`

- Exports the requested `size`, `containerSize`, and `style` interface with defaults of 28 px and 56 px.
- Uses `react-native-svg` with the canonical `0 0 24 24` view box and the exact fork-and-knife path geometry from `docs/System-design-UI/assets/icons/brand-mark.svg`.
- Uses no fill, the theme accent-deep stroke, 1.6 stroke width, and round line caps/joins.
- Places the SVG in the existing accent-soft, centered, rounded badge treatment.

### `BrandLoader`

- Exports the requested visible `label` and optional `compact` interface.
- Exposes a progressbar accessibility role and uses the visible label as its accessibility label.
- Uses the 56 px badge in centered full/section mode and a proportional 36 px badge in inline compact mode.
- With normal motion, loops two consecutive 450 ms parallel opacity/scale animations using `Easing.inOut(Easing.cubic)` and the native driver: `0.6 / 0.96` to `1 / 1.04`, then back to `0.6 / 0.96`.
- With Reduce Motion, starts no loop and renders at opacity/scale 1.
- Stops the loop and both animated values during cleanup.

### `StateTransition`

- Exports the requested `stateKey`, `children`, and optional `style` interface.
- On mount and every state-key change, stops prior motion, resets to opacity 0 and an 8 px Y offset, then animates to opacity 1 and zero offset over 200 ms with `Easing.out(Easing.cubic)` and the native driver.
- Reduce Motion applies the final values synchronously.
- Cleanup stops the composite entrance and both animated values, preventing stale motion after rapid replacement or unmount.

### `ScreenEntrance`

- Exports the requested `active`, `children`, and optional `style` interface.
- Active entries use the same 200 ms fade/8 px rise as state transitions.
- Inactive screens stop motion and remain at the fully visible final values until the next active entry; there is no exit animation or route-state change.
- Reduce Motion applies final values synchronously.
- Cleanup stops the composite entrance and both animated values.

No new dependency or production test scaffolding was added.

## Verification

Command run from the repository root:

```text
corepack yarn workspace @imeal/mobile exec tsc --noEmit --strict --jsx react-native --module ESNext --moduleResolution bundler --target ESNext --esModuleInterop --allowSyntheticDefaultImports --skipLibCheck src/ui/BrandMotion.tsx
```

Exact output:

```text
(no output)
```

Exit code: `0`.

This focused compile validates the new component in strict TypeScript mode against the installed React Native, React, and `react-native-svg` types without compiling concurrently edited app surfaces.

## Concerns

- The mobile package has no configured component test runner, so this task could not exercise animation timing, native-driver behavior, or rendered visuals in isolation. The focused strict TypeScript check passed; runtime and visual verification remains part of the downstream integration task.
