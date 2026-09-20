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
| Associated Domains / Sign in with Apple | Enabled on the Prod Bundle ID only |
| Apple distribution profile | Created using the existing distribution certificate; exact profile verified and installed under its own UUID |
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

## Remaining release gates

- Verify the exact store records and operator permissions; do not infer them from
  Firebase authentication or a successfully generated local upload key.
- Implement/review the separate Prod archive/export and APK/AAB signing paths.
  The current Android Gradle configuration wires QA signing only; this preparation
  does not silently reuse that key for `prodRelease`.
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
