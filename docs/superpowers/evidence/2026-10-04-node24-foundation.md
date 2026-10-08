# Node 24 foundation checkpoint evidence

Date: 2026-10-04

> **Historical checkpoint:** this evidence predates the subsequent Prisma 7.10.0 and Expo SDK 57 dependency cutovers. Its Prisma 5.22.0 observations are retained as immutable checkpoint results and are not the current runtime contract.

## Runtime and dependency contract

- Host runtime: Node.js `v24.18.1`.
- Corepack: `0.35.0`; repository-selected Yarn: `4.18.0`.
- Root engine: `>=24 <25`.
- Direct `@types/node` declarations are pinned to the same stable release: `24.19.1` in API, worker, mobile, domain, and observability workspaces.
- Yarn lock regeneration completed with `YARN_ENABLE_IMMUTABLE_INSTALLS=false corepack yarn install`; the follow-up `corepack yarn install --immutable` passed.
- Lockfile resolves `@types/node@24.19.1` and `undici-types@7.24.6`.
- Prisma remains `5.22.0`; the disposable CI URL was supplied while running `prisma generate`, which completed successfully.
- `apps/mobile/package-lock.json` remains `{}`.

## Runtime image contract

All four Node Dockerfiles present in the repository use the approved multi-architecture Node 24 Alpine index digest:

```text
node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
```

Updated files:

- `apps/api/Dockerfile`
- `apps/worker/Dockerfile`
- `apps/admin-web/Dockerfile`
- `infra/migrations/Dockerfile`

The repository contains four Node Dockerfiles even though the CI workflow has three application build commands.

## Verification commands and outcomes

- `corepack yarn workspace @imeal/core exec prisma generate --schema prisma/schema.prisma` with a disposable `DATABASE_URL`: **pass**, Prisma Client `v5.22.0` generated.
- `corepack yarn typecheck`: **pass**.
- `corepack yarn lint`: **pass**, zero errors. Existing warnings are recorded below.
- `corepack yarn test:unit`: **pass**.
  - `@imeal/core`: 5 files, 45 tests.
  - `@imeal/contracts`: 2 files, 43 tests.
  - `@imeal/api`: 32 files, 280 tests.
  - `@imeal/worker`: 21 files, 178 tests.
  - Total: 60 files, 546 tests.
- `corepack yarn test:staging-tools`: **pass**, 121 tests.

The three CI application Docker build commands were executed with `GITHUB_SHA=node24-foundation` and all finished successfully after the Admin Dockerfile fix:

```text
docker build --file apps/api/Dockerfile --tag imeal/api:${GITHUB_SHA} .
docker build --file apps/worker/Dockerfile --tag imeal/worker:${GITHUB_SHA} .
docker build --file apps/admin-web/Dockerfile --tag imeal/admin-web:${GITHUB_SHA} .
```

The Admin build now uses the existing dependency-aware Turbo convention:

```text
RUN yarn turbo run build --filter=@imeal/admin-web...
```

This compiles `@imeal/contracts` before Admin Web and avoids relying on ignored local `dist` output.

## Lint warnings (non-blocking)

Lint returned zero errors and these warnings on existing source paths:

- API: 11 warnings — `eslint(no-unused-vars)` for `allowlist` twice, `prepared`, `_error`, `NestFactory`, `AppModule`, and `isHttpRoute`; `unicorn(no-useless-fallback-in-spread)` in notifications once and registrations twice; `unicorn(no-empty-file)` for `test/test-controller.js` once.
- Worker: 2 warnings — `eslint(no-unused-vars)` for the unused `HealthService` import and `providers` variable.

No business logic changes were made for these warnings.

## Baseline/environment observations

- Host `corepack enable` could not install global Windows shims because `C:\Program Files\nodejs\pnpm` returned `EPERM`. Repository-selected `corepack yarn` worked and was used for all commands; no global shim change was required.
- Docker Desktop was initially stopped. The ordinary local command `docker desktop start` started it successfully; no daemon or infrastructure configuration was changed.
- The first clean Admin Docker build exposed the pre-existing dependency-order failure (`@imeal/contracts` had no `dist` because `.dockerignore` excludes `**/dist`). The smallest upstream fix was the Turbo dependency-aware build command above. The exact Admin build was rerun and passed.
- No Docker or test failures remain for the Node foundation checkpoint.
