# Web runtime and publication

The web app has one `NODE_ENV=production` Next.js standalone build. QA and
production run the same immutable `ghcr.io/h66rogi/rogichat-web@sha256:…` digest.
There is no QA build shape, preview route, synthetic fixture or web `/v1` proxy.

| Runtime setting | QA | Production |
| --- | --- | --- |
| `NODE_ENV` | `production` | `production` |
| `ROGICHAT_WEB_ENV` | `qa` | `production` |
| `ROGICHAT_API_ORIGIN` | `https://api.qa.rogi.chat` | `https://api.rogi.chat` |
| Public web origin | `https://qa.rogi.chat` | `https://rogi.chat` |

The server validates the exact environment/API-origin pair at request time and
renders public configuration into the page, following the [Next.js self-hosting guidance](https://nextjs.org/docs/app/guides/self-hosting). No `NEXT_PUBLIC` build-time origin
or request Host header selects an API origin. Browser requests go directly to
the API with `credentials: include`; the API owns host-only cookies, explicit
credentialed CORS and CSRF protection. Invalid runtime configuration fails closed.

`ROGICHAT_DEFAULT_ROOM_ID` is optional; absent or empty means no configured room.
A nonempty value must be a valid UUID. It
selects a real API-authorized room, never a synthetic fallback. Leaving it unset
keeps the app usable without inventing a room list.

## Container contract

Build from the repository root using `apps/web/Dockerfile`. Node 24.21.0 and
pnpm 12.4.2 are pinned; both base images and GitHub Actions are digest/SHA pinned.
The final image contains traced standalone files, static assets and public files.
It runs as `10001:10001`, listens on `0.0.0.0:3000` and supports a read-only root.
Mount `/tmp` and `/app/apps/web/.next/cache` as bounded tmpfs; the cache mount must
be writable by UID/GID 10001. Drop all capabilities and enable no-new-privileges.
`GET /healthz` is unauthenticated, returns minimal JSON with HTTP 200, and checks
runtime configuration without requiring an authenticated API session.

`tools/web/check-image.sh IMAGE` verifies nonroot identity, read-only filesystem,
health, server-rendered API origin, Host header isolation, absent preview/API-proxy
routes and clean SIGTERM exit for both runtime configurations of the same image.
The production build gate scans route manifests and application artifacts for
preview/fixture content; the all-layer scanner independently checks image layers
and metadata for prohibited material, failing closed.

## Verification and publication

`web.yml` preserves the `Web required checks` context. Changed web/build/security
inputs require lint, typecheck, unit tests, one production build, production
artifact isolation, desktop/mobile browser tests, and container/runtime/all-layer
security checks. Public PR jobs use GitHub-hosted runners and no cloud or registry
credentials. Existing backend, security, mobile and infrastructure contexts remain.

`web-publish.yml` runs only on a trusted QA push in `h66rogi/rogichat`. Before
building, it waits for successful **push** runs of `web.yml`, `backend.yml`,
`security.yml`, `infrastructure.yml` and `mobile.yml` matching the exact QA commit
and repository. Failed, missing or timed-out checks block publication. It checks
out that exact SHA and builds, tests and scans before registry authentication.
It publishes only the checked image ID, resolves its immutable repository digest,
then pulls that digest and compares the image ID again.

The workflow summary and `web-publication-proof-<SHA>-<attempt>` artifact record
source SHA, checked image ID, immutable digest, architecture, verification run
IDs/attempts/URLs and publication run URL. Treat proof artifacts as evidence for
review: they never trigger deployment. Verify the trusted workflow run and its
exact commit before accepting proof; a downloaded JSON file alone is not authority.

## Promotion and operational ownership

A separately reviewed production change must reference the QA-verified digest
unchanged and set the production runtime pair. Do not rebuild or resolve a mutable
QA tag during promotion. Confirm successful publication and verification runs,
match the digest and OCI revision, and retain the previous known-good digest and
its runtime configuration for rollback.

Infrastructure owns host placement, separate web networking, Caddy, DNS and TLS.
Publication does not establish deployment. Before reporting a rollout complete,
verify the running image digest, container health/restarts, public web route,
rendered runtime origin and real credentialed API behavior for that environment.
