# syntax=docker/dockerfile:1.7
# Build a partir da raiz do monorepo: docker build -f apps/api/Dockerfile .

ARG NODE_IMAGE=node:26-alpine

# Manifests de todos os workspaces: o npm ci precisa deles para resolver o lockfile.
FROM ${NODE_IMAGE} AS manifests
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/connectors/package.json packages/connectors/
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/

# Dependências de produção apenas dos workspaces da API
FROM manifests AS deps
RUN npm ci --omit=dev --workspace @fns/core --workspace @fns/connectors --workspace @fns/api

# Compilação TypeScript
FROM manifests AS build
RUN npm ci --workspace @fns/core --workspace @fns/connectors --workspace @fns/api --include-workspace-root
COPY packages/core packages/core
COPY packages/connectors packages/connectors
COPY apps/api apps/api
RUN npm run build -w @fns/core && npm run build -w @fns/connectors && npm run build -w @fns/api

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/packages/core/package.json ./packages/core/package.json
COPY --from=build /repo/packages/core/dist ./packages/core/dist
COPY --from=build /repo/packages/connectors/package.json ./packages/connectors/package.json
COPY --from=build /repo/packages/connectors/dist ./packages/connectors/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
# Exports montados em /data quando SOURCES inclui "files"
ENV DATA_DIR=/data
USER node
EXPOSE 3333
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3333/health/ready || exit 1
CMD ["node", "apps/api/dist/server.js"]
