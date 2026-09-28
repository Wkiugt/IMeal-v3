FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
RUN corepack enable && corepack prepare yarn@4.18.0 --activate
WORKDIR /app
COPY . .
RUN yarn install --immutable
RUN yarn workspace @imeal/admin-web build

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS runner
COPY apps/admin-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/admin-web/dist /usr/share/nginx/html
RUN apk add --no-cache libcap && setcap 'cap_net_bind_service=+ep' /usr/sbin/nginx && apk del libcap && sed -i 's|^pid .*|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx/conf.d
USER nginx
EXPOSE 80
