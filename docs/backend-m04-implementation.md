# M04 profiles, rooms and authorization

2026-09-20. Backend implementation; real login, media and message delivery remain separate gates.

## HTTP surface

All routes use the current session/account and the response query in one fresh writer snapshot.
Commands use a single bounded transaction with locking authorization reads. Every mutation needs
exact environment Origin and the current session CSRF token. Chat/room operations also require
the current verified SOOP link; account self-profile is available before linking.

| Endpoint | Projection / permission |
|---|---|
| `GET/PATCH /v1/me/profile` | Own UUID, nickname, avatar placeholder, optional month/day, one global streamer-visibility choice |
| `GET /v1/rooms?after=<room UUID>` | At most 50 discoverable/current rooms; own membership actor only, no participant list |
| `POST /v1/rooms/:roomId/join` | Idempotent active join; membership actor and snapshotted policy/version/start order |
| `POST /v1/rooms/:roomId/leave` | End current membership; owner must transfer first (transfer is not yet exposed) |
| `POST /v1/admin/rooms` | Explicit `manage_rooms`; explicitly selected enabled creator with verified link becomes owner |
| `PATCH /v1/rooms/:roomId/history-policy` | Current owner or explicit room manager; affects future joins only |
| `GET /v1/rooms/:roomId/actors/:actorId/profile` | Full replacement of this viewer's permitted profile projection |
| `GET /v1/rooms/:roomId/profile-revisions?after=<actor UUID>` | Current room streamer only; bounded revision refresh page |

Strict body allowlists reject user/role injection, birth year, arbitrary avatar URLs, unsupported
policies and malformed identifiers. Nickname is NFC, trimmed, 1–40 Unicode code points, with
control/format characters rejected. Room names use the same normalization with an 80-point bound.
Avatar remains `null` until M08 introduces authorized, processed asset references; external URLs
must not be accepted as a temporary shortcut. Media/sticker policy and upload execution are later
milestones, not implicitly enabled by these profile endpoints.

## Privacy and membership

Birthday is a valid month/day (including February 29), nullable, private by default. One stored
choice applies to all current/future rooms. A viewer receives a `birthday` field only when both
people are currently active in the same room, the viewer's role **in that room** is STREAMER,
and the subject opted in. Global creator or admin status never grants birthday access. In FAN
rooms fans cannot enumerate other fans' profile/activity; GROUP members can see ordinary profiles.

Room actors are room-scoped UUIDs, not global user UUIDs or provider IDs. Revisions are opaque HMACs
of the viewer's visible projection and membership scope. A hidden birthday-only change does not
alter a fan's revision. Streamers receive a changed revision on visibility withdrawal; fetching
the replacement profile removes the field rather than merging stale birthday data.

Revision responses are explicitly `partial: true`, with 50-item pages and `next`; they are not
an authoritative full-room cache purge manifest. Clients must not remove unlisted actors after
one page. M06 adds generation-stable sync, privacy-scoped hints, offline refresh and cache purge
integration tests. Current pages support >50 participants without returning unbounded responses.

Joining snapshots the room history policy and commit-order boundary. Later policy changes do not
rewrite an existing membership period. Leave/rejoin creates a new period with the new policy.
Room lock precedes its counter; concurrent joins remain unique. FAN/GROUP and many rooms/users
share one model; there is no hard-coded first user, first room, or streamer identity.

Room creation and history-policy changes append bounded, body-free audit events in the same
transaction. Admin capabilities and creator registration remain explicit operations; no public
self-grant or first-login promotion endpoint exists. Invite/approval/password join policies are
reserved in the model but rejected until their actual verification workflow is implemented.

## Access predicates and later integration

`canReadMessage` requires active account/link/room/member/period, matching room scope, history
boundary, unblocked original/deletion root, and either ROOM_SHARED or a current positive grant
for the **exact stream and member**. Room owner publication authority is a separate predicate:
current STREAMER owner may publish any available restricted source in that room without fan
consent, independently of ordinary read grants/history. It still cannot bypass original deletion,
moderation, inactive state or cross-room scope.

These pure predicates are not yet message endpoints. M05 must load their facts with message
content in the same snapshot, test real deletion/grant races and retain the unrestricted author
delete→published-copy cascade. No message TTL cleanup is introduced: chat retention remains
until an authorized deletion request. Right-to-left swipe is the client's private-reply gesture,
not a reason for the backend to infer reply audience from an ambiguous payload.

Independent fixture tests cover fan/streamer/admin/non-member matrices across multiple rooms,
new-room consent, withdrawal/revision privacy, cross-room actors, CSRF, revoked identity, initial
owner provisioning, policy/rejoin snapshots, bounded pages, and read/publication denial matrices.
Tests do not establish the separate 1,000-connection performance target; M12 owns that load gate.
