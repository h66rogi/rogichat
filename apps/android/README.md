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
failures are displayed honestly. Apple, account deletion, rooms and chat adapters
remain unavailable. A fresh installation has no credential entry screen or
fixture adapter. Authoritative session 401 removes only the current session;
LINK errors never clear a newer account. Offline logout removes the local
credential and reports unconfirmed server revoke.
Appearance is saved on device; notification settings read and open actual OS
settings independently of the authenticated account's server preferences.
M11 GET preferences and explicit account-wide disable use real Bearer requests.
Disabling explains its effect on other devices and the web, sends the latest
positive uint64-string `expectedGeneration`, and only applies a confirmed response.
Conflict or uncertain results trigger a read, never automatic write replay.
Enabling native push, registration and FCM remain unavailable; no permission
request, optimistic toggle, default-enabled state or synthetic success is added.
Read-state UUID/context DTOs and closed transport are available for future C05/C06
integration. No screen reports read progress, calculates unread counts or borrows
Meloming chat UX from this foundation.

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
