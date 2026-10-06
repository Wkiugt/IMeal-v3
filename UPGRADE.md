# Upgrade guide

## 2026-10-04 platform baseline

The repository now targets Node.js 24 (`>=24 <25`) with Corepack Yarn `4.18.0`; direct Node type declarations resolve to `@types/node` 24.19.1. CI and the four Node Dockerfiles use the pinned Node 24 Alpine image contract.

### Mobile

`apps/mobile` is aligned to Expo SDK 57 (`expo` 57.0.26), React 19.2.3, React Native 0.86.3, React Native Web 0.21.3, and React Navigation 7 (native 7.5.0, bottom-tabs 7.20.0, native-stack 7.20.0). Expo config plugins include notifications, camera, location, font, secure-store, and status-bar. TypeScript resolves to 6.0.3 and Vitest to 4.1.11.

Run the managed checks from `apps/mobile`:

```text
npx expo install --check
npx --yes expo-doctor@1.20.4
corepack yarn exec tsc --noEmit -p tsconfig.json
corepack yarn test
```

The CI Metro smoke fetches Android, iOS, and web AppEntry bundles over HTTP. It is not a physical-device or native build acceptance test.

### React Native architecture transition

For any Expo 54 → 55 migration step, React Native's New Architecture is mandatory and MUST remain enabled. Do not add `newArchEnabled: false` or an equivalent compatibility escape hatch. The final Expo 57 configuration preserves the mandatory New Architecture contract.

### Prisma and backend

Prisma was upgraded from 5.22.0 to stable 7.10.0 with the canonical generated-client output, explicit `prisma.config.ts` datasource, and PostgreSQL driver adapter; the existing ten migrations are unchanged. API Nest common/core/schedule resolve to 12.0.1 with platform-fastify 12.0.4; worker common/core/schedule resolve to 12.0.1 with platform-express 12.1.2 and multer 2.4.0. Domain builds now run metadata-only `prisma:generate` with a build-scoped nonsecret URL before TypeScript, and Turbo caches the ignored generated source with the domain build. API and worker TypeScript resolve to 6.0.3. The disposable PostgreSQL verification uses port 55432 only; it runs `validate`, `generate`, `migrate deploy`, and `migrate status`.

### CI and staging boundary

The qualification baseline has explicit `deploy/develop` and `deploy/staging` guards, a secretless disposable PostgreSQL check, and a separate protected ephemeral-staging qualification that always tears down hosted Compose. These checks do not make protected staging green when credentials, approved origins, DNS/TLS, providers, rollback artifacts, or immutable release inputs are unavailable. See `docs/superpowers/plans/2026-10-04-platform-runtime-upgrade.md` and `docs/runbooks/staging-readiness.md`.

### Acceptance checklist

The managed checks cover Expo dependency alignment, Expo Doctor, TypeScript, tests, and Android/iOS/web Metro HTTP bundles. Physical-device acceptance remains required: cold start, OTP login, permissions, notification registration/deep links, QR/check-in flow, offline/retry behavior, and sign-out/session expiry. No physical-device claim is made here; see `docs/superpowers/evidence/2026-10-04-mobile-sdk57-research.md`.

### Test tooling

All seven workspaces resolve Vitest 4.1.11. Admin Web resolves Vite 8.2.2 and TypeScript 5.9.3. Contracts and observability use TypeScript 5.9.3; domain uses TypeScript 5.9.3; mobile uses TypeScript 6.0.3.

### Security-only lock resolutions

The root `package.json` contains descriptor-specific resolutions only:

```json
{
  "undici@npm:6.20.1": "6.28.1",
  "mysql2@npm:3.15.3": "3.23.1",
  "deepmerge-ts@npm:7.1.5": "8.0.2",
  "uuid@npm:^7.0.3": "11.1.1",
  "tmp@npm:^0.0.33": "0.2.7"
}
```

These are narrow, consumer-tested fixes for exact vulnerable descriptors; they are not global major-version overrides. `corepack yarn install --immutable` must pass after dependency changes.

The final recursive Yarn audit remains non-zero only for the unfixed `braces@3.0.3` high advisory, `node-forge@1.4.0` high advisory, and registry deprecation findings. No advisory is suppressed. See [`2026-10-04 final dependency audit`](docs/superpowers/evidence/2026-10-04-final-dependency-audit.md) and its [`2026-10-06 current reassessment`](docs/superpowers/evidence/2026-10-06-dependency-audit.md) for paths, IDs, reachability, and evidence.

The consolidated final qualification record, exact upgrade-authored file inventory, final image bindings, scanner evidence, commands, and blockers are maintained in [`docs/superpowers/evidence/2026-10-04-prisma7-checkpoint.md`](docs/superpowers/evidence/2026-10-04-prisma7-checkpoint.md).
