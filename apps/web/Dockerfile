# Build from the repository root. Produces the production web image only: ROGICHAT_WEB_ENV is never
# set to qa here, so the preview routes and fixtures are not registered and cannot be bundled.
# Docker Hub official node manifest-list digests verified 2026-09-20 (same as apps/api/Dockerfile).
FROM node:24.21.0-bookworm@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4 AS tooling
WORKDIR /workspace
RUN npm install --global pnpm@12.4.2 --ignore-scripts && npm cache clean --force
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json

FROM tooling AS build
# Only the web importer and its dependency closure; the API graph never enters this image.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter '@rogichat/web...'
COPY apps/web ./apps/web
# Belt and braces: preview sources are excluded from the production route set by next.config.ts, and
# they are removed from the build context as well so no copy of them can exist in this image.
RUN rm -rf apps/web/src/preview && find apps/web/src -name '*.preview.tsx' -delete
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @rogichat/web build

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime
RUN groupadd --gid 10001 rogichat && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin rogichat
WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# Standalone output traced from the monorepo root: /app mirrors /workspace.
COPY --from=build --chown=10001:10001 /workspace/apps/web/.next/standalone /app
COPY --from=build --chown=10001:10001 /workspace/apps/web/.next/static ./.next/static
COPY --from=build --chown=10001:10001 /workspace/apps/web/public ./public
USER 10001:10001
EXPOSE 3000
STOPSIGNAL SIGTERM
ENTRYPOINT ["node"]
CMD ["server.js"]
