# Native product integration

This batch builds on the actual native session, room membership, account deletion
and durable conversation implementations. QA and production use the same product
composition. Synthetic users, messages and success responses remain restricted to
isolated tests; unavailable providers and APIs produce errors or unavailable states.

## Verified conversation baseline

PR [74](https://github.com/h66rogi/rogichat/pull/74), source
`b23fea7dbc362d66ad2e7020a5a51241d15e35df`, includes current QA
`c5c75d433e1da9a46d8a2fa4b66c405ab6e4a0c5` through a normal merge.
All required checks passed. [Mobile run 35508874961](https://github.com/h66rogi/rogichat/actions/runs/35508874961)
verified:

- Android: every variant, lint, packaged environment separation and an ephemeral
  test signing key. Hosted API 36 revision 7 ran 27 actual Keystore/SQLite tests
  with zero skips.
- iOS: ten strict Swift suites, 27 actual GRDB tests, protected-store-to-SQLite
  cold recovery with receipt GET only, and a disposable real system Keychain.
- iOS: Debug-QA, Release-QA, Debug-Prod and Release-Prod device SDK bundles.

This checkpoint has not produced a new tester release. Its QA merge is held for
the larger coherent product batch; the feature source and final artifact gates
below must be verified separately.

## Feature integration ownership

| Area | Implementation boundary | Remaining acceptance |
|---|---|---|
| Apple identity | Existing protected pending proof, one-shot transaction, original LINK bearer, atomic credential publication | Provider login and account linking |
| Media and avatars | Existing native HTTP and account DB, original room authority, immutable SEND, bounded picker/private download files | Hosted Android storage checks and real authenticated upload/access |
| Message actions | Durable action journals, current action hints, explicit user commands, GET-only recovery of uncertain results | Hosted Android storage checks and authenticated end-to-end actions |
| Own blocks | Current server labels only; per-room operations remain available after leave; account-wide discovery uses the frozen contract below | Actual backend deployment and authenticated cold login/new-device recovery |
| Push | Actual OS permission, protected installation custody, provider capability, binding CAS, separate explicit preference ON | Provider configuration and real device evidence |
| Realtime | Real SDK, foreground REST authority, no ambient cookies, explicit reconnect after REST validation | Live authenticated reconciliation |

The applicable Meloming implementation reuse is recorded in
[R53–R62](mobile-reuse-audit.md). No Meloming chat UX, operational configuration,
identifiers, credentials or signing material are copied.

The own-block room discovery contract is frozen in backend source
`0d75c977244b43c2882b6f0fcbce8bc50664e25f`:
`GET /v1/blocked-rooms?cursor=<opaque optional>` returning
`{rooms:[{roomId,displayName:string|null}],nextCursor:string|null}`. The cursor
query has a 2,200-character bound and is account/session/audience scoped for 15 minutes.
An empty page can have a continuation because the server scans bounded membership
pages. Clients must continue until null, reject loops/duplicate IDs and cap total
work. Invalid cursors require restarting the GET traversal; they never authorize
replaying mutations. Labels are current permitted projections, never stored old
names or raw identifiers used as user-facing substitutes. Backend integration
tests and live deployment evidence are tracked separately from this source contract.

## Integrated source checkpoints

The integration branch preserves the original reviewed helper ancestry: media
`704c3c5c091205ef610f096e3b85df5a0e8e2139`, actions/current block labels
`dd60ef0d86462d746bbe474ec6fafada73cb9dda`, identity/push/realtime
`b0488e0f7751fbddf6cadb7a338ad646873add1e`, and signing
`50754b7fe65bfd0d09facbbb90179167021e9705`. iOS composition is
`5c4f8640cca940517ae1756ec379e909c4434187`, followed by
`e30ab5d69cb3ecdacfcc26c47cf068541c7f1e27` for completed unblock-dispatch
cleanup after journal failures. Android final composition is
`fbf65ff91888fb92a50a3e0052ff11ffe041ee2c`; its QA 233 and production 225 JVM
tests, QA lint, QA APK and instrumentation APK assembly passed. The 30 Android
instrumentation cases compiled but have not yet run against this final source.
Five Android and seven iOS helper conflicts were resolved to these final reviewed
platform implementations; the original extracted helper history remains intact.

The parent integrated run passed all 20 strict Swift suites, actual loopback
WebSocket checks, 30 actual on-disk GRDB tests and all four device SDK configurations
on the initial feature source, including the APNs outstanding-callback reservation.
The cold native-session/SQLite harness needed an explicit test-only rejection of
the new feature enum; its rerun passed with one original POST and GET-only recovery.
The later unblock fix passed 118 strict helper assertions and all four affected
device SDK configurations passed again on that final iOS source. No simulator, physical
device, provider account or delivery success is inferred. The integrated
Python release/guard suite ran 174 tests: 173 passed and the opt-in disposable
Keychain test was skipped locally; its previous hosted evidence remains separate.

## Cross-platform review corrections

Read-only cross-platform review found two concrete recovery defects before signing.
A completed unblock dispatch could remain in memory after a journal failure and
prevent a fresh GET. Both implementations now retire only that completed dispatch,
preserve durable UNKNOWN, and keep older completions from clearing a newer request.
Android additionally covers enqueue COMMIT rollback (zero rows and zero DELETEs)
and receipt COMMIT failure (one DELETE, UNKNOWN retained, GET-only recovery).
Concurrent Android profile/avatar writes now share serialization through HTTP and
response publication, retaining the original account ticket while queued and at
actual dispatch. Reverse completion and logout while queued have regressions.
The review found no remaining concrete P1/P2 within these bounded paths after fixes.

## Dependency and artifact checks

The host persistence package retains only GRDB 7.11.1. The app lock additionally
pins SocketIO 16.1.1 and Starscream 4.0.8 at reviewed exact revisions. Release
checks inspect three original license notices and the actual GRDB and Starscream
privacy bundles. The app declaration also includes account-linked photos/videos
for functionality, alongside its existing profile, device and message data.

The intermediate actual Debug-QA device SDK app passed these pin, resource and
privacy checks. Thirty-four Python mutation checks passed for resolver identity,
revision/source changes, missing resources, wrong declarations and tracking types.
These results do not substitute for the final feature source build or signed IPA.

## Release prerequisites and evidence gaps

- QA Firebase CLI reauthentication is pending. The installed CLI is available
  through `PATH="$HOME/.nvm/versions/node/v24.11.1/bin:$PATH" firebase login --reauth --no-localhost`.
  No authorization codes or callback URLs belong in repository files or logs.
- A configured Android Firebase SDK uses a real environment-specific input outside
  Git and its approved app/project target. A completely absent input disables push
  initialization and enrollment; it does not block other real API flows or signing.
  Explicit but missing files, partial/malformed values and environment/target
  mismatches still fail closed. Artifact checks distinguish four empty SDK
  resources from the exact configured values, without fictional identifiers or
  a bypass flag. QA App Distribution target metadata exists, but the SDK input is
  not yet available; production Firebase registration/configuration is unverified.
  Upload/distribution retain their independent real target/authentication checks.
- Both iOS Bundle IDs have the Apple, push and associated-domain capabilities and
  separate App Store profiles. Their signed entitlement/profile/certificate checks
  are enforced by release tooling. APNs provider key custody and delivery are not
  established by an App Store Connect API key or provisioning profile.
- The production App Store Connect app record is absent. No authenticated browser
  or cached CLI session is available to create it. Production Play registration
  and Play App Signing remain unverified.
- Actual SOOP/Apple account login, physical-device notification delivery and a
  full authenticated feature round trip have not been performed. QA native SOOP
  transaction/exchange routes are live; that does not establish deployment of
  every newer backend feature contract.

If Firebase authentication remains unavailable, the final verified coherent signed
APK may be delivered through an authenticated private operations Release asset.
That artifact must bind the full public source SHA, actual APK SHA-256, signing
certificate fingerprint, environment/API origin/version/build and validation runs.
Download/hash readback is required. This is a signed downloadable artifact, not
App Distribution or store delivery. No signing material is included.

Mobile automatic release scheduling remains a follow-up after this coherent signed
checkpoint: use the trusted Mac and existing CLI with current merged-QA provenance,
required CI, durable numbering/locks and provider-specific truthful status.
Public PR jobs continue to receive no credentials.

Existing QA build 14 artifacts and distribution receipts remain unchanged. No
build 15 or new full-feature tester release is claimed by this record.
