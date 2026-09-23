# QA media activation

The QA release request selects `features: ["media"]` only with a version-2
backend export containing the immutable runtime, migration and decoder images.
The reviewed release helper verifies all three image identities, stages the
source-hashed `infrastructure/runtime/compose.media.yaml`, and starts the
decoder before the worker and API. A release without the feature uses the
existing two-image archive and an empty feature overlay.

Before preparing a media release, provision a **Rogichat QA** R2 bucket and a
bucket-scoped credential outside Git. The host file `/etc/rogichat/media.json`
must be root-owned, group 10001, mode 0440, and contain exactly `accountId`,
`bucket`, `accessKeyId`, and `secretAccessKey`. The helper checks shape and
custody before draining the API edge. It never stages the credential. The API
and worker mount it read-only; the decoder receives no secret or network.

The decoder shares only a Unix socket volume with the worker. The worker mounts
that volume read-only. Each API/worker scratch directory and the decoder's
private `/tmp` are bounded tmpfs mounts. The release health gate checks that
all three roles run the approved image identities, that the decoder has no
network, and that the intended secret/socket mounts are present.

The web runtime also needs the exact R2 origin in
`ROGICHAT_MEDIA_STORAGE_ORIGINS` for signed multipart MR uploads, and the R2
bucket needs a CORS policy allowing the QA web origin and the required upload
methods/headers. Neither value is inferred from a signed URL. Activate the web
binding and verify the bucket policy before claiming browser uploads work.

After activation, test an owner-authenticated wardrobe image, song sheet and
MR multipart upload from QA, then verify media retrieval and deletion. Use new
disposable QA fixtures; do not copy Meloming channel content.
