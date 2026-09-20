# ACCOUNT content and media runtime

The existing durable PURGE handler now continues from account profile, read-state,
membership, notification and session cleanup into profile-change outbox cleanup,
owned message rows and media admission. The scheduling identity remains the
original ACCOUNT request. Neither this batch nor a drained page writes LIVE_PURGED,
removes identity guards, or advances the original receipt timestamp/deadline.

`AccountContentService.page` is an exported internal transaction port. It verifies
the canonical receipt hash, exact admitted ACCOUNT checkpoint, current blocked
account and matching guarded obligation. The parent `AccountCleanupService.step`
reads the external immutable receipt before opening the transaction; runtime
continuation applies the job generation/owner/token/expiry fence in that same
transaction. Unknown COMMIT errors escape without replaying a domain command.

Ownership uses `messages.content_owner_user_id` across rooms. It never uses
observer membership or publisher identity as a substitute. Copies are selected
before roots, one room is locked after intent/account authorization, and independent
quotes retain their body while losing the unavailable quote reference. An FK-free
checkpoint stores each message UUID, original root UUID, room, content owner,
receipt digest and requested time before tombstoning or physical removal. Its
row-purge time is atomic with removal. A restored row reopens its checkpoint;
restored receipt/push dependencies can also be found without a live parent row.
A separately admitted MESSAGE request may consume exact ACCOUNT physical-row
proof after account-first removal, while retaining its own immutable authority.
No MESSAGE request is fabricated for ACCOUNT cleanup.

`MessageDependenciesService` reuses the existing transaction-scoped notification,
receipt, quote, publication, reaction, sticker-link and event cleanup for both
scopes. Changes advance the selected room's content epoch. Root UUIDs with
remaining foreign children are retained rather than deleting independent content.
The runtime does not interpret that retained dependency as completed deletion.

Media references are detached only after storing FK-free ACCOUNT provenance and
revoking the asset when exclusively owned. ATTACHMENT and PUBLICATION provenance
reference IDs name their owning message checkpoint; AVATAR/ACCOUNT IDs name the
account. Destination assets of unpublished or published copies derive authority
from the source content owner, even when the publisher owns the destination asset.
Current locking reference probes preserve assets shared with independent messages,
profiles or publications, and approved service catalog assets. Avatar links and
owned unlinked assets are scanned separately; retained UUID identity anchors stay.

The MEDIA worker stores every object UUID, asset UUID, attempt UUID and immutable
key in `media_cleanup_attempts` before external DELETE. It enumerates at most 100
objects per page using an asset checkpoint, including more than 500 historical
attempts. The existing job continues in place, and recovery uses one stable
`media-cleanup:<asset>` identity rather than hourly or lease-ID keys. Failed legacy
jobs remain historical records; recovery adds at most one stable asset identity.
Counters do not exhaust durable cleanup solely because many pages are required.
Worker outcomes distinguish progress/deferred from completed cleanup.

Successful DELETE/404 is only an observed deletion at that instant. ALLOCATED,
missing/invalid acknowledged-write metadata, failed storage operations and late
writers retain their keys and quota obligation. A write acknowledgement arriving
during a DELETE requires another subsequent DELETE. Cleanup closure requires
acknowledged writes and recorded deletion for every current object. No arbitrary
elapsed duration, cancellation or lease expiry proves writer termination. A
crashed writer whose PUT outcome cannot be recovered still requires actual writer
termination/acknowledgement or provider proof; this batch does not invent that proof.
Backups, provider revocation and device caches are not certified erased.

Auth/login/provider lifecycle changes are owned by the coordinated Apple/auth
batch. Its bounded all-status secret scrub must retain the original auth-not-before
and blocked-state fences. Moderation's later exported retention port will be
composed with the shared dependency service; neither pending integration permits
a global purge-completion claim.

Migration `20260920104110_m10_account_content_media` adds five FK-free tables,
generated and applied by Prisma 7.10.0 on an isolated MySQL 8.0.44 instance, then
replayed with all prior migrations on a second fresh instance. Its SHA256 is
`8e26e053d3245ed96d253759a6bfb4488ab5297d0f0c4e2ee9bf1df103ee7aca`.
The successful generation started 2026-09-20 10:40:54 UTC; fresh replay started
10:41:57 UTC and both fixture teardowns were confirmed by 10:42:35 UTC. No live SQL
or shared database migration was performed. Schema source was published separately
as `d08a0e5` for dependent additive migrations.

Focused unit coverage includes late PUT after 404, acknowledgement ordering,
restart/cursor wrap, bounded 501-object cleanup and final-fence rollback. Integration
coverage exercises real ACCOUNT worker continuation, root/copy ownership across
rooms, shared/service preservation, unpublished destination provenance, two-scope
concurrency and unknown COMMIT. Hosted exact-head CI supplies full runtime evidence;
source publication is not deployment. INFRA alone owns QA merge/live activation.
