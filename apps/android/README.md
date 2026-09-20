# 로기챗 Android

Native Compose product app, Android 10+ (API 29), target/compile API 37.
QA and prod both execute `src/main/.../AppEntry.kt`; only endpoint, signing,
application identity and version suffix differ. Neither APK includes a preview
host, synthetic account/room selector or fake service operation.

Reusable navigation, theme/type scale, settings, profile editing and notification
settings are adapted from the read-only reference app. See
[`docs/mobile-reuse-audit.md`](../../docs/mobile-reuse-audit.md) for exact evidence.
Chat UX is independently designed. Navigation Compose 2.10.1 and Lifecycle 2.11.0
are pinned; Release builds use R8 and resource shrinking.

The installed product uses the committed native transport contract to restore
an existing protected credential, revalidate on foreground, log out and fetch/save
the full own profile. Android Keystore AES-GCM protects an environment-bound
credential in atomic files under `noBackupFilesDir`; a durable logout marker
prevents failed removal from reviving an old credential. REST uses an exact Bearer
header and `X-Rogi-Client: android`, fixed seven-day expiry and no refresh,
cookies, CSRF, invented Origin, redirects or HTTP body logging. Local operation
epochs are separate from the server's opaque account-generation hint.

SOOP login and account linking use the committed native transaction/HTTPS handoff/
completion contract. Login requires the reviewed `2026-09-20` usage consent and
sends no Bearer; linking captures the same current native session at start and
exchange. AndroidX Browser 1.10.0 opens a system Custom Tab; only exact same-environment
API launch and HTTPS completion URLs are accepted. Browser completion alone never
means login succeeded. Independent PKCE/state proofs live only in protected
short-lived storage; durable consume, credential clear stamps and local epoch
checks reject replay, canceled and stale results. Lost exchange responses require
a fresh login. Explicit local reset can recover unreadable login storage without
claiming server logout or deleting the server account.

The broker is still activation-gated. Actual signed App Links association and
provider/device round trips remain external release gates; neither the manifest
nor mocked tests establish deployment or provider success. Server 404/503/offline
failures are displayed honestly. Apple uses the same protected PKCE/state, explicit consent, browser callback and one-shot installation coordinator; provider/browser completion is never session success. A fresh installation has no credential entry screen or
fixture adapter. Authoritative session 401 removes only the current session;
LINK errors never clear a newer account. Offline logout removes the local
credential and reports unconfirmed server revoke.
Appearance is saved on device; notification settings read and open actual OS
settings independently of the authenticated account's server preferences.
M11 GET preferences and explicit account-wide disable use real Bearer requests.
Disabling explains its effect on other devices and the web, sends the latest
positive uint64-string `expectedGeneration`, and only applies a confirmed response.
Conflict or uncertain results trigger a read, never automatic write replay.
Native push uses an explicit OS permission, protected per-installation ID/secret,
real provider token, capability/resolve/register and a separate explicit account-wide
ON action with the latest generation. Final HTTP admission rechecks the original
account and OS permission. Missing SDK configuration disables only push; it creates
no Firebase app or permission prompt. Unknown results are reconciled by reads, never
automatic mutation replay. Read-state reports only newly displayed authorized rows
after real read-context GET and user interaction, not restored scroll anchors.
No unread count or Meloming chat UX is inferred.

Use JDK 17 and the installed Android SDK. Examples:

```sh
./gradlew :app:assembleQaDebug :app:assembleQaRelease :app:assembleProdRelease --max-workers=2
./gradlew :app:test :app:lint --max-workers=2
./gradlew :app:connectedQaDebugAndroidTest --max-workers=2
```

State/repository tests are under `src/test`. Historical reducer fixtures live only
under `src/testQa`; they cannot enter any APK. Package guards also inspect every
QA/prod Debug/Release APK for fixture markers. Signed test distribution continues
through [`tools/mobile/qa_release.py`](../../tools/mobile/qa_release.py).

Native transport tests cover strict DTOs, headers/redirects/body bounds,
generation races, expiry, clear cancellation, profile PATCH null semantics,
authenticated encryption and failure recovery. `src/androidTest` additionally
checks real Android Keystore/atomic persistence in isolated test-only file/key
namespaces and activity recreation without populating a product credential.
The instrumentation APK is never distributed. Ktor 3.6.0, serialization 1.11.0,
and their resolved dependencies are locked; upstream license texts are packaged.

SOOP contract/race tests additionally cover strict URL/JSON grammar, public versus
bound authorization, TTL, two reversed flows, cold callbacks, one-shot consume,
partial protected writes, cancel/logout failures, and explicit consent. Tests use
isolated fakes under `src/test`; no successful broker/device authentication is
claimed by these tests. App Link hosts are `qa.rogi.chat` and `rogi.chat`, with
exact path `/mobile/auth/complete`, no custom-scheme fallback.

M11 tests cover strict generations/DTOs, exact transport, session-scoped mutation
admission, request inversion, single-flight disable, conflict/lost-response reads,
expiry and account teardown. Preferences stay in their account's feature state;
they are not persisted in shared device preferences. Unit tests do not establish
hosted M11 deployment, native push-provider availability or device delivery.


MB04a room discovery and schema-v2 membership manifests use the real native API.
The session retains the optional canonical `accountPartition`; without it, durable
room access stays closed and never falls back to `account.userId`. Discovery pages
are separate from membership authority: only all pages of one complete manifest
generation replace the account's membership set. Reset, duplicate/loop cursors,
unknown schema, stale credentials and partial/error responses cannot manufacture
an empty or joined state. Joined directory rows open the native conversation with their originally rendered membership and directory cycle; participation commands retain the same original-scope admission.

Room 2.8.5 with KSP 2.3.12 provides an actual on-disk, no-backup database per environment
and account partition. Staging/effects/checkpoint changes commit in one transaction
under the session lifecycle mutex, with expiry checks before and after commit.
Credential or partition changes hide private state before durable cleanup, and a
failed cleanup marker prevents a cold open from reviving old authority. A fresh
manifest is required after process restart. DB failures remain errors; no destructive
migration fallback is configured. Versioned schema exports and isolated SQLite
rollback/reopen tests live under `src/androidTest`. Database v2 adds conversation projections, profile staging, cursor checkpoints and immutable commands. Version 3 adds media payloads, pending assets, action/unblock journals and scroll anchors through explicit non-destructive migrations. No message draft or credential is stored in shared preferences.
Source contract tests do not establish hosted schema-v2 rollout or live account success.


The sync `deviceId` is a random installation/environment UUID created only when an
authorized room sync begins. Its 36-byte AtomicFile under `rooms-{environment}`
survives logout/account-cache cleanup; uninstall or app-data clearing resets it.
It is sent in the authenticated `/v1/sync` query to bind server cursors, while
`cacheId` rotates for every fresh manifest cycle/reset. It is not a hardware,
advertising or push identifier. Store privacy disclosures must account for this
identifier's off-device transmission and authenticated association; the mobile
implementation alone does not establish server retention or ephemeral processing.


Room participation commands use the existing native Bearer transport: one explicit
JSON `{}` POST to join (200) or leave (204). Leave requires a native confirmation;
it does not delete messages. A session-owned active command survives feature
ViewModel recreation and blocks competing mutations/refreshes while in flight.
Before sending, the app commits a fresh incomplete directory checkpoint under the
original account scope; failed local invalidation sends nothing. Old manifest,
continuation and command responses cannot republish a different account's data.

Only a fresh complete manifest publishes current membership after a command.
Conflicts, malformed/lost responses and network errors never auto-replay a POST;
retry fetches current state. Such a GET proves membership at read time, not that
an earlier timed-out command has terminated. A later server commit remains possible.
The wire contract has no expected membership scope or idempotency receipt for
join/leave; the app does not invent one or claim cross-device period-specific CAS.
The user can issue a new explicit choice after current state is confirmed. Native
room policy-management flows remain outside this slice.


Account deletion admission uses one explicit native `DELETE /v1/me/account` with
`{}` and the captured original Bearer. A strict 200 `blocked` receipt means the
request was accepted and account access blocked; it never means physical deletion
is complete. Receipt IDs accept canonical UUID v4/v5. Only a strict 403
`RECENT_AUTH_REQUIRED` response permits guarded live restoration of the original
credential followed by real session validation; it never automatically resends a
request after login. There is no receipt/status GET fallback.

A separate environment-bound Android Keystore/AtomicFile journal preserves actual
receipts and unknown outcomes under `noBackupFilesDir`. It does not change the
existing credential/pending-auth v1 formats. Original credentials are erased with
their durable clear marker before dispatch; the original Bearer survives only in
the in-memory command. Cold recovery never repeats DELETE, and incomplete local
cleanup prevents another account from being installed. DB cleanup is restricted
to the original partition and rejects foreign files. Journal phases cover clear
stamp and interrupted credential-restoration writes. Failed/unknown requests do
not become success because a later session request succeeded or failed.

Confirmed and unknown records are retained without automatic eviction (16 records,
16 KiB). Authentication/proof storage has its own namespace. Result presentation
can be acknowledged without erasing its protected record; another account never
sees a previous account's receipt or reauthentication action. Explicit device-data
reset explains that local records are lost and a server request is not canceled.
Reset/logout confirmations retain their original account and local epoch; journal
reset also pins the original record. UI admission and serialized service admission
both reject stale confirmations before changing a newer account or its storage.
The former unimplemented parameterless account-close action is removed.
Provider, guard-key/ledger activation, physical deletion and backup retirement
remain server/operations release gates. Tests use isolated namespaces and never
submit a real account deletion request.


The native conversation uses the same environment-scoped Bearer client and account
Room database. Its wire contract is the combined C04/C05/C06 source
`f9197a31d61b7c34256e92f0bcb73ee255275d40`: schema 2, opaque M/A, immutable
millisecond/UUID display order and lossless decimal versions. Foreground polling,
history pagination, actual private-recipient discovery and authorized quoted TEXT
replies operate on the originally selected account, membership and directory cycle.
Meloming Talk/TalkV2 UX is not reused. Existing common navigation, theme, repository,
HTTP client and lifecycle implementations are reused.

A user command commits to SQLite before one session-owned POST. UI cancellation
cannot abandon ownership after that commit. Process recovery first verifies the
credential binding, server generation and account partition, then obtains fresh
complete membership authority; it never sends a stored command again. Unknown
outcomes use receipt GET only, and receipt 404 remains unknown. Confirmed receipts
map command IDs to message IDs without text/time matching. Stored is not delivered
or read. Commands retire only after an authoritative projection or deleted receipt;
unresolved payloads have no automatic eviction. A full pending store rejects new
admission visibly rather than dropping an old command.

A complete manifest's missing/changed M removes old room payload. A-only changes
withdraw old projections while keeping the original unresolved command for receipt
lookup; its M/recipient/body are never rebound. Room-authority errors close private
content, whereas an individual message GET 403/404 hides only that projection and
keeps its confirmed receipt without exposing the original command body as fallback.
Equal-version C05 updates replace projections and refresh or remove quoted drafts.
All UI publication shares a synchronous fence with account/directory invalidation,
and all SQLite commits remain under the credential lifecycle mutex.

Source/unit/SQLite fixture checks do not establish backend rollout, native broker
availability, a live two-account exchange or store distribution. Runtime samples,
synthetic sessions, automatic POST replay, unread/read reporting and socket-based
claims are not part of this implementation.


The feature composition reuses the extracted non-chat picker, confirmation, permission,
provider and Socket.IO lifecycle implementations. PHOTO/VIDEO/STICKER use the same
immutable outbox, original M/A/credential admission and receipt recovery as TEXT.
The picker accepts JPEG/PNG/WebP up to 10MB and MP4/MOV up to 50MB. Pending upload
recovery reads status only; it never repeats reservation/upload automatically.
Signed media access is short-lived and downloaded without bearer/cookies/redirects.
Private scratch is cleaned once before any media work after process restart.
Avatar application requires a ready receipt and explicit profile PATCH; uncertain
results query the real profile without manufacturing success or discarding edits.

Delete/publication/reactions/report/block use current C05 hints and the existing
protected transport. Their original selection and session scope are checked at actual
HTTP admission; durable UNKNOWN is committed first. Settings can discover own blocked
rooms via the recovery-only endpoint, then display current nullable server labels and
unblock even after leaving. Empty pages with a continuation are not completion; no
UUID or old cached private label is used as a display name. Local journals are account
partitioned and removed with account teardown; current labels remain memory-only.

Socket.IO Java 2.1.2 (Engine.IO 2.1.0) uses a no-cookie/no-redirect client and numeric
schema version 1. Lifecycle/background/credential changes close it synchronously.
Reconnect requires REST revalidation. Socket and FCM payloads only request canonical
sync; they never supply message bodies, read ACKs or unverified navigation.
Firebase BoM 34.19.0 resolves Messaging 25.1.3. The pinned token API remains the native
push contract even though this SDK deprecates it in favor of newer provider APIs.
No automatic initialization, Analytics dependency or BigQuery delivery export is used.

Optional private SDK inputs are `ROGICHAT_QA_FIREBASE_CONFIG_FILE` and
`ROGICHAT_PROD_FIREBASE_CONFIG_FILE`. Present files must be canonical regular mode0600
(single-link) JSON with exactly environment, packageName, applicationId, apiKey,
projectId and gcmSenderId; duplicate/partial/mismatched values are rejected. Firebase
SDK applicationId is distinct from the Android package, and its project number must
match gcmSenderId. Values stay outside Git; absence leaves the four generated
rogi_firebase_* resources empty and push unavailable. Trusted distribution tools
independently verify packaged configuration. Prod signing uses only its dedicated
ROGICHAT_PROD_KEYSTORE/ROGICHAT_PROD_STORE_PASSWORD/ROGICHAT_PROD_KEY_ALIAS inputs;
there is no QA fallback.

Local automated checks do not establish Apple/SOOP provider activation, Firebase
configuration/delivery, media transcoding/object access, hosted feature rollout or a
real two-account conversation. Those require separate runtime/release evidence.
