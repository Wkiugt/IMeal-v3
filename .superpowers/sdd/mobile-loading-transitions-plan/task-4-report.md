# Task 4 — Transient notice lifecycle report

## Files

- `apps/mobile/src/ui/BrandNotice.tsx`
  - Removed the caller-controlled `durationMs` field from `ShowNoticeInput`.
  - Added the internal tone timeout policy and generation-safe notice replacement/dismissal lifecycle.
- `.superpowers/sdd/mobile-loading-transitions-plan/task-4-report.md`
  - Records implementation and verification evidence for this task.

No screen callsites were changed; they continue to use `showNotice`.

## Lifecycle behavior

- `info` and `success` notices begin dismissal after exactly `4000` ms.
- `warning` and `error` notices begin dismissal after exactly `6000` ms.
- With normal motion, dismissal retains the existing 200 ms opacity/translate exit, so removal completes at approximately 4.2 or 6.2 seconds.
- With Reduce Motion enabled, the notice is removed immediately when its 4- or 6-second threshold is reached.
- Every `showNotice` call increments a monotonic generation before clearing the prior timer and stopping both animated values. The replacement receives a fresh full timeout.
- Timer callbacks and animated exit completion callbacks carry the notice generation and may clear state only while that generation remains current, preventing an older notice from removing a replacement.
- Manual dismissal targets the current notice generation, clears its timeout, stops in-flight motion, and uses the same Reduce Motion-aware exit path.
- Notice-effect cleanup clears the timer and stops both opacity and translation animation values during replacement, removal, and provider unmount.
- Existing overlay placement, tones, accessibility alert/live-region behavior, accessibility announcement, and dismiss button remain unchanged.

## Verification

No focused `BrandNotice` test harness exists in the mobile workspace, so no permanent test scaffolding was added. The narrowest available TypeScript validation for the mobile package was run from the repository root:

```text
$ corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json
(no stdout)
exit code: 0
wall time: 2.69 seconds
```

Result: TypeScript completed successfully with no diagnostics.

## Concerns

- Timer thresholds, replacement races, and Reduce Motion dismissal were not exercised in a runtime UI harness because this workspace has no focused React Native component test setup for `BrandNotice`; verification for this slice is compile-time only.

## Review fix — stale dismissal isolation

- Moved the generation check ahead of timer clearing and animation stopping in `dismissGeneration`.
- A queued callback from an older notice now returns without touching the current notice's timeout or entrance animation. Current-generation automatic and manual dismissal retain the existing timer clear and exit behavior.

Verification:

```text
$ corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json
(no stdout)
exit code: 0
wall time: 2.94 seconds
```

Status: PASS — TypeScript completed successfully with no diagnostics.
