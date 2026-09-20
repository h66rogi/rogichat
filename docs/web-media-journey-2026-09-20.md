# Avatar and photo integration on the current web transport

This branch starts at PR #66 `83061701fa94f39fb4555e381218c3f8e8f0fc6b` and
preserves its room-entry 401 recovery and post-ACK fresh read. It uses the current
API v1 cookie/CSRF transport; it does not activate the separate schema 2 branch.
PR #66 passed 82 unit tests, 126 production browser tests and all required CI.

## Product changes

- Settings reuses `MediaUploadPanel`/`MediaUpload` for AVATAR. Only the explicit
  READY use action issues `PATCH /v1/me/profile {avatarAssetId}`. It then rereads
  the persisted profile and reconfirms the same session before showing success.
  Failed saves retain the upload; removal explicitly persists a null avatar.
- Each selected chat recipient has a separate photo upload draft. Photos are
  sent separately from text, so sending a photo does not discard a text draft.
  Processing/202, avatars and other-room uploads cannot become PHOTO commands.
  The existing command owner sends `{type: PHOTO, assetIds: [id]}` with its
  immutable retry identity/payload and fetches the real timeline after its ACK.
- PHOTO attachment and STICKER references are retained from the real message
  DTO and rendered by `AuthorizedMediaImage`/`MediaImageResource`. Each access
  request binds the exact asset, room and message; sticker requests also bind
  the sticker ID. Anonymous publications retain no author/source linkage.
  This batch renders received stickers but does not introduce sticker sending
  or VIDEO upload/playback. Non-image content remains an honest unsupported row.
- `MediaSessionScope` binds media operations to the current account and room
  epoch. Room/session loss and deletion abort requests and revoke blob URLs
  synchronously. Each metadata response and completed image transfer reconfirms
  the session before it becomes usable; a changed account cannot display bytes
  under the old scope. Ordinary disposal is not interpreted as global logout.
  React effect replay allocates fresh owned resources instead of reusing a
  disposed upload/image controller.

## Contracts and configuration

The reused primitives and pinned backend contracts are recorded in
[web-media-integration.md](web-media-integration.md), including backend source
`46bca354c96c4ce972ecf5320f6706e20041d161`. The wire DTOs in that report were
checked against this tree's media/profile/message controllers and projections.
PHOTO send stays on `/v1/rooms/:roomId/messages`, not command schema 2.

`ROGICHAT_MEDIA_STORAGE_ORIGINS` is an optional JSON array of exact, reviewed
HTTPS origins. It defaults to an empty array. Wildcards, URL paths, credentials,
duplicate origins and API origins are rejected. No real signer origin is
invented or installed by this change. This is public deployment configuration,
not a server permission grant or proof that media processing is available.
Empty configuration disables upload affordances and leaves display unavailable;
configured operations still require the server's actual admission and READY.
Storage GETs retain the primitive's no-cookie/no-CSRF/no-referrer boundary.

The Playwright server alone supplies a synthetic intercepted signer in its test
environment. Synthetic PNG bytes and server DTOs exist only under `test/e2e` and
unit tests; they are not product adapters, fallback data or runtime defaults.

## Verification and remaining gates

- Local: 90 web unit tests, TypeScript and ESLint passed with retained dependencies.
- New unit coverage: READY-only sends, immutable photo retry payloads, wrong-kind
  and cross-room rejection, late ACK after room disposal, exact image DTOs,
  anonymous projection, account change during signed transfer, immediate blob
  revocation, and default-empty origin configuration.
- New production browser regressions cover AVATAR processing, failed save,
  persisted reconciliation/removal, PHOTO retry, preservation of the separate
  text draft, exact message access context and blob revocation after deletion.
  Browser execution belongs to hosted CI; no local heavy build was performed.
- At the initial audit, live API `f6958c5b344e0a50aa519c02be433c6c90477ec2`
  exposed no media upload/access or sticker catalog routes in
  `/docs/openapi.json`, and no push routes. Source support is not deployment
  activation. Real media acceptance requires commissioned API/worker/storage,
  exact reviewed signer configuration, browser storage CORS, real account/room
  authorization, and observed processing/READY/display/send. None is claimed
  from synthetic tests or a source commit.
- The parent owns integration, QA merge and release verification. Push module,
  service worker, backend, infrastructure, lockfiles and dependencies remain
  outside this media change. Future schema 2 integration must preserve both its
  command fences and this media lifetime/READY behavior through an explicit review.


## Catalog and capacity extension

The mounted picker reads one real server catalog page (maximum 50 references),
requires explicit selection and sends the catalog ID, not its image asset ID.
Failed writes keep the exact selected command for explicit retry. No synthetic
catalog or automatic send is part of the product. Photo drafts are capped at two
recipient targets; sticker selection holds one page and one preview.

A shared 64 MiB application byte budget reserves bounded image transfer capacity
before network admission, then shrinks retained reservations to the verified Blob
size. Abort, disposal and expiry release leases synchronously. This bounds tracked
application resources, not total browser process or decoder RSS. Focused tests
cover overflow, non-cooperative late responses and mixed tiny-image/maximum-video
reservation admission. Video mounting remains a separate pending integration.

After the infrastructure owner confirmed the broker and query-log reload, the
owned real QA page consent checkbox and login button navigated to the actual SOOP
credential screen (provider hostname and visible ID/password fields observed).
No credentials were entered; this is provider-entry evidence only, not evidence
of a completed callback, authenticated session, actual room or message delivery.
