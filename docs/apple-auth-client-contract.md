# Apple login and explicit identity linking

Backend writer: `task/apple-soop-link`. The web backend transport is supported; a new web Apple UI rollout is outside this native integration batch. This contract is implemented by the Apple
Nest module; provider registration and actual QA Apple account verification are
separate release evidence. Existing SOOP direct login and native SOOP endpoints
remain unchanged. No refresh endpoint exists.

`AppleStartDto`, `AppleStartResponse`, `AppleNativeCompleteDto`, and
`AppleExchangeDto` in `apps/api/src/modules/auth/apple/apple.dto.ts` are the exact
wire input types. All routes use `/v1/auth/apple` below.

1. `POST /start`, JSON: `{clientId:"ios"|"android"|"web",intent:"login"|"link",
   codeChallenge,returnState,termsVersion?}`. Challenge is SHA256(verifier),
   base64url without padding (43 chars); verifier is RFC7636 43–128 chars.
   returnState is a fresh random 32-byte base64url value (43 chars).
   Login requires `termsVersion:"2026-09-20"`; link omits termsVersion and
   requires the original authenticated session, recent authentication and terms.
   Response: `{transactionId,state,nonce,authorizeUrl,expiresIn:600}`.
2. iOS sets **exact returned nonce** on `ASAuthorizationAppleIDRequest.nonce`
   (do not hash again) and returned state on the request. Native success goes
   to `POST /native/complete`: `{transactionId,state,authorizationCode,
   identityToken,codeVerifier}`. Response: `{code}` (one-time completion).
   No provider email, display name or Apple user identifier is accepted as identity.
3. Android/web open authorizeUrl. Apple form-posts to the API `/callback`;
   it is never an app link. Server redirects to
   `https://qa.rogi.chat/mobile/auth/complete?code=…&state=<returnState>`
   for Android or `https://qa.rogi.chat/auth/apple/complete?code=…&state=…`
   for web (production uses `https://rogi.chat`). The same destinations carry
   `error=AUTH_FAILED` and state on cancellation. No tokens/subjects in URLs.
4. `POST /exchange`: `{clientId,transactionId,code,codeVerifier}`. Native
   response exactly follows existing native SOOP exchange:
   `{tokenType:"Bearer",accessToken,expiresAt,session}`. Web sets the standard
   HttpOnly session cookie and returns the existing `/v1/auth/session` DTO.
   The completion expires after 120 seconds. Consume once; do not blindly retry
   lost exchange responses. Reauthenticate on an unknown result.

For link, every start/complete/exchange request carries the ORIGINAL session.
Native uses Bearer + `X-Rogi-Client`; web uses cookies + matching Origin and
`X-CSRF-Token`. Server binds user UUID, session UUID, account generation, client,
environment, state, nonce, code and S256 proof. Logout, deletion, account change,
generation change or a different session reject the pending link. Native browser
callback checks the stored original session; exchange proves its possession.
Native login sends no Authorization. Web login must start after logout.

Apple success can return `soopLinkStatus:"REQUIRED"`,
`onboardingState:"SOOP_LINK_REQUIRED"`, `capabilities:{chat:false}`.
Keep the authenticated account and offer SOOP link, own account, logout, deletion,
support and terms. REST/socket/sync/media/reactions/chat-push reject chat access
with **403 SOOP_LINK_REQUIRED**, never trigger refresh loops or new accounts.
After SOOP link, use the returned rotated session and reload account state.

SOOP conflict is `409 SOOP_LINK_CONFLICT`. Apple conflict is
`409 APPLE_LINK_CONFLICT`. Neither transfers or merges an identity. Safe recovery:
log in directly with the existing SOOP account, then explicitly link Apple from
account settings; an Apple identity already owned by another restricted account
still conflicts. `401 LINK_SESSION_CHANGED`, `403 RECENT_AUTH_REQUIRED`,
`403 TERMS_REQUIRED`, `400 AUTH_FAILED`, and `503 AUTH_UNAVAILABLE` are stable
Apple errors; unavailable provider config is never successful authentication.
