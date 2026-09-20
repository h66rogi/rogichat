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
entrypoint through cross-container Unix IPC using a read-only client socket
volume, PNG/JPEG/WebP and H264/AAC MP4 bytes, a real
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

## Exact native-library scanner review

The independent 2026-09-20 security review verified the signed Bookworm
`InRelease` → `Packages.xz` → package → library chain, plus signed `Sources.xz`
and upstream source. Two required shared libraries contain NUL-separated PEM
parser/serializer delimiters, with no private key body. The scanner's printable
normalization joins those literals. Only the following full-file hashes are
permitted for the `private-key` detector; other rules and modified bytes still
fail. No directory, filename, package, layer or global-rule exception is used.

| Library | Exact amd64 file SHA-256 |
| --- | --- |
| libmbedcrypto.so.2.28.3 | `c04f91fdb172e17ddb21c9e0b75c04cb4f802bdfc40bb65484550746cd0019a8` |
| libssh-gcrypt.so.4.9.6 | `6733636aeb1c5d541aa06c578a95d12c2253c4e99fc85623595341905d3d6221` |

Package URLs and exact package checksums are recorded in
`tools/security/image_fixtures.json`. The signed index is the
[Bookworm snapshot InRelease](https://snapshot.debian.org/archive/debian/20260920T000000Z/dists/bookworm/InRelease).
The delimiter definitions are in
[Mbed TLS v2.28.3 pkparse.c](https://github.com/Mbed-TLS/mbedtls/blob/v2.28.3/library/pkparse.c#L1253)
and [libssh 0.10.6 pki_gcrypt.c](https://github.com/libssh/libssh-mirror/blob/libssh-0.10.6/src/pki_gcrypt.c#L46).
Regression tests exercise the real scanner: exact delimiter bytes pass, changed
bytes fail, other secret detectors still fire, and a fresh ephemeral RSA key in
an unrelated image file remains blocked under the complete reviewed policy.

A separate independent review verified two scanner-generated filename objects
for Debian `ldconfig` trigger files. Existing typed `entry-name-metadata` policy
binds their exact JSON bytes and `generic-api-key` rule only:

| Debian package | Exact JSON-object SHA-256 |
| --- | --- |
| libpciaccess0 | `1d30b1380969e545b17dfa215dc1fce099a74f36c384653c17f1618620110e86` |
| libglapi-mesa | `349481123fdd9ad2ddef21a65ec698049e95de201e451bb65e55e07ba1893668` |

Both names use directory `var/lib/dpkg/info`, architecture `amd64` and extension
`triggers`, assembled by the typed policy. These are not exemptions for file
contents. Signed package checksums and URLs
are recorded with the typed entries. Tests require changed names, altered typed
metadata and real secret patterns inside these filenames to remain blocked.
