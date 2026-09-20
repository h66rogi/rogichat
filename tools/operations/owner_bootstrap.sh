#!/bin/sh
# INFRA-only manual helper. Never called by deployment, API or login hooks.
set -eu
[ "$#" -eq 0 ] || exit 64
[ "$(id -u)" -eq 0 ] || exit 77
case "${BOOTSTRAP_ENVIRONMENT:-}" in qa|production) ;; *) exit 64 ;; esac
# Image reference and network are operational metadata, never secret payloads.
printf '%s' "${BOOTSTRAP_IMAGE:-}" | LC_ALL=C grep -Eq '^[a-z0-9][a-zA-Z0-9./:_-]*@sha256:[a-f0-9]{64}$' || exit 64
printf '%s' "${BOOTSTRAP_NETWORK:-}" | LC_ALL=C grep -Eq '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$' || exit 64
case "$BOOTSTRAP_NETWORK" in host|none) exit 64 ;; esac
# Fixed root-custody directory: private data is never accepted on argv or env.
python3 - <<'PY'
import os, stat
root = '/run/rogichat-owner-bootstrap'
s = os.lstat(root)
assert stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and stat.S_IMODE(s.st_mode) == 0o700
for name in ('request.json', 'database.json', 'auth.json', 'ca.pem'):
    s = os.lstat(root + '/' + name)
    assert stat.S_ISREG(s.st_mode) and s.st_uid == 0 and stat.S_IMODE(s.st_mode) == 0o600
PY
# Root inside an unprivileged, read-only container can read root-owned 0600 files.
# No Docker socket, host namespace, capabilities, ports, restart or implicit pull.
exec docker run --rm --pull=never --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --user 0:0 --pids-limit 64 --memory 256m --cpus 1 --log-driver none \
  --network "$BOOTSTRAP_NETWORK" \
  --mount type=bind,src=/run/rogichat-owner-bootstrap,dst=/run/owner-bootstrap,readonly \
  --env "APP_ENV=$BOOTSTRAP_ENVIRONMENT" --env NODE_ENV=production --env DB_POOL_SIZE=1 \
  --env DATABASE_SECRET_FILE=/run/owner-bootstrap/database.json \
  --env AUTH_SECRET_FILE=/run/owner-bootstrap/auth.json --env DB_CA_FILE=/run/owner-bootstrap/ca.pem \
  --entrypoint /bin/sh "$BOOTSTRAP_IMAGE" -c \
  'exec node /app/apps/api/dist/modules/owner-bootstrap/owner-bootstrap.command.js < /run/owner-bootstrap/request.json'
