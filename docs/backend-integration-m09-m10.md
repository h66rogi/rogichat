# Native authentication, media and deletion foundation integration

This integration preserves the reviewed commit ancestry of native SOOP issuance
(`de02c6a`, PR 23), video decoder IPC (`bd00a7f`, PR 24), PHOTO publication
(`f3bace3`, PR 25), and the external deletion-ledger port (`8313c5d`, PR 27),
together with QA `90a73e1` and its Swagger and real web product changes.
No production promotion, host activation, R2 provisioning or external broker
activation follows from this source integration.

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
unsupported. Decoder IPC alone is not VIDEO worker activation.

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

The ledger module is still an unregistered foundation, not external-first deletion
admission, account deletion or proof of physical purge. M10 admission/replay,
bounded content and media cleanup, independent backup inventory and restore gates
remain separate work. Actual provider identity, R2 permissions/expiry/Range and
isolated decoder process limits still require operational evidence. Isolated test
fixtures are not deployed users, messages, adapters or successful provider flows.
