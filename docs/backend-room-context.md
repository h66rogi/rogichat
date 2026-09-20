# Room authority and private recipients

## Authoritative viewer context

Use the existing authenticated `GET /v1/sync` membership manifest. Each room
already supplies `roomId`, `name`, `mode`, `actorId` and `role`, with an opaque
generation and the existing reset/continuation contract. There is no separate
`/context` API and no client-selected role or inferred first/default room.
Message/profile sync continues to enforce the captured participation boundary
and current grants. A visible profile alone is not proof that a private message
can be sent to it.

## FAN-room private-recipient picker

`GET /v1/rooms/:roomId/private-recipients?after=<actor UUID>` requires a current
authenticated, SOOP-verified account with an active membership/participation in
an active FAN room, with role STREAMER or FAN in that exact room. STREAMER viewers
receive eligible FAN actors; FAN viewers receive eligible STREAMER actors only.
Fans never receive other fans. GROUP/MEMBER viewers, administrators without the
appropriate room membership, and streamers in another room cannot use this list.
The target need not be the room owner: the existing send policy permits any
eligible opposite-role actor in that room, including a first message with no pair.

The only successful response fields are:

```json
{
  "recipients": [
    { "actorId": "<room actor UUID>", "nickname": "<nickname>", "avatar": { "assetId": "<asset UUID>" } }
  ],
  "next": null
}
```

`avatar` is null unless the current profile references its own READY, undeleted,
globally scoped AVATAR asset. No signed URL, storage key, account/provider ID,
birthday, grant/stream ID, total count or activity indicator is included. The
existing actor-profile media access route must separately authorize any URL.

Candidates must be active opposite-role participants with active accounts, verified SOOP
links and profiles. No pair means the existing send command may create it. An
existing pair must reference a RESTRICTED stream and have both participant
grants currently valid (`valid_from <= DB now`, no revocation, no expiry or
`expires_at > DB now`), both readable, and the sender's grant sendable. The target's
`can_send` is deliberately not required. Missing/revoked grants are never
repaired, including after re-entry. The current schema has no separate stream
status. History boundaries restrict old messages; this endpoint neither reads
nor expands history.

The entire authorization and projection use the same read-only transaction.
Generated Prisma queries load fixed 100-candidate keyset batches and batch
pair/grant relations, without per-recipient queries. Eligibility is evaluated
before appending to the 50-result response and its one eligible lookahead.
`next`, when non-null, is always the last returned eligible actor ID, never a
skipped or lookahead ID. If 10,000 scanned candidates do not prove exhaustion or
provide 51 eligible rows, the request fails with 503 instead of falsely returning
an empty/exhausted page. The existing transaction deadline still applies.

Pages are fresh snapshots, not a stable catalog generation. Re-fetch on opening
the picker; preserve ordinary pagination behavior, and discard its cache when
session/room authority resets. Being listed is advisory only: a concurrent
leave, grant expiry/revocation, account change or other policy change may make
the subsequent send fail. Every send independently reauthorizes and does not
trust this response. Use profile sync for profile cache replacement, not this
list, and never treat `next: null` as permission to purge unrelated profiles.

## Verification

Dedicated unit tests cover eligible lookahead, bounded scans and exact grants.
Disposable MySQL HTTP fixtures exercise session/role isolation, minimal DTOs,
current membership/profile state, revoked pairs after re-entry, and multi-batch
pagination. Synthetic data exists only inside these isolated tests; no runtime
seed, schema migration, new infrastructure or public credential is introduced.
