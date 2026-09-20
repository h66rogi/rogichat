# Initial SOOP profile and default room

## Identity and profile

The broker retains its exact, case-sensitive canonical SOOP subject namespace.
Optional `profile: {displayId,nickname,imageUrl}` comes only from the authenticated
token-holder station response. The API accepts both the previous broker envelope
and this additive envelope. No nickname, public search result or guessed image
URL is an identity source. Invalid display fields are omitted/null at the broker;
conflicting identity evidence is rejected. Provider tokens never reach this API.

First verified metadata initializes the existing user UUID in the login transaction.
Only an untouched `새 사용자` nickname is replaced. Legacy profiles with revision
greater than one are conservatively treated as customized. Explicit nickname edits
and avatar changes (including clearing a null avatar) are recorded permanently.
Subsequent OAuth does not synchronize or overwrite an initialized profile.
Initialization and avatar removal emit profile-change records and realtime hints
atomically. Account cleanup removes the stored display metadata.

`GET/PATCH /v1/me/profile` adds `soop: {displayId} | null` and
`providerAvatarUrl: string | null`. These fields are self-only. The session contract
does not change. Actor profiles/profile sync only add optional
`providerAvatarAvailable: true`, never an account ID, provider URL or provider ID.
User-uploaded avatars take priority; the existing R2 access policy is unchanged.

Existing sessions cannot recover metadata from previously discarded provider
tokens. One ordinary OAuth after the new broker is live initializes an untouched
existing account without changing its UUID; it is not a new-account migration.

## Authorized provider image transport

- `POST /v1/me/provider-avatar/access`
- `POST /v1/rooms/:roomId/actors/:actorId/provider-avatar/access`

Both accept no body or `{}` and return `{url,expiresIn:60}`. They require normal
cookie+CSRF or native proof, verified SOOP and current viewer authorization.
`GET /v1/profile-images?ticket=...` consumes a credential-free encrypted capability;
the target account, FAN visibility, room membership, block and current avatar are
rechecked before every read. Tokens are AES-256-GCM, keyed by an audience-separated
derivation of the existing authorization key/epoch. Rotation invalidates tickets.
Tickets contain no plaintext identity or source URL. Do not persist or log them.

Only exact canonical HTTPS SOOP profile CDN paths are fetched; redirects and
arbitrary URLs are forbidden. Maximum response is 2 MiB, deadline five seconds,
four concurrent reads per API process. After each current ACL check, identical
source reads share one download and a 30-second byte cache (max 32 entries/16 MiB).
At most 32 distinct downloads wait, with a four-second queue deadline. No cached
authorization or credentials are reused. JPEG/WebP MIME and magic are required.
Issue/read quotas are committed independently (120 per viewer/minute each).
Responses are private/no-store, nosniff and no-referrer. Clients retain image bytes
only within the admitted lease and discard them on account/scope changes. This
read-only provider path does not require R2 write credentials.

## Fresh and existing database bootstrap

Migration `20260920165804_soop_profile_default_room` is unmodified Prisma output:
two optional SOOP metadata columns, three profile provenance flags and a singleton
default-room binding registry. It does not create users or assign privileges.
After migration readiness, the official migration entrypoint invokes the versioned
`dist/modules/owner-bootstrap/default-room-initialize.js` with runtime DML credentials.
Migration/initialization succeeds only after the real catalog graph is committed.
The API also awaits the same idempotent catalog barrier before HTTP listen/ready.
No manual operator room creation is needed; Prisma's raw CLI alone is not the
service's official migration/initialization entrypoint.

The stable catalog room UUID is `bdcc3129-e4a8-49ec-9491-ce9ca62cb5d3`, display name
`후로기`, mode `FAN`, initial history `SINCE_JOIN`. The room, counter and shared
stream are created atomically, initially CLOSED without a fake owner. Directory
responses identify it with `isDefault:true, availability:OWNER_PENDING`; it cannot
be joined until the real owner is bound. Other closed rooms remain undiscoverable.

Optional `DEFAULT_ROOM_SECRET_FILE` is a protected regular file (max 2 KiB;
root/runtime-owned, private permissions) containing only `expectedSubject` and
optional UUIDv4 `roomId`. Keep the actual operator-provided subject outside this
public repository. Without the file, the real pending room still exists. With it,
the existing independent identity guard key pins the expected subject digest.
Only an exact ACTIVE/VERIFIED SOOP identity without deletion fences can be bound.
The application grants that account creator status and STREAMER membership, not
administrator capabilities. No first-user, nickname or GitHub-name inference.

Multiple API instances serialize on the singleton registry and reuse the graph.
An unrelated preexisting catalog-ID room is a conflict, never silently adopted.
After binding, bootstrap never reopens, recreates or overwrites a changed/deleted
room. Missing owner is retried every ten seconds; successful binding stops polling.

## Rollout and rollback

1. Review exact generated migration/checksum and protected configuration separately
   for QA and production. Preserve all previous migration files and history.
2. Apply and initialize through the environment-owned approved migration job, then deploy the new
   API/worker. Verify readiness, schema, same existing sessions and real default
   room while the old broker remains active. New API accepts the old envelope.
3. Only after **both QA and production** API checks, activate the profile-capable
   broker. Old API strict parsers reject its additive field.
4. Complete one approved normal OAuth and verify same UUID, real metadata, manual
   edits preserved, avatar reads and default room ownership. Do not print PII or
   tokens in evidence.

For rollback, revert the broker first, then an API release compatible with the
additive schema. Do not remove columns or reset database history. Public API/web/
native integration and deploy remain owned by the infrastructure coordinator;
the broker Node6 release has its existing separate owner.
