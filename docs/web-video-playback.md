# Bounded WEB video playback leaf

This leaf implements M09 video access and native playback; final chat mounts belong
to the media composition owner. It does not implement VIDEO upload/SEND. Backend
contract was read at `f4c89d853a7c5e35a8d542e6bd383c72009f5568` (media controller,
OpenAPI, media-core authorization and isolated video decoder), on the media base
`fa3ddfe7243936e7564cba004f1c69644a00a50f`.

## Contract and integration

- `VideoClient` takes `MediaClientOptions` plus mandatory `budget: { reserve(bytes):
  () => void }` and mandatory `verifySession(signal)`. Pass the existing session's
  shared `MediaByteBudget`, configured storage origins, CSRF/session verification
  and unauthorized callback. Never instantiate a per-video budget. Structural
  typing keeps this leaf independently compilable before the owner lands its module.
- `MediaVideoResource(client)` owns pending operations, native video element,
  object URLs and budget releases. Dispose it when its visible reference ends.
- `VideoPlayer({resource,lifetime,assetId,context:{roomId,messageId},revision})`
  exposes an explicit load action, real native controls, unavailable/retry and
  unsupported-codec states. Context/resource must be stable. Supply a lifetime
  that synchronously aborts on account/session, room/membership, visibility gate,
  message deletion and revision changes; `isCurrent` additionally fences late work.
  Use the same lifetime on the client and component. A changed revision/reference
  resets the playback position and hides the previous element before effect cleanup.
- No access occurs before user load. No signed URL is given to the video element,
  state store, local persistence, service worker cache, image proxy or logs.
- One max video/poster pair reserves **60.125 MiB**. Before explicit video loading,
  composition must release inactive/offscreen image reservations or provide a
  usable capacity retry; image history must not indefinitely starve video.

Access is POST `/v1/media/assets/:assetId/access` with `variant: video|poster`,
`roomId` and `messageId`, yielding `{url,expiresIn:60}`. Backend signs only after
fresh room/message authorization and checks all variants against original deletion.
M09 produces a fast-start, ordinary MP4 (H.264/yuv420p/30 fps; optional AAC stereo
48 kHz), up to 50 MiB, and WebP poster up to 2 MiB. It is not fragmented MP4, so
feeding arbitrary ranges into MSE would not be a valid implementation.

The first storage request probes `bytes=0-0`; total capacity is reserved before
requesting payload. Remaining requests are sequential ranges of at most 1 MiB.
Each requires status 206, exact Content-Range offset/end/unchanged numeric total,
matching MP4/WebP content type, exact body length and consistent Content-Length
when present; encoded responses, 200 fallback, overflow and truncation are rejected.
Storage must expose Content-Range and a strong ETag over CORS. Every range must
carry the same strong ETag; weak, missing or changed identity is rejected even for
same-size objects. Requests omit credentials, use
no-store, refuse redirects and suppress referrers; API credentials/CSRF are never
copied into storage requests. The backend object is addressed by the same lease URL throughout assembly; ETag
consistency additionally rejects replacement between ranges.

This is a **bounded complete rendition download through validated ranges**, not
progressive network playback. Seeking uses the assembled local MP4. There is no
unbounded download or arbitrary browser limit below the backend's 50 MiB contract.
The transfer's 60-second deadline begins before access admission. The earlier of
poster/video deadlines aborts partial work and revokes both retained resources.
At playback expiry, the resource captures time/rate/playing state, detaches native
sources, revokes URLs/releases reservations, then requests fresh authorized leases only while actively playing and visible.
Paused/ended/offscreen/background resources release their bytes and retain only
position/rate for an explicit reload; they do not repeatedly download in the background.
`loadedmetadata` restores position and attempts resume; a denied browser play()
requires the native user gesture. Failed reauthorization stays unavailable without
an automatic retry loop or old media. Media errors never display upstream details.

## Allocation boundary

Each lease reserves its total declared bytes plus 4 MiB + 64 KiB transfer/metadata
scratch. Range buffers become immutable Blob parts immediately; the final
`Blob(parts)` references those immutable parts, rather than allocating a second
full-file ArrayBuffer. Releases are idempotent; failures, cancellation, expiry,
reference changes and disposal relinquish all owned reservations and URLs. These
are application-owned reachable bytes, **not a promise about total browser RSS**,
decoder surfaces, transport internals, GC timing or browser-managed Blob backing.
The application does not write media to persistent browser storage.

Source basis for the immutable-part model:

- [Chromium Blob storage design](https://chromium.googlesource.com/chromium/src/+/master/storage/browser/blob/README.md)
  describes referenced Blob dependencies and browser-managed storage.
- [WebKit BlobRegistryImpl](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/network/BlobRegistryImpl.cpp)
  resolves Blob parts by appending existing storage items, rather than concatenating
  all content into an application ArrayBuffer.
- [File API](https://www.w3.org/TR/FileAPI/) specifies Blob byte sequences and
  immutability; it does not specify a cross-browser hard physical-memory limit.

## Evidence and outstanding release gates

Focused unit tests cover the 50 MiB boundary, partial/range failures, aggregate
capacity, idempotent release, stale lifetime responses, cancellation, expiry,
position/rate/resume preservation, revision changes and late completion. The
isolated browser test imports the production client/resource code and exercises
actual H.264/AAC decoding, native play/seek, 60-second reauthorization with position
restoration and abort removal of sources/budget. It runs in existing desktop and
mobile Chromium projects; synthetic HTTP stays under tests and fixtures are generated in a temporary directory
using the existing ffmpeg CLI, then deleted. No binary fixture is committed (the
public scanner disallows unreviewed binary source formats). CI must have ffmpeg
with libx264/AAC/WebP available; no test silently skips a missing codec tool.

Local receipts: focused unit suite, full web TypeScript check, focused ESLint and
both isolated Chromium projects pass. No heavy local Next/container build or new
dependencies were used. Per coordinator CI consolidation, publish the leaf branch
and integrate into the media draft PR (#67); full browser/container/security gates
are examined there instead of creating another whole-matrix PR.

These receipts are not deployed QA playback proof. Final mounted chat integration,
current-QA composed CI, actual R2 exposed Content-Range/ETag/expiry/Range/ACL, actual iOS/Safari
and Android devices, and device memory behavior remain release gates. No server,
DNS, Caddy, QA merge or deployment is performed by this leaf.

Fixture generation (only test assets, synthetic color/tone):

```sh
ffmpeg -f lavfi -i color=c=navy:s=160x90:r=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 3 -c:v libx264 -pix_fmt yuv420p -threads 1 -c:a aac -ac 2 -movflags +faststart video-playback.mp4
ffmpeg -i video-playback.mp4 -frames:v 1 -c:v libwebp video-poster.webp
```
