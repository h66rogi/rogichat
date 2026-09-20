# Web media module integration contract

This is an independently consumable image media module, **not wired product UI,
M08/M09 acceptance, runtime activation, or deployment**. QA remains frozen at
`049a1971b3905159235a4be785cbfc6310cb9fd7`. No core transport, controller,
private-session, composer, timeline, settings, shared UI, dependencies or workflows
are changed. Video remains unavailable; it is not silently downgraded to an image.

## Immutable backend source

Authoritative coordinator handoff: backend integration
`46bca354c96c4ce972ecf5320f6706e20041d161` (draft PR #52).
Read with `git show`; reference checkouts were not modified or merged. These
contracts match this module's QA base. Paths below are relative to `apps/api/src`.

| Contract | Path | Git blob |
| --- | --- | --- |
| Routes | `modules/media/media.controller.ts` | `d25d4c862245d0c427cc50ba960cd4ef121a45d9` |
| DTOs | `modules/media/dto/media.openapi.ts` | `41f2621ff2a058fdda815ee49228035e80e44018` |
| Auth/upload/signing | `modules/media/media.service.ts` | `09688565366ed50457452d2839c26841c3b5a182` |
| READY, membership, exact references | `modules/media/media-core.service.ts` | `e724864cce48074b0c0f43f9f5e33978eebe8fff` |
| Input limits | `common/media/media-policy.ts` | `025cf5f1160701e95ef7c70461d97a6176176130` |
| Sticker catalog | `modules/stickers/dto/sticker.openapi.ts` | `8dba52dd11e940daef8b6a3db660d0ad4be1b07f` |
| Profile/avatar | `modules/users/dto/profile.openapi.ts` | `c503bdadc380039038c604dbfb9c611430ab5f31` |

Also inspected at that commit: `modules/stickers/stickers-core.service.ts`,
`modules/users/dto/update-profile.dto.ts`, `modules/auth/auth-context.ts`,
`modules/media/adapters/media-store.ts`, `docs/backend-m08-m09-checkpoint.md`,
and `docs/backend-video-worker.md`. Registered runtime OpenAPI overrides optional
offline route documentation: source availability is not a commissioned route.

## Wire behavior

- `POST /v1/media/upload-intents`: `{kind, contentType, byteLength, roomId?}`;
  201 `{assetId, status: 'reserved'}`. PHOTO requires a room; AVATAR/STICKER omit it.
  PHOTO/AVATAR admit JPEG/PNG/WebP up to 10 MiB; STICKER PNG/WebP up to 1 MiB and
  requires server-side `manage_stickers`. No client capability grants authority.
- `POST /v1/media/upload-intents/:assetId/content`: exact
  `application/octet-stream`, raw Blob, cookie credentials and current CSRF.
  Browser supplies Content-Length if appropriate. No multipart, query, encoding,
  presigned PUT, app-generated IDs, or speculative completion call.
  202 `processing` is never usable media.
- `GET /v1/media/upload-intents/:assetId`: same UUID with one of `reserved`,
  `uploading`, `processing`, `ready`, `deleting`, `deleted`. There is no wire
  `failed` enum or failure-detail field. Deleting/deleted is unusable.
- Create has **no idempotency key or lost-response lookup**. A lost creation
  response leaves an uncertain state without automatic replay. Lost upload
  responses preserve the exact asset ID; explicit refresh only queries status,
  including if it is still reserved. Discard is a user choice and may leave a
  server reservation for cleanup; it is not server deletion or cancellation.
- Polling is sequential, at most 30 attempts with two-second intervals by
  default. Each metadata request has a 15-second bound, upload five minutes,
  storage GET 30 seconds or remaining authorization lifetime. Metadata JSON is
  limited to 64 KiB using both declared Content-Length and actual streamed bytes
  before parsing; this accommodates the 50-item catalog with escaped labels.
  Rejected or aborted bodies are cancelled and reader locks released; malformed
  JSON returns INVALID_RESPONSE without exposing payload text. Cancellation
  aborts current transport and polling; every completion checks lifetime and
  operation generation. No persistence or background replay exists.
- `POST /v1/media/assets/:assetId/access`: exact context and `variant: 'image'`;
  response is exactly `{url, expiresIn: 60}`. Owned unattached preview uses no
  context. Message image uses roomId/messageId; avatar uses roomId/actorId;
  sticker uses roomId/stickerId and messageId for historical references.
  Access admission independently checks READY and current ACL; upload status is
  uploader-only and must not be called for other people's display references.
- The separate signed GET uses `credentials: 'omit'`, no API headers, no
  referrer, no redirects and no cache. Explicit exact HTTPS storage origins must
  be supplied from reviewed deployment configuration; empty means unavailable.
  Response-provided headers and other response fields are rejected. The loader
  accepts only bounded JPEG/PNG/WebP responses (10 MiB), then owns one local blob
  URL, expiring conservatively 60 seconds from **before** authorization starts.
  An expired image is cleared and requires explicit reauthorization to reload.
  Already issued server URLs cannot be revoked before server expiry; local
  generation invalidation still immediately removes local content.
- `GET /v1/rooms/:roomId/stickers?after=UUID`: strict `{items: [{id, label,
  assetId}], nextCursor: UUID|null}`, at most 50. Empty is a real empty catalog.
  Sending uses `content: {type: 'STICKER', stickerId: item.id}` through the sole
  command owner, never the image asset ID. Uploading a STICKER does not register
  or activate it: operator registration/approval UI is outside this module.

## Exact integration responsibilities

The single integration owner on `web-command-sync-v2` consumes
`apps/web/src/features/media/index.ts`. This does not alter the C06
`691aff80` / C05 `492f2f75` consumer contract or activate v2.

1. Construct one `MediaClient({apiOrigin, storageOrigins, csrf, lifetime})` per
   current authorization scope. `csrf()` must return the current session proof.
   `lifetime` is `{signal, isCurrent}` bound to identity **and** membership period
   and the visible message/avatar/sticker reference. Abort synchronously on
   logout, SOOP/link invalidation, room loss, actor replacement, deleted message,
   revoked sticker, or scope replacement. Merely rerendering with new props is
   insufficient for retained objects: abort the old lifetime first. The predicate
   provides an additional late-completion/render fence, not an event source.
2. For an attachment draft, construct `MediaUpload(client)` and render
   `MediaUploadPanel` with the same lifetime, kind, roomId (PHOTO only), and
   `onReady(assetId)`. `onReady` is an explicit use action, not upload acceptance.
   Only the existing command owner may turn it into a real message command;
   retain its immutable command/retry identity and fresh server authorization.
   Clear on removal and dispose when the owning scope is destroyed. Changing
   draft kind or room requires a distinct controller/lifetime. Panel unmount
   clears local state and aborts requests; it does not delete the server asset.
3. In the real settings ProfileSection, AVATAR `onReady` feeds the existing
   profile mutation `{avatarAssetId}` to `PATCH /v1/me/profile`. Removal is an
   explicit `{avatarAssetId: null}` command; omission preserves it. Profile
   persistence and response projection belong to that owner. Do not optimistically
   claim profile success. Use the canonical profile avatar reference afterward.
4. For timeline/avatar/sticker display, construct one `MediaImageResource(client)`
   per exact visible reference and render `AuthorizedMediaImage` with stable
   context, the same lifetime and meaningful localized `alt`. The component
   checks its reference key before displaying a blob and clears on unmount;
   dispose the resource at scope destruction. No Next image proxy, service-worker
   caching, generic draft storage, analytics payload, or logs may retain media.
   `MediaClient.stickers()` is the catalog adapter; its consumer must fence list
   state with the same lifetime and replace/clear it on revocation.
5. No core API adjustment is required: `MediaClient` owns its narrowly scoped
   raw-binary and metadata transport. If consolidating later, preserve all
   credentials/CSRF/timeout/redirect/schema/lifetime rules and the separate
   credential-free signed GET. Do not pass generic request headers to storage.
6. `apps/web/package.json` now includes `src/features/media/*.test.ts` in
   `test:unit`, so hosted unit runs execute this suite. This single script change
   is the authorized shared-file exception; dependencies and workflows are unchanged.

## Remaining runtime and release gates

- UI wiring, profile mutation reconciliation, catalog UI, actual command enqueue,
  browser keyboard/a11y checks and cross-scope interaction tests remain owner work.
- Actual QA media routes/R2 configuration were not commissioned at handoff.
  Validate runtime OpenAPI, authenticated upload/processing/READY, rejection,
  capacity/429 recovery, signed GET CORS/content type, CSP `img-src blob:`, expiry,
  revoked membership, cross-room denial, avatar replacement and sticker revocation
  using the deployed immutable backend. No storage-origin allowlist is fabricated.
- M09 source documents video/poster and processed H.264/AAC but explicitly retains
  browser/native codec, real R2 Range/seek and expiry reauthorization acceptance
  gates. No verified browser video-seek contract/evidence was supplied, so this
  image module deliberately exports no VIDEO upload/player or guessed position
  recovery behavior. Add that surface after those contracts and gates are frozen.
- All-web/native/backend compatibility and rollback remain prerequisites for v2
  activation. No QA/main merge, rollout or host configuration is part of this PR.

## Validation and impact

Run from `apps/web`:

```sh
node --import ./src/features/chat/testing/register-ts.mjs --test src/features/media/media.test.ts
```

The 23-test dedicated suite covers strict schema/context checks, non-READY rejection,
bounded polling, immutable status retries, uncertain create/upload, delayed and
stale completions, identity revocation, blob cleanup on unmount/expiry, URL origin
and content restrictions, bounded streaming, zero credential forwarding, and
catalog pagination. Test bytes exist only in the isolated unit file.

Correction validation uses Node 24.21.0. Focused TypeScript and typed ESLint
reuse the integration owner's existing dependencies read-only in a temporary
copy outside this checkout. The copy preserves `src/features/media` paths and
uses the **unchanged** repository `eslint.config.mjs` and `tsconfig.json`, plus
exact copies of the imported shared button and `cn` helper. Commands are
`eslint src/features/media --max-warnings 0` and
`tsc -p tsconfig.json --noEmit --incremental false`. A temporary negative control
removing one test registration's `void` correctly fails `no-floating-promises`;
all 23 registrations with `void` pass. The Next pages-directory notice reflects
the focused copy, not a disabled rule. The original author's focused lint claim
was insufficient: these typed rules caught the original 18 registrations.

No dependency installation, full local build, media binaries or dependency writes
are involved. Hosted CI remains authoritative for full build/browser/container
checks. Security all and Git hooks are mandatory.

Impact is additive: no existing runtime imports this module yet, no API or DB
shape changes, only the authorized test script changes a shared file, and no native consumers depend on these
new symbols. The important integration risks are lifetime wiring, media route
commissioning, exact storage-origin configuration/CORS, and actual browser/runtime acceptance.
