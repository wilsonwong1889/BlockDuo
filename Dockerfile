# syntax=docker/dockerfile:1

# Debian rather than Alpine on purpose: the room server is a Worker, and running
# it locally means running the real `workerd` binary that `wrangler dev` starts.
# workerd is glibc-only — there is no musl build — so Alpine cannot run it.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV npm_config_update_notifier=false

# Only the manifests, so the install layer is reused until a dependency actually
# changes. Every workspace's package.json has to be here: `npm ci` validates the
# whole workspace tree against the lockfile and fails if one is missing.
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci

# Shared by both dev services. The source arrives as a bind mount at run time,
# so what is baked in here is only the dependency tree and the environment.
FROM deps AS dev
# CI keeps wrangler non-interactive; it has no terminal to prompt at.
ENV CI=1 \
    WRANGLER_SEND_METRICS=false
COPY . .
EXPOSE 5173 8787

FROM deps AS build
COPY . .
# The Worker uploads apps/web/dist as its assets, so the site is built first.
RUN npm run build

# The single-origin preview: one container serving the built site and the rooms
# on one port, the way the deployed Worker does.
FROM deps AS preview
ENV CI=1 \
    WRANGLER_SEND_METRICS=false
COPY . .
COPY --from=build /app/apps/web/dist ./apps/web/dist
WORKDIR /app/apps/server
EXPOSE 8787
CMD ["npx", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787"]
