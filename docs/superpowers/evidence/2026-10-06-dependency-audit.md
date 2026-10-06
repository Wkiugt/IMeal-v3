# Dependency audit addendum

Date: 2026-10-06. Reviewed commit `5030cde2c43c1d816704b0102c2e81a5a753f6ef`.
The reviewed pre-fix lock had SHA-256
`53acbe1cc6cca284853f89bc594d31e1dde596d4db5be01e11b6b48bd6311595`.
The final targeted lock has SHA-256
`695b5b2c3a26250bfc680fb32e6f0ebbe8d6e024163cd58e377fa5f697a8b27d`.

Reproduce in a disposable checkout with Corepack Yarn 4.18.0:

```text
corepack yarn install --immutable
corepack yarn npm audit --all --recursive
```

The final audit exited **1**. The CI gate remains nonzero; no advisory was
ignored, suppressed, waived, or converted to a pass. The workflow preserves
complete output as
`dependency-audit-${{ github.run_id }}-${{ github.run_attempt }}/dependency-audit.log`.

## Findings and reachability

The pre-fix audit identified two additional current-lock vulnerabilities that
an earlier comparison incorrectly called parent-only. That comparison is
superseded by the independently verified pre-fix lock identity; no stale-state
explanation is asserted.

- **Fixed by the targeted lock update, worker production runtime:** `proxy-addr@2.0.7`
  through `@nestjs/platform-express@12.1.2` → `express@5.2.1`. The API uses
  `@nestjs/platform-fastify` instead. GHSA-jqcg-44mw-7w3h affects `>=1.1.0
<2.0.8`; `2.0.8` is the official fix and satisfies the existing `^2.0.7`
  descriptor.
- **Fixed by the targeted lock update, shared test/build dependency tree:**
  `source-map-js@1.2.1` through `magicast@0.5.4` (via
  `@vitest/coverage-v8@4.1.11`) and `postcss@8.5.28` (via
  `@expo/metro-config@57.0.12` and `vite@8.2.2`). GHSA-68fv-2mgg-jv7q affects
  `>=1.0.0 <1.2.2`; `1.2.2` is the official fix and satisfies the existing
  `^1.2.1` descriptors. These shared Docker `node_modules` trees remain
  reachable; classification is functional usage, not an image-absence claim or
  risk waiver.
- **Unfixed final high, build/dev dependency tree:** `braces@3.0.3` through
  `micromatch@4.0.8` (including Expo Metro file-map paths). GHSA-vfj7-8cjw-p6xm
  affects `<=3.0.3`; no patched release is published.
- **Unfixed final high, Expo CLI dependency tree:** `node-forge@1.4.0` through
  `@expo/cli@57.0.27` (including Expo code-signing paths). GHSA-86w9-cpqp-85rv
  affects `<=1.4.0`; no patched release is published for the SDK 57 CLI line.

The final audit also reports these moderate deprecations, with no risk waiver:
`text-encoding@0.7.0` via `react-native-qrcode-svg@6.3.22` (mobile runtime),
`tsconfck@3.1.6` via `vite-tsconfig-paths@5.1.4` (API/worker test tooling),
`whatwg-encoding@3.1.1` via `jsdom@26.1.0` (Admin Web test dependency),
unsupported `eslint@8.57.1` via the repository root, and
`@humanwhocodes/*`, `glob@7.2.3`, `inflight@1.0.6`, and `rimraf@3.0.2` in
ESLint/flat-cache tooling. These remain reachable in the shared dependency
installation; classification does not waive the audit gate.

The remediation was deliberately narrow: `yarn up -R proxy-addr source-map-js`
changed only those two lock leaves and their checksums; no root resolution or
broad parent upgrade was added. Node 24 consumer smokes passed for Express
proxy trust behavior and PostCSS inline source maps after the update. Official
advisories: <https://github.com/advisories/GHSA-jqcg-44mw-7w3h>,
<https://github.com/advisories/GHSA-68fv-2mgg-jv7q>,
<https://github.com/advisories/GHSA-vfj7-8cjw-p6xm>, and
<https://github.com/advisories/GHSA-86w9-cpqp-85rv>.
