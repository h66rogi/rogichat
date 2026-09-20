# Native callback web association

2026-09-20. Web follow-up to the production application implementation. The backend
contract checkpoint is `ac69ca2`; its native browser handoff/exchange remains a later
slice, so publishing these files does not establish working native login.

## Runtime selection and public association

The same image uses the validated `ROGICHAT_WEB_ENV` configuration. The request Host
never selects the app identity or callback destination. QA serves the verified public
QA identities supplied by the coordinator and directly reconfirmed by the mobile owner against current QA signing artifacts; production identities
are not verified and production deliberately returns empty association documents.
Actual signing keys, provisioning profiles and credentials are not included.

| Response | QA | Production |
|---|---|---|
| `/.well-known/apple-app-site-association` | `FS9YQ9URFY.chat.rogi.rogichat.qa` for webcredentials and exact `/mobile/auth/complete` applinks component | Empty applinks details and webcredentials apps |
| `/.well-known/assetlinks.json` | `chat.rogi.rogichat.qa` plus the approved SHA-256 signing-certificate fingerprint | Empty array |
| `/mobile/auth/complete` | Fixed fallback, no auth exchange | Same honest fallback |

The QA Android fingerprint is the public certificate digest supplied in the coordinator's
verified contract, not a private key. The source constant and contract test match that
digest exactly. Android 15+ dynamic path rules allow only the callback path; older
Android versions rely on the native manifest's exact-path intent filter, which remains
owned by the mobile worker.

[Apple associated-domain documentation](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
requires the matching application identifier, app entitlement, HTTPS and an association
file without redirects. The webcredentials apps list and exact applinks component follow
that schema. [Android website-association documentation](https://developer.android.com/training/app-links/configure-assetlinks)
requires public JSON over HTTPS without redirects and the matching package/signing
certificate. Dynamic rules supplement the native manifest and cannot replace its scope
on Android 14 and earlier.

## Callback privacy

The fallback is a `route.ts` that receives no Request argument and returns fixed HTML.
It never reads, displays, logs, validates or exchanges callback code/state and does not
load the Next application, third-party resources, analytics, cookies, API requests or
browser storage. A fixed early script calls `history.replaceState` with the known path;
it removes query and fragment without reading either. With JavaScript disabled, the
page tells the person to close the tab and return to the app.

The response sets `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, nosniff and
a restrictive CSP allowing only the hashes of its fixed inline script and style.
It reports no login success and asks the person to return to the app or restart login
there. The home link sends no referrer. Infra separately owns removal of sensitive URI
and header fields from proxy error/access logs; this web response cannot sanitize a
request already received by upstream infrastructure.

The legacy `/auth/login` failure redirect also now returns a relative Location containing
only an enumerated reason, eliminating its previous Host-derived absolute destination.

## Verification

Four unit cases cover exact QA identity/path, Android digest/path, empty production
associations and isolated fallback behavior. Production browser tests cover direct JSON,
spoofed Host non-reflection, sentinel code/state non-reflection in HTML and headers,
query/fragment removal, no other requests, keyboard focus and axe serious/critical
violations. The pipeline owner verifies actual Next header precedence and production
runtime responses; public HTTPS association retrieval and real-device OS verification
remain deployment/mobile gates.
