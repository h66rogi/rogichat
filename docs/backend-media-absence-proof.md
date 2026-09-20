# Bounded media object absence proof

## Contract

`R2MediaStore.remove` resolves only after independent direct-storage read-back
confirms the exact immutable environment/asset/attempt/variant key is absent.
A DELETE acknowledgement alone no longer allows media cleanup to mark object
rows deleted, release reserved quota or complete the cleanup job.

The adapter uses its existing private S3 endpoint, bucket and credentials:

1. Validate the existing key/environment guard before I/O.
2. Send DELETE once. Explicit SDK client errors (HTTP 4xx) and named permission
   denials fail closed. Network failures and server errors can represent a lost
   acknowledgement, so read-back may independently recover those outcomes.
3. HEAD the identical key. A successful HEAD means the object exists. Only an
   installed SDK `S3ServiceException` with HTTP 404 and `NotFound` or `NoSuchKey`
   proceeds; arbitrary thrown objects, missing metadata, permission failures,
   throttling, network failures and server errors do not prove absence.
4. HEAD the configured bucket afresh and require actual SDK HTTP 200 metadata.
   HEAD errors can conflate missing buckets and objects; missing, inaccessible,
   malformed or uncertain bucket responses fail closed. No bucket proof is cached.
5. Check cancellation again before returning.

One 30-second deadline covers all three requests, including signing and transport.
The caller's AbortSignal can terminate it sooner. A promise race bounds the caller
wait even if a transport ignores cancellation; the SDK also receives the composed
signal. Checks between requests stop an abandoned operation from issuing read-back
requests later. SDK retries remain disabled (`maxAttempts: 1`). Timer and listener
cleanup runs on success and failure. Failure exposes only
`media_absence_unverified`, without provider error causes, keys, endpoints,
credentials or request IDs; the adapter adds no logging.

No public/custom-domain/cache URLs, arbitrary endpoint options, provider packages,
credentials, token permissions or configuration fields were added. Secret-file-only
configuration and 60-second signed GET behavior remain unchanged. A deployed token
that cannot HEAD the bucket will retain cleanup obligations; this change does not
request or provision broader permissions.

## Sources and installed SDK verification

Reviewed 2026-09-20:

- [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/):
  direct S3 reads observe completed deletes strongly; concurrent writes remain
  last-writer-wins. The S3 API bypasses custom-domain caching.
- [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/):
  HeadObject, DeleteObject and HeadBucket are supported.
- [AWS HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html):
  HEAD can return generic errors without a response body; missing objects may
  return 403 when listing permission is unavailable. Such denials are not absence.
- [AWS HeadBucket](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html):
  HTTP 200 confirms bucket existence/access; error statuses cannot do so.
- [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/):
  object read/write credentials can remain scoped to specific buckets.

Locked `@aws-sdk/client-s3` and presigner version 3.1135.0 were installed and
inspected locally. The SDK exports HeadObjectCommand, HeadBucketCommand and
S3ServiceException; transport tests verify empty HEAD 404 deserializes as
`NotFound` with HTTP metadata. XML-coded errors also exercise actual SDK parsing,
including rejecting explicit NoSuchBucket. Tests replace only the SDK request
handler, retaining command serialization, signing and deserialization. Synthetic
credentials and responses exist only in isolated tests. No real R2/cloud call or
credential was used, so this is not evidence of deployed token capabilities.

## Validation and effects

- 39 focused media-store tests: confirmed absence, existing object, missing bucket,
  denied/throttled/server/network errors, malformed exceptions, unknown DELETE
  acknowledgement, explicit write denial, exact request scope, invalid keys,
  pre-abort, abort at every request, abort with final success and aggregate deadline.
- Disposable MySQL 8.0.44: all 185 integration tests passed, including ten added
  cases through the actual adapter and existing cleanup service. Uncertainty keeps
  object rows, asset reservation, global quota and a RUNNING job obligation intact.
  A fresh generation with verified absence (including a lost DELETE ACK) releases
  quota once; stale/completed retries cannot repeat release. Expiring the lease
  during the final bucket check still prevents database completion.
- All 307 unit/contract/e2e regression tests passed, including the 39 focused cases.
- API build and lint passed. Security and publishing checks are recorded in the PR.

Side-effect review: the production caller is MediaWorkerService.cleanupMedia.
It already performs storage I/O outside transactions, completes only after every
remove resolves, and rechecks current objects plus job lease fences transactionally.
These algorithms were not changed. Additional HEAD requests increase storage
operations and may delay cleanup under unavailable permissions/services, preserving
quota instead of claiming success. Other application code consumes the unchanged
MediaStore interface; schema, deletion module, authentication and OpenAPI are unchanged.
Sibling checkouts contain copies of the same module, not a separate package consumer.

## Limits and remaining obligations

This is a bounded point-in-time observation, not proof that all late writers have
stopped. A later PUT can recreate the immutable key; deleting/recreating a bucket
between observations is likewise outside a stable-bucket observation guarantee.
Existing upload/processing hard deadlines, delayed cleanup guards, immutable keys,
lease fencing and durable orphan reconciliation remain necessary. Transport abort
bounds local waiting; it does not prove a provider stopped processing an earlier write.

This does not establish full M10 account deletion, live-inventory exhaustion,
backup purge, cache purge, or a global LIVE_PURGED milestone. It neither changes nor
claims those workflows. No QA merge, host change or deployment is part of this work.

## Parent integration checkpoint

The parent combined this source with C04 command/session contracts and the final
PR 35 TLS helper foundation. Build and 314 unit/contract/e2e cases passed; all 187
disposable real-MySQL cases passed with no skips. An independent read-only review
of all four original changed files and neighboring cleanup/fence code found no
bounded-change blocker. The cleanup comment now states the point-in-time limit
instead of treating elapsed age as proof that late provider writes stopped.
These are source integration results, not real R2 or QA activation evidence.
