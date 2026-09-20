# Web login focus incident

Investigation: 2026-09-20, approximately 22:38–22:46 KST. Fix base:
`db28e94` (merged QA). Observed public web source: `129f`; API: `397`.

## Demonstrated pre-provider failure

The session hook replaced every state with `checking` on window focus. That
unmounted public login links and the `SoopButton` containing in-memory consent.
On an unfocused window's first pointer interaction, the focus event could remove
the intended target before pointerdown, leaving an apparently inert control.

In a dedicated Orca tab, event listeners recorded trusted window focus followed
by trusted pointerdown/up/click targeting the temporary loading `SECTION`, not
the checkbox. The document's `performance.timeOrigin` stayed identical for this
sequence, distinguishing the race from separate tab/document reloads also seen
between some automation command batches.

An independent isolated Chromium browser corroborated consent loss on the live
page: native checkbox activation produced `checked=true`; dispatching the focus
lifecycle event produced `checked=false` and a disabled login button. This
second focus event was injected, not claimed as native input.

The fix keeps only `unauthenticated` public controls mounted during revalidation,
including hidden-page refresh and restoration. Account-bearing states still
lock before the next request. Logout/deletion markers, generation fencing,
session consistency checks and server authorization remain in effect.

## Separate candidate session contract defect

The deployed `129f` parser accepts the three-field cookie session from API `397`.
It does not contain the candidate's strict four-field parser. Therefore the
candidate defect does not explain the current pre-provider symptom.

At the QA base, the API cookie session producer returns `authenticated`,
`soopLinkStatus`, `csrfToken`, `accountPartition`, `onboardingState` and
`capabilities`. The candidate web parser rejected the last two fields. The new
regression failed with `INVALID_SESSION` before the fix and passes afterward.

All three session consumers (account API client, chat controller and privacy
client) now use the same parser. The parser deliberately allows the two admission fields together and checks
that their values agree with verified/link-required status. Unknown fields,
partial admission fields, invalid capability types and a missing account
partition still fail closed. No partition is fabricated for the old API.
Deployment of this candidate requires the corresponding API partition contract.
The common browser test fixture and privacy browser projection now match the
actual six-field producer. A separate chat regression reproduced rejection of
that response and verifies that a later capability denial clears private chat.

## Live boundary and limitations

Without request interception or credentials, isolated Chromium followed home →
chat → login → consent → a trusted native `BUTTON` click → start HTTP 200 →
provider redirect → SOOP password form. No page error was observed. The API
transaction cookie was host-only on the API origin, Secure, HttpOnly, SameSite
Lax, with path `/`. No cookie values or redirect query parameters were retained.

This proves the continuously focused pre-authentication path can work, not that
provider login succeeds. In that initial run, no credentials were available or
requested; no real callback, identity exchange, session issuance or authenticated
chat was observed. A later attempt with a user-established provider session
returned the web login failure route; session issuance remained unverified.
Recent real callback correlation and immutable deployment verification belong
to the infrastructure incident owner. The provider/native return incident is
not resolved by this web change.

## Validation

- All 348 web unit tests; lint and TypeScript passed.
- Production build and runtime artifact isolation passed.
- Full browser suite: 244 passed on desktop and mobile Chromium, with two
  intentional viewport-specific skips (desktop drawer and mobile sticky aside).
  Delayed session reads verify public controls remain actionable while private
  content disappears; hidden online/restoration verifies consent preservation.
- Public repository security scanner passed before publication.
- Local tools used retained dependencies copied into this isolated checkout.
  The local Node runtime was 24.11.1; CI must verify the repository-pinned runtime.

Publication, required remote CI, owner review and deployment are separate gates;
this report does not claim that the running release already contains the fix.
