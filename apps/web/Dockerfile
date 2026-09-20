# Build once from the repository root; promote the same digest across environments.
FROM node:24.21.0-bookworm@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4 AS build
WORKDIR /workspace
RUN npm install --global pnpm@12.4.2 --ignore-scripts && npm cache clean --force
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
# Workspace policy includes the reviewed MariaDB patch, even for a filtered web install.
COPY apps/api/package.json ./apps/api/package.json
COPY patches ./patches
RUN pnpm --filter @rogichat/web... install --frozen-lockfile --ignore-scripts \
    && rm -rf /root/.cache/pnpm
COPY apps/web ./apps/web
COPY tools/web/check-production.mjs tools/web/prepare-runtime.mjs tools/web/runtime-server.mjs ./tools/web/
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @rogichat/web build && node tools/web/check-production.mjs \
    && node tools/web/prepare-runtime.mjs

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime
RUN groupadd --gid 10001 rogichat && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin rogichat
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build /workspace/apps/web/.next/standalone ./
COPY --from=build /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /workspace/apps/web/public ./apps/web/public
RUN mkdir -p /app/apps/web/.next/cache && chown 10001:10001 /app/apps/web/.next/cache
WORKDIR /app/apps/web
USER 10001:10001
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node"]
CMD ["server.js"]
