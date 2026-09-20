# Prod app identity and signing preparation

The production app identity is `chat.rogi.rogichat`; the display name is 로기챗.
This work prepares registration and signing resources. It does not submit an app
for review, upload a binary, promote QA to Production, or prove provider login.

## Operator tool

`tools/mobile/prod_signing.py` is a separate preparation command. Existing
`qa_release.py` and its QA identity, upload and artifact guards are unchanged.
It reuses the existing App Store Connect transport and external-file boundary,
but performs its own exact Prod resource selection. Prefix matches are rejected.
No profile or certificate is revoked; existing signing material is never replaced.

The operator configuration is `~/.config/rogichat/mobile-prod.json`, mode 600,
outside Git. It must contain `environment: prod`, `app_id: chat.rogi.rogichat`, an
external `artifact_root`, and the existing `ios` API/team/keychain/certificate
fields. The Android section names a dedicated `rogichat-prod-upload` alias in
`~/.config/rogichat/signing/prod/upload.p12` with its separate password file
`upload-password`. The tool never copies QA profile, tester or Firebase targets
into Prod. Actual IDs, certificate fingerprints and secrets are not recorded here.

```sh
python3 tools/mobile/prod_signing.py ios --create-missing
python3 tools/mobile/prod_signing.py android --create-missing
```

Select the installed Xcode through `DEVELOPER_DIR` before the Apple command.
Omitting `--create-missing` rechecks the existing resources without creating remote
ones. Commands use an external exclusive lock. Creation first queries the exact
resource and then reads it back; a lost response is not automatically retried.
A later invocation reconciles the exact remote resource before any new POST.

Apple preparation validates the exact Bundle ID, Associated Domains and Sign in
with Apple capabilities, existing distribution private-key identity, active
`IOS_APP_STORE` profile, exact app/team/certificate binding, expiry and disabled
debug entitlement. The verified profile is downloaded outside Git and installed
under its own UUID. Apple currently returns a `UNIVERSAL` bundle platform and an
iOS distribution profile listing `iOS`, `xrOS`, and `visionOS`; profile type and
exact application identity still gate acceptance.

Android preparation creates a distinct RSA 3072-bit PKCS12 upload key, verifies
that its alias contains a private key, and exports its public certificate outside
Git. An upload certificate is **not** proof of Play App Signing enrollment or the
certificate Google will use for installed applications.

## Observed status, 2026-09-20

| Item | Evidence/status |
| --- | --- |
| Apple Prod Bundle ID | Created after exact absent lookup, then exact readback |
| Associated Domains / Sign in with Apple / Push | Exact QA and Prod Bundle IDs now have all three capabilities; only missing capabilities were added |
| Apple distribution profiles | New, distinct `Rogichat QA App Store Capabilities v2` and `Rogichat Prod App Store Capabilities v2` profiles verified and installed; existing certificate reused |
| Android upload key | Created outside Git with dedicated Prod paths; private-key entry and certificate readback verified |
| App Store Connect app record | Exact API lookup absent; authenticated browser session unavailable |
| Google Play app / signing enrollment | Unverified; browser reaches Google sign-in, no authorized Play API credentials are configured in this preparation |
| Firebase reauthentication | Existing operator login step remains pending; no duplicate login request or target change |
| Signed Prod binary / store submission | Not attempted in this preparation |

Apple explicitly requires new app records to be created on the
[App Store Connect website](https://developer.apple.com/documentation/appstoreconnectapi/apps).
When an authenticated operator session is available, create the iOS record with
name `로기챗`, primary language Korean, Bundle ID `chat.rogi.rogichat`, SKU
`rogichat-prod`, then rerun the Apple preparation command for exact readback.
Google documents app creation through
[Play Console](https://support.google.com/googleplay/android-developer/answer/9859152).
No registration failure here establishes that the developer account lacks a role;
the browser authentication boundary prevents verifying its permissions.

The normal CLI authentication paths were also checked: installed Fastlane 2.232.2
reported no usable session through its noninteractive session check. No configured
Play Publisher credential, application-default credential, or available Google
Cloud/Play CLI session was found. These are authentication-availability findings,
not evidence that the account lacks a developer role. No password or raw browser
cookie was extracted, and no additional sign-in or verification-code request was
sent during this check.

The initial bootstrap profiles remain preserved. The subsequent
`tools/mobile/prod_capabilities.py` preparation uses a closed environment-to-Bundle
ID/profile-name mapping. It added Apple login to QA and push to both environments,
then created the two **new** App Store profiles above. Actual downloaded profiles
were checked for exact identity/certificate, Apple `Default`, Associated Domains,
`aps-environment: production`, expiry and distribution-only permissions before
private config references were updated atomically. The previous configuration and
profile bytes remain in private `signing/capabilities-v2` evidence directories.
No old profile/certificate was revoked, and no historical QA archive/IPA was changed.

```sh
python3 tools/mobile/prod_capabilities.py qa
python3 tools/mobile/prod_capabilities.py prod
```

The commands above only recheck/install already prepared profiles. Explicit
`--create-missing --update-config` enables preparation and config-reference changes.
The new profile gate applies to the next Apple/push feature build; it does not
retroactively reclassify historical QA builds. Capability/profile readiness does
**not** establish an APNs provider credential, a working push registration API,
notification delivery, or successful Apple authentication.

## Remaining release gates

- Verify the exact store records and operator permissions; do not infer them from
  Firebase authentication or a successfully generated local upload key.
- Integrate and execute the separate Prod artifact path below. The Android owner
  must mount its dedicated signing configuration before a signed Prod build;
  there is no QA signing fallback.
- Verify signed Prod artifact identity, endpoint, no shipped fixtures, privacy and
  dependency resources, and exact `rogi.chat` associated domains. Capability/profile
  permission alone does not verify a signed app or live AASA/assetlinks file.
- For Android verified links, use the actual Play app-signing certificate after
  enrollment, not an assumed match to the local upload certificate.
- Apple capability enablement does not implement Apple login. Product/backend
  login and mandatory SOOP linking still require their own implementation and QA.
- Keep Production promotion to `main` separate from QA, with trusted operator
  signing and no credentials on public PR runners. Store release is a separate step.

## Validation

The focused suite uses fake Apple responses and temporary files only:

```sh
python3 -m unittest discover -s tools/mobile -p test_prod_signing.py -v
python3 tools/security/check.py all
```

It covers exact identity versus QA prefixes, duplicate targets, lost creation
response reconciliation, capability target binding, wrong/wildcard profile app,
team/certificate/expiry/debug/distribution/platform/capability mutations, immutable
signing files and the preserved QA-only manifest boundary. It does not count as
an archive, SDK, device, store upload or provider authentication test.

## Separate local Prod artifacts

`tools/mobile/prod_release.py` prepares a signed `Rogichat-Prod` / `Release-Prod`
archive, a local App Store IPA export, and signed `prodRelease` APK/AAB files. It
does not expose an upload, submission or promotion command. The existing QA tools
and their QA-only manifest gate remain unchanged.

The private Prod configuration is the same one used for signing preparation.
Each new build requires an exact 40-character committed SHA and a completely clean
working tree, checked before the build and before its receipt is written. Outputs
are created once under the external artifact root's `prod/<platform>/<number>/`;
`release.json` binds the source, exact identity/API, versions and file/tree hashes.
Export uses an independent archive copy so Xcode metadata cannot mutate the
canonical signed archive. Reusing an existing build directory/export is rejected.

```sh
python3 tools/mobile/prod_release.py ios-archive \
  --source-sha <integrated-commit-sha> --build-number <number> --version <version>
python3 tools/mobile/prod_release.py ios-export --manifest <external-ios-release.json>
python3 tools/mobile/prod_release.py android-build \
  --source-sha <integrated-commit-sha> --build-number <number> --version <version>
python3 tools/mobile/prod_release.py verify-ios --manifest <external-ios-release.json>
python3 tools/mobile/prod_release.py verify-android --manifest <external-android-release.json>
```

The operator selects pinned Xcode through `DEVELOPER_DIR`. The iOS path requires
the separately prepared exact distribution profile and certificate. The signed
archive and IPA must contain `chat.rogi.rogichat`, `https://api.rogi.chat/v1/`, the
two exact `rogi.chat` callback domains, distribution entitlements, pinned GRDB
resources/license and the current privacy manifest. The app's actual signed
entitlements must include Apple `Default` and `aps-environment: production`, not
merely a profile permitting them. Dependency resolution uses
the committed lock files only. Local export is explicitly recorded as **not Apple
validated or uploaded**; App Store record registration remains a separate gate.

For Android, the tool reads the mode-600 dedicated Prod password file and supplies
only `ROGICHAT_PROD_KEYSTORE`, `ROGICHAT_PROD_STORE_PASSWORD` and
`ROGICHAT_PROD_KEY_ALIAS` to its child process. Passwords are never command-line
arguments. The agreed Gradle integration rejects partial Prod variables, preserves
unsigned hosted builds when all are absent, and has no QA fallback. This trusted
tool only accepts artifacts signed by the dedicated Prod upload certificate; it
checks both APK and AAB identity, endpoint, callback and signatures. This does not
establish Play enrollment or the final Play app-signing certificate.

Pure regression tests use temporary files and mocked SDK output, including wrong
signers/profiles/QA identity, moved or modified artifacts, source changes during a
build, unsafe IPA paths and Xcode mutation of the independent export archive:

```sh
python3 -m unittest discover -s tools/mobile -p 'test_prod_*.py' -v
```

These preparation changes have not yet executed a signed Prod build or store
validation. The parent integration owns the actual build and resulting evidence.
