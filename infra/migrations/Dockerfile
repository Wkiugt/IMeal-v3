FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
RUN apk add --no-cache bash openssl postgresql-client
RUN corepack enable && corepack prepare yarn@4.18.0 --activate

FROM base AS builder
WORKDIR /app
COPY . .
RUN yarn install --immutable

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/yarn.lock ./yarn.lock
COPY --from=builder /app/.yarnrc.yml ./.yarnrc.yml
COPY --from=builder /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=builder /app/packages/domain/prisma ./packages/domain/prisma
COPY --from=builder /app/packages/domain/prisma.config.ts ./packages/domain/prisma.config.ts
COPY --from=builder /app/infra/migrations/production-gate.sh ./infra/migrations/production-gate.sh
COPY --from=builder /app/packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/preflight.sql ./infra/migrations/sql/preflight.sql
COPY --from=builder /app/packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/backfill.sql ./infra/migrations/sql/backfill.sql
RUN rm -rf /usr/local/lib/node_modules/npm && rm -f /usr/local/bin/npm /usr/local/bin/npx && sed -i 's/\r$//' ./infra/migrations/production-gate.sh && chmod 0555 ./infra/migrations/production-gate.sh
ENTRYPOINT ["/bin/bash", "/app/infra/migrations/production-gate.sh"]
