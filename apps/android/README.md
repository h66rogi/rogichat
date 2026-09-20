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

Native SOOP/Apple credential issuance is still unavailable. No login provider,
account linking, deletion, room adapter or chat operation is enabled by this
transport slice. A fresh installation stays honestly signed out; no credential
entry screen or fixture adapter is packaged. Network/storage failures retain
truthful retry state; authoritative 401 removes only the still-current session.
Offline logout removes the local credential and reports unconfirmed server revoke.
Appearance is saved on device; notification settings read and open actual OS
settings. No disconnected server preference switches are displayed.

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
