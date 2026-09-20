# M10 account purge implementation inventory

Read-only review baseline: backend `fcd03ef` and M11 `43d7bec`, 2026-09-20.
This is an implementation inventory, not an implemented purge or deployment claim.
The MESSAGE admission/replay work and PR 37 object-absence proof are separate
in-flight changes; their existence does not establish account purge completion.

## Required slices

1. **Durable acceptance and checkpoint model.** Fresh authentication and recent
   authentication proof precede an immutable ACCOUNT ledger intent, outside any
   database transaction. A short transaction then changes the account to DELETING,
   records the original request time/digest and queues bounded work. ACK follows
   that commit, never the external write alone. Replay must work without the
   original session, API retry or pre-existing DB job. Do not scan every room in
   the acceptance transaction.
2. **Identity resurrection guard.** `IdentityService.resolve` must not create a
   new account merely because purge removed an identity. Serialize a purpose-
   separated, versioned subject HMAC guard with identity resolution and deletion.
   Cover web callbacks and native exchange, including unbound transactions whose
   user is not yet known. Scrub bound login/link verifiers and encrypted payloads;
   `login_transactions` has no user/session FK. Retain the guard until live purge
   and the maximum accepted authentication lifetime have both passed. Current
   web/native overall lifetimes are ten minutes. Subsequent explicit registration
   gets a new UUID and no previous membership, grant or ownership.
3. **Physical content purge.** Inventory roots, publication destinations and
   registered object attempts before removing provenance. Detach retained dedupe
   metadata from live content through a generated migration: current
   `command_receipts.message` and `deletion_requests.message` Restrict FKs prevent
   physical deletion. Retain opaque dedupe IDs and terminal deleted state, scrub
   payload digests, and do not introduce arbitrary dedupe TTL expiration.
4. **Account remainder and topology.** Purge profile/birthday/avatar references,
   identities, sessions, personal media usage, capabilities and reactions even
   on other authors' messages. Revoke grants and end participation periods in
   bounded room transactions. Close the departed owner's capability without
   implicitly assigning a new owner. Keep only minimal inactive UUID references
   needed by independently authored replies and service-owned approved stickers;
   never delete an entire room or every asset with that registrar's UUID.
5. **Independent backup and restore gates.** Use externally operated inventory
   of automatic/manual/final snapshots, exports, AWS Backup and restore-created
   recovery points. No timestamp or TTL tag proves removal. A real Aurora drill
   and existing-cloud retention changes remain separate approved operations.

## Dependency ordering

- Before deleting message provenance, invoke the M11 notification purge port.
  It discovers null-room fanout jobs and delivery jobs by message/root ownership.
  Preserve its `{ deleted, done }` continuation contract.
- Invoke read-state purge before membership-period removal, preserving its
  distinct `{ deleted, hasMore }` continuation contract. Push subscriptions must
  precede auth sessions because of their composite session/user FK.
- Transfer every media cleanup obligation to durable item checkpoints before
  removing MEDIA jobs. Remove scoped PUBLICATION and REALTIME_HINT jobs before
  their publication/event rows. `jobs.resource_id` is polymorphic; never infer
  ownership only from a room ID or sweep unrelated participants' jobs.
- Clear references from other authors' quotes, preserving their independent
  content. Remove attachments, sticker links, reactions, publication media,
  publication mappings and room events before messages. Publication messages
  precede roots because of the self-referencing deletion-root FK.
- Keep object keys until verified storage cleanup. Remove object/asset rows only
  after profile, attachment, publication and catalog dependencies are handled.
  Quota release must be exactly once in the same fenced checkpoint transaction.
- `audit_events` deliberately has no FK and minimal UUID/action/time data.
  `profile_changes` is disposable user-linked outbox metadata. Sticker audit rows
  do have FKs; handle them explicitly. No hidden-state or revision-history table
  exists at this baseline; future stores must be added to this inventory.

## Concurrency and completion requirements

Bound batch sizes (at most 500), use stable keysets or repeatedly delete the first
remaining page, and never OFFSET through a mutating set. Persist phase/item
progress atomically with domain changes, applying the job lease fence last.
Perform a final no-match rescan after writers are fenced. MESSAGE and ACCOUNT
purges of the same root must share exactly-once item/quota ownership.

Failed/exhausted jobs remain outstanding deletion obligations with alerts and a
recovery path; enqueue dedupe does not revive FAILED or COMPLETED jobs. Original
durable request time fixes the 24-hour live and 30-day backup deadlines through
retries and outages. A failed item prevents LIVE_PURGED.

A repeatable-read source-owner snapshot is not sufficient to fence publication
against concurrent account deletion. The focused PR #38 review and four real
two-connection MySQL tests verified that the existing writable message loader
already obtains the current content-owner status through a joined locking read.
Request, TEXT publication, PHOTO allocation and PHOTO finalization all reject or
revoke after the source owner's deletion commits despite an older RR snapshot.
See [the evidence](backend-publication-owner-fence.md). No runtime race fix was
needed. Future ACCOUNT purge must still verify consistent account/domain/job
lock ordering and contention; these tests do not prove global deadlock freedom.

PR 37 adds bounded direct-storage absence read-back, but this is point-in-time.
Age checks, process termination and SDK abort alone do not prove a provider-side
late PUT cannot arrive. Durable registered write attempts, termination evidence
and orphan reconciliation must close this gap before global LIVE_PURGED.

Restore remains isolated until the complete latest ledger is reapplied, account/
root/media denies are rebuilt and orphans reconciled. Revoke restored sessions,
rotate cursor/cache epochs, reset birthday visibility OFF and disable unproven
memberships, positive grants, ownership and admin powers. Synthetic access tests
and explicit operational release precede serving. Do not re-backup restored
deleted data to restart retention; ledger pruning also requires all linked
copies gone, no active restore, and at least 31 days' retention.
