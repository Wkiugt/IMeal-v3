# 2026-10-06 dependency security workstream

## Required raw audit

The required command was run with Yarn 4.18.0:

```text
yarn npm audit --all --recursive
```

It exited `1` and reported eleven entries: nine registry deprecations plus two high advisories. The high entries were:

| Package/version | Reachability | Advisory |
| --- | --- | --- |
| `braces@3.0.3` | `micromatch@4.0.8` (Expo Metro and Metro file-map paths) | `1240992`, GHSA-vfj7-8cjw-p6xm, CVE-2026-93687 |
| `node-forge@1.4.0` | `@expo/cli@57.0.27` and `@expo/code-signing-certificates@0.0.6` | `1240912`, GHSA-86w9-cpqp-85rv, CVE-2026-85393 |

The other raw entries were deprecations for `@humanwhocodes/config-array@0.13.0`, `@humanwhocodes/object-schema@2.0.3`, `eslint@8.57.1`, `glob@7.2.3`, `inflight@1.0.6`, `rimraf@3.0.2`, `text-encoding@0.7.0`, `tsconfck@3.1.6`, and `whatwg-encoding@3.1.1`. The raw command was not made green and no finding was hidden.

`yarn npm audit --all --recursive --json` produced one NDJSON object per finding with this shape:

```json
{"value":"braces","children":{"ID":1240992,"URL":"https://github.com/advisories/GHSA-vfj7-8cjw-p6xm","Severity":"high","Vulnerable Versions":"<=3.0.3","Tree Versions":["3.0.3"],"Dependents":["micromatch@npm:4.0.8"]}}
```

## Root cause and remediation availability

`yarn why` confirmed these paths:

- `micromatch@4.0.8` depends on `braces@3.0.3` through `npm:^3.0.3`.
- `@expo/metro-file-map@57.0.3`, `metro-file-map@0.84.5`, and `metro-file-map@0.84.6` resolve `micromatch@4.0.8`.
- `expo@57.0.26` resolves `@expo/cli@57.0.27`; both virtual Expo paths resolve the same CLI.
- `@expo/cli@57.0.27` and `@expo/code-signing-certificates@0.0.6` resolve `node-forge@1.4.0` through `npm:^1.3.3`.

GitHub advisory metadata reports `first_patched_version: null` for both current advisories. npm registry metadata on 2026-10-06 reports `braces@3.0.3` as the latest published version and `node-forge@1.4.0` as the latest published version. `@expo/cli@57.0.27` is the SDK-57/latest CLI release; `expo@57.0.27` is not published (`npm` returned `E404`), so `expo@57.0.26` is the newest SDK-57 parent. The braces issue remains open, and the node-forge fix PR remains open/unmerged. Therefore no direct upgrade or safe resolution can remove either advisory without leaving the supported Expo 57 dependency set or using an unreleased source tree.

`yarn workspace @imeal/mobile exec expo install --check` reported `Dependencies are up to date`. No manifest or lockfile change was made.

## Narrow qualification wrapper

`scripts/ci/security-audit.mjs` is the security lane command. It runs the complete Yarn audit with the documented deprecation switch, without advisory ignores:

```text
yarn npm audit --all --recursive --no-deprecations --json
```

It streams the complete raw stdout/stderr into dispatcher diagnostics, accepts only these exact temporary exceptions, and fails closed for all other findings, malformed/incomplete JSON, unexpected stderr, unsupported process exit codes, and invalid/expired clocks:

| Package/version | Numeric ID | GHSA | Severity/range | Expiry |
| --- | ---: | --- | --- | --- |
| `braces@3.0.3` | `1240992` | `GHSA-vfj7-8cjw-p6xm` | `high`, `<=3.0.3` | 2026-11-06 00:00 UTC |
| `node-forge@1.4.0` | `1240912` | `GHSA-86w9-cpqp-85rv` | `high`, `<=1.4.0` | 2026-11-06 00:00 UTC |

The wrapper does not classify deprecations; `--no-deprecations` removes the documented registry deprecation entries before machine evaluation. A throwaway clean audit using `--ignore 1240992 --ignore 1240912` was used only to observe Yarn's clean JSON shape: exit `0`, empty stdout, and empty stderr. Those ignore flags are not used by the gate.

## Verification

- Node 24.21.0 was downloaded as a portable official Windows ZIP because no `node24`, `nvm`, or `fnm` executable was available. Corepack Yarn reported `4.18.0` under Node 24.
- `yarn install --immutable`: passed with one existing `YN0086` peer warning.
- `node --test scripts/ci/security-audit.test.mjs` under Node 24: 6/6 passed. Tests cover exact exceptions, expiry, changed package/version/URL/ID/range/severity/mixed versions, unknown critical/high/moderate/low findings, malformed/incomplete output, clean exit-0 shape, stderr, unsupported process exits, and invalid clocks.
- Actual Node 24 wrapper smoke: passed. It retained both raw advisory JSON records and emitted acceptance messages; underlying Yarn audit exited `1`, wrapper qualification exited `0`.
- Docker 29.8.1 is installed. WSL reports only the Docker Desktop distribution; no general Linux distribution is available. Docker/POSIX image qualification remains owned by the CI workstream.

The integrated workspace verification was attempted after immutable install. The initial Node 24 `yarn typecheck` and subsequent `yarn build` both failed in `@imeal/admin-web` resolving `@imeal/contracts` through the Yarn-created Windows workspace reparse-point link, with additional existing `src/main.ts` unknown-error property diagnostics. The source package and `packages/contracts/dist` exist, but `node_modules/@imeal/contracts/package.json` is inaccessible through the link while the manually resolved target is present. This is an environment/link-resolution limitation, not a dependency security change; no hand-made dependency workaround was applied.

Additional integrated verification after the security patch:

- `yarn test:unit` under Node 24: failed in `@imeal/api` with 29 failed suites (37 tests passed); `@imeal/contracts` (43 tests) and `@imeal/core` (45 tests) passed. Failures were `Cannot find package '@imeal/core'`, `@imeal/contracts`, and `@imeal/observability` through inaccessible Windows workspace links.
- `yarn turbo run test --filter=@imeal/mobile --filter=@imeal/admin-web --filter=@imeal/observability --concurrency=1`: observability passed (76 tests); admin-web failed all 7 tests resolving `@imeal/contracts`; mobile was not reached by Turbo after the dependent admin failure. Direct `yarn workspace @imeal/mobile test` then passed 135 tests but failed 5 suites at the same inaccessible `@imeal/contracts` import (23 test files passed).
- `yarn test:build-order`: passed all 3 tests (with a Node DEP0190 warning from the fixture's shell child process).
- Exact CI behavior catalogue with the added security test (`node --test scripts/ci/ci-contracts.test.mjs scripts/ci/ci-dispatcher.test.mjs scripts/ci/ci-verify.test.mjs scripts/ci/workflow-graph.test.mjs scripts/ci/mobile-process.test.mjs scripts/ci/mobile-export.test.mjs scripts/ci/metro-smoke.test.mjs scripts/ci/security-audit.test.mjs`): 50 passed, 2 Windows-specific skipped, 0 failed.
- Staging non-Docker catalogue (11 test files): 115 passed, 0 failed.
- `node --test scripts/verify-production-boundary.test.mjs`: 2 passed; `node scripts/verify-production-boundary.mjs`: passed.
- `yarn workspace @imeal/mobile exec expo install --check`: `Dependencies are up to date`; `yarn dlx expo-doctor@1.20.4 apps/mobile`: 21/21 checks passed.
- Mobile production export wrapper (with the inner Expo command `expo export --clear --platform all` through the catalogue command): failed with exit 1 while resolving `@imeal/contracts`; Metro HTTP smoke failed with HTTP 500 for the same module-resolution cause.
- Docker daemon probe succeeded (`docker info`: server 29.8.1). Linux clean-copy verification was run in `node:24-alpine`; its completed results and interrupted remaining commands are recorded below. No Windows junction workaround was applied.

The Linux clean-copy command completed install, build, typecheck, lint, unit, and client-suites before the requested stop reached build-order. Results retained in session artifact `artifact://815` (backing log `~/.omp/agent/sessions/-orca-workspaces-IMeal-deploy-develop/2026-10-06T01-11-31-552Z_01a10ec4-0be0-7117-844b-c9910d9b7473/815.bash.log`): immutable install passed with `YN0086`; `yarn build` passed (`6/6` tasks); `yarn typecheck` passed (`10/10` tasks); `yarn lint` passed with 11 warnings and 0 errors; `yarn test:unit` passed (60 files, 542 tests: contracts 43, core 45, API 279, worker 175); and client suites passed (`4/4` tasks, including mobile 28 files/158 tests). The container was stopped at `node scripts/build-order.test.mjs`, which returned 143; Expo check/doctor/export/smoke and Linux wrapper/CI-behavior were not reached. No pass claim is made for those unexecuted commands.
