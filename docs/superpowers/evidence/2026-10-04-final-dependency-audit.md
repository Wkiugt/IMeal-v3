# Final dependency audit and security lock evidence

Date: 2026-10-04
Current reassessment: [`2026-10-06 dependency audit addendum`](2026-10-06-dependency-audit.md).

## Commands and lock state

The final dependency mutation used Corepack Yarn `4.18.0`:

```text
YARN_ENABLE_IMMUTABLE_INSTALLS=false corepack yarn install
corepack yarn install --immutable
corepack yarn npm audit --all --recursive
```

The immutable install passed. The audit intentionally exited `1`; no advisory was ignored, suppressed, or converted into a green result.

Root `package.json` contains only these descriptor-specific, security-only resolutions:

```json
"resolutions": {
  "undici@npm:6.20.1": "6.28.1",
  "mysql2@npm:3.15.3": "3.23.1",
  "deepmerge-ts@npm:7.1.5": "8.0.2",
  "uuid@npm:^7.0.3": "11.1.1",
  "tmp@npm:^0.0.33": "0.2.7"
}
```

`@nestjs/mau@0.2.6` and its latest published `0.2.8` both declare exact `undici: 6.20.1`; `6.28.1` is the first fixed 6.x version reported by the advisories. Prisma `7.10.0` declares exact `mysql2: 3.15.3`; `3.23.1` is the first version beyond both reported affected ranges (`<3.22.0` high, `<=3.23.0` moderate). `@prisma/config@7.10.0` declares exact `deepmerge-ts: 7.1.5`; the reviewed config consumers use plain merge operations that remain compatible with stable `8.0.2`. `xcode@3.0.1` declares `uuid: ^7.0.3` and uses only `require('uuid').v4`; stable `11.1.1` retains the CommonJS `v4` API. `external-editor@3.1.0` declares `tmp: ^0.0.33`; the reviewed tempfile create/read/unlink consumer smoke passed on stable `0.2.7`. Prisma CLI remained `7.10.0`; disposable-PostgreSQL `validate`, `generate`, `migrate deploy`, and `migrate status` all passed after the resolutions.

For the worker, the official parent was upgraded from `@nestjs/platform-express^12.0.1` to `^12.1.2`. Its peer metadata accepts the existing `@nestjs/common/core^12.0.1`, and `12.1.2` declares fixed `multer: 2.4.0`. The worker suite passed after this parent upgrade, so no multer resolution was needed.

## Final workspace version inventory

These are the installed versions resolved by each workspace after the final immutable install (not manifest ranges):

| Workspace                         | TypeScript                                 | Nest installed paths                                             | Vite  | Vitest |
| --------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- | ----- | ------ |
| repository root                   | 5.9.3                                      | —                                                                | 8.2.2 | 4.1.11 |
| `apps/mobile`                     | 6.0.3                                      | —                                                                | 8.2.2 | 4.1.11 |
| `apps/admin-web`                  | 5.9.3                                      | —                                                                | 8.2.2 | 4.1.11 |
| `apps/api`                        | 6.0.3                                      | common/core/schedule 12.0.1; platform-fastify 12.0.4; CLI 12.0.0 | 8.2.2 | 4.1.11 |
| `apps/worker`                     | 6.0.3                                      | common/core/schedule 12.0.1; platform-express 12.1.2; CLI 12.0.0 | 8.2.2 | 4.1.11 |
| `packages/contracts`              | 5.9.3                                      | —                                                                | 8.2.2 | 4.1.11 |
| `packages/observability`          | 5.9.3                                      | —                                                                | 8.2.2 | 4.1.11 |
| `packages/domain` (`@imeal/core`) | 5.9.3                                      | —                                                                | 8.2.2 | 4.1.11 |
| `packages/ui`                     | none declared; root-hoisted 5.9.3 resolves | —                                                                | —     | —      |

`packages/ui` declares no TypeScript compiler or test script; the root typecheck does not include this package. Its project-relative TypeScript resolution was checked once and resolved to the root-hoisted `5.9.3`.

The mobile client resolves: Expo 57.0.26; `@expo/metro-runtime` 57.0.16; React/React DOM 19.2.3; React Native 0.86.3; React Native Web 0.21.3; `@types/react` 19.2.18; `@types/node` 24.19.1; navigation native 7.5.0, bottom-tabs 7.20.0, native-stack 7.20.0; screens 4.26.2; safe-area-context 5.7.0; and SVG 15.15.4. Expo modules resolve to the SDK 57 patch versions recorded in the mobile evidence.

All seven workspace Vitest paths resolve to `4.1.11`.

## Audit findings after the fixes

The following affected paths were removed from the final audit output by compatible upgrades or the documented same-major resolutions:

- `@vitest/mocker` / `vitest`: all workspaces resolve `4.1.11`; the prior `4.1.2` pin in admin-web is now exact `4.1.11`.
- `brace-expansion`: `1.1.21` and `5.0.12` satisfy the minimatch ranges and clear the reported moderate/high DoS advisories.
- `fast-uri`: AJV's `3.x` path resolves `3.1.8`.
- `undici`: the Expo SDK paths resolve `7.30.0` and `8.11.2`; the Mau exact descriptor is resolved to `6.28.1`.
- `multer`: the worker's Nest 12.1.2 parent resolves `2.4.0`.
- `tmp`: the external-editor exact descriptor resolves to `0.2.7`, clearing the reported old and new tmp advisories.

The registry still reports these findings, with exact current paths and fixed-version boundaries:

| Package and current path                                                            | Severity / advisory       | Fixed boundary or status                                                                                       |
| ----------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `braces@3.0.3` via `micromatch@4.0.8`                                               | High, GHSA-vfj7-8cjw-p6xm | Affected `<=3.0.3`; npm's stable latest is still `3.0.3`, so no fixed release exists in the required 3.x line. |
| `node-forge@1.4.0` via `@expo/cli@57.0.27`                                          | High, GHSA-86w9-cpqp-85rv | Affected `<=1.4.0`; npm currently publishes no version beyond `1.4.0`, so no fixed release is available.       |
| `text-encoding@0.7.0` via `react-native-qrcode-svg@6.3.22`                          | Moderate deprecation      | Package is unmaintained; no replacement was introduced speculatively.                                          |
| `tsconfck@3.1.6` via `vite-tsconfig-paths@5.1.4`                                    | Moderate deprecation      | Current npm 3.x remains `3.1.6`; no fixed 3.x release is published.                                            |
| `glob@7.2.3`, `inflight@1.0.6`, `rimraf@3.0.2` via legacy ESLint/flat-cache tooling | Moderate deprecations     | Remediation requires parent/tooling major migration; no gate was weakened.                                     |
| `eslint@8.57.1` and its `@humanwhocodes/*` dependencies                             | Moderate deprecation      | ESLint 8 is unsupported; the current root configuration has not been silently migrated to ESLint 9.            |
| `whatwg-encoding@3.1.1` via `jsdom@26.1.0`                                          | Moderate deprecation      | npm's current release remains `3.1.1`; no fixed release is available.                                          |

## Consumer verification

After the final lock settled:

- contracts: 2 files, 43 tests passed;
- observability: 3 files, 76 tests passed;
- worker: 21 files, 175 tests passed;
- root `test:unit`: domain 45, contracts 43, API 279, worker 175 tests passed;
- Prisma CLI 7.10.0 validate/generate/migrate command surface passed;
- Disposable PostgreSQL on `127.0.0.1:55432`: Prisma 7.10.0 `validate`, `generate`, `migrate deploy`, and `migrate status` passed; ten migrations were up to date.
- Mobile: `npx --yes expo-doctor@1.20.4` passed 21/21, mobile TypeScript passed, and all 28 files/158 tests passed.
- Xcode 3.0.1 parsed and rewrote a disposable project fixture with UUID 11.1.1; generated UUID output was accepted and the rewritten fixture reparsed.
- `corepack yarn install --immutable` passed.

The latest immutable install emitted aggregate `YN0086` only; no `YN0002` or `YN0060` line was emitted. `corepack yarn explain peer-requirements` identified ten unsatisfied upstream peer paths, all inspected:

- Expo 57/React 19 paths: `p384a85` (`@expo/cli@57.0.27` → `@expo/router-server` requires `expo-constants`), `p3cf9b6` (requires `expo-font`), `pf7d417` (requires `react`), `p8db4ec` (`expo-linking@57.0.11` → `expo-constants` requires `expo`), `p191919` (`babel-plugin-transform-flow-enums` → `@babel/plugin-syntax-flow` requires `@babel/core`), and `p8ef017` (`babel-preset-expo@57.0.13` → Expo Babel plugins require `@babel/core`). The managed Expo Doctor, mobile TypeScript, 158 mobile tests, Metro bundle smoke, and Expo config checks all passed; no runtime peer defect was observed.
- Prisma 7 paths: `p265bd8` (`prisma@7.10.0` → `mysql2` requires `@types/node`), `p038f1e`/`p0b62d0`/`p5de72b` (`prisma@7.10.0` → `@prisma/studio-core` requires React type/runtime peers). Prisma validate/generate and disposable PostgreSQL migration/status checks passed; no Prisma consumer defect was observed.
- No unsatisfied path was attributable to Nest 12.1.2 or Vitest 4.1.11; their peer explanation entries were satisfied or optional missing-peer notices. These warnings are retained as provenance, not suppressed or dismissed as a blanket “existing” warning.

## Final security handoff boundaries

- Dependency audit: two unfixed **High** advisories remain (`braces@3.0.3` and `node-forge@1.4.0`). They **block the as-configured CI audit gate** because `corepack yarn npm audit --all --recursive` exits 1 and the checks job fails, which prevents protected deployment from qualifying. No stable fixed release is available in the required paths, so no safe remediation is currently published; this is not a policy waiver or a suppressed finding.
- Peer provenance: immutable install emitted aggregate `YN0086` and exactly ten inspected transitive peer paths (six Expo 57/React 19 and four Prisma 7 paths). No `YN0002`/`YN0060` was emitted, and no unmet Nest 12.1.2 or Vitest 4.1.11 peer was found.
- Browser runtime warnings: actual Expo Web auth smoke observed only the React Native Web `shadow*` deprecation, Expo Notifications' unsupported web push-token listener warning, and `useNativeDriver` JS fallback. No runtime exception or console error occurred; this is not a native-device/authenticated-session proof.
- Final local image Trivy/Syft bindings and the worker readiness limitation are recorded in `docs/superpowers/evidence/2026-10-04-image-scans.md`.
- Final Gitleaks source/full-history/negative-control evidence, including current `minVersion = "v8.30.1"` and all-ref `--log-opts=--all` scan, is recorded in `docs/superpowers/evidence/2026-10-04-secret-scanner-ci-review.md`.
- Protected staging qualification remains blocked on protected inputs and production scheduler qualification. The workflow Syft source-prefix issue is a reachable CI workflow correction (the accepted fast SBOM path uses `docker:`), not an application implementation blocker or basis for an all-green claim.
