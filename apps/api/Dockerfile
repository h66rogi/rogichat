# Build from the repository root. The default/final target is runtime, never a migrator.
# Docker Hub official node manifest-list digests verified 2026-09-20.
FROM node:24.21.0-bookworm@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4 AS tooling
WORKDIR /workspace
RUN npm install --global pnpm@12.4.2 --ignore-scripts && npm cache clean --force
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/migration/package.json ./apps/migration/package.json
COPY patches ./patches

FROM tooling AS build
# Compilation does not require Prisma engine installation scripts.
# Registry version metadata is build cache, not a migration/runtime dependency. Remove it
# in the creating layer so unused registry metadata is not retained in image history.
# Axios's top-level UMD browser bundle is outside its Node exports and triggers
# a generic-key false positive; keep the Node entrypoint and remove only that file.
RUN --mount=type=cache,id=rogichat-pnpm-v12,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm --filter @rogichat/api... install --frozen-lockfile --ignore-scripts \
    && rm -f node_modules/.pnpm/web-push@3.6.7*/node_modules/web-push/README.md \
    && rm -f node_modules/.pnpm/axios@1.15.0*/node_modules/axios/dist/axios.js \
    && rm -rf /root/.cache/pnpm
COPY apps/api ./apps/api
RUN pnpm --filter @rogichat/api build

FROM tooling AS production-dependencies
# The pinned package README embeds example subscription secrets. It is not a
# runtime input; omit it and the download store in the install layer while
# retaining the hard-linked runtime source and license in node_modules.
RUN --mount=type=cache,id=rogichat-pnpm-v12,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm --filter @rogichat/api... install --prod --frozen-lockfile --ignore-scripts \
    && rm -f node_modules/.pnpm/web-push@3.6.7*/node_modules/web-push/README.md \
    && rm -f node_modules/.pnpm/axios@1.15.0*/node_modules/axios/dist/axios.js \
    && rm -rf /root/.cache/pnpm

FROM tooling AS migration-dependencies
RUN --mount=type=cache,id=rogichat-pnpm-v12,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm --filter @rogichat/migration... install --frozen-lockfile --ignore-scripts \
    && rm -rf /root/.cache/pnpm

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS migration
# Keep only the migration CLI, driver and schema; the API build tree is not an input.
# Prisma's engine downloader needs OpenSSL version detection on the slim base.
RUN rm -f /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources \
    && printf '%s\n' \
      'deb [check-valid-until=no signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] http://snapshot.debian.org/archive/debian/20260920T000000Z bookworm main' \
      'deb [check-valid-until=no signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] http://snapshot.debian.org/archive/debian-security/20260920T000000Z bookworm-security main' \
      > /etc/apt/sources.list.d/migration.list \
    && apt-get update \
    && apt-get install --no-install-recommends --yes openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=migration-dependencies /workspace/node_modules /workspace/node_modules
COPY --from=migration-dependencies /workspace/apps/migration/node_modules /workspace/apps/api/node_modules
COPY apps/api/package.json apps/api/prisma.config.ts /workspace/apps/api/
COPY apps/api/prisma /workspace/apps/api/prisma
# Download the exact reviewed schema engine, failing the build on any error.
RUN node -e "const path=require('node:path');const prisma=require.resolve('prisma/package.json',{paths:['/workspace/apps/api']});const dir=path.dirname(require.resolve('@prisma/engines/package.json',{paths:[prisma]}));const fetch=require(require.resolve('@prisma/fetch-engine',{paths:[dir]}));const version=require(require.resolve('@prisma/engines-version',{paths:[dir]})).enginesVersion;fetch.download({binaries:{[fetch.BinaryType.SchemaEngineBinary]:dir},version,binaryTargets:['debian-openssl-3.0.x'],showProgress:false,failSilent:false}).catch(e=>{console.error(e);process.exit(1)})"
RUN groupadd --gid 10001 rogichat && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin rogichat
WORKDIR /workspace/apps/api
ENV NODE_ENV=production
USER 10001:10001
ENTRYPOINT ["node"]
# This target must not apply migrations merely because somebody starts it.
# An approved job supplies the CLI path/arguments after reading its separate secret.
CMD ["--version"]

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime-base
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

# Decoder uses the same pinned Node base, lockfile and native sharp dependency tree.
# Snapshot pins ffmpeg and every transitive apt dependency; apt signature checks stay on.
FROM runtime-base AS decoder
USER root
RUN rm -f /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources \
    && printf '%s\n' \
      'deb [check-valid-until=no signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] http://snapshot.debian.org/archive/debian/20260920T000000Z bookworm main' \
      'deb [check-valid-until=no signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] http://snapshot.debian.org/archive/debian-security/20260920T000000Z bookworm-security main' \
      > /etc/apt/sources.list.d/decoder.list \
    && apt-get update \
    && apt-get install --no-install-recommends --yes ffmpeg=7:5.1.9-0+deb12u1 \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o 10001 -g 10001 -m 0700 /run/decoder
USER 10001:10001
CMD ["dist/media-decoder-main.js"]

# Keep the default build target and runtime artifact unchanged.
FROM runtime-base AS runtime
