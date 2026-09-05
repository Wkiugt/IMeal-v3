FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare yarn@4.18.0 --activate
WORKDIR /app
COPY . .
RUN yarn install --immutable
ARG VITE_ENTRA_TENANT_ID
ARG VITE_ENTRA_CLIENT_ID
ARG VITE_ENTRA_API_SCOPE
ENV VITE_ENTRA_TENANT_ID=$VITE_ENTRA_TENANT_ID
ENV VITE_ENTRA_CLIENT_ID=$VITE_ENTRA_CLIENT_ID
RUN yarn workspace @imeal/admin-web build

FROM nginx:1.27-alpine AS runner
COPY apps/admin-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/admin-web/dist /usr/share/nginx/html
EXPOSE 80
