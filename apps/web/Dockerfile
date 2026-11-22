# syntax=docker/dockerfile:1.7
# Build a partir da raiz do monorepo: docker build -f apps/web/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/connectors/package.json packages/connectors/
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @fns/core --workspace @fns/web --include-workspace-root
# O front só importa tipos do core, mas o compilador precisa das declarações (.d.ts).
COPY packages/core packages/core
RUN npm run build -w @fns/core
COPY apps/web apps/web
RUN npm run build -w @fns/web

FROM nginx:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
