FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS builder
RUN corepack enable && corepack prepare yarn@4.18.0 --activate
WORKDIR /app
COPY . .
RUN yarn install --immutable
RUN yarn turbo run build --filter=@imeal/admin-web...

FROM nginx:1.30-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94 AS runner
COPY apps/admin-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/admin-web/dist /usr/share/nginx/html
RUN apk add --no-cache --upgrade libexpat pcre2 libcap && setcap 'cap_net_bind_service=+ep' /usr/sbin/nginx && apk del libcap && sed -i 's|^pid .*|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx/conf.d
USER nginx
EXPOSE 80
