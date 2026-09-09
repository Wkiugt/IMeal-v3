# SDD ledger — plan: local://mobile-loading-transitions-plan.md

## Preflight scan

| Task | Own-text consistency | Shared-file/interface relationship | Finding / ruling |
|---|---|---|---|
| 1. Shared brand and motion surface | Creates `BrandMotion.tsx` and defines four exports with explicit props, timings, cleanup, and Reduce Motion behavior; no internal test file is mandated. | Produces `BrandMark`, `BrandLoader`, `StateTransition`, `ScreenEntrance` consumed by Tasks 2–3. | Consistent. Task 1 owns the shared contracts and must preserve exact exported signatures. |
| 2. Shell, auth, and navigation integration | Changes `PrototypeFrame`, `App.tsx`, and navigator options; consumes Task 1 exports. | `App.tsx` consumes `BrandMark`/`BrandLoader`/`StateTransition`; `PrototypeShell.tsx` consumes `ScreenEntrance`; Task 3 relies on the frame wrapper. | Consistent. Integration must not alter route names, redirect behavior, tab registration, unmount policy, or existing layout semantics. |
| 3. Asynchronous screen branches | Updates six named screen files with loading/error/request-generation lifecycle rules and shared motion surfaces. | Consumes Task 1 `BrandLoader`/`StateTransition`; uses existing `showNotice` contract from Task 4 without changing provider policy. | Consistent. Task 3 must leave notices provider-owned and preserve domain timers/refresh controls. |
| 4. Transient notice lifecycle | Updates `BrandNotice.tsx` only: removes caller duration override and centralizes exact tone timeouts, generation guards, and cleanup. | Existing screen callsites remain consumers; Task 3 error paths must continue using `showNotice`. | Consistent. Provider remains above navigation and owns all transient notice timers. |
| Task-pair 1↔2 | — | Task 2 depends on Task 1 exports and Task 1's `ScreenEntrance` style contract. | No contradiction; execute serially. |
| Task-pair 1↔3 | — | Task 3 depends on Task 1 loader/transition exports. | No contradiction; execute serially. |
| Task-pair 1↔4 | — | Both use `useReducedMotion`, but no shared mutable state or file ownership. | No contradiction. |
| Task-pair 2↔3 | — | Task 3 screens use `PrototypeFrame` behavior introduced by Task 2. | No contradiction; Task 2 precedes Task 3. |
| Task-pair 2↔4 | — | `App.tsx` keeps `NoticeProvider` above `NavigationContainer`; Task 4 changes only provider internals. | No contradiction. |
| Task-pair 3↔4 | — | Task 3 continues existing `showNotice` callsites; Task 4 changes timeout policy only. | No contradiction; verify callsites after both. |

## Rulings

- Ruling: treat the four numbered implementation sections as the execution tasks because the recovered plan uses section headings rather than `Task N` headings — this preserves every named requirement without inventing a separate scope.
- Ruling: do not add permanent tests solely to satisfy process wording where the mobile package has no test runner; use the plan's TypeScript check plus focused runtime/smoke verification, and keep any throwaway checks outside production files — cost if wrong: a missing regression test could allow a later lifecycle regression.
Task 1: complete (commits 4b8e0e5..85dd1bd, review clean; reviewer found no P0-P3 issues)
Task 1: concern deferred — runtime animation timing/visual behavior requires Expo integration smoke verification.
Task 2: complete (commits 85dd1bd..dd00ad8, review clean)
Task 2: concern deferred — runtime viewport/focus/Reduce Motion behavior requires Expo integration smoke verification.
Task 3: fix round 1/5 (1 addressed, 0 open; commits 1dad039..350733b)
Task 3: complete (commits dd00ad8..350733b, review clean)
Task 3: concern deferred — reordered-response, camera, QR, polling, and animation behavior requires Expo/device smoke verification.
Task 4: fix round 1/5 (1 addressed, 0 open; commits ca2792f..e0f1bfd)
Task 4: complete (commits 350733b..e0f1bfd, review clean)
Task 4: concern deferred — timer thresholds, replacement races, and Reduce Motion dismissal require runtime verification.
Ruling: add the existing `SafeAreaProvider` at the App root as a prerequisite integration fix — runtime reproduction on the current Expo build consistently blanked `/pickup` with “No safe area value available” because both `PrototypeFrame` and the global notice overlay consume `SafeAreaView` without a provider; this is the smallest root-cause fix and preserves the provider above navigation — cost if wrong: a root wrapper change could affect safe-area insets across every screen and must be smoke-checked.
Task 5: complete (commits e0f1bfd..08c943d, review clean)
Task 5: runtime proof — authenticated Expo web Dashboard → Calendar → Ticket at 390×844 rendered with zero missing-safe-area, console/page, or HTTP ≥400 errors.
Task 3: final-review fix (1 addressed, 0 open; commits 08c943d..6b05db0)
Task 3: final re-review clean — initial calendar loading remains visible until authoritative week resolution.
Verification: `corepack yarn workspace @imeal/mobile exec tsc --noEmit -p tsconfig.json` exited 0 with no output.
Verification: final Expo web smoke at 390×844 authenticated session rendered Dashboard, Calendar, and Ticket routes with no page errors; Pickup showed its captured unavailable branch and accessible notice dismissal surface.
Verification: error notice remained present before its timeout threshold and was absent after exit completion in the Expo web session.
Final merge-base review: plan-specific mobile changes approved; one Important finding concerns `apps/admin-web/src/main.ts:405-406`, introduced by pre-existing commit `4b8e0e5 feat(auth): add local role testing flow`.
Final review: parked — preserve Entra sign-in in admin web — Ruling: out of scope for this mobile loading/transitions plan and present at the task-start HEAD; do not alter unrelated admin authentication in this branch — cost if wrong: merging the broader branch without a separate admin-auth fix leaves AUTH_MODE=entra deployments unable to sign in.
