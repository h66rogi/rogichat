# Mobile identity and native push integration

This branch supplies independently testable identity/push modules. It is **not a
mounted-product or real-device completion claim**. The mobile parent explicitly
assigned protected persistence, session/network/root/delegate/service/manifest,
dependency and project mounting to the existing Android/iOS single writers.

## Contract evidence

- Frozen backend `f9197a31d61b7c34256e92f0bcb73ee255275d40` supports native SOOP,
  session, M11 read/disable; its Web Push subscription endpoint cannot accept
  APNs/FCM tokens. Native registration is a subsequent backend change.
- Apple writer supplied `docs/apple-auth-client-contract.md` and
  `apps/api/src/modules/auth/apple/apple.dto.ts` on `task/apple-soop-link`.
  New request paths: POST `/v1/auth/apple/start`,
  `/v1/auth/apple/native/complete` (iOS), `/v1/auth/apple/exchange`.
  Start sends clientId/intent/codeChallenge/returnState. An optional legacy login
  `termsVersion` is ignored. Unlike SOOP, **no codeChallengeMethod** field.
  iOS sets the server-returned nonce directly, without hashing it again, and
  checks returned state; complete sends transactionId/state/authorizationCode/
  identityToken/codeVerifier. Exchange sends clientId/transactionId/code/
  codeVerifier and reuses the existing native SOOP session response validator.
- Android opens only the validated Apple authorize origin/path and checks
  transaction state/nonce in its query. The app receives only completion code
  and stored returnState at the environment's `/mobile/auth/complete` URL.
  Apple form-post callback belongs to the API, never the app.
- Native push writer supplied `native-push.controller.ts`,
  `native-push-contract.ts`, `native-push.service.ts`, and
  `dto/native-push.openapi.ts` under `apps/api/src/modules/notifications` on
  backend-m11-parallel. These are **authored candidate sources, not yet a
  validated/frozen backend SHA** at this checkpoint.
- GET `/v1/me/native-push-capabilities` returns available/provider; POST
  `/v1/me/native-push-subscriptions` returns 201 `{id,generation}` and takes
  provider/token/installationId/bindingSecret/optional generation. POST
  `/v1/me/native-push-subscriptions/resolve` returns 200
  `{binding:null|{id,generation,revoked}}`; its body is installationId/bindingSecret.
  DELETE `/v1/me/native-push-subscriptions/:id` takes generation/bindingSecret
  and requires an empty 204. Generations are canonical positive uint64 strings.
- All native authenticated requests use Bearer and `X-Rogi-Client:ios|android`,
  JSON content type, no cookies/Origin/CSRF/redirects. Apple login omits Bearer;
  Apple link carries its **original** credential through all three requests.
- Registration is not account push opt-in. M11 expectedGeneration remains a
  separate preference CAS. Native registration requires valid SOOP chat access.
- Push payload is only wake: APNs `{aps:{"content-available":1},type:
  "sync_required",version:1}`, FCM data `{type:"sync_required",version:"1"}`.
  Neither is a room route nor authorization. OS delivery/display is not guaranteed.

## Exact OS integration hooks

1. Add owned `IdentityEntrySection` to real Welcome/LinkRequired composition;
   actions invoke real Apple start and existing SOOP link. Preserve account,
   logout, deletion and policy/support access while SOOP is required. Server
   `soopLinkStatus/onboardingState/capabilities` remains authoritative.
2. Android implements `AppleIdentityTransport` and `NativePushTransport` with
   the existing bounded native client; iOS implements `AppleIdentityRequesting`
   and `NativePushRequesting` using their closed URLRequest builders. Validate
   exact statuses and existing error envelopes; unavailable/unknown is not success.
3. Reserve and securely persist Apple proof, intent, original credential,
   transaction expiry and persistent session epoch before native/browser launch.
   Reuse `AuthProof`/`SOOPProof` for random S256 verifier and returnState. Do not
   reuse SOOP pending transaction storage without distinguishing provider.
   Bind `IdentityAttempt`, check its ticket before every post-await step and
   before atomic session persistence. Consume/cancel on logout, account change,
   expiry or unknown exchange; never blindly retry an exchanged completion.
4. iOS owns `AppleAuthorization` for the whole UI request, passes the actual
   presentation window and returned nonce/state, then sends extracted material
   only to the complete endpoint. Native credential extraction never logs in.
   Cancellation detaches delegates, invokes the native controller cancel API and
   rejects late callbacks; sheet dismissal/window lifecycle still need device evidence.
5. Protect and persist random installationId plus canonical 32-byte bindingSecret
   once per environment **before first registration**. Retain across account
   transitions, including APNs logout (APNs cannot rotate on demand). Resolve
   remote binding after unknown response/cold restart; persist observed generation
   before the next operation. Never guess increments. On 409, resolve then start
   a new scoped intent; do not silently replay an old account command.
6. `PushScope` includes environment, account, server generation, persistent
   session epoch and installation epoch. `PushLifecycle.bind(nil,...)` runs
   synchronously before logout/revocation/expiry cleanup. Permission unknown or
   denied blocks registration; it does not claim the server binding was deleted.
   Actual DELETE/logout and provider server session checks perform revocation.
7. On foreground/retry/provider rotation, `beginTokenFetch` captures a unique
   ticket. Android onNewToken invalidates old work and fetches current SDK token;
   never attach a delayed raw callback to a newly logged-in account. Only the
   still-current ticket reaches tokenReceived/registrationToken. Only validated
   server 201 plus durable generation persistence may call registered. Any timeout
   remains retryRequired, not registered/revoked. No raw token logging.
8. iOS reuses real UNUserNotificationCenter permission + APNs registration via
   `ApplePushPermission`, receives device Data in the owner AppDelegate and uses
   `NativePushContract.apnsToken`. Android `AndroidPushPermission` checks runtime
   permission and app-wide notification disable, even below Android 13. The owner
   ActivityResult launcher calls willRequest then reads actual OS state.
9. `NativePushWake` strictly normalizes the vendor format, then owner resumes
   session bootstrap/manifest sync under the current scope. Separately received
   **verified application links** may use `PushRouteGate`; never pass push data to
   that parser. Offer only after cold boot session restoration establishes its
   persistent scope; clear on account changes. After real `/me` and room-detail
   reauthorization, call authorized(ticket, scope, roomID) and navigate in the same
   actor/dispatcher turn. Denial cancels, transient failure may retry before TTL.

## Reference reuse audit for parent incorporation

Reference repositories were read-only; their exact HEADs matched the assigned SHAs.
No reference environment/configuration, token, key, ID, history or legacy assets
were copied. Parent must incorporate this table into `mobile-reuse-audit.md`,
which is outside this worker's assigned file ownership.

| Source SHA/path/symbol | Destination | Reuse and changes |
|---|---|---|
| iOS `18a33bbf96fe52b28d0de361916e20549bdcce6b`, `Meloming/Core/Auth/AuthManager.swift`, loginWithApple | Core/Identity/AppleAuthorization.swift | Modified reuse of provider/createRequest/scopes/controller/delegate/credential extraction. Strong lifetime replaces associated-object retention; nonce/state and one-shot cancellation added; removed legacy API, email-based assumptions and logging. |
| Same iOS SHA, `Meloming/Core/Push/PushNotificationManager.swift`, requestAuthorization/checkAuthorizationStatus | Core/Push/ApplePushPermission.swift | Retained actual permission request/options/status and registerForRemoteNotifications sequence; no Firebase singleton or swallowed/logged errors. |
| Android `ecb3dbedb1dde5364bd617f072bc1ac4091b1a17`, `core/data/src/main/java/com/meloming/android/core/data/push/PushNotificationManager.kt`, checkPermissionStatus/onPermissionResult | core/push/AndroidPushPermission.kt | Modified OS permission check and requested-state persistence; app-wide disable checked for every supported OS; actual OS state overrides callback Boolean. |
| Both reference push managers; Android `app/src/main/java/com/meloming/android/push/MelomingFirebaseMessagingService.kt`; iOS `Meloming/App/AppDelegate.swift` | OS-owner callback mounting described above | Read and handed off actual provider callback responsibilities. No claim of copied service/delegate: ownership/dependency constraints prohibit editing those files here. Removed legacy URL/type/channel routing and token logging from proposed integration. |
| Existing Rogichat PendingRouteQueue/AuthProof/SOOP exchange validators | PushRouteGate/AppleIdentityContract | Actual direct reuse of strict queue/proof/validated response code, not rewritten equivalents. |
| New scope reducers, wire DTOs, wake validators, UI sections and tests | Owned identity/push directories | New implementation required: reference account bearer checks lack persistent epoch/CAS and use incompatible backend endpoints/payloads. No Talk/TalkV2 reuse. |

## SDK decision evidence

No SDK installation, resource or dependency files changed. Native APNs and Apple
use platform SDKs already available. Android owner reviews and locks FCM graph.
Official [Firebase Android release notes](https://firebase.google.com/support/release-notes/android)
and Google Maven BoM 34.19.0 map messaging to 25.1.3. Transient artifact verification:

- BoM POM SHA256: `81a4d927eb8e31c1f2022cf80d603224b67be784eb8570a93715228e6399cbbf`.
- Messaging POM SHA256: `ed4d3920a8af06ce7b78ebb5ba7daa3eb7aaf513c3c31b6b54d78f67ba695466`.
- Messaging AAR: 156493 bytes; SHA256 `cabf7ad0610e41777b1e79f1c0b76073f1a1b372aa9ff83007627860cb8dcf15`.
- Direct POM graph includes Firebase common/components/installations/encoders/
  datatransport, GMS base/basement/tasks/cloud-messaging/stats. Analytics was not
  requested. Full transitive footprint, license/minSDK, configuration and locks
  belong to Android packaging owner; this is a pin proposal, not SDK approval.

## Validation and remaining evidence

Small Swift and Kotlin executable checks cover permission denial/unknown,
unavailable registration, old token/duplicate callback, rotation, retry after
unknown failure, logout, A→B→A, cold launch stale authorization, wrong room,
duplicate route and TTL. Swift Apple wire checks cover native nonce DTO,
login/link request differences and one-shot scope cancellation. Swift device SDK
strict-concurrency typecheck covers the native Apple/permission/UI primitives.
Additional Android JUnit contract tests await the parent's normal unit matrix.

Follow-up checks also passed: Swift request builders against the existing native
session dependency set, and the Android native push JUnit contract with the exact
existing strict JSON parser isolated for a low-memory compiler invocation.
Native cancellation uses the SDK's iOS 16+ `ASAuthorizationController.cancel`,
supported by this app's minimum OS; see [Apple cancellation contract](https://developer.apple.com/documentation/authenticationservices/asauthorizationcontroller/cancel()).

Remaining: backend tested/published frozen SHA reconciliation; OS mounts and
protected pending/binding generation persistence; parent full build/CI; actual
APNs/FCM receiving and provider Apple/SOOP account round trips; Firebase external
reauthentication/configuration and signing. No repeated user credential question,
synthetic provider success, independent deployment, GUI or simulator is used.
