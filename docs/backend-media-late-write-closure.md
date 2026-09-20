# Media late-write containment and remaining closure gate

Baseline: root integration `46bca354c96c4ce972ecf5320f6706e20041d161`.
This is the parent-approved schema-unchanged safety slice, not full M10 purge
closure, a migration, an operational deployment, or permission to claim
`LIVE_PURGED`. Ownership is limited to the media worker/repository, media cleanup
tests and this document; ACCOUNT/auth, deletion reconciliation, messages,
publication ownership fences and M11 remain unchanged.

## Storage contract and writer inventory

R2 exposes strongly consistent reads, but concurrent PUT/DELETE operations on a
key resolve according to which operation completes last. A successful direct
HEAD absence check is therefore only an observation at that instant. Client
abort, expired leases and process death do not prove provider termination.
[Cloudflare consistency](https://developers.cloudflare.com/r2/reference/consistency/)

All content writers found in `apps/api/src` at the baseline use the shared
`R2MediaStore.put`: a single `PutObjectCommand`, `IfNoneMatch: '*'`, SDK
`maxAttempts: 1`, bounded file size and a server-selected immutable attempt key.
No multipart, native CopyObject, presigned PUT, or other content writer was found
in source; this source inventory cannot establish what historical/external
credentials have written to a deployed bucket.

| Writer | Registration before storage | Acknowledgment persisted | Unknown/failure outcome |
| --- | --- | --- | --- |
| Original photo/video/avatar/sticker upload, `MediaService.upload` | `MediaCoreService.beginUpload` + `MediaRepository.allocateInput`; asset/token/key commit before spool/PUT | `finishUpload` after PUT success sets input `STORED`, positive byte length and SHA-256, then PROCESSING | Five-minute request deadline, disconnect, bad input, failed auth/commit or crash leaves `ALLOCATED`; failUpload blocks the asset, with recovery for expired upload leases |
| Image/avatar/sticker output, `MediaWorkerService.processMedia` | `prepareMedia` allocates image key, quota and job fence before decoder/PUT | `finalizeMedia` sets output READY and metadata only after PUT success and fresh owner/asset/job checks | Lease loss, 450-second deadline, decoder/PUT/commit failure leaves allocation and reservation |
| Video and poster, same worker | Both output rows and distinct variant keys are registered before either PUT | Both READY transitions commit with asset/job completion after both writes succeed | First write can succeed while the second is unknown; neither allocation is treated as terminated by timeout or age |
| Publication photo copy, `MediaCopyService.processPublication` | `PublicationPhotoRepository.allocate` commits destination asset/object/key, quota and publication provenance | Bounded GET/spool/PUT, not server-side copy; `finalizePhoto` persists READY, length and hash after writes and publication/job fences | Four-minute deadline, lease loss or partial copy preserves allocated destination objects; abandonment/expiry routes them to media cleanup |
| Durable deletion ledger | Separate `r2-deletion-ledger` adapter, immutable non-content ledger records | Separate ledger contract | Outside this media-content cleanup scope; never swept as an object orphan |

Source retry attempts receive new keys. Positive byte length and a valid content
SHA-256 are written to `media_objects` only in the three successful finalization
repositories: original `storeInput`, worker `readyObject`, publication `ready`.
They are preserved by old `deleteObjects` updates. For these audited registered
writers, STORED/READY/DELETED plus both fields is acknowledged-write evidence;
ALLOCATED always remains uncertain, even if unexpected metadata is present.
A bare legacy DELETED marker is never termination evidence. Restored/imported or
out-of-band records require a separate provenance audit; metadata alone cannot
establish that an unaudited writer respected this contract.

## Implemented invariants

- Every cleanup plan includes legacy DELETED rows, keys, current states and
  acknowledgment fields, under an asset lock and a current `FOR UPDATE` read.
  The final transaction repeats that read and compares exact membership, keys,
  states and evidence after external storage I/O; an old repeatable-read snapshot
  cannot replace that check. Existing raw SQL is retained specifically for
  current-row locking, bounded recovery and its polymorphic jobs exclusion.
- At most 500 keys enter a cleanup pass. A 501st sentinel fails closed before
  storage I/O; this slice does not invent an ephemeral paging cursor. A future
  durable page model is required to progress larger inventories.
- Young upload/transform attempts retain the existing deferral. Once old enough,
  DELETE/read-back may remove currently visible orphan bytes, but any unresolved
  row keeps **all** asset keys, object states and the complete reservation.
  A delayed continuation is durably enqueued before the current job is completed,
  with the job generation/token/expiry fence last in the same transaction.
- Successful task completion after deferral means continuation handoff, not
  physical purge completion. The asset stays DELETING indefinitely if writer
  termination cannot be proven. Repeated HEAD404 never strengthens that evidence.
- Legacy DELETED assets with unproven registered objects re-enter bounded recovery
  and DELETING. Previously refunded quota cannot be reconstructed here; no fake
  replacement charge or successful purge claim is created. Already removed rows
  or keys cannot be rediscovered by this source-only slice.
- Only an unchanged plan whose every object has acknowledged-write evidence may
  mark objects/asset deleted and release reservation once, atomically with the
  final lease fence. No storage calls occur inside the database transaction.

## Comparison and unresolved design

Durable registered attempts plus reconciliation is the chosen direction: keep
per-key obligations and independently schedule cleanup after crashes. Existing
allocations conservatively record uncertainty, but cannot distinguish a write
never started, an acknowledged write whose DB update was lost, and a provider
request still in flight. Those cases deliberately remain outstanding. Full
closure requires a separately approved durable attempt/outcome/provenance model,
writer termination evidence, bounded paging, recovery/alerts and a final inventory
rescan. Schema/client/migration generation needs parent resource allocation and
the repository Prisma policy; no hand SQL migration is supplied here.

Conditional create-only PUT plus permanent non-content tombstones remains an
**unapproved alternative**, not implemented. It would change permanent key
retention and absence semantics and require proof that every writer, including
legacy, native-copy and multipart completion paths, honors the destination
condition. Cloudflare documents operation-specific S3 compatibility and special
copy destination conditions, so a PutObject header cannot simply be generalized
to every API. Current source having no multipart/copy call does not establish
historical bucket provenance or a safe migration to tombstones.
[Compatibility](https://developers.cloudflare.com/r2/api/s3/api/),
[copy destination conditions](https://developers.cloudflare.com/r2/api/s3/extensions/)

No current check establishes global `LIVE_PURGED`, historical accounting repair,
backup removal, unregistered orphan absence or a provider-side cancellation
bound. ACCOUNT purge must preserve or durably transfer these obligations before
removing media rows/jobs/provenance. No ACCOUNT code is changed here.

## Validation

Deterministic unit tests cover original, image, video, poster and publication-copy
keys with a provider completion after DELETE/404, repeat/restart reconciliation,
metadata on ALLOCATED, legacy DELETED recovery, exact state/key/membership/evidence
drift, lease-loss rollback, bounded overflow, absence errors and once-only quota.
Hosted real-MySQL regressions exercise the service/repository, original late-write
reconciliation, legacy recovery and an older RR snapshot followed by a concurrent
proof change. Existing storage-adapter tests continue to validate direct absence
rather than an SDK acknowledgment alone.

The local resource hold permits only tiny transpilation of the two changed
TypeScript modules and unchanged storage adapter using an existing compiler and mocked imports, the focused
unit tests, syntax checks and mandatory public scanners. No dependency install,
full build, Prisma generation, Docker, local DB, cloud operation or remote SQL is
performed. Hosted CI supplies full compilation, normal dependency resolution and
real-MySQL validation against the published immutable head; synthetic tests do
not prove deployed R2 termination or product availability.
