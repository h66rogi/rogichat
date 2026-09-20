# Web runtime: QA and production

Both environments run the same production-built immutable `rogichat-web` image.
QA is a real service with its own API and account data. Preview routes, fake data
and build-time environment-specific bundles are not deployment artifacts.

Compose the base `compose.yaml` with exactly one environment overlay:
`compose.qa.yaml` or `compose.prod.yaml`. Set `ROGICHAT_WEB_IMAGE` to the approved
`ghcr.io/h66rogi/rogichat-web@sha256:...` digest. The release helper validates the
image identity and source; Compose configuration alone is not authorization.

The application uses port 3000, UID/GID 10001, read-only root, bounded tmpfs/cache,
no host port, no secrets or Docker socket. `/healthz` checks the web process;
authentication and actual API flows are separate acceptance checks. Runtime pairs:

| Environment | Web | API | ROGICHAT_WEB_ENV |
| --- | --- | --- | --- |
| QA | https://qa.rogi.chat | https://api.qa.rogi.chat | qa |
| Production | https://rogi.chat | https://api.rogi.chat | production |

`ROGICHAT_API_ORIGIN` is the exact API URL in this table. The web process validates
the pair at runtime. There is no same-origin API proxy or cookie-domain rewriting;
browsers use the existing host-only API cookie with credentials and explicit CORS.

## Edge integration

The web network contains only Caddy and the web container. Never attach web to
the API's default network: the backend's trust-proxy boundary assumes only Caddy
and the API are permanent peers there.

Keep the existing Caddy project and certificate/config volumes. Merge its reviewed
bootstrap Compose file with `edge.qa.yaml` or `edge.prod.yaml`, after creating the
matching web network. The overlay mounts `/opt/rogichat/web/sites` read-only into
`/etc/caddy/sites`; the main Caddyfile imports `*.caddy` from that directory.
Install only the matching reviewed web site as `web.caddy`. Do not add a duplicate
apex host in production's main Caddyfile. Existing Caddy imports must also survive
future backend template updates and rollback.

Initial edge attachment requires Caddy container recreation while preserving all
volumes and the existing API network. It is a separately serialized commissioning
step, not a hidden side effect of publishing an image. All deployment operations
share `/run/lock/rogichat-deploy.lock`; reject drift in the current Caddyfile hash.

Validate and start the real web process before DNS publication. Check exact image,
container health, network membership, HTTPS certificate/hostname, `/healthz`, root
page, real signed-out/empty/error states and `/preview` returning 404. DNS-only web
records are owned by their environment's Terraform state. Never report edge health
alone as successful application deployment.
