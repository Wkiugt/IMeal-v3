FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS base
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare yarn@4.18.0 --activate

FROM base AS builder
WORKDIR /app
COPY . .
RUN yarn install --immutable
RUN yarn workspace @imeal/core prisma generate
RUN yarn turbo run build --filter=@imeal/api...

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/observability/package.json ./packages/observability/package.json
COPY --from=builder /app/packages/observability/dist ./packages/observability/dist
USER node
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/main"]