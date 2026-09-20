# Moderation report, personal block and room ban

Implementation contract for MB07/FW07. Runtime validation and migration evidence
will be recorded below before this batch is declared ready. Operator staffing and
support contact configuration are separate operational work; `received` means
only that a report has committed to durable storage.

## HTTP contract

All paths are under `/v1`, use the existing browser Origin/CSRF or native bearer
contract, reject extra body fields, and serialize public IDs as UUIDv4. `actorId`
is the existing room membership identifier, never a global account/provider ID.

| Method and path | Input | Result |
| --- | --- | --- |
| POST `rooms/:roomId/messages/:messageId/reports` | `idempotencyKey`, `reason`, optional `detail` | `reportId,status,createdAt` |
| GET `report-receipts/:idempotencyKey` | None | Own receipt |
| GET `reports/:reportId` | None | Own receipt |
| GET `rooms/:roomId/blocks?after=:actorId` | None | `blocks:[{actorId,blockedAt,displayName}],next` |
| PUT `rooms/:roomId/blocks/:actorId` | `{}` | `actorId,blocked:true,resetRequired:true` |
| DELETE `rooms/:roomId/blocks/:actorId` | No body | `actorId,blocked:false,resetRequired:true` |
| GET `rooms/:roomId/bans?after=:actorId` | None | Owner-only `bans:[{actorId}],next` |
| POST `rooms/:roomId/bans/:actorId` | `{}` | `actorId,banned:true,rejoinRequired:false` |
| DELETE `rooms/:roomId/bans/:actorId` | No body | `actorId,banned:false,rejoinRequired:true` |
| GET `admin/reports?after=:reportId` | None | `reports:[{reportId,status,createdAt,reason,detail}],next` |
| POST `admin/reports/:reportId/resolve` | `status:resolved\|dismissed` | Receipt |

Report reasons are `spam|harassment|sexual|violence|other`. Optional detail is
1–1000 Unicode code points with control characters rejected. Status is exactly
`received|resolved|dismissed`; there is no fake queued/reviewing state. Lists use
50-item keyset pages and nullable `next`. GET-by-key reconciles a lost response
without retaining the original message body. A 404 means no receipt belonging to
this authenticated account exists. An exact POST retry returns the same receipt;
reuse of the key with different room/message/reason/detail returns 409. Admission
is rate limited independently of the command transaction.

## Authorization and privacy

A new report requires a currently readable message in the same transaction as
its insert. A receipt does not confer renewed content access: it survives leave,
ban and deletion and never includes a message/source/author identifier. Ordinary
`manage_users` operators may review only supplied report details and reason,
not fetch private conversation bodies or the source fan of anonymous publication.
Current capability is locked on every operator read/resolve, with durable audit.
Resolution records the decision and clears detail; it does not itself delete a
message or ban anyone. No automatic first-user administrator is introduced.

Reports never copy message bodies or attachments. Optional detail expires for
operator access after 24 hours. The worker physically clears expired detail in
bounded batches; the exported retention port joins the deletion dependency drain
for message roots, publications, reporters and content owners. A deleted/missing
source or deleting account also suppresses detail before physical cleanup. Only
a minimal receipt, keyed digest and internal audit references remain.

Personal blocks require a legitimately visible current nonself actor. A fan
cannot use another fan ID or anonymous publication root as a target/discovery
oracle. Own recovery lists return previously recorded target actor IDs plus a nullable current
`displayName`, solely for the existing caller-owned block. This purpose-specific label
is available after leaving, without restoring general profile or room access. It is
null for banned/unverified callers, unavailable rooms, missing/inactive/deleting/deleted/
suspended/unverified targets, invalid periods, missing profiles or FAN-role-hidden targets.
Only the current nickname is projected; no historical name, avatar, birthday, provider ID,
user ID or anonymous source lookup is retained or exposed. Unblock does not require
renewed target visibility. Clients distinguish unavailable labels with the existing
actor reference and date rather than stale profile caches.
Personal blocks never evict other fans or delete content. Blocking the only
streamer can leave a fan with no usable conversation; leave, unblock and account
management remain available.

## Enforcement and cache behavior

Blocker reads suppress messages authored by the blocked actor before pagination,
and apply the same policy to direct GET, media issuance, quote projection,
reaction aggregates, profiles/avatars, recipient discovery and sync. Anonymous
publication uses its publisher for policy and never resolves its hidden author.
Private sends and final push admission check both block directions. The push
worker checks again after transport preparation; a request admitted before a
later block cannot be recalled, and already issued media URLs retain their
existing 60-second lifetime.

Block and unblock change both actors' room ACL epochs and therefore authorization
revision A and manifest generation. Membership scope M remains stable, preserving
SEND reconciliation. They do not change room-global content epoch or global
account generation, so unrelated fans and push subscriptions are not invalidated.
Clients discard the affected room cache on mutation/reset/A change and obtain a
new snapshot; unblocking makes retained content eligible under the current ACL.
Other sessions observe the change on their next authorized sync. No tombstone or
physical purge represents a personal block.

Only the current owner streamer may ban/unban a room actor. Ban closes the active
period, nulls membership, increments generation/ACL and revokes that actor's
stream grants. Unban changes BANNED to LEFT; it neither joins nor restores grants.
Explicit join calculates a fresh policy period. Historical direct pairs never
repair revoked grants. Hiding a message, deletion, personal block and moderator
ban are distinct concepts; these endpoints do not alias hide or delete.

## Persistence and races

New CRUD uses generated Prisma. Current room/member/capability/block locks are
explicit raw-SQL exceptions for Repeatable Read command admission. Existing
reviewed ACL-before-LIMIT, realtime audience and binary reaction aggregation SQL
retain their bounded/bound-value exceptions with the new policy predicates.
Auth/room locks serialize report-versus-delete, block-versus-send/unblock and
ban-versus-rejoin; no transaction holds external storage or push network I/O.

Migration 22 is additive and must be generated by pinned isolated `migrate dev`
after migrations 20/21, then verified by a fresh replay. No manually authored SQL,
reset, create-only migration or live database changes are part of this batch.

## Validation checkpoint

- Prisma Client generation and TypeScript emit: passed with existing pinned tools.
- Full serial unit suite after M10 runtime and retention wiring: 394 passed.
- Targeted lint and all 20 OpenAPI/contract tests passed.
- Migration 22 `20260920111123_moderation_report_block` generated/applied with Prisma 7.10.0 and MySQL 8.0.44; second fresh database replayed all 22 and reported schema in sync.
- SQL SHA-256: `37cf4a1bc473baf2165b5f3477efa7e64ae358b9483d1da2dd9c7e1f0d33c0ea`. Predecessor schema 21: `d366904`; no prior SQL changed.
- Both fixture databases and owned mysqld/datadir teardown confirmed at `2026-09-20T11:12:16.683Z`.
- Targeted fresh-MySQL suite: 63 tests, 55 passed; all 8 moderation HTTP tests, both final push-block directions, account report-detail cleanup and message purge/crash tests passed. The 8 media tests failed because a predecessor test fixture set the shared budget below a single photo reservation; upstream fix `a7bd230` is merged, rerun pending hosted CI.
- After the predecessor hardening merge: TypeScript and 47 focused unit tests passed.
- Additive recovery-label projection: TypeScript, 12 focused unit/OpenAPI tests and targeted lint passed; real MySQL afterleave/IDOR/deletion regression and hosted CI pending.
- Deployment and QA/main merge: not performed by this worker.
