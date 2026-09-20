# Web Push enrollment module integration

`apps/web/src/features/push/**` implements Web Push enrollment and its lifecycle for the web
app: server capability, the account preference, browser subscription registration and removal,
the account/session fence and the wake-payload logic the service worker needs.

This document is the wiring contract for the owners of the shared web files. The module ships
its own transport and no UI, and the only line it changes outside itself is the `test:unit`
glob in `apps/web/package.json`, so nothing in it is reachable from the product until the
settings screen and `public/sw.js` are wired as described below.

## Source of truth

Every route, status, field, pattern and rule in the module was read from the authoritative
backend commit `46bca354c96c4ce972ecf5320f6706e20041d161` (PR 52, M11 input `69bfa9a`):

- `docs/backend-m11-contract.md` — persistence, DTOs, errors, generation and send fence.
- `docs/m11-push-enrollment-config.md` — `GET /v1/me/push-capabilities`, VAPID secret file.
- `packages/contracts/m11.openapi.json`, `apps/api/src/modules/notifications/dto/notifications-docs.openapi.ts`
  and `notifications.openapi.ts` — schemas and patterns.
- `apps/api/src/modules/notifications/notification-contract.ts` — the request parsers.
- `apps/api/src/modules/notifications/notifications.controller.ts` — the mounted routes.
- `apps/api/src/common/http/safe-exception.filter.ts` — the `{"error":{"code":…}}` envelope.

No endpoint, field or status in this module is inferred. Anything the server rejects is also
rejected locally, so a bad value fails with a stated reason instead of a generic 400.

## Module map

| File | Responsibility |
| --- | --- |
| `contract.ts` | Routes, canonical generation/key/endpoint validation, unpadded base64url, strict response parsers, request body builders. |
| `transport.ts` | The `PushHttp` port, so the lifecycle can be tested without a network. |
| `http.ts` | The production transport: approved origin, cookie credentials with the current CSRF token, no redirects, no HTTP cache, bounded JSON read under a deadline, status-bound error-code allowlist. |
| `api.ts` | The five M11 calls with their exact statuses and response shapes. |
| `errors.ts` | `PushError` and the status/code classification, including 403 `FORBIDDEN` vs 403 `SOOP_LINK_REQUIRED` and 503 `AUTH_UNAVAILABLE`. |
| `scope.ts` | Account/session fence: aborts in-flight work and discards late completions. |
| `binding.ts` | Which server subscription this browser owns: id, generation, a one-way fingerprint of the exact subscription registered, opaque account/session. No endpoint, no subscription keys. |
| `browser.ts` | `PushBrowser` port and the production adapter over Service Worker, Push API and Notification permission. |
| `enrollment.ts` | The lifecycle: `refresh`, `enable`, `disable`, and the settings presentation model. |
| `wake.ts` | Wake payload validation, generation-fenced wake coalescing, the account binding registry and the generic visible notification for the service worker. |

## 1. Transport (owned here, no core file changes)

The module ships its own production transport, so nothing about the wiring has to be guessed
and nothing depends on a pending change to `src/core/api/client.ts`:

```ts
const http = pushHttp({ apiOrigin, csrf: () => session.csrfToken });
const api = new PushApi(http);
```

`pushHttp` sends to an approved API origin only (`https://api.qa.rogi.chat`,
`https://api.rogi.chat`) and only to the five enrollment paths, with `credentials: 'include'`,
`cache: 'no-store'`, `redirect: 'error'`, the current session's CSRF token read per request on
every mutation including `DELETE`, a JSON body on every mutation, a 15 s request deadline
composed with the caller's signal, and a bounded (8 KiB) streaming JSON read. The reported
status is always the response's own status — never inferred from the method — and an error
envelope is trusted only for the codes the contract defines for that status
(400 `INVALID_REQUEST`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`/`SOOP_LINK_REQUIRED`,
404 `NOT_FOUND`, 409 `CONFLICT`, 429 `RATE_LIMITED`, 503 `AUTH_UNAVAILABLE`/`UNAVAILABLE`).
Anything else is reported as no body, so an unexpected payload can never read as success.

`PushHttp` remains a port purely so the lifecycle tests can run without a network. A session
whose CSRF token is not the server's canonical 43-character base64url value is an
authentication state, reported as such without reaching the network.

## 2. Settings wiring (`src/features/settings`, core owner)

```ts
const scope = adoptScope(previous, { account, session });      // opaque, non-reversible values
const enrollment = new PushEnrollment({ api: new PushApi(http), browser: new WebPushBrowser(), storage: window.localStorage, scope });
```

- `session` is `await sessionBinding(session.csrfToken)` from `src/core/api/session-binding.ts`.
  `account` must be an equally opaque per-account value; do not pass a raw account id.
- Call `adoptScope` whenever the private session changes. The previous scope ends, its requests
  abort, and its late completions are discarded instead of applied to the new account.
- `enrollment.subscribe` / `enrollment.getState` are `useSyncExternalStore`-shaped.
- `enrollment.model()` returns exactly the `SettingsNotificationsModel` shape that
  `NotificationSection` consumes; assign it directly so any drift fails typecheck at the
  wiring site. `enrollment.test.ts` asserts that structural match.
- `refresh()` on mount, then `toggle()` straight from the click. `enable()` is the only path
  that calls `Notification.requestPermission`, and nothing in the module prompts on load,
  navigation or refresh. `toggle()` dispatches without awaiting and `enable()` starts the
  prompt before its first `await`, inside the click's transient activation, so do not wrap
  either in work of your own that awaits first. `enable()` also refuses to prompt until
  `refresh()` has confirmed the server capability, and the toggle stays blocked until then, so
  the prompt never appears for a capability the server has not confirmed.
- `refresh()` reads existing browser state through `getRegistration`, so opening settings never
  installs the service worker. `enable()` registers `/sw.js`, inside the user action.
- When `getState().needsDecision` is true a compare-and-set conflict happened. The module has
  already re-read the stored value; show it and let the user choose again. The desired value is
  never replayed.
- `NotificationSection` renders `enabled === null` as "알림을 제공하지 않습니다". The module
  reports `null` only while the account preference has not been read in this scope.
- `model().enabled` is true only while every condition a notification depends on holds: the
  preference the server keeps is on, this browser session still holds the exact subscription it
  registered, the browser still supports Web Push, the permission is still granted and the
  server still reports the capability. A permission revoked in browser settings, a rotated key,
  an endpoint the push service replaced, a dropped browser subscription, a record left by an
  earlier session or one that cannot prove which subscription it belongs to, and a server that
  lost its configuration all report false.
- Wire the click to `enrollment.toggle()`, never to `enable()` or `disable()` picked from
  `model().enabled`. When that value is false while the server still keeps a preference or this
  browser still keeps a record, the press means clean up rather than enrol, and choosing from
  the displayed value would route it to `enable()`, which refuses — leaving the user unable to
  release what the server still keeps. `enrollment.intent()` reports `'enable'`, `'disable'` or
  `null` for the same decision when the control needs a label.

## 3. Service worker (`public/sw.js`, core owner)

`public/sw.js` is served verbatim from the web origin and is not bundled, so it cannot import
this module. `wake.ts` is the source of truth for the logic; the worker must implement the same
rules, and a build step that generates `sw.js` from the module is the way to stop the two from
drifting. The worker must:

1. On `push`: treat the data as a wake only when it is exactly `{"type":"sync_required","version":1}`
   (`isWakePayload`). Anything else — extra fields, another type or version, unparseable data —
   is ignored. The payload carries no room, member or message id, no author, no text, no URL
   and no cursor, so nothing in it may be rendered.
2. Coalesce wakes (`WakeCoalescer`): while a sync runs, further wakes fold into a single pending
   flag and are covered by one further run of the same sync. A failed sync is passed to
   `event.waitUntil`, not swallowed, and leaves the worker able to accept the next wake.
3. Show a notification for every wake, because `userVisibleOnly` subscriptions owe the user
   something visible. Use `WAKE_NOTIFICATION`: it says only that there may be something to
   check. It must not claim a new message, name a sender or show content — the worker has none.
4. Bind worker state to the account with `WakeBindingRegistry`. The page posts the current
   `{account, session}` on login, account switch and logout; every bind produces a distinct
   binding, so logging out and back into the same account (A → B → A) does not make earlier
   work current again. A sync result is applied only while `isCurrent` holds for the binding
   that started it, and `WakeCoalescer.dispose()` abandons the running cycle on a switch so a
   late success or failure cannot disturb the new one. The worker keeps no Cache API storage:
   the app has no private caches today and this module introduces none, so an account switch
   invalidates in-memory work rather than evicting stored private data.
5. On `notificationclick`: focus an existing client or open the web origin. Authenticated sync
   happens in the page after open or resume; the worker never renders content of its own.

The sync the worker and the page run after a wake is owned by the command/sync work, not by
this module. Its integration point is a single callback — `coalescer.run(() => sync())` in the
worker and the same sync on `visibilitychange`/`focus` in the page — and it must reauthenticate
and reauthorize, because a wake is not proof that anything is readable.

Browser policy the product has to respect: permission is requested only from a user gesture;
a denied permission can be changed only in browser settings, so the UI states that instead of
re-prompting; iOS and iPadOS deliver Web Push only to a Home Screen web app, which the module
reports as `install-required` rather than claiming a Safari tab will work; and a browser may
expire or rotate a subscription at any time, after which the server answers 404/410 for the old
endpoint and the user has to enroll again.

## 4. Unit tests

`apps/web/package.json` `test:unit` now includes `src/features/push/*.test.ts`, so the module's
tests run in `.github/workflows/web.yml` with the rest of the web unit tests. That one-line
script addition is the only change this branch makes outside `src/features/push/**` and this
document. Locally:

```sh
node --import ./src/features/chat/testing/register-ts.mjs --test src/features/push/*.test.ts
```

## Lifecycle rules the module enforces

- **Order.** `enable()` reads capability, then the stored preference, then asks for permission,
  then registers the endpoint, and only then writes `pushEnabled: true`. The stored preference
  is never true while the server has no endpoint for this browser.
- **Compare-and-set.** Preference writes carry the generation from the latest read. A 409 re-reads
  the stored value and sets `needsDecision`; the desired value is not replayed.
- **Lost response.** Only a network failure on an initial registration is retried, once, with the
  byte-identical generation-free body, which the server answers with the existing id and
  generation without mutating it. An HTTP failure is never retried this way.
- **Rotation and rebinding.** A browser subscription created with a different application server
  key is replaced. A subscription this account owns from another session is re-registered with
  its current generation.
- **Cross-account endpoints.** 404 or a 409 for an endpoint whose generation this browser does
  not hold leads to an unsubscribe and one fresh endpoint. If the push service hands back the
  same endpoint, enrollment stays unavailable and says so; it never pretends to succeed.
- **Account switch.** A binding left by another account is dropped and its browser subscription
  withdrawn before this account can enroll. Ownership is never transferred.
- **Removal.** `disable()` writes `pushEnabled: false` first, then removes the subscription with
  generation CAS, then unsubscribes in the browser. Only the owning session may remove; a record
  belonging to another session or one the server has already moved past is reported as such
  rather than described as a clean removal.
- **Wake fence.** `WakeBindingRegistry` gives every binding a monotonic generation, so an
  A → B → A account sequence never admits work from the first A, and `WakeCoalescer` fences each
  cycle so a late completion from an abandoned one cannot change a running sync.
- **Truthful eligibility.** A local record proves only that there is state to clear. It counts
  as an enrollment solely for the session that registered it, and only while the subscription
  the browser holds now is the one that registration was made for. The record keeps a SHA-256
  fingerprint over the endpoint, both subscription keys and the application server key
  together, so an endpoint the push service replaced under the same key, a rotated key and a
  record with no fingerprint all fail to match; a browser that names its subscription's key
  must additionally name the server's current one. None of the covered values can be read back
  out of the fingerprint, so no endpoint or subscription key is ever stored.
- **Explicit action.** `intent()` and `toggle()` carry what the press does, so a browser that
  reports not enrolled while server state remains cleans up instead of trying to enrol.
- **Gesture.** The permission prompt is the first thing `enable()` does, before any `await`,
  and only for a capability `refresh()` already confirmed. The capability is then re-read for
  the current key before anything is registered.
- **Fence.** Every step runs under `PushScope`. An account or session change aborts the requests
  in flight and discards their completions, so no state, binding or notice from a previous
  account is applied to the new one.
- **Credentials.** The endpoint and the p256dh/auth keys exist only in memory and in the request
  body. They are never stored, logged, put in a notice or written to a test artifact. Local
  storage holds `v1:<account>:<session>:<subscription id>:<generation>` and nothing else.
- **Honest states.** Every failure keeps the real state and a reason: 401, 403 `FORBIDDEN`,
  403 `SOOP_LINK_REQUIRED`, 404, 409, 503 `AUTH_UNAVAILABLE`, network failures and unexpected
  response shapes are distinct outcomes, and none of them produces an enabled-looking toggle.

## Not implemented here, and not claimed

- **Delivery.** M11 runtime VAPID is not commissioned, so `GET /v1/me/push-capabilities` answers
  `{"available":false}` and enrollment correctly reports the server as not ready. No real
  registration, push delivery, device notification or return-to-sync has been exercised. Server
  availability is enrollment capability, not delivery, and a worker ACK is not proof of receipt.
- **Product wiring.** The settings screen still passes a static unavailable notification model
  and `public/sw.js` still has no `push` handler. Until those core-owned changes land, this
  module is unreachable from the product and FW07 is not complete. The transport is not
  pending: it ships here.
- **The sync itself.** What the page and the worker do after a wake belongs to the command/sync
  work; this module defines only the wake contract and the callback seam.
- **Browser matrix.** No Android Chrome, desktop or iOS Home Screen verification was run, and no
  Next.js production build or Playwright run was executed in this worktree.

## Verification performed

Node 24.21.0, TypeScript 5.9.3 (the repository pin), from `apps/web`:

- `node --import ./src/features/chat/testing/register-ts.mjs --test src/features/push/*.test.ts`
  — 85 tests, 85 pass, 0 fail.
- `tsc --noEmit` over `src/features/push/**` with the repository's strict options
  (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`) — clean.
- ESLint 10.11.0 with the repository's type-aware rule set over the module's 18 files — 0 errors,
  0 warnings. The lint setup was itself checked against a deliberate probe file: it reported the
  floating `node:test` registration, the floating promise and the `console` statement before the
  probe was deleted.
- `python3 tools/security/check.py all` before commit and the repository hooks on commit and push.

The full workspace typecheck, lint, production build and browser suite run in hosted CI on the
pull request; this worktree has no `node_modules` and none were installed for this change.
