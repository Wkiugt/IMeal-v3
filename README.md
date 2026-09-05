# IMeal v2 Monorepo

IMeal v2 is a Yarn workspace managed with Turborepo.

- `apps/mobile`: React Native and Expo client
- `apps/api`: NestJS Fastify API
- `apps/worker`: scheduled background jobs
- `apps/admin-web`: administration client
- `packages/contracts`: shared versioned API schemas
- `packages/domain`: Prisma schema and domain services

Install and validate the workspace:

```bash
corepack enable
corepack prepare yarn@4.18.0 --activate
yarn install --immutable
yarn typecheck
yarn test:unit
yarn build
```

For database-backed tests, start PostgreSQL, set `DATABASE_URL`, then run
`yarn test:db`. The test harness applies production migrations to an isolated,
disposable schema for each suite.

For the local deployment stack, copy `.env.example` to `.env`, replace every
Entra and signing placeholder, then run `docker compose up --build`.
