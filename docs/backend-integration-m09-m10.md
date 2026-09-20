# Native authentication, media and deletion foundation integration

This integration preserves the reviewed commit ancestry of native SOOP issuance
(`de02c6a`, PR 23), video decoder IPC (`bd00a7f`, PR 24), PHOTO publication
(`f3bace3`, PR 25), and the external deletion-ledger port (`8313c5d`, PR 27),
together with QA `90a73e1` and its Swagger and real web product changes.
No production promotion, host activation, R2 provisioning or external broker
activation follows from this source integration.

The next combined source batch incorporates QA `d98ff28`, VIDEO worker PR 32
(`9aa1891`), QA-only automatic backend helper PR 29 (`9c368cf`), and the web
owner-approved frozen automatic export PR 31 (`5bc0ca8`). Normal merges preserve
the reviewed ancestry. The web archive shared-core changes retain the default
manual backend producer contract; automatic exports require explicit event and
independently verified workflow provenance. Neither helper is installed or
commissioned merely by merging source. Schema-changing backend releases remain
on the separately approved migration path, not the no-migration automatic lane.

## Controller contract alignment

The three native issuance routes are documented on their actual Nest controller:

- `POST /v1/auth/native/soop/transactions`: strict login/link request alternatives,
  explicit login consent, client-bound S256 and return state.
- `GET /v1/auth/native/soop/launch`: one-use browser launch ticket and 303 response.
- `POST /v1/auth/native/completions/exchange`: one-use completion code and verifier;
  opaque seven-day credential plus the existing minimal native session DTO.

The 600-second overall lifetime is not a launch-ticket or completion-code lifetime:
those are 60 and 120 seconds respectively. Login rejects Authorization; link
requires the original recently authenticated native session at start and exchange.
No browser session/CSRF alternative is documented for native JSON requests.
Header/body conditional requirements remain explicit descriptions plus runtime
checks because OpenAPI security alternatives cannot express those conditions.
The callback documents its stored-channel branch and never promises a native
session cookie or a recoverable credential after an exchange ACK is lost.

PHOTO publication keeps its existing receipt/status shape. Its description now
matches the reviewed PHOTO copy implementation; VIDEO/STICKER publication remains
unsupported. The VIDEO worker now persists independent video/poster objects and
finalizes them atomically after fresh owner/lease checks. Source integration does
not establish actual R2 processing or isolated decoder deployment.

## Verification boundaries

The initial combined graph exposed two failing OpenAPI inventory tests for missing
native metadata. These tests were retained and the controller metadata corrected,
not excluded. Native request schema tests cover consent, unknown fields, PKCE and
client bindings. Actual native HTTP success/error/redirect responses in the
disposable MySQL suite are now validated against the generated OpenAPI document.
Health/auth/full exports use existing offline test composition and do not contact
the broker, a service DB or object storage.

Independent review found no blocker in the native metadata change and identified
an inherited bearer-scheme description saying issuance did not exist; it is
corrected here. Runtime authentication, session projection and controller input
validation are unchanged by the documentation edits.

Before the next source batch, the combined native/media/ledger graph passed 259
unit/contract/HTTP-process cases and 159 disposable real-MySQL cases, including
actual native HTTP response validation; offline OpenAPI export and lint passed.
The added VIDEO worker and release/export seams receive combined verification
again rather than inheriting independent branch CI as integration evidence.

The combined batch passed 270 API unit/contract/HTTP-process cases, 175 disposable
MySQL cases, 110 operations cases, 22 web archive cases, and 11 migration/schema
probe cases. The independent disposable-MySQL read-only schema probe also passed.
Build, lint and offline OpenAPI export passed. One initial operations failure was
a missing local Compose executable; rerunning with the official checksum-verified
standalone executable passed the unchanged render/isolation assertion. No test
was skipped to make that environment failure green.

The final intake adds only the reviewed web HTTPS readiness correction
(`29f5ef9`): verified TLS, no redirects, transient-only retries within 90 seconds,
and preservation of an enclosing caller's absolute alarm deadline. First-activation
rollback remains covered. This helper-only change reuses the unchanged API/MySQL
evidence above and reruns affected combined operations and publication checks.

An independent Claude Opus 5 review of the bounded web automatic-export change
(`27b9e61`, identical nine reviewed blobs at `5bc0ca8`) reported no blocker and
passed 22 web plus 48 backend/helper cases. That verdict does not cover unrelated
backend changes or the later TLS correction. Historical archive provenance is
distinct from release preflight and receiver/poller checks of current successful
CI attempts; rerun revocation remains enforced at those later gates. Automatic
web export currently requires the repository default branch to remain `qa`.

The ledger module is still an unregistered foundation, not external-first deletion
admission, account deletion or proof of physical purge. M10 admission/replay,
bounded content and media cleanup, independent backup inventory and restore gates
remain separate work. Actual provider identity, R2 permissions/expiry/Range and
isolated decoder process limits still require operational evidence. Isolated test
fixtures are not deployed users, messages, adapters or successful provider flows.
