# Backend live acceptance — 2026-09-20 UTC

This record separates real product verification from isolated test evidence.
Dates below are UTC; add nine hours for KST. It contains no account identifiers,
provider subjects, credentials, private infrastructure addresses or message bodies.
An accepted release does not close every M01–M12 operational requirement.

## SOOP profile and genuine default room (schema 25)

QA and production API/worker ran public source
`5f41f70bd76912c871324cc5a92ab4ea4bc13f99` before the profile-capable broker
was activated. The deployment owner verified the exact 25 generated migration
names/checksums, healthy workloads without restarts and public readiness.
Only after both environment gates did the broker owner activate the compatible
profile response. Both old and additive broker envelopes remain covered by API
tests; rollback must reverse this compatibility ordering.

The WEB owner then used the retained real browser contexts, not an API-created
session or a fixture-backed screen:

| Environment | Actual observation |
| --- | --- |
| QA | One ordinary OAuth at 20:37:30; session/profile 200, original user UUID preserved, actual provider nickname/display ID/photo initialized. Default room READY/FAN; normal join at 20:38:33. One authorized private-to-owner message committed at 20:39:15. Full reload preserved account, storage partition and message; provider photo decoded successfully. |
| Production | One ordinary OAuth at 20:40:59; session/profile 200, original user UUID preserved and actual provider metadata initialized. Normal default-room join at 20:41:56. Full reload preserved account/partition/joined room; provider photo decoded successfully. No production message was sent. |

The active catalog existed without a fabricated user or owner membership.
The intended real streamer had not yet authenticated. Therefore these checks
prove fan access and persisted private-to-owner inbox behavior, **not** that the
streamer received or read a message. Real owner binding still requires the exact
configured verified provider identity. It cannot use the first user, nickname,
avatar or a reviewer account as a substitute.

Fresh migration, repeated/concurrent startup, delayed identity configuration,
eventual genuine owner binding and preserved private backlog are covered by
`apps/api/test/integration/default-room.test.mjs`. Existing manual nickname/avatar
edits, explicit avatar clearing and concurrent manual-edit preservation are
covered by `apps/api/test/integration/soop-profile.test.mjs`. The live OAuth above
does not separately claim a manual-edit experiment on the real account.

## Administrator/reviewer access (schema 26)

The separately reviewed public integration is
`d95a34adf71c38f888ddddc759bd6fce7d921046`, merged to QA as
`a63bbdae583dcd84c42b07872b1c374c84bd6b01` and promoted through PR #104 to
`7c322c64c1ec2a365722897bbc63aadf26b26905` on main. A source merge alone is not
runtime or consumer acceptance.

The generated migration is `20260920185425_admin_reviewer_access`, SHA-256
`d000e455dbd31efddbe4db2c20d3efe8b93a587f3205639dbba6be0169e65df2`.
No old migration was rewritten. Protected one-shot bootstrap requests are
environment-specific and use the previously verified real operator identity.
Reviewer credentials are separate, independently generated and never embedded
in product code or a public artifact. A reviewer is a real persisted account,
not a mock SOOP identity or permanent room owner.

### Observed QA WEB acceptance

The WEB owner reported the following against paired QA API/worker/web source
`a63bbdae583dcd84c42b07872b1c374c84bd6b01`:

- Existing SOOP account capabilities returned 200 with the exact approved
  administrator permission; account identity and profile were preserved.
- A normal UI self-grant at 21:10:16 became effective STREAMER for 300 seconds.
  After its real 21:15:16 expiry, the 21:15:37 capability response was FAN with
  no temporary grant and every streamer permission false. The UI returned to
  FAN without a manual reload; no clock or expiry was altered for the test.
- A separate normal UI grant at 21:15:49 was explicitly revoked at 21:16:05.
  At 21:16:16, current capabilities were FAN, active grants zero, and the revoked
  grant remained in history. Full reload at 21:16:32 preserved the original
  UUID, account partition and real provider profile.
- An isolated real reviewer browser used the normal password form once at
  21:11:33. Session was READY with chat enabled; normal default-room access and
  the FAN private-to-owner composer worked. Full reload at 21:12:40 preserved
  the reviewer identity/partition. `/admin` denied the reviewer at 21:12:59.

No extra OAuth, chat message or password rotation was used for this QA26 WEB
acceptance.

### Observed QA iOS acceptance

At 21:16:39, the MOBILE owner completed XCUITest against the real installed QA20
app from the schema26 integration tree. Exactly one native password login used
the protected reviewer credential. Process termination/relaunch restored the
session from protected storage; the actual default room joined and exposed its
composer without an incorrect SOOP-link requirement. No message, password change
or OAuth was performed. Credential copies used by the test runner were removed;
private receipt/result bundles retain the test evidence without public credentials.
The MOBILE owner subsequently confirmed this frozen iOS build 20 as TestFlight
VALID / IN_BETA_TESTING with the intended internal group and Korean release notes.

### Observed QA Android acceptance

At 21:32:08, the MOBILE owner reported real signed build 20 acceptance separately
from iOS: one normal native password login, READY room list, force-stop/relaunch
with protected session restoration, and the existing genuine default-room
membership/composer. No SOOP hard gate, synthetic session, message or password
rotation was used. Test-harness field/selector corrections stayed outside the
product; the signed APK bytes were unchanged. Temporary credential copies were
removed and credential values were not printed. At 21:32:50, the MOBILE owner
separately confirmed publication through the approved private GitHub distribution
and matching hashes for all eight freshly downloaded assets. Firebase distribution
authorization remains a separate unavailable dependency, not an implied success.

### Observed production26 runtime and bootstrap

At 21:22:19, the deployment owner independently observed all production API,
worker and web workloads running the reviewed QA artifact source
`a63bbdae583dcd84c42b07872b1c374c84bd6b01`, healthy with zero restarts. This is the
promoted immutable artifact, not a claim that its source label was rewritten to
the later main merge SHA. All 26 SQL migration names/checksums matched. The
ACTIVE catalog still had no fabricated owner; existing account identity, room
and zero production messages were preserved.

The protected administrator and reviewer bootstrap commands completed using the
reviewed migration image, real regular-file input and runtime DML credentials.
Fixed success markers, operation journals and temporary-file cleanup were
verified separately. The shared authentication broker was not restarted or changed.
The earlier readiness 503 was within the approved migration maintenance fence,
not a successful-serving claim. After the deployment receipt, a separate backend
check observed public `/live` and `/ready` returning 200.

### Observed production WEB acceptance

Against the same paired source, the WEB owner completed:

- Existing SOOP administrator: normal 300-second UI self-grant at 21:24:46;
  current capability 200/STREAMER/temporary at 21:24:59; normal revoke returned
  the account to FAN with zero active grants and one revoked history entry.
  Full reload and the 21:27:24 recheck preserved that revoked state.
- Original session/profile 200 at 21:26:50 preserved the original UUID,
  account partition, verified SOOP, chat entitlement and actual provider profile.
  The settings image loaded successfully at 21:27:09.
- A distinct production reviewer used the normal password form exactly once at
  21:26:20. Session/profile 200 and full reload at 21:26:50 preserved its real
  identity, partition and chat entitlement. `/admin` denied the reviewer with
  no administrator form at 21:27:10.
- Read-only room discovery at 21:27:24 showed the genuine READY/FAN default room
  and an honest participation prompt for this unjoined reviewer. No reviewer
  join or production message was performed; neither is inferred from discovery.

No OAuth or password rotation was performed. No active production test grant
remains from this acceptance. Natural 300-second expiry was already measured in QA; production
explicit revoke is not relabeled as a second natural-expiry measurement.
Temporary credential bridges were removed without changing the issued credentials.

The actual administrator entry is settings → `관리자 페이지` → `/admin`.
The normal form exposes `유효 시간`, `발급 사유`,
`내 계정에 임시 권한 발급` and `권한 회수`. Reviewers enter through the ordinary
login page's `아이디로 로그인` form using privately issued credentials and terms.

## Evidence boundaries and remaining operations

- The exact schema26-compatible 30-minute soak passed as hosted run
  [35537369172](https://github.com/h66rogi/rogichat/actions/runs/35537369172).
  See [measurements and limits](backend-m12-quality-evidence.md#observed-schema26-thirty-minute-soak-run-35537369172)
  for the full result, including injected errors, tail latency and worker timing.
- An isolated 30-minute API/worker/MySQL/native-video soak is independent from
  real-provider and real-browser acceptance. Its exact tested checkout, results
  and limitations must accompany any claim that its acceptance targets passed.
- R2 authorization and actual upload/read/expiry/Range/delete/purge remain a
  distinct live gate. A disk adapter or independent S3 ledger canary is not R2
  evidence. Known provider credential failures must not become fake success.
- Disposable logical MySQL restore proves only the exercised restore procedure;
  actual Aurora restore, complete external deletion-ledger inventory, backup
  expiry and physical deletion require their own retained evidence.
- VAPID custody is not delivered Web Push. Actual Web Push/APNs/FCM delivery and
  their missing provider configuration must be tracked separately.
- Independent Apple chat authorization in source does not prove live Apple
  provider configuration or an actual Sign in with Apple flow.
- The low-cost MVP topology is one API and one worker. Earlier bounded 1,000-client
  experiments are not a production capacity promise. Cross-node realtime hints
  and expansion gates retain the limits in the quality evidence document.
