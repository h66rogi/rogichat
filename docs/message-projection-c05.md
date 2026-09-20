# C05 live message projection

Every live MessageDTO returned by GET, snapshot, history, and live sync events
requires `counterpart: {actorId: lowercase UUID} | null` and
`allowedActions: {reply: boolean, publish: boolean, delete: boolean}`.
Existing fields and anonymous author privacy are preserved. There are no new
source, account, provider, stream, grant, or peer-status fields.

Counterpart is the current eligible opposite participant of the readable PRIVATE
pair, including the recipient of the viewer's own outgoing message. SHARED,
anonymous, non-pair and ineligible cases return null. Eligibility uses the same
read transaction: exact room/stream/pair/viewer, current account and SOOP,
active membership period, FAN role compatibility, both current read grants and
the viewer's send grant. Rejoining never repairs a revoked pair grant.

Reply means starting a PRIVATE quoted draft. PRIVATE uses counterpart; an
identifiable non-self SHARED author may be targeted if currently eligible.
A new private pair can be created when none exists; existing revoked grants
remain denied. Own SHARED messages and anonymous publications are not reply
targets. Publish hints identify a current streamer room owner viewing a live
PRIVATE original TEXT (non-null) or PHOTO; VIDEO, STICKER and derived copies
are false. This does not change the independent publication authority or read
policy. Media preparation and mutation-time checks can still reject publication.
Delete uses sender account ownership, including the anonymous copy's publisher,
not its source fan. Ownership-only remove after leaving or SOOP loss is unchanged.

These booleans are UI hints, never capabilities or promises of eventual success.
Every mutation reauthorizes current facts. A stale true must handle rejection;
a false does not redefine the mutation endpoint's independent authority.

Message version describes message state, not membership/grant/action state.
The same message version can have different hints or counterpart after refresh.
Consumers must replace the entire live DTO when accepting a current authorized
GET/snapshot/event projection, including at equal message version, while fencing
responses by local request generation and current account/room/access context.
A late response from an earlier generation must not restore stale hints or a
counterpart. Refresh on resume, access changes and rejected actions; local
version dedupe alone is insufficient. C05 adds no global peer-state invalidation
signal and does not unblock a persistent outbox or guarantee immediate refresh.

Wire tombstones remain `{type: "message.deleted", messageId, version}` only,
with no author, content,
counterpart or action fields. Internal cached tombstones such as
`{id, version, deleted: true}` also contain none of the live DTO fields. They clear all cached live DTO fields; a late live
response must not resurrect a tombstone. Command/deletion receipts are unchanged.

Shared synthetic contract fixtures for backend, web and mobile review live only
in `apps/api/test/fixtures/message-projection.json`. They must not be imported
into runtime bundles. `privateOutgoing` and `stalePrivateOutgoing` intentionally
share a message version and demonstrate full DTO replacement.

## Integration evidence

PR #40 source `492f2f75f96acc88874d46646e44cbadefe532db` passed two independent
reviews and hosted backend run 35495544014, including 180 real MySQL cases and
both image scans. Parent integration over the M11 and publication-fence graph
merged without conflicts and retained the existing MESSAGE_CREATED PUSH fanout
enqueue. Build, lint, controller OpenAPI export and the serial combined
unit/contract/e2e suite passed; the composed disposable-MySQL suite passed all
233 cases, with none skipped, on 2026-09-20.

These are source/test results, not a QA release. Current clients must consume the
required live-message fields correctly before activation. This additive hint
projection does not include the separate C06 schemaVersion 2 / required SEND
membershipScope cutover, which remains gated on matching web/native consumers.
