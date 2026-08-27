# SkinTune — single-service deployment image (Render "Docker" web service).
#
# This builds the whole pnpm workspace once, then runs ONLY the API server
# (artifacts/api-server), which serves the built SkinTune frontend
# (artifacts/skintune/dist/public) as static files and answers /api/* itself.
# One container, one port, one Render web service.
#
# Render's Docker runtime provides $PORT at runtime; this image reads it the
# same way the api-server always has (see artifacts/api-server/src/index.ts).

FROM node:24-slim AS base
WORKDIR /workspace
RUN corepack enable

# ---- deps: install the full workspace once, cached by lockfile ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY artifacts/api-server/package.json artifacts/api-server/package.json
COPY artifacts/skintune/package.json artifacts/skintune/package.json
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/package.json
COPY lib/api-client-react/package.json lib/api-client-react/package.json
COPY lib/api-spec/package.json lib/api-spec/package.json
COPY lib/api-zod/package.json lib/api-zod/package.json
COPY lib/db/package.json lib/db/package.json
COPY scripts/package.json scripts/package.json
RUN pnpm install --frozen-lockfile

# ---- build: full source, build the frontend then the API server ----
FROM deps AS build
COPY . .
# Vite needs PORT/BASE_PATH at build time only to resolve its dev-server
# config path (see artifacts/skintune/vite.config.ts) — the values below are
# build-time only and unrelated to the runtime $PORT Render injects later.
ENV PORT=5173
ENV BASE_PATH=/
RUN pnpm --filter @workspace/skintune run build
RUN pnpm --filter @workspace/api-server run build

# ---- runtime: only what the API server needs to run ----
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Bundled, self-contained server output (esbuild produced a single .mjs).
COPY --from=build /workspace/artifacts/api-server/dist ./dist
# Frontend production build, served as static files by the API server.
COPY --from=build /workspace/artifacts/skintune/dist/public ./public

ENV STATIC_DIR=/app/public
# Render's Docker runtime sets $PORT itself and routes to whatever value it
# is at container start; the app reads process.env.PORT (see
# artifacts/api-server/src/index.ts) so no fixed port needs to be baked in
# here. EXPOSE is documentation only — Render does not require it.
EXPOSE 10000
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
