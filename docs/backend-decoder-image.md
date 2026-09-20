# Isolated decoder artifact

The explicit `decoder` Docker target publishes as
`ghcr.io/h66rogi/rogichat-media-decoder@sha256:…`. Its entrypoint is
`node dist/media-decoder-main.js`, working directory `/app/apps/api`, UID/GID
10001. The default Docker target remains the API runtime. Decoding stays in the
separate decoder process graph, never in the API or worker.

The image reuses the digest-pinned Node 24 Bookworm base and locked production
module tree, including sharp 0.35.4 and its native optional dependencies.
FFmpeg/FFprobe come from Debian's signed 2026-09-20 snapshot, pinned to
`7:5.1.9-0+deb12u1`; the snapshot also fixes transitive dependencies. Release
signatures and package hashes remain mandatory; only snapshot expiry checking
is disabled. See [Debian snapshots](https://snapshot.debian.org/),
[APT source policy](https://manpages.debian.org/bookworm/apt/sources.list.5.en.html)
and [sharp installation requirements](https://sharp.pixelplumbing.com/install/).

Run with network none, read-only rootfs, all capabilities dropped,
no-new-privileges, PID limit 128, one CPU and 512 MiB memory. `/tmp` is a private
128 MiB tmpfs with noexec/nosuid/nodev; `/run/decoder` contains only the shared
0600 Unix socket owned by 10001. Only the worker shares that socket directory;
it must not share scratch. The sole decoder-specific environment setting is
`DECODER_ISOLATED=true`. Never provide database, auth or provider environment,
secret mounts, or a Docker socket. Runtime overlays and release activation are
separate reviewed changes; image presence does not enable media.

Hosted PR CI builds the real image without package authentication, runs the
existing native image/video suites with **zero skips**, then verifies its actual
entrypoint through Unix IPC using PNG/JPEG/WebP and H264/AAC MP4 bytes, a real
WebP poster, invalid input rejection, metadata stripping and scratch cleanup.
SIGTERM is tested with an incomplete active IPC request and must exit zero.
Tests are read-only mounts or stdin input and are absent from released layers.
The rotated-video fixture uses MP4 display-matrix metadata supported by the
pinned FFmpeg; all existing orientation/pixel assertions remain intact.

QA publication repeats these checks and scans every layer and image metadata
before registry login. PR concurrency cannot cancel QA publication. No local
Docker, registry publication outside that pipeline, or service credentials are
needed for this verification.

## Archive compatibility

An empty export `decoder_digest` produces legacy descriptor v1 with exactly
runtime and migration. A supplied immutable decoder digest produces v2 with
exactly runtime, migration and decoder. Both versions retain identical top-level
and per-image field shapes. V2 has exactly seven members:

- `descriptor.json`
- `runtime.tar` and `runtime.manifest.json`
- `migration.tar` and `migration.manifest.json`
- `decoder.tar` and `decoder.manifest.json`

Every role binds the fixed registry repository and raw manifest hash to the
config ID, source SHA, archive hash and uncompressed layer identities. Decoder
configuration additionally requires the dedicated command and working directory.
OCI archive-manifest identity remains distinct from config identity; release
requests must explicitly select and bind the appropriate execution identity.
The web importer's isolated `ROLES`/`FILES` overrides retain their v1-only policy.

A reviewed media release uses v2 and explicit decoder image, config and execution
identities. A non-media release uses v1 and no decoder fields. Archive download
writes the decoder config ID for v2; the release owner supplies the separately
verified execution ID, with no automatic fallback. Exporting is not deployment.
