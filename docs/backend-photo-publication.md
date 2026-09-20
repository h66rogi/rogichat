# M08 PHOTO publication slice

This slice extends room-owner private-message publication to PHOTO. TEXT keeps
its existing publication handler and DTO. STICKER and VIDEO publication remain
explicitly rejected before any publication or job is created.

STICKER is a separate follow-up agreed with the coordinator: catalog source
assets are global (`room_id IS NULL`), whereas `publication_media` deliberately
has a composite room/source-asset foreign key. Independent sticker publication
needs an explicit provenance and room-scoped access/projection design. This
change neither weakens that constraint nor aliases a public copy to a catalog
or private source. VIDEO awaits M09 integration. No schema or migration changed.

## Copy and commit boundary

`PublicationsCoreService` validates the current room owner capability, active
membership/period, publisher account/SOOP, original content owner, source
deletion/moderation and content revision. It accepts one to four READY image
objects, with bounded byte lengths, hashes and matching attachment positions.
It does not require the owner's ordinary private read grant or history window.

Before storage I/O, one transaction reserves the exact validated output bytes,
creates independent PROCESSING destination assets and ALLOCATED immutable
objects, persists `publication_media` provenance and fences the current job
generation/token/owner/expiry. Each retry gets new asset/object/attempt UUIDs.
Superseded assets retain their durable object rows and reservations, are marked
DELETING and receive ordinary MEDIA cleanup jobs. A retry needs additional
capacity until the uncertain previous attempt has been physically cleaned.

Injected `MediaCopyService` streams the existing sanitized image through the
bounded scratch spool, checks exact length and SHA-256, and performs the
immutable PUT through `MediaStore`. Reads, writes and scratch disposal happen
outside database transactions, with a four-minute abort deadline. It never
reuses private input/quarantine keys or falls back to the private source.

Finalization repeats current authorization, source revision/object/hash and
destination provenance checks under locks. Destination READY, anonymous shared
message/attachments, publication status, audit, message event/hint and job
completion commit together. A stale completion fence rolls all these changes
back. PUT acknowledgement alone grants no access; generic uploader preview
already denies publication destinations. Current message ACL and READY checks
precede the existing 60-second signer, which remains unchanged.

## Ownership, deletion and recovery

Destination `owner_user_id` and message `content_owner_user_id` remain the
original author's account; the sender member is the publishing owner, while
the published DTO uses the existing anonymous projection and strips source,
sender and quote information. The public message's `deletion_root_id` points
to the original. Original deletion or account deletion blocks published reads
and URL issuance; leaving the room alone preserves historical content.
Deleting a public copy only cleans its independent attachment, not the original.

Unknown PUT results and process loss leave discoverable ALLOCATED objects.
Expired live leases can retry without overwriting them. Bounded recovery finds
PREPARING copies with no runnable publication job, locks room/publication/assets,
rechecks jobs, revokes the publication and queues cleanup. Failed, exhausted or
missing jobs therefore cannot retain inaccessible copy reservations forever.

Physical deletion uses the existing media worker's ten-minute recent-attempt
guard and twenty-minute deferred cleanup. Reservations are returned only after
all physical deletions succeed and the cleanup completion fence commits. Copy
recovery runs before generic media recovery in the existing worker probe.

Already-DELETING assets now enter cleanup before membership authorization:
cleanup must not acquire a room lock after owner/asset locks or depend on an
author remaining a member. A real MySQL test holds the room lock while cleanup
completes. The broader existing PROCESSING transform path still uses
owner/asset-before-membership ordering; this narrow fix is not a claim that
every media/message lock-order interaction has been redesigned.

## Persistence and scope

Ordinary writes use generated Prisma operations and explicit `select`.
Bound raw reads establish current-row locks for source objects, provenance,
budget, room/publication and lease fences after an earlier RR snapshot.
Recovery locks one eligible room with SKIP LOCKED, then at most twenty
publications in that room. `jobs.resource_id` is polymorphic with no Prisma
publication relation, so the no-runnable-job predicate is evaluated before
LIMIT in these locking queries to prevent active copies from starving recovery.
All identifiers are fixed and values bound.

Production Nest registration exports only services; storage and repositories
remain private. Worker module/runtime registration changes are integration
points for the coordinator's later M09 work. Controllers, auth, contracts,
schema, migrations, dependencies, infrastructure and deployment are untouched.

## Verification and remaining release gates

Tests use isolated synthetic bytes, an injected in-memory `MediaStore`, real
scratch files and disposable loopback MySQL 8.0.44. They do not prove actual R2,
encoded pixels, decoder operation, production credentials or deployment.

New coverage includes HTTP and snapshot anonymous PHOTO projection, independent
keys, no access before READY, 60-second access responses, source deletion,
publisher owner/membership/SOOP and account changes, revision/moderation/asset
changes during PUT, stale generations, uncertain PUT recovery, author leaving,
public-only deletion, unsupported STICKER/VIDEO, quota denial and concurrent
last-slot reservation, and deletion lock ordering. Unit tests cover external-I/O
transaction boundaries, length/hash mismatch and scratch cleanup.

Validation commands from `apps/api`:

```sh
pnpm build
pnpm typecheck
pnpm lint
node --test test/unit/*.test.mjs
node --test test/e2e/*.test.mjs test/contracts/*.test.mjs
node test/run-mysql.mjs
```

Repository gate: `python3 tools/security/check.py all`, plus installed commit and
push hooks. The local Node 24.21.0 installation's pnpm 12.4.2 launcher lacked a
shebang and Node `spawn` returned ENOEXEC; a temporary external shell wrapper
invoked its installed `bin/pnpm.mjs` for the disposable harness. No harness,
package, lockfile or tool policy was changed to bypass validation.

Final local snapshot: build, typecheck and lint pass; 208 unit, 141 disposable
MySQL and 18 HTTP/process/contract tests pass (367 total). The 141 include eleven
new PHOTO integration cases; four new unit cases cover the copy I/O boundary.
Remote CI evidence is recorded in the task PR. This slice is
not M08/M09 release acceptance. STICKER design, VIDEO integration, actual R2
access/expiry, independent review and the coordinator-owned QA merge/release
remain separate gates.
