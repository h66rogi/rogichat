# Build once from the repository root; promote the same digest across environments.
FROM node:24.21.0-bookworm@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4 AS build
WORKDIR /workspace
RUN npm install --global pnpm@12.4.2 --ignore-scripts && npm cache clean --force
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
# Workspace policy includes the reviewed MariaDB patch, even for a filtered web install.
COPY apps/api/package.json ./apps/api/package.json
COPY patches ./patches
RUN --mount=type=cache,id=rogichat-pnpm-v12,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm --filter @rogichat/web... install --frozen-lockfile --ignore-scripts \
    && rm -rf /root/.cache/pnpm
COPY apps/web ./apps/web
COPY tools/web/check-production.mjs tools/web/prepare-runtime.mjs tools/web/runtime-server.mjs ./tools/web/
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @rogichat/web build && node tools/web/check-production.mjs \
    && node tools/web/prepare-runtime.mjs \
    && mkdir -p apps/web/.next/standalone/apps/web/.next/cache

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:7924c53f56526359d0f491c22517306d8d92f1b285656a6094398e2c55bbaeca AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 PATH=/nodejs/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
COPY --from=build /workspace/apps/web/.next/standalone ./
COPY --from=build /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /workspace/apps/web/public ./apps/web/public
WORKDIR /app/apps/web
USER 10001:10001
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["node"]
CMD ["server.js"]
