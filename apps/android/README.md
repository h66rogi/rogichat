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

The product currently restores no native credential because the server's native
login/session handoff contract (C01/C02) is not implemented. The signed-out screen
states that limitation. Profile, account and room screens use injected domain
repositories/session state; the shipped app never installs a fake adapter.
Appearance is saved on device; notification settings read and open actual OS
settings. No disconnected server preference switches are displayed.

Use JDK 17 and the installed Android SDK. Examples:

```sh
./gradlew :app:assembleQaDebug :app:assembleQaRelease :app:assembleProdRelease --max-workers=2
./gradlew :app:test :app:lint --max-workers=2
```

State/repository tests are under `src/test`. Historical reducer fixtures live only
under `src/testQa`; they cannot enter any APK. Package guards also inspect every
QA/prod Debug/Release APK for fixture markers. Signed test distribution continues
through [`tools/mobile/qa_release.py`](../../tools/mobile/qa_release.py).
