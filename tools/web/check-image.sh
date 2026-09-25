#!/usr/bin/env bash
set -euo pipefail
image=${1:?image required}
test "$(docker image inspect --format '{{.Config.User}}' "$image")" = '10001:10001'
test "$(docker image inspect --format '{{json .Config.Entrypoint}}' "$image")" = '["node"]'
test "$(docker image inspect --format '{{.Architecture}}' "$image")" = amd64
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges "$image" -e '
const fs = require("node:fs");
if (process.getuid() !== 10001 || process.env.NODE_ENV !== "production") process.exit(1);
for (const p of ["/app/.git", "/app/apps/web/src", "/app/apps/web/test", "/app/apps/web/.next-qa"]) if (fs.existsSync(p)) throw Error(p);
try { fs.writeFileSync("/app/write-probe", "must fail"); process.exit(1); } catch (e) { if (e.code !== "EROFS" && e.code !== "EACCES") throw e; }
'
id=''
cleanup() { if test -n "$id"; then docker rm -f "$id" >/dev/null; fi; }
trap cleanup EXIT
key_digest() {
  docker exec "$id" node -e '
const fs = require("node:fs");
const crypto = require("node:crypto");
const file = ".next/cache/rogichat-runtime/prerender-manifest.json";
if ((fs.statSync(file).mode & 0o777) !== 0o600 || (fs.statSync(".next/cache/rogichat-runtime").mode & 0o777) !== 0o700) throw Error("Unsafe key permissions");
const manifest = JSON.parse(fs.readFileSync(".next/prerender-manifest.json"));
if (Object.keys(manifest.preview).length !== 3) throw Error("Missing runtime keys");
if (Object.values(manifest.preview).some(key => typeof key !== "string" || key.length < 32)) throw Error("Missing runtime keys");
if (Object.keys(JSON.parse(fs.readFileSync(".next/prerender-manifest.template.json")).preview).length) throw Error("Image template contains keys");
if (Object.hasOwn(JSON.parse(fs.readFileSync(".next/server/server-reference-manifest.json")), "encryptionKey")) throw Error("Unused action key shipped");
console.log(crypto.createHash("sha256").update(JSON.stringify(manifest.preview)).digest("hex"));
'
}
for environment in qa production; do
  api_origin=https://api.qa.rogi.chat
  if test "$environment" = production; then api_origin=https://api.rogi.chat; fi
  room_env=()
  if test "$environment" = production; then room_env=(-e ROGICHAT_DEFAULT_ROOM_ID=); fi
  id=$(docker run -d --read-only --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16777216 \
    --tmpfs /app/apps/web/.next/cache:rw,noexec,nosuid,nodev,size=67108864,uid=10001,gid=10001 \
    --memory 512m --pids-limit 128 -p 127.0.0.1::3000 \
    -e NODE_ENV=production -e "ROGICHAT_WEB_ENV=$environment" -e "ROGICHAT_API_ORIGIN=$api_origin" "${room_env[@]}" "$image")
  port=$(docker port "$id" 3000/tcp | cut -d: -f2)
  if ! node tools/web/check-runtime.mjs "http://127.0.0.1:$port" "$environment"; then docker logs "$id"; exit 1; fi
  before_restart=$(key_digest)
  [[ "$before_restart" =~ ^[a-f0-9]{64}$ ]]
  docker restart --time 15 "$id" >/dev/null
  # Docker may allocate a new ephemeral host port when restarting the container.
  port=$(docker port "$id" 3000/tcp | cut -d: -f2)
  if ! node tools/web/check-runtime.mjs "http://127.0.0.1:$port" "$environment"; then
    docker inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}' "$id"
    docker logs --tail 20 "$id"
    exit 1
  fi
  after_restart=$(key_digest)
  [[ "$after_restart" =~ ^[a-f0-9]{64}$ ]]
  test "$before_restart" != "$after_restart"
  docker stop --time 15 "$id" >/dev/null
  # Next 16.3.5 drains connections, then deliberately exits 128 + SIGTERM.
  exit_code=$(docker inspect --format '{{.State.ExitCode}}' "$id")
  printf 'Next SIGTERM exit code: %s\n' "$exit_code"
  test "$exit_code" = 143
  test "$(docker inspect --format '{{.State.OOMKilled}}' "$id")" = false
  docker rm "$id" >/dev/null
  id=''
done
# A healthy process with mismatched/missing configuration must not be deployable.
for invalid_case in mismatch missing invalid-room; do
  invalid_env=(-e ROGICHAT_WEB_ENV=qa)
  if test "$invalid_case" = mismatch; then invalid_env+=(-e ROGICHAT_API_ORIGIN=https://api.rogi.chat); fi
  if test "$invalid_case" = invalid-room; then invalid_env+=(-e ROGICHAT_API_ORIGIN=https://api.qa.rogi.chat -e ROGICHAT_DEFAULT_ROOM_ID=invalid); fi
  id=$(docker run -d --read-only --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16777216 \
    --tmpfs /app/apps/web/.next/cache:rw,noexec,nosuid,nodev,size=67108864,uid=10001,gid=10001 \
    --memory 512m --pids-limit 128 -p 127.0.0.1::3000 "${invalid_env[@]}" "$image")
  port=$(docker port "$id" 3000/tcp | cut -d: -f2)
  node tools/web/check-invalid-runtime.mjs "http://127.0.0.1:$port"
  docker rm -f "$id" >/dev/null
  id=''
done
