# Image publication boundary

The publisher scans both locally built Docker-save streams **before GHCR login**.
The export workflow scans both saved images again **before public artifact upload**.
Neither scan runs an image or receives a cloud/runtime credential. A parse error,
missing/wrong scanner, unsupported compression, limit breach or unreviewed finding
blocks publication. No raw finding or archive-controlled name reaches CI output.

The scanner checks every layer separately, so a later deletion/whiteout cannot
hide a lower-layer secret. It includes config/environment/history, filenames,
links and PAX metadata, verifies OCI blob and rootfs digests, and rejects unexpected
trailing payloads. Image content never becomes a filesystem extraction path.
ZIP, tar, gzip, bzip2, xz and ar/deb contents are recursively scanned. Unsupported
RAR, 7z, zstd, LZ4 and Unix compress payloads fail closed. Archive decoding is bounded
to 5 levels, 256 MiB per expanded file, 2 GiB per layer, 8 GiB expanded content and
250,000 entries. Exceeding a limit requires a reviewed tooling change, not skipping
that file. Gitleaks decoding is bounded to 10 levels; no finite scanner establishes
that arbitrary obfuscation is secret-free.

`image_fixtures.json` is a reviewed list of exact public file SHA-256 values (or explicitly identified canonical name-metadata bytes)
and specific detector rules. It does **not** exclude a path, package directory or
base layer. Changing even one byte of the checked input removes the exception. A dependency upgrade
may therefore need a reviewed fixture refresh: compare the full bytes against the
pinned official image or integrity-verified upstream package, inspect the finding
privately, and record its provenance and narrow rule. Never automatically convert
scan findings into exceptions. No credential material belongs in this manifest.
GnuTLS's public cryptographic self-test keys are checked against upstream source;
they do not authorize exemptions for other keys or another version of the binary.

Run `python3 tools/security/install.py` and then pipe `docker image save IMAGE`
to `python3 tools/security/image_scan.py -`. For private troubleshooting, add
`--report /a/private/directory/image-review.json`; this creates a new mode-0600 file
outside the checkout containing only content hashes and rule identifiers. Never
upload diagnostics or failed images as public artifacts. Run
`python3 tools/security/test_image_scan.py` to exercise real scanner failures and
the normal no-credential image path. The source-security gate remains independent.
