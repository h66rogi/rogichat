# Web profile and default room contract

The self profile remains the source of the current nickname; rendering never writes
provider defaults over a manually saved profile. Optional additive fields are
`soop: { displayId: string } | null` and `providerAvatarUrl: string | null`.
Only home and own settings display the SOOP ID; the internal account UUID is not a
display ID. Older API responses without these fields remain readable.

Persisted `avatar.assetId` takes priority and uses the existing authorized media
reader. Otherwise a validated canonical SOOP CDN image may be displayed on the
self profile with no referrer. Missing photos have a neutral fallback; failed
images expose retry. Explicit deletion sends `avatarAssetId: null`, rereads the
profile, and verifies both sources were removed. Nickname edits omit avatar fields.

Actor profiles may include `providerAvatarAvailable: true`. Chat uses
`POST /v1/rooms/:roomId/actors/:actorId/provider-avatar/access {}` and accepts only
an opaque ticket at the configured API origin's `/v1/profile-images` endpoint.
The byte request omits cookies, CSRF and referrer, rejects redirects, and allows
only JPEG/WebP up to 2 MiB. Blobs expire within 60 seconds of starting admission
and are revoked on room/session loss. Repeated visible references to an actor
share one scoped reader. Anonymous publications never gain author images or IDs.

The configured default room UUID wins. Without it, only the unique server
`isDefault: true` marker selects a room, never its name or position. Pagination is
bounded and ambiguous results fail closed. `availability: OWNER_PENDING` exposes
the real room and a refresh control but prevents joining. `READY` uses the normal
join flow; opening home never joins automatically. Creating the genuine room and
verifying its owner are backend responsibilities.
