# Web login through text send: current API v1 audit

## Source and deployment boundary

- Web baseline: `cf54f2438971fd82227c0f044659bd80993cd9e2` (QA).
- Reported running API/worker: `f6958c5b344e0a50aa519c02be433c6c90477ec2`.
- Prior command/sync v2 work stays on `dokdo2013/web-command-sync-v2` at
  `db6c488c94b34dce3f1fb98bf1103c052fe7dce4`, PR #59; this work neither merges
  nor activates it. Journey changes are based directly on current QA.
- This audit uses the existing web cookie transport and schemaVersion 1 sync.
  Native auth, schema upgrades, backend, infrastructure and mobile are outside
  this change. QA continues to use the production product composition.

## Current journey

| Stage | Existing client behavior and source contract |
| --- | --- |
| Login | Explicit terms checkbox enables `POST /v1/auth/soop/start`, JSON `{ intent: "login", termsVersion: "2026-09-20" }`, API cookies included. Matches running API `auth.controller.ts` at the pinned API SHA. |
| Callback | API sets the session cookie and redirects to web `/`; provider denial redirects to `/auth/login?error=AUTH_FAILED`. Web converts that failure route to an enumerated `/login?reason=failed`, discarding raw query values. `/auth/complete` independently verifies the session and does not claim success from navigation. |
| Session | `usePrivateSession` reads session, profile, then session again; requires verified SOOP linkage and matching CSRF binding before exposing private content. Unauthenticated, link-required, unavailable and pending logout remain gated. |
| Room | `useRoom` requires the explicitly configured default room, locates that exact ID in the paginated `/v1/rooms` directory, and offers explicit entry if not joined. It does not select the first available room. |
| Authorization | `ChatController` reads the full `/v1/sync` membership manifest, room profile-sync and private-recipients before snapshot/events. Recipient visibility alone never grants send permission. These rooms/messages/sync modules have no source differences between the pinned running API and web baseline. |
| Text send | Uses current `/v1/rooms/:roomId/messages`, CSRF, immutable retry ID/payload, role-authorized SHARED/PRIVATE intent and TEXT content. A validated committed receipt proves persistence; only subsequent server reads populate the timeline. |

## Concrete frontend corrections

1. A committed send racing an older in-flight sync called `refresh()`, which
   coalesced into that old read. If it had already captured the pre-send server
   state, the saved message stayed absent until a later socket hint or poll.
   Send now schedules revalidation after the existing read settles. The unit
   regression reproduces the missing second read on the baseline, then proves
   the saved message is fetched without a timer, fabricated item or manual refresh.
2. A session expiring after room discovery but before entry left the old entry
   button on screen with a login-required error. A join 401 now refreshes the
   session gate, providing the login path instead of another stale join attempt.
   The isolated browser regression checks both the login gate and absence of
   the entry button/private chat after the rejected request.

## Actual external acceptance blockers

Read-only public QA observations around 18:53–18:59 KST on 2026-09-20:

- `/login`: HTTP 200; `/healthz`: HTTP 200 with `status: ok`.
- Unauthenticated API `/v1/auth/session`: HTTP 401, `UNAUTHENTICATED`, no-store.
- Public web runtime serialization explicitly contains `defaultRoomId: null`.
  Thus even a successful login currently reaches the honest unconfigured-room
  state before room discovery. The backend must commission a real FAN room
  with a verified eligible owner, and infrastructure must bind that room's ID
  using `ROGICHAT_DEFAULT_ROOM_ID`. An ID chosen from directory order or a
  synthetic owner/room would not satisfy acceptance.
- Coordinator relayed a live browser terms/login attempt at 18:50 KST:
  start returned HTTP 503 `AUTH_UNAVAILABLE`; the UI stayed on login with the
  safe generic retry error. Coordinator also relayed that the dedicated broker
  request route was undeployed (404), independently of the unresolved canonical
  SOOP subject contract. This worker did not initiate competing OAuth or consent.
- Identity readiness must remain fail-closed. No client change can establish a
  canonical identity, install a broker route or create a real session by itself.

No actual user login, room membership or text delivery was observed by this
worker. End-to-end live acceptance remains blocked on broker/identity readiness
and real room commissioning/configuration, then a fresh authorized browser run.

## Verification

- Reproduced the send regression before its fix: expected two event reads, got one.
- After the fix: all 82 web unit tests passed; TypeScript and ESLint passed.
- Retained `node_modules` were used directly. The local pnpm shim points at a
  missing cached launcher; no dependency installation or heavy build was run.
- The new join-expiry browser test requires the production artifact in CI;
  local browser execution was not claimed. Security hooks and remote CI are
  required publication checks; their result is reported with the immutable PR SHA.

The parent owns review, integration, QA merge and deployment. These frontend
corrections alone do not resolve the observed login 503 or configure the room.
