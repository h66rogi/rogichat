# Build from the repository root. The default/final target is runtime, never a migrator.
# Docker Hub official node manifest-list digests verified 2026-09-20.
FROM node:24.21.0-bookworm@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4 AS tooling
WORKDIR /workspace
RUN npm install --global pnpm@12.4.2 --ignore-scripts && npm cache clean --force
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY patches ./patches

FROM tooling AS build
# Compilation does not require Prisma engine installation scripts.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY apps/api ./apps/api
RUN pnpm --filter @rogichat/api build

FROM tooling AS production-dependencies
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM build AS migration
# Prisma CLI/engine are confined to this explicitly selected image target.
# Run only the reviewed pinned engine installation, without any database input.
RUN node -e "const path=require('node:path'); const pkg=require.resolve('@prisma/engines/package.json',{paths:[require.resolve('prisma/package.json',{paths:['/workspace/apps/api']})]}); require(path.join(path.dirname(pkg),'scripts/postinstall.js'))"
RUN groupadd --gid 10001 rogichat && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin rogichat
WORKDIR /workspace/apps/api
ENV NODE_ENV=production
USER 10001:10001
ENTRYPOINT ["node"]
# This target must not apply migrations merely because somebody starts it.
# An approved job supplies the CLI path/arguments after reading its separate secret.
CMD ["--version"]

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime
RUN groupadd --gid 10001 rogichat && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin rogichat
WORKDIR /app/apps/api
ENV NODE_ENV=production
COPY --from=production-dependencies /workspace/node_modules /app/node_modules
COPY --from=production-dependencies /workspace/apps/api/node_modules ./node_modules
COPY --from=build /workspace/apps/api/package.json ./package.json
COPY --from=build /workspace/apps/api/dist ./dist
USER 10001:10001
EXPOSE 3000
STOPSIGNAL SIGTERM
ENTRYPOINT ["node"]
CMD ["dist/main.js"]
