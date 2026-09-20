# C06 membership and authorization contract (prelaunch breaking v2)

This change is source-only until web, Android and iOS consumers cut over together.
Do not independently activate this backend in QA or production. Validate rollback
with the matching consumers; a schema 1 client cannot send schema 2 commands.
C04 read-only command reconciliation GET remains unchanged. C05 message eligibility,
counterpart and allowedActions projections are independently owned.

## Wire contract

`membershipScope` (M) and `authorizationRevision` (A) are canonical unpadded
base64url HMAC-SHA256 strings, exactly 43 characters. They are opaque cache and
intent bindings, never authorization credentials. Fresh authorization is mandatory.

| Response | Version | M/A placement | Reset |
| --- | --- | --- | --- |
| GET rooms discovery | unchanged envelope | actorId/M/A only on joined items; unjoined omit all three | not applicable |
| POST room join | unchanged envelope | actorId, historyPolicy, policyVersion, M/A; removes visibleFromOrder | not applicable |
| GET sync manifest | schemaVersion 2 | each room has roomId/name/mode/actorId/role/M/A | rooms [], generation null, complete false, nextCursor null |
| GET room snapshot | schemaVersion 2 | envelope M/A, messages, nextCursor, historyCursor | snapshot starts fresh; cursor input is 400 |
| GET room events | schemaVersion 2 | envelope M/A, events, hasMore, nextCursor | events [], hasMore false, nextCursor null, M/A null |
| GET room history | schemaVersion 2 | envelope M/A, messages, nextCursor | messages [], nextCursor null, M/A null |
| GET room profile-sync | schemaVersion 2 | envelope M/A, profiles, generation, complete, nextCursor | profiles [], generation null, complete false, nextCursor null, M/A null |

All listed reset envelopes set resetRequired=true. Successful envelopes set it
false. Messages and individual events never contain M/A. Paginated discovery is
not authoritative: replace local memberships only after a complete, single-
generation sync manifest. Manifest generation binds every emitted room M/A and
account membership_generation, so an ACL change invalidates continuation.

## Scope and authorization revision

M uses `membership-scope:v1:` followed by JSON of
`[audience, userId, roomId, active_period_id]`. The auth audience is the environment
separation used by existing session/cursor configuration. M survives role, policy,
grant and unrelated-room changes; leaving/rejoining creates a different M.

A uses `authorization-revision:v1:` followed by JSON of `[audience, vector]`.
The vector remains exactly the former sync ACL vector:
`[actorId, role, mode, active_period_id, String(visible_from_order), String(acl_epoch),
policy_version, String(room.content_epoch), String(account.membership_generation), grants, revokedStickerIds]`.
Grants retain stream_id/can_read/can_send/valid_from/expires_at/revoked_at/active
field order, numeric booleans, canonical JSON dates, stream UUID ascending order;
revoked sticker IDs are deduplicated and ascending. Account-wide generation is
intentional: joining a different room conservatively invalidates A and cursors in
existing rooms, while leaving M unchanged. Physical message purge increments room.content_epoch, invalidating A, manifest continuations and every room cursor while M stays stable. Do not silently narrow this vector.

A single DB now is captured for grant active predicates, revoked sticker ACL,
message page/source invalidation predicates and cursor validity within a response.
Scope batches issue three queries regardless of room count, capped at 10,000
members, aggregate grants and distinct room/sticker pairs (+1 lookahead each).
Overflow is 503, never a partial supposedly complete manifest. The raw SQL
revoked-sticker query is an ORM exception: viewer ACL must precede DISTINCT/LIMIT
across all selected rooms, and ordinary ORM relation queries do not provide this
bounded grouped projection. All values, including the captured clock, are bound.

## SEND and durable compatibility

SEND requires membershipScope; malformed/missing/noncanonical tokens return
400 INVALID_REQUEST. Structural input validation may precede authentication, as before. For a well-formed
scope, authentication/SOOP checks precede mismatch handling; in the command
transaction the room and current active membership are locked and freshly checked
before **either** committed or deleted prior-receipt handling. A well-formed but
unequal scope returns 409 MEMBERSHIP_SCOPE_MISMATCH with only the error code,
never an expected token, period, actor or hint. C06 adds no migration; the integrated contract retains schema 17 content_epoch invalidation.

The payload digest stays byte-compatible `message-command:v1:` HMAC SHA256 over
JSON fields in this exact order: clientMessageId, intent, recipientActorId, quoteId,
content. Keep existing normalization and nulls; M/A are excluded. Uniqueness stays
room/actor/clientMessageId across periods. No automatic scope rebinding or replay:
an old pending intent stays blocked; a new explicit user action creates a new
intent/key. Scope renewal alone never grants permission to resend old content.

## Public display order and cache merge

Display only the sparse authorized loaded set, ascending by canonical millisecond
UTC createdAt then lowercase UUID ASCII, without locale comparison. This display
key is immutable. Internal created_order remains the history boundary; capture
that boundary before sorting a copy of the selected response. Event log ordering
stays event_order, never display order. Treat versions as uint64 decimal strings
and compare with BigInt/lossless integers. Within the same account, room, local
cache generation and M/A context, an accepted tombstone is terminal: lower, equal
and higher-version live upserts/history cannot resurrect it. Newer tombstones may
advance the stored version and event checkpoint; ignored live events still allow
the response cursor to commit atomically. Immutable display-key validation remains
in force, including for rejected resurrection attempts.

Reset requires a different, fresh cacheId; reusing the current cacheId cannot erase
tombstones. An authority change requires a fresh fenced local cache generation and
an authoritative, freshly authorized snapshot. Old-generation responses must never
merge into it, even when M/A later cycles back to an earlier value. This cache reset
is not a message-restoration or ID-reuse contract: server deletions remain irreversible,
and any newly visible projection must come from that authorized snapshot.
