# M10 bounded MESSAGE row purge

Internal source slice built on composed backend `388c9d0` (ACCOUNT admission and
owner-send fence included). The configured bounded PURGE runtime now invokes
this port as described in [bounded deletion runtime](backend-purge-runtime.md).
This remains a MESSAGE row subset, not deployment, full account purge, storage
cleanup or a `LIVE_PURGED` assertion.

`MessagePurgeService.step` owns one fresh write transaction and requires a valid
PURGE lease, configured ledger environment and page size 1–500. It locks the
immutable deletion intent before the actor account, room, blocked source and
selected publication copy. The intent's canonical digest, environment, request,
room, target, sender-author and original request time must match the durable admission
and retained deletion request. A publisher may delete their own copy although the
content owner is the original fan; only children of the exact target are selected,
and their content-owner provenance must match that target. The fan source is never
selected through a copy’s ancestor link. Missing actor/root rows do not erase a prior proof;
missing root rows without exact atomic proof return `deferred`.

The service only supports TEXT/STICKER graphs without message attachments or
publication-media provenance. All media inventory probes are bounded existence
queries. Unsupported targets return `deferred` without deleting any provenance,
registered write attempts, MEDIA jobs, object keys or quota obligations. Approved
service sticker assets and catalog entries survive; only the message link is
removed. ACCOUNT remainder and shared exactly-once media cleanup remain separate.

Each step mutates at most one dependency page (plus constant checkpoint/epoch
metadata), then locks and fences the PURGE job last. The lease timestamp is checked
after acquiring the job lock. Failure throws and rolls back the whole transaction.
Queue-deletion pages return immediately rather than acquiring later domain locks.
Repeated first-remaining pages are restartable without OFFSET or a process-local
cursor. The shared room lock serializes competing root/copy commands; publication
and push writers already reject the admitted blocked source using current reads.

The dependency order for each copy, then the root, is:

1. Exact-message null-room PUSH fanout jobs, then delivery jobs and delivery rows,
   through `NotificationsCoreService.purgeMessage` returning `{ deleted, done }`.
2. Retain command receipts with opaque message UUIDs, terminal `deleted=true` and
   null payload digest, without TTL expiration. Keep original deletion requests.
3. Clear other authors' quote references in bounded pages, preserving their text
   and incrementing message versions.
4. Scoped PUBLICATION jobs before publication mappings; reactions and sticker links.
5. Scoped REALTIME_HINT jobs before room events, then the physical message row.

The generated schema change detaches only the two retained metadata-to-message
FKs, retaining actor FKs and explicit room/message indexes. A separate
`message_purge_checkpoints` record copies exact immutable identity and digest and
records `rows_purged_at` atomically with final root removal. It proves only the
physical row subset. The deletion request remains BLOCKED, the PURGE job is not
completed by this internal port, and backups/account/storage are not inferred gone.
A restored root is processed again; an old proof cannot authorize deleting a
mismatched root or suppress restored children. MESSAGE ledger replay preserves
its original `blocked_at` when a previously blocked root has disappeared.
An exact matching proof also permits bounded cleanup of restored FK-free target
receipts and null-room PUSH fanout jobs before returning `rows_purged` again.
Unproven absence never authorizes that cleanup. Historical child IDs whose
provenance was removed cannot be rediscovered from a root-only proof; orphan
restore reconciliation remains a separate gate, not a global restore-safety claim.
If a selected child copy already has its own DB-admitted deletion request, the
source runner defers before touching that child. The copy runner removes it with
its own exact proof, then the source runner resumes. A bounded Prisma existence
probe under the room lock detects admission without acquiring a sibling intent
lock in reverse order. Externally durable but not yet DB-admitted copy intents
remain a separate unresolved replay case; this is not complete shared-purge closure.

## Sync and read behavior

Removing events would otherwise strand cached tombstones and derived quotes:
`affected` discovers changes through those event and quote/root references. Every
quote detachment, event-removal page and message removal therefore increments
`rooms.content_epoch` in the same transaction. `SyncRepository.state` includes the
epoch, and `SyncCoreService.scope` includes it in the existing signed ACL binding
for events, history and profile pagination. Old cursors return the existing reset
shape; fresh snapshots replace content and show independent quotes without their
removed references. No new wire fields, event types or synthetic tombstone data
are introduced, and no room-wide hint is emitted for otherwise hidden activity.
The generic room reset is conservative and includes members who did not see the
deleted source; it carries no source ID, author or operation metadata.

Room manifest generation still describes topology and membership, not message
content. Own-read state retains its monotonic order and projects an absent or
blocked message as null; advancing to a physically removed message fails current
message authorization. C06 receipt lookup retains opaque terminal state because
it no longer depends on the live row. Future C06 A cached authority scopes must
include this content epoch, alongside their existing current ACL checks.

The regression file `message-row-purge.test.mjs` covers bounded pagination and
service restart, FK detachment and retained receipts, immutable replay, old event
and history cursors, independent quoted content, invalid/expired leases including
a real two-connection job-lock wait, unproven absence, mismatched proof, media
deferral, scoped jobs/deliveries, publication copies and approved service stickers.
Migration `20260920084358_m10_message_row_purge` was generated by the pinned
Prisma 7.10.0 `migrate dev` against an owned loopback MySQL fixture, then all 17
migrations were replayed against a second fresh fixture database. All prior 16
checksums remained unchanged. Information-schema assertions verified that only
the two message FKs were detached, actor FKs remained, and the epoch/proof fields
existed. Prisma renamed the former FK-supporting `(room_id,message_id)` indexes
from their `_fkey` names to the explicit `_idx` names in the schema; the index
columns and bounded lookup support are retained. These are unmodified generated
index renames, not manual DDL or a dedupe-key change. The generated migration SHA-256 is
`9f55555af7708656e7a4db09b1196b819b58e859d3aad95c23c96c2d52a2dc7a`.
The owned MySQL exited with code 0 and its datadir was removed before releasing
the resource slot. No dependency installation or local build was performed.
Application runtime validation is delegated to the exact-head hosted CI; syntax
and migration checks alone do not establish application completion.
