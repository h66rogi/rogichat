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

`ROGICHAT_DEFAULT_ROOM_ID` is optional. An explicit UUID takes precedence; when absent or empty, the web accepts only one server-marked `isDefault: true` room across the directory. Without either binding it shows the unopened state.
A nonempty value must be a valid UUID. It
selects a real API-authorized room, never a synthetic fallback. Leaving it unset
keeps the app usable without inventing a room list.

## Container contract

Build from the repository root using `apps/web/Dockerfile`. Node 24.21.0 and
pnpm 12.4.2 are pinned; both base images and GitHub Actions are digest/SHA pinned.
The final image contains traced standalone files, static assets and public files.
It runs as `10001:10001`, listens on `0.0.0.0:3000` and supports a read-only root.
Mount `/tmp` and `/app/apps/web/.next/cache` as bounded tmpfs; the cache mount must
be writable by UID/GID 10001 and is required for startup. Drop all capabilities and enable no-new-privileges.
`GET /healthz` is unauthenticated, returns minimal JSON with HTTP 200, and checks
runtime configuration without requiring an authenticated API session.

Before the final image copy, runtime preparation removes generated framework
keys and rejects any enabled Server Actions or remaining copies of those keys.
The image carries a keyless prerender template. Startup creates fresh cryptographic
keys atomically in the cache tmpfs, with directory mode 0700 and file mode 0600;
restarts rotate these keys. No fixed keys or generated-key scanner exclusions are
used. Enabling Server Actions requires a separately reviewed runtime key contract.

`tools/web/check-image.sh IMAGE` verifies nonroot identity, read-only filesystem,
health, server-rendered API origin, Host header isolation, absent preview/API-proxy
routes and graceful SIGTERM exit (143, as defined by pinned Next.js) for both runtime
configurations of the same image, including restart key rotation, private file
modes and inaccessible manifest/cache HTTP paths.
The production build gate scans route manifests and application artifacts for
preview/fixture content; the all-layer scanner independently checks image layers
and metadata for prohibited material, failing closed.

The exact `/mobile/auth/complete` fallback returns static HTML with no-store,
no-referrer and a hash-based restrictive CSP; it neither reflects nor exchanges
callback parameters. Legacy `/auth/login` redirects use a relative or exact
configured web origin, never a request Host header. The two `/.well-known/`
association endpoints return reviewed QA identities only in QA and empty valid
associations in production until production identities receive separate review.

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

## Verified archive transport

`web-export.yml` automatically exports successful QA `Web image publication`
workflow runs. The repository default branch is QA: the exporter checks out its
actual `github.sha`, which may be newer than the published source. The source
must be identical to or an ancestor of that exact exporter head. The workflow has
only contents/actions/packages read permissions and performs no deployment.
The manual QA workflow remains available with published source SHA and registry
digest hex inputs; no caller-selected mode is accepted.

Before pulling, the exporter validates the publisher payload against the original
repository's exact run/attempt API, reads a bounded digest-verified publication
proof, and resolves its immutable image/config and five unique CI identities.
Each recorded CI attempt must independently be a successful exact-source QA push
in the original repository and expected workflow path. Historical publisher and
CI attempts are checked using attempt APIs, never replaced with a newer rerun.
Expired proof, failed API calls and digest mismatches fail closed without another
proof or registry fallback. The exporter checks
that the exporter QA commit descends from the source, pulls only the immutable
image, verifies its raw registry manifest and config, and logs out before saving.
The producer and consumer additionally bind the requested digest and config ID
to the successful publication run's exact-attempt proof artifact, verify its
GitHub artifact digest and five exact CI run/attempt identities, and reject proofs created or
replaced after the export attempt began. Descriptor version 1 stays unchanged.
Every exported layer is scanned before a one-day Actions artifact is uploaded.

The `web-<source>-<run>-<attempt>` artifact contains exactly `descriptor.json`,
`runtime.tar`, `runtime.manifest.json` and `publication-proof.zip`. The fourth
member is the original GitHub publication artifact ZIP (at most 1 MiB), fetched
with the producer credential off host and transported without reserialization.
Hosts pass its bounded bytes explicitly as `publication_proof` to provenance
verification; only public metadata is fetched on host, never a proof ZIP or token.
Unattended receivers must pass `required_event="workflow_run"` to
`verify_provenance(descriptor, approval, token=None, *, publication_proof=bytes,
required_event=None)`. This rejects otherwise valid manual exports. Management
helpers omit that keyword and retain both explicitly supported web events;
backend archive defaults remain manual-only. Both paths verify the actual exact
export attempt's event, identity and successful conclusion.
Its original SHA-256 must match immutable GitHub artifact metadata. Missing,
extra or malformed members and old three-member archives fail closed.
Descriptor version 1 identifies the producer SHA/run/attempt, six verification runs, and one `images.runtime` object
with `image`, `config_id` and `archive_sha256`. The raw manifest hash must match
the published digest; its config must match the archive config and every rootfs
layer. OCI archive manifest identity is verified separately from the registry
digest. Loading a Docker archive does not create a registry RepoDigest.

`python3 tools/web/archive.py download --export-sha <sha> --run-id <id> \
--attempt <attempt> --artifact-id <id> --output <new-outside-git-directory>` uses
the operator's existing GitHub CLI session. It verifies the Actions ZIP digest,
trusted producer, artifact identity, CI and ancestry before writing an approval
record. It never loads or deploys the image. The infrastructure-owned release
helper must select and verify the actual host image identity explicitly.
