FROM node:20-alpine AS base
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare yarn@4.18.0 --activate

FROM base AS builder
WORKDIR /app
COPY . .
RUN yarn install --immutable
RUN yarn workspace @imeal/core prisma generate
RUN yarn turbo run build --filter=@imeal/worker...

FROM builder AS runner
WORKDIR /app/apps/worker
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/main"]