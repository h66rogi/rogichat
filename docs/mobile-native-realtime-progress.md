# Native realtime wake transport

Identity/push checkpoint `cec28afc528854a5199c4518a9bd5c6a19afc183` was committed,
security checked, pushed and verified remotely before this additional scoped work.
The coordinator extended the same task to actual realtime drivers; SDK imports
and the pins below were explicitly approved, with dependency/project/root changes
remaining owned by the Android/iOS single writers.

## Exact server contract

Read `apps/api/src/modules/realtime/realtime.gateway.ts` directly and compared
with frozen backend `f9197a31d61b7c34256e92f0bcb73ee255275d40`: identical SHA256
`a5cd47e7733c6558e1a5540ea64832a0cb4d0770722e95b5b489aa3d7078961a`.

- Socket.IO default namespace `/`, Engine.IO path `/v1/realtime`, websocket only.
- Upgrade headers: native Bearer plus `X-Rogi-Client:android|ios`. No cookie,
  Origin spoof, CSRF, credential query parameter, polling or redirect fallback.
- Namespace auth is `{schemaVersion:1,transport:"native"}`. **1 is a number**.
- Only `sync.required` with `{schemaVersion:1}` reaches the feature coordinator.
  There are no client application emits, joins, room subscriptions, message
  payloads, delivery guarantees or socket-based authorization decisions.
- Server buffer cap is 1024 bytes; handshake deadline 5 seconds, normal server
  heartbeat 25-second interval + 20-second timeout. The native Engine.IO reader
  validates and bounds advertised heartbeat values and closes on timeout.
- Foreground/reconnect/periodic REST reconciliation remains mandatory. A socket
  connection never asserts that the account still has chat or room permission.

## Concrete implementations

Android `SocketIORealtimeFactory` constructs the actual Java Socket.IO client,
using a separate OkHttp client with `NO_COOKIES`, no redirects, no HTTP retry,
no logging interceptor, `forceNew=true`, multiplexing disabled and websocket-only
transport. `NativeRealtimeManager` reuses the non-chat reference's callbackFlow,
event registration/connect and awaitClose teardown. SDK automatic reconnect is
disabled: loss closes the flow with a typed revalidation ticket, and a new
connection requires fresh REST authority and the still-current ticket.

Java SDK 2.1.2 declares auth as `Map<String,String>` but its actual Socket.java
passes it directly into `JSONObject(Map)` for the CONNECT packet. The narrowly
scoped `nativeSocketAuth` boundary preserves the integer schema value using type
erasure; a real JSONObject regression verifies it remains numeric. Converting it
to a string would violate the server contract.

iOS `SocketIORealtimeFactory` retains the real SocketManager/default SocketIOClient
and SDK namespace/auth/event parser. The default SDK engine is deliberately
replaced through its public `SocketManager.engine:SocketEngineSpec` seam:

- SocketIO 16.1.1 `SocketEngine` uses URLSession.default and copies cookies into
  its WebSocket request. Starscream's custom HTTP handler synthesizes Origin and
  reads HTTPCookieStorage.shared; its native engine also uses URLSession.default.
  Those defaults are unsuitable for Rogichat's native credential boundary.
- `CookieFreeSocketEngine` uses a real URLSessionWebSocketTask, ephemeral session,
  nil cookie/credential/cache storage, `httpShouldHandleCookies=false`, and an
  explicit redirect-rejecting delegate. Its only URL is the environment's fixed
  `wss://api…/v1/realtime/?EIO=4&transport=websocket`.
- Socket.IO packet parsing stays in the SDK. The closed Engine.IO 4 subset admits
  bounded open/ping/pong/message/close frames only, and outgoing SDK writes may
  only be the exact native namespace CONNECT or namespace DISCONNECT. Binary,
  polling/upgrades and client application writes fail closed.
- The manager handle queue and engine queue are main. The Swift 6 actor boundary,
  including protocol conformance, was typechecked against the actual SDK modules.
  Removing handlers and closing the native socket precede releasing the driver.

Reference structure and behavior were retained where applicable. The new isolated
engine is required by concrete cookie/Origin behavior, not by library age.
No backend guard was relaxed, no header was spoofed, and no SDK global cookie
storage was modified by runtime code.

## Owner mounting instructions

1. Pin the SDKs below and include these source files in the actual app target.
   Android excludes the transitive `org.json:json` artifact and uses Android's
   platform org.json, as required by the SDK's Android installation guidance.
   Keep normal dependency lock/checksum/license review; no dependency/project
   file was edited in this leaf branch.
   The Swift target must see both SocketIO and Starscream modules because the
   SDK engine protocol exposes Starscream's WebSocket type, even though the
   replacement engine never constructs it. Preserve dependency privacy resources
   and license notices (SocketIO MIT; Starscream Apache-2.0).
2. Instantiate `NativeRealtimeManager(SocketIORealtimeFactory())` once in the
   retained session owner (Swift uses `init(factory:)`). It must not be created
   once per view render or supplied a test driver in product code.
3. Derive RealtimeScope from verified current environment/account/server generation
   and the protected persistent session epoch. Bind null on logout, SOOP required,
   revocation, expiry or account replacement **before async work**. Bind foreground
   false before backgrounding; managers synchronously invalidate callbacks and
   close the old socket. A→B→A requires a new epoch, not account-ID equality.
4. With current foreground REST authority, connect using the current protected
   bearer. Consume `syncRequired(scope)` by invoking the existing coalesced
   authority/manifest/room REST reconciliation. Check the same scope before and
   after await and before applying to UI/cache. Never navigate from socket data.
5. Consume `revalidationRequired(ticket)` by retaining existing foreground polling,
   applying bounded retry/backoff in the session owner, and rechecking REST
   authority before `reconnect(ticket,currentBearer)`. Old reconnect tickets are
   rejected after a new connection, background transition or account change.
   Do not use SDK auto-reconnect or Flow retry with the old captured bearer.
6. Android collection cancellation also removes handlers/disconnects. Swift owner
   calls disconnect on teardown, with isolated deinit as a final cleanup boundary.
   All user-facing authorization/error/retry states stay owned by the existing
   app/session flow, not by a socket-status-as-login shortcut.

## Source reuse audit for parent incorporation

Parent owns `docs/mobile-reuse-audit.md`; incorporate these rows there.

| Read-only reference | Destination | Actual modified reuse |
|---|---|---|
| Android `ecb3dbedb1dde5364bd617f072bc1ac4091b1a17`, `core/network/src/main/java/com/meloming/android/core/network/socket/SongLiveSocketManager.kt`, connect | core/realtime/NativeRealtimeManager.kt and SocketIORealtimeDriver.kt | callbackFlow/on/connect/awaitClose lifecycle and real IO.Options/IO.socket construction; strip join, identifier, song events, polling and logs; add immutable scope fencing and explicit REST reconnect. |
| iOS `18a33bbf96fe52b28d0de361916e20549bdcce6b`, `Meloming/Core/Network/SongLiveSocketManager.swift`, connect/disconnect/setupEventHandlers/deinit | Core/Realtime/NativeRealtimeManager.swift and SocketIORealtimeDriver.swift | retained manager/socket, weak callbacks, PassthroughSubject/erased publisher, SDK event registration and teardown; strip join/song data, use default namespace, disable auto-reconnect and fence every callback. |
| New implementation | RealtimeContract, CookieFreeSocketEngine, NativeEngineIOState, RealtimeWebSocketRequest and tests | Reference lacks persistent account scope and cookie-free native Engine.IO transport. Existing SDK public engine seam preserves the library parser instead of replacing all Socket.IO behavior. |

No Talk/TalkV2 source was read for this feature; no legacy endpoints, IDs, assets,
configuration, keys, provider material or history were copied.

## Pins and verification

- Java `io.socket:socket.io-client:2.1.2`, official tag commit
  `667bd17a01b97306be7a364c409b201b0a9eb017`; JAR 66372 bytes,
  SHA256 `7cad7b85f6ff3d8c0194841ab2bd91d7275acbad3883c23a72df25067ecf59ef`;
  POM SHA256 `fd7eb21de192c9a62c9b1304dd0c788240fbfbb3b81ed4073cea9d00f56ffad0`.
  Direct runtime dependencies: engine.io-client 2.1.0 and org.json (exclude on
  Android). Engine.IO JAR SHA256
  `84bb94a41b0bd1f6f5762804ecc04b3626c3397aa2cfbc22daba6eb0622ee575`.
  Isolated compile used existing OkHttp 4.12.0/Okio 3.9.1 cache;
  the app owner must lock the final compatible graph.
- Swift SocketIO 16.1.1 revision
  `42da871d9369f290d6ec4930636c40672143905b`; dependency Starscream 4.0.8 revision
  `c6bfd1af48efcc9a9ad203665db12375ba6b145a` was used for the device SDK check.
  Pin both in resolved dependencies rather than floating the transitive range.
  Starscream is linked for the SDK's protocol types, but its default transport
  is never instantiated by this factory.
- Actual cached SDK modules emitted into a temporary directory, then all concrete
  Swift files passed iPhoneOS SDK Swift 6 strict-concurrency typecheck. No Xcode
  GUI, simulator, app build, archive or package installation was performed.
- Actual Java 2.1.2 JAR was checksum verified and the concrete Android driver
  compiled with a 512 MiB compiler heap. Lifecycle and numeric-auth checks ran
  with a 128 MiB JVM heap. No Gradle/build configuration changed.
- Both platforms' lifecycle checks cover pre-connect hints, duplicate callbacks,
  malformed schema, reconnect replay, old callbacks, A→B→A, background/logout and
  teardown. Swift closed-protocol checks cover open/auth/ping/event/close, bounds,
  forbidden application writes and isolated request configuration.
- `python3 apps/ios/Tests/Realtime/run_transport_checks.py` captures actual
  Foundation WebSocket requests over isolated loopback. It seeds a test cookie
  into the shared jar and proves no Cookie/Origin headers appear, native headers
  are present, frames are exchanged, and a 302 is not followed. This is actual
  local transport evidence, **not** real QA authentication, TLS/device evidence,
  or a full Socket.IO/server end-to-end claim. Only test code rewrites the
  production-prepared URL to loopback; product origin validation is unchanged.

Remaining integration: OS dependency/root/foreground/session mounts, parent
current-app build/required CI and real QA/device credential/session-revocation
round trips. Foreground REST polling remains the honest fallback throughout.

Primary sources: [Java SDK release](https://github.com/socketio/socket.io-client-java/releases/tag/socket.io-client-2.1.2),
[Java initialization](https://socketio.github.io/socket.io-client-java/initialization.html),
[Java Android installation](https://socketio.github.io/socket.io-client-java/installation.html),
[Swift SDK](https://github.com/socketio/socket.io-client-swift/tree/42da871d9369f290d6ec4930636c40672143905b),
[Engine.IO protocol](https://socket.io/docs/v4/engine-io-protocol/),
[Socket.IO protocol](https://socket.io/docs/v4/socket-io-protocol/).
