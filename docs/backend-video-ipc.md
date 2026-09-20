# Isolated media decoder IPC v1

2026-09-20. Decoder-only implementation based on backend snapshot
`844df1e6d4d4f1faaec01eeb6ee3b0e9fcf22d4b`. Worker activation, all-variant
publication/READY transactions and QA deployment are separate integration gates.

## Wire contract

One Unix connection carries exactly one conversion. The request is a four-byte
big-endian length followed by 2–1024 bytes of UTF-8 JSON produced by
`JSON.stringify({version: 1, intent: {kind, contentType, byteLength}})`, followed
by exactly `intent.byteLength` input bytes. JSON must round-trip byte-for-byte;
this rejects duplicate properties and ambiguous encodings. Unknown versions,
properties, kinds, roles, content types, and untrusted paths/binaries are rejected.

The request writer **stays open** until the response is complete. EOF, socket
close/error, or extra request bytes cancel the conversion. EOF-delimited uploads
cannot distinguish a later reader disconnect while the decoder is running;
keeping the request half open is necessary for prompt process-group cancellation.
There is no legacy-wire fallback: worker and decoder need the same protocol
version. The existing image application interface is preserved.

The response has the same bounded JSON framing:

```json
{"version":1,"kind":"VIDEO","variants":[{"role":"video","contentType":"video/mp4","byteLength":123,"width":160,"height":90,"durationMs":1000},{"role":"poster","contentType":"image/webp","byteLength":45,"width":640,"height":360}]}
```

Immediately following the manifest are the exact declared bytes for `video`,
then `poster`, then EOF. Images use `kind: "IMAGE"` and exactly one `image` role
with WebP type and width/height/byteLength. No output path crosses the socket.
There are no optional variants or arbitrary role arrays: duplicate, additional,
reordered, truncated, overlong frames and any trailing byte fail the whole result.
The response is not accepted until EOF, including after the second staged file.

Socket and file streams operate with bounded chunks (64 KiB), backpressure and
private `MediaSpooler` files. No whole media body is accumulated in RAM. Each
client output has its own hash, byte count and cleanup handle. Failure/abort
attempts cleanup of every staged output and awaits every disposal; a disposal
failure fails the call. The decoder reads only fixed role paths through
`O_NOFOLLOW` handles, checks regular-file size and bounds the emitted bytes again.

## Integration contract

`UnixImageDecoder` implements both ports from
`apps/api/src/modules/media/adapters/media-decoder-client.ts`:

- `ImageDecoder.decode(stream, intent, signal): Promise<DecodedMedia>` keeps
  `file`, `width`, `height`, and `contentType: 'image/webp'`. The concrete client
  adds `kind: 'IMAGE'`; that field is optional on the legacy port so existing
  injected image implementations remain source-compatible.
- `VideoDecoder.decodeVideo(stream, intent, signal): Promise<DecodedVideoMedia>`
  returns `kind: 'VIDEO'`, `video: {role: 'video', file, contentType: 'video/mp4',
  width, height, durationMs}` and `poster: {role: 'poster', file,
  contentType: 'image/webp', width, height}`. Each `file` is `SpooledMedia`.
- `DecodedResult` is a discriminated union with required IMAGE/VIDEO kind.
  The image method rejects VIDEO, and the video method rejects image intents.
  Neither method substitutes originals or returns partial success.

The caller owns both video output files on success and must dispose both after
storage preparation, on finalization failure, on stale lease or cancellation.
Do not mark an asset READY until every trusted variant has been prepared and
atomically fenced/finalized. No worker/repository/schema changes are in this
slice; the existing image-only worker cannot yet process VIDEO.

## Bounds and cancellation

| Boundary | Image | Video |
|---|---|---|
| Input | Existing image policy | 50 MiB, 60 seconds, 1920×1080 or portrait equivalent |
| Output | PHOTO 10 MiB, AVATAR 2 MiB, STICKER 1 MiB | MP4 50 MiB plus poster 2 MiB |
| Dimensions | Existing image/sticker policy, avatar max edge 512 | Even canonical video dimensions, poster max edge 640 |
| Per-job external Node deadline | 60 seconds | 210 seconds |
| Client and post-header server deadline | 120 seconds | 270 seconds |
| Header admission | Server deadline 30 seconds | Server deadline 30 seconds |
| Conversion concurrency | One per decoder server | Same shared slot |

The input spool retains its existing 30-second idle cap. The client receives
variants sequentially, so `maxConcurrent: 1` remains sufficient; retained video
and poster reservations together require up to 52 MiB (within the existing
64 MiB worker spool budget). The worker's existing outer 240-second timeout must
be widened during integration to accommodate the 270-second video transport
budget and storage I/O while preserving lease heartbeats and finalization fences.

Each job runs a detached Node POSIX process group on Linux/macOS, with only PATH
and LANG in its environment. FFmpeg/FFprobe inherit that group. The parent
captures the positive PID returned by spawn and sends `SIGKILL` only to its
negative process-group ID, at most once; unknown PIDs and zero are never signaled.
Unsupported platforms fail closed. Deadline, abort, pipe error/premature close,
and socket cancellation kill the group. Leader exit also kills the group before
awaiting child `close`, covering descendants that keep inherited stdout open.
`server.close(callback)` cancels active connections and waits for child close and
scratch cleanup before invoking the callback. Native binaries default to fixed
`/usr/bin` paths; optional server-construction paths are trusted local configuration
for native tests and never accepted from request metadata or inherited env.

The existing video decoder remains unchanged: bounded probe, full source decode
and re-encode, canonical probe and full generated decode, stripped metadata,
strict track/rotation/codec validation, and final poster validation still gate
success. Decoder output polling is only defense in depth.

## Evidence and deployment limits

Tests use synthetic media and synthetic descendant processes. Local macOS tests
exercise real SIGKILL group termination on timeout, abort, leader exit with an
inherited pipe, stdout overflow/error/early close, client close/error, and server
shutdown. Protocol tests exercise fragmentation/coalescing, invalid metadata,
version rejection, byte limits, second-output failure, delayed trailing data,
abort during the poster/EOF wait, and restoration of spool reservations.
The native suite checks real H.264/AAC/WebP IPC plus the existing orientation,
metadata-stripping, invalid-video, abort, path and concurrency regressions.
The native IPC test explicitly skips only when FFmpeg/FFprobe are unavailable.

Validation on Node 24.21.0/macOS: build, typecheck and lint passed; the combined
unit, contract and native run passed 225 tests with no skips using
`node --test --test-concurrency=2 test/unit/*.test.mjs test/contracts/*.test.mjs
test/decoder/video*.test.mjs` from `apps/api`. This includes maximum-size 50 MiB
video plus 2 MiB poster streaming and spool-idle cancellation. The public-repo
scanner passed before publishing. An initial broad run from the repository root
hit the working-directory-dependent migration contract and a concurrent DB
handshake timing failure; the correct-directory, bounded-concurrency run passed.

Impact review found the existing image worker/module as the only application
consumers; their image port remains compatible, while video activation needs
the coordinator-owned integration above. A read-only DEV workspace search found
no external repository consumers of these decoder symbols. No dependency or
schema changes are required.

This is **not** evidence of Linux container/cgroup isolation, network denial,
hard tmpfs quota, CPU/memory restrictions, startup orphan recovery, parent-server
SIGKILL recovery, real R2 behavior, or production browser/native playback.
Those deployment and end-to-end gates remain with the coordinator. No cloud
writes, migration, runtime activation, merge or deployment are part of this slice.
