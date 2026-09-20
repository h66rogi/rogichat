# First-party auth ingress source

This directory prepares `https://auth.rogi.chat` for the dedicated SOOP **로기챗**
app. It makes no live changes. The external route is production EC2 Caddy with
ACME HTTPS, then HTTP **inside encrypted Tailscale only** to a new dedicated
private Nginx listener on port 8310, then `127.0.0.1:3100`. The private listener
binds a single Tailnet IPv4 address and accepts only the production edge's single
Tailnet source address. Confirm the route-selected source and Tailnet ACL/firewall
before use. No public bind, shared virtual-host edit, or alternate upstream exists.

Only these exact method/path pairs are forwarded (queries are passed to the broker):

| Method | Path |
| --- | --- |
| POST | `/v1/platform/oauth/rogichat/requests` |
| POST | `/v1/platform/oauth/rogichat/exchange` |
| GET | `/v1/platform/oauth/rogichat/authorize` |
| GET | `/v1/platform/oauth/rogichat/callback` |

Other paths, methods, encoded aliases and unexpected hosts return 404. Templates
render 503 on allowed routes by default. The broker owns validated provider and
registered-client redirects; the proxies never construct redirects from request
input, rewrite locations, or choose upstreams from client data. Automatic HTTP
redirects are disabled; ACME remains Caddy-managed. No legacy host, page, branding,
or shared provider client may appear in the auth journey.

## Enablement gate

The central operator must retain private evidence of the **new dedicated app's**
provider display name 로기챗 and exact registered callback
`https://auth.rogi.chat/v1/platform/oauth/rogichat/callback` before enabling DNS or
forwarding. BACKEND separately configures dedicated `ROGICHAT_SOOP_*` bindings
without any fallback to `SOOP_*`. QA and production API broker `baseUrl` both use
`https://auth.rogi.chat`, with distinct broker client ID/secret bindings and each
client's own registered API return URI. Provider app credentials and broker client
credentials are different bindings; none belong in this public repository.

`--enable-proxy` records an operator choice, **not verified provider evidence**.
Until proof and backend readiness exist, omit that flag and retain honest 503s.
Before applying, verify the new port is unused, inspect the complete composed
Nginx/Caddy config and inherited settings, validate it on the real hosts, verify
ACME and the actual user auth route, and confirm no existing site behavior changes.
This standalone Caddy template includes global privacy/timeouts and a 404 fallback:
merge the reviewed policy/site into the existing edge configuration while preserving
its sites, ACME storage and admin requirements; do not replace the entire config.
The Nginx template is an `http`-context fragment with a new server, not a replacement
for the existing process configuration. Existing global request-error logging must
also discard auth request details before headers select a server.

## Private rendering

Use Python 3.9+ and provide private values from the operator environment:

```sh
python3 infrastructure/runtime/auth/render.py \
  --node-tailnet-ip "$ROGICHAT_BROKER_TAILNET_IP" \
  --prod-tailnet-ip "$ROGICHAT_PROD_TAILNET_IP" \
  --output "$ROGICHAT_PRIVATE_RENDER_DIR"
```

The output must be outside this repository; existing files/symlinks are refused,
files use mode 0600 and a new directory uses 0700. Only distinct, single usable
IPv4 addresses in the Tailscale range are accepted, never CIDRs, hostnames, ports
or injected config. Keep rendered files, private bindings and deployment evidence
outside Git and public logs. After proof, add `--enable-proxy` to render into a
fresh private directory. Rendering does not deploy or modify DNS.

Requests are bounded to 16 KiB with finite header/body/upstream timeouts. Nginx
caching/storage and proxy retries are disabled, and both hops force `no-store`.
Host/protocol/forwarding headers are hard-set; Nginx identifies the verified edge
as the client instead of trusting caller IP claims. Authorization and cookies
remain available to the broker. Nginx access logs contain only fixed time, status
and duration fields; Caddy access logs omit the entire request and response headers.
Request error logs are discarded because their free-form messages can contain OAuth
queries, while status/time access logs retain failures. Do not enable debug logging
or add URI/header/body fields. See the upstream [Caddy logging documentation](https://caddyserver.com/docs/caddyfile/directives/log)
and [Nginx logging documentation](https://nginx.org/en/docs/http/ngx_http_log_module.html).

## Local validation

Use the existing checksum-pinned Terraform 1.16.3 and Caddy 2.11.4 installer:

```sh
python3 tools/infrastructure/install.py
.tools/terraform -chdir=infrastructure/environments/prod/cloudflare init -backend=false -input=false -lockfile=readonly
.tools/terraform -chdir=infrastructure/environments/prod/cloudflare validate
.tools/terraform -chdir=infrastructure/environments/prod/cloudflare test -no-color
python3 -m unittest discover -s infrastructure/runtime/auth -p 'test_*.py' -v
```

Proxy tests require Nginx **1.28.3**, default `.tools/nginx/sbin/nginx` or
`NGINX_BINARY`. Official source: `https://nginx.org/download/nginx-1.28.3.tar.gz`,
SHA-256 `2c96a946bfb0882a21744ed429770a2123ae1828c7c48665092993ddee91a918`.
Build the verified archive in ignored local tools with PCRE2 available; no system
service installation is required. Tests refuse other proxy versions and exercise
real local processes with synthetic bindings and isolated test-only broker data.
They adapt/validate Caddy without ACME, and validate/run Nginx using loopback
bindings because Nginx `-t` binds sockets on macOS. No test contacts private hosts.

Existing infrastructure CI picks up the Terraform tests. Proxy tests are explicitly
local here: workflow/tool-installer edits are outside this bounded source change.
A mock Terraform result is not a credentialed plan: when production records already
exist in state, auth enablement must plan exactly one auth A-record create, zero
updates and zero deletes. Deployment and provider verification remain separate.
