# Repository Guidelines

## Project Overview

IMeal v2 is a Yarn/Turborepo TypeScript monorepo for an internal employee meal-registration and pickup system serving roughly 200–300 staff. It replaces the former Firebase/Firestore design with a self-hosted PostgreSQL system:

- `apps/api`: NestJS/Fastify HTTP API.
- `apps/worker`: NestJS scheduled jobs for cutoff, no-show, and pickup-session cleanup.
- `apps/mobile`: Expo/React Native staff and kitchen workflows.
- `apps/admin-web`: Vite-based administrative web client.
- `packages/contracts`: versioned Zod transport schemas and inferred types.
- `packages/domain`: Prisma schema/client and reusable registration/serving rules.
- `packages/ui`: shared React components and mostly static UI prototypes.

## Architecture & Data Flow

The server is authoritative. Mobile and Admin Web call the API; they never write PostgreSQL directly. PostgreSQL is the business source of truth, with Prisma migrations under `packages/domain/prisma/migrations`.

Typical flow:

1. Admin publishes a weekly menu.
2. Staff registers meals by day before the business cutoff.
3. The cutoff locks the registration state.
4. Staff selects pickup intent and receives a short-lived signed QR code.
5. Kitchen resolves the QR code, reviews the exact set, and explicitly confirms serving.
6. Serving, audit, notifications, and realtime events are persisted/emitted.
7. Worker jobs mark remaining eligible registrations as no-show and create penalties.

Business rules use `Asia/Ho_Chi_Minh`: cutoff is strictly before 14:00 on the preceding day; serving is 10:30–13:30; no-show processing starts at 13:45. Dynamic QR codes have a 5-second TTL with 2-second clock skew; pickup sessions expire after 30 seconds. Preserve these rules when changing date or time logic.

The main invariants live in `packages/domain/src/RegistrationService.ts` and the Prisma schema. Use transactions for multi-write state changes, unique constraints and idempotency keys for replay/concurrency safety, and row locks for serving races. Delegation requires recipient acceptance. Persisted notifications are authoritative; Expo Push is delivery transport.

API modules in `apps/api/src` provide authentication, registrations, delegations, pickup, kitchen dashboard/realtime, notifications, and admin features. Entra JWT authentication provisions users and expands database roles/permissions. Kitchen updates use SSE and deduplicate event IDs; clients refetch after reconnects or duplicate events.

## Key Directories

- `apps/api/src/auth`, `common`, `config`: Entra JWT validation, guards/decorators, business-time helpers, configuration.
- `apps/api/src/registrations`, `delegations`, `pickup`, `kitchen`, `notifications`, `admin`: HTTP controllers and application services.
- `apps/worker/src`: scheduled state transitions and cleanup services.
- `apps/mobile/src/api`: token-bearing `fetch` wrappers; `src/screens`: pickup, kitchen, and delegation screens.
- `apps/admin-web/src`: administrative Vite application.
- `packages/contracts/src/v1`: public schemas/types for envelopes, errors, pagination, delegation, kitchen, and realtime payloads.
- `packages/domain/src`, `packages/domain/prisma`: persistence and domain invariants.
- `packages/ui/src/components`, `packages/ui/src/views`: reusable controls and UI prototypes.
- `docs`: product requirements, flows, technical requirements, backend structure, ADRs, and execution notes.

## Development Commands

Use Yarn; do not use the obsolete pnpm workspace files or the empty mobile `package-lock.json`.

```sh
corepack enable
corepack prepare yarn@4.18.0 --activate
yarn install --immutable

yarn typecheck
yarn lint
yarn build
yarn format

yarn test:unit   # contracts, API, worker unit suites
yarn test:db     # domain DB suite, API e2e, worker e2e
```

For local infrastructure and DB-backed tests:

```sh
cp .env.example .env        # replace Entra and signing-secret placeholders
docker compose up --build
yarn test:db                 # requires PostgreSQL and DATABASE_URL
```

Useful workspace commands include `yarn workspace @imeal/api start:dev`, `yarn workspace @imeal/worker start:dev`, `yarn workspace @imeal/contracts test`, `yarn workspace @imeal/core test`, `yarn workspace @imeal/api test:e2e`, and `yarn workspace @imeal/worker test:e2e`. Mobile uses `yarn workspace mobile start` (or `android`, `ios`, `web`); Admin Web uses `yarn workspace admin-web dev`.

`turbo.json` makes build depend on upstream package builds, caches `dist/**` and `.next/**`, and treats `dev` as persistent and uncached.

## Code Conventions & Common Patterns

- Use strict TypeScript. API/worker code follows Nest modules, controllers, services, guards, and DTO boundaries; inject collaborators through constructors when available.
- Prefer `async`/`await`. Use Prisma `$transaction` for invariants spanning writes. Reserve raw SQL for explicit row locks and atomic outbox claims.
- Translate domain failures into Nest HTTP exceptions at API boundaries. Return stable error codes and structured envelopes rather than making clients branch on message text.
- JSON success shape is route-specific. Envelope-backed versioned routes use
  `{ data, meta?: { requestId, pagination? } }` (with `meta.pagination` where
  the route is paginated). Current raw authentication endpoints under `/auth`
  return their documented raw payloads, and `GET /admin/weekly-menus` returns
  its documented raw weekly-menu array; these routes are not wrapped solely
  because the general API guidance describes envelope-backed routes.
- Implementation references: `apps/api/src/auth/auth.controller.ts` returns
  raw OTP request/verify, logout, and `/auth/me` values consumed by the raw
  schemas in `apps/mobile/src/api/authAPI.ts`;
  `apps/api/src/admin/weekly-menus/weekly-menus.controller.ts` delegates raw
  weekly-menu values; `apps/admin-web/src/main.ts` consumes the raw
  weekly-menu array and maps each daily menu’s revisions/current meal fields;
  envelope-backed check-in and employee-activity schemas in
  `packages/contracts/src/v1/check-in.ts` and
  `packages/contracts/src/v1/employee-activity.ts` are parsed by
  `apps/mobile/src/api/checkInAPI.ts` and
  `apps/mobile/src/api/employeeActivityAPI.ts`.
- Use Zod schemas from `packages/contracts/src/v1` for transport contracts; add or change versioned contracts before changing consumers.
- Represent business dates explicitly and use existing Vietnam-time helpers (`apps/api/src/common/business-time.ts`); do not introduce ad-hoc local/UTC conversions.
- Keep side effects such as push notifications outside committed database transactions when possible; log delivery failures without rolling back the business state.
- React code favors local hooks (`useState`, `useEffect`, `useCallback`, `useMemo`, `useRef`), immutable `Set` replacement for selections, focus-aware polling/cleanup, and explicit loading/error/finally states. Do not show optimistic saved state when the server has not confirmed it.
- Mobile API modules are thin authenticated `fetch` wrappers with explicit response checks. Screens own focus refresh, countdowns, selection, and recovery state.
- Follow Prettier: semicolons, single quotes, and `trailingComma: 'all'`. Oxlint allows explicit `any` but warns on floating promises.
- Preserve accessibility in UI work: 44×44 minimum targets, focus-visible states, reduced-motion behavior, and clear recovery/error messages.

## Important Files

- `package.json`: authoritative workspace metadata and root commands.
- `yarn.lock`, `.yarnrc.yml`, `.prettierrc`, `turbo.json`: dependency/install, formatting, and task-runner behavior.
- `packages/domain/prisma/schema.prisma`: relational model, indexes, unique constraints, and cascades.
- `packages/domain/src/RegistrationService.ts`: cutoff, registration, delegation, penalty, and serving rules.
- `packages/contracts/src/v1/index.ts`: shared contract export surface.
- `apps/api/src/app.module.ts`, `apps/api/src/main.ts`: API module graph and bootstrap.
- `apps/api/src/pickup/pickup.service.ts`: signed QR, pickup sessions, locking, and idempotent confirmation.
- `apps/api/src/kitchen/kitchen-dashboard.service.ts`, `kitchen-events.service.ts`: dashboard aggregation and SSE events.
- `apps/api/src/auth/jwt.strategy.ts`, `auth.service.ts`, `permissions.guard.ts`, `roles.guard.ts`: identity and authorization boundary.
- `apps/worker/src/no-show-worker.service.ts`, `cutoff-worker.service.ts`, `pickup-worker.service.ts`: scheduled jobs.
- `apps/mobile/src/api`, `apps/mobile/src/screens`: client transport and user workflows.
- `.env.example`, `docker-compose.yml`, `Caddyfile`: local/runtime services and environment contract.
- `docs/README.md`: documentation reading order and canonical product rules.
- `docs/05-backend-structure.md`: API envelopes, pagination, locking, idempotency, audit, and realtime requirements.

## Runtime/Tooling Preferences

- Required baseline: Node.js `>=18`; repository package manager: Yarn `4.18.0` via Corepack.
- Yarn uses the `node-modules` linker and global cache (`.yarnrc.yml`). `yarn.lock` is authoritative; `pnpm-workspace.yaml` and `pnpm-lock.yaml` are explicitly obsolete.
- Build targets include Node/Nest services, Prisma Client, Expo/React Native, and Vite/Admin Web. API and worker Docker builds run Prisma generation; do not hand-edit generated client output.
- Local Compose provisions PostgreSQL 15, PgBouncer transaction pooling, MinIO, a Prisma migration job, API, worker, Admin Web, and Caddy. Keep secrets in ignored `.env` files; commit only `.env.example` changes.
- Database changes require a Prisma migration, not an ad-hoc schema edit. Check the current migration history before modifying models.

## Testing & QA

Vitest is used across the repository; Nest tests use `@nestjs/testing`, HTTP e2e tests use Supertest, and contract tests validate Zod schemas.

- Default task workflow: implement requested fixes/features and report the changed files and behavior. Do not run automated test-case suites unless the user explicitly requests them; the user owns manual QA. Non-test static checks required by the active harness remain allowed and must be reported separately.
- Unit tests: `yarn test:unit`. API and worker unit discovery is `**/*.spec.ts`; contracts and domain use normal Vitest discovery.
- DB/e2e tests: `yarn test:db`. Domain setup creates a disposable random PostgreSQL schema, deploys migrations, truncates tables between tests, and drops the schema afterward. It requires `DATABASE_URL` and PostgreSQL. API e2e reuses this setup; worker e2e does not.
- API/worker coverage: `yarn workspace @imeal/api test:cov` or `yarn workspace @imeal/worker test:cov`. Coverage uses V8; no repository-wide threshold was found.
- Unit tests generally mock Prisma and `$transaction`; time-sensitive domain/API tests use fake timers. E2E controller tests commonly override services and bypass auth, so they verify HTTP/controller behavior rather than full persistence/authentication.
- High-risk behavior already covered includes cutoff boundaries, registration/delegation invariants, signed QR expiry/signature/date/intent checks, replay and idempotency, serving-vs-cancel races, all-or-nothing batch behavior, no-show penalty idempotency, SSE deduplication, and configuration security.
- Treat `apps/api/test/test-controller.ts` and `.js` as obsolete probes; they are excluded from e2e discovery.

Before changing behavior, read the relevant product and backend docs, then the owning service and its tests. The documented reading order is listed in `docs/README.md`. Note that older ADR/execution documents may conflict with current canonical Vietnam-time/server-authoritative rules; prefer current source, `docs/02-technical-requirements.md`, `docs/03-product-flows.md`, `docs/05-backend-structure.md`, and the root README when conflicts appear.
