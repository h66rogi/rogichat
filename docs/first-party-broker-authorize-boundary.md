# First-party broker browser boundary

Hosted QA and production SOOP login starts accept browser authorization URLs only
at `https://auth.rogi.chat/v1/platform/oauth/rogichat/authorize`, with exactly one
43-character opaque `request` query value, HTTPS, no userinfo and no fragment.
`HttpBroker.request` and `NativeAuthService.start` use the same predicate. Invalid
or foreign destinations return `AUTH_UNAVAILABLE` before any browser redirect or
native launch ticket is returned. Native failure marks the pending transaction
failed without persisting an invalid launch URL.

The confidential `broker.baseUrl` remains server-side transport configuration. It
may use the first-party proxy or an internal broker origin; a matching transport
origin alone no longer authorizes a browser destination in hosted environments.
Isolated non-hosted configuration retains its configured browser origin. No
startup config validation, session keys, existing sessions, provider identity,
CSRF binding or PKCE policy changes in this patch.

Tests retain server transport request/exchange assertions and cover first-party
acceptance, foreign/malformed destination rejection, exact URL shape, non-hosted
behavior, and native failure persistence. Native and deletion integration fixtures
now return the first-party browser origin while keeping their synthetic transport
origin distinct. Fixtures remain isolated from application runtime.

This guard deliberately makes new hosted SOOP starts unavailable while the broker
still returns a foreign browser origin. Activation requires first-party ingress,
a dedicated correctly branded provider app and callback, and the broker release
that returns the first-party authorize URL. Remote CI is source verification;
actual login/session and every failure/retry route need release-owner validation.
