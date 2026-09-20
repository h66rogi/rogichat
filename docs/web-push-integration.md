# Web Push enrollment module integration

`apps/web/src/features/push/**` implements Web Push enrollment and its lifecycle for the web
app: server capability, the account preference, browser subscription registration and removal,
the account/session fence and the wake-payload logic the service worker needs.

This document is the wiring contract. The module ships its own transport, the settings hook,
the page wake bridge and the service worker; outside `src/features/push/**` it changes the
notification section and its model, the `test:unit` glob in `apps/web/package.json`,
`public/sw.js` and the browser expectations those change. The one remaining step is mounting
the hook in `src/features/settings/real-settings.tsx`, which its owner does as described below;
until then the product still shows the static unavailable notification model.

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
| `wake-bridge.ts` | The page side of a wake: binds the worker to this account, syncs on wake, open and resume, and refuses a wake for another account or session. |
| `use-push-settings.ts` | The React hook the settings screen mounts: builds the transport, browser adapter, storage and scope, and exposes the model, the press and the notice. |

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

## 2. Settings wiring (`src/features/settings/real-settings.tsx`, core owner)

The hook does the building; the mount is three lines and changes nothing else:

```tsx
const push = usePushSettings(session, profile.id);
// ...
notifications: push.model,                       // replaces the static unavailable model
<SettingsView ... onToggleNotifications={push.toggle} />
```

- `usePushSettings` reads the API origin from `useApi()`, derives the opaque account and session
  identities with `sessionBinding`, guards `localStorage`, creates the scope through
  `adoptScope` and refreshes on mount. No raw account id, CSRF token or credential is stored,
  and the CSRF token is read per request from the latest render.
- `push.toggle` is what `onToggleNotifications` receives, and it **ignores the boolean the
  control offers**. When the state is not enrolled while the server still keeps a preference or
  this browser still keeps a record, the press releases that registration instead of enrolling;
  deriving the action from the displayed value would route it to `enable()`, which refuses, and
  the user could never release what the server keeps. `push.model.action` carries the same
  decision so the section can name the press.
- `push.toggle` dispatches without awaiting, and `enable()` starts the permission prompt before
  its first `await`, so the prompt stays inside the click's transient activation. Do not wrap
  either in work of your own that awaits first.
- `enable()` refuses to prompt until `refresh()` has confirmed the server capability, and the
  control stays blocked until then, so the prompt never appears for a capability the server has
  not confirmed. `refresh()` reads existing browser state through `getRegistration`, so opening
  settings never installs the service worker; `enable()` registers `/sw.js` inside the action.
- `push.needsDecision` is true after a compare-and-set conflict: the module has re-read the
  stored value, so show it and let the user choose again. The desired value is never replayed.
- `push.refresh` re-reads state after an error; `NotificationSection` takes it as `onRetry`.
- `model.enabled` is true only while every condition a notification depends on holds: the
  preference the server keeps is on, this browser session still holds the exact subscription it
  registered, the browser still supports Web Push, the permission is still granted and the
  server still reports the capability. A permission revoked in browser settings, a rotated key,
  an endpoint the push service replaced, a dropped browser subscription, a record left by an
  earlier session or one that cannot prove which subscription it belongs to, an unusable
  browser storage and a server that lost its configuration all report false.
- `SettingsView.tsx` needs no change: it already forwards `onToggleNotifications`.
- `SettingsNotificationsModel` gained only optional fields (`action`, `busy`, `notice`), so an
  existing caller keeps compiling. `NotificationSection` uses them to show the real result, an
  in-flight change and a retry, and to present a cleanup press as an explicit release rather
  than an off-to-on switch. `enabled === null` now means the state has not been read yet, not
  that notifications are unsupported.

## 2b. Page wake bridge

```ts
const stop = startWakeBridge({ binding, sync, worker: navigator.serviceWorker, resume: window, visible: () => document.visibilityState === 'visible' });
```

`binding` is `{account, session, generation}` from `WakeBindingRegistry`, `sync` is the app's
authenticated sync. The bridge posts the binding to the worker, syncs when the worker reports a
wake for this binding, syncs on open, `visibilitychange` and `focus`, collapses a burst into one
run, ignores a wake for another account, session or generation, and on stop unbinds the worker
and abandons the running cycle. A wake delivered while no page was running is covered by the
sync on open, which is what browser policy allows.

## 3. Service worker (`public/sw.js`)

`public/sw.js` now implements the wake handlers. It is served verbatim and cannot import the
module, so it mirrors `wake.ts`, and `src/features/push/service-worker.test.ts` runs the shipped
file itself against stub globals and checks the same rules. Keep the two in step; a build step
that generates the worker from the module would remove that duty entirely.

What it does, and nothing else:

1. `push`: treats the data as a wake only when it is exactly `{"type":"sync_required","version":1}`.
   Extra fields, another type or version and unparseable data are ignored. The payload carries
   no room, member or message id, no author, no text, no URL and no cursor, so nothing in it is
   rendered.
2. Shows the generic notification for every wake, because a `userVisibleOnly` subscription owes
   the user something visible; the shared tag collapses a burst into one. It says only that
   there may be something to check and never claims a message, a sender or content.
3. Coalesces the sync work: while one run is in flight, further wakes are covered by one more.
4. Tells the open pages of the bound account to sync, through `WAKE_SYNC`. The worker itself
   fetches no private data, keeps no Cache API storage and reads no cookie, token or account
   identifier; the binding is memory only and arrives from the page as `WAKE_BIND`, with
   `WAKE_UNBIND` on logout.
5. `notificationclick`: focuses an existing page of this origin, or opens this origin's root.
   The target is fixed; no URL is ever taken from a payload.

Browser policy the product has to respect: permission is requested only from a user gesture; a
denied permission can be changed only in browser settings, so the UI states that instead of
re-prompting; iOS and iPadOS deliver Web Push only to a Home Screen web app, which the module
reports as `install-required` rather than claiming a Safari tab will work; and a browser may
expire or rotate a subscription at any time, after which the server answers 404/410 for the old
endpoint and the user has to enroll again.

## 4. Unit tests

`apps/web/package.json` `test:unit` includes `src/features/push/*.test.ts`, so these run in
`.github/workflows/web.yml` with the rest of the web unit tests. `service-worker.test.ts` runs
the shipped `public/sw.js` itself, so the worker is covered by the same suite. Locally:

```sh
node --import ./src/features/chat/testing/register-ts.mjs --test src/features/push/*.test.ts
```

## Lifecycle rules the module enforces

- **Order.** `enable()` checks support and the capability already confirmed by `refresh()`,
  asks for permission before any await, re-reads the capability for its current key, reads the
  stored preference, registers the endpoint, and only then writes `pushEnabled: true`. The
  preference the server keeps is never true while it has no endpoint for this browser.
- **Storage.** An unusable `localStorage` — a private window, blocked site data, a full quota —
  is reported as its own state. Without the record this browser could not prove what it
  registered or release it later, so enrollment stops instead of appearing to work.
- **Compare-and-set.** Preference writes carry the generation from the latest read. A 409 re-reads
  the stored value and sets `needsDecision`; the desired value is not replayed.
- **Lost response.** Only a network failure on an initial registration is retried, once, with the
  byte-identical generation-free body, which the server answers with the existing id and
  generation without mutating it. An HTTP failure is never retried this way.
- **Reuse evidence.** An existing browser subscription is registered as-is only when it is
  known to belong to the server's current application server key: the browser names that key,
  or the record written at its registration fingerprints exactly this subscription under it.
  Anything else is withdrawn and replaced by a fresh subscription created with the current key,
  so a subscription of unknown origin is never labelled with a key it may not have.
- **Rebinding.** A record's generation belongs to the endpoint it was written for, so it is
  sent only when that exact endpoint is being rebound to a new session of the same account. A
  newly created endpoint registers without a generation.
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
- **Product wiring.** The settings screen still passes a static unavailable notification model,
  so the hook is not mounted yet and the product still shows that. Until that one mount lands,
  the lifecycle is unreachable from the product and FW07 is not complete. The transport, the
  hook, the bridge, the worker and the section are not pending: they ship here.
- **The sync itself.** What a page reads after a wake belongs to the command/sync work; this
  module decides when that sync runs and refuses wakes from another account, session or
  generation, but the sync is the app's own authenticated call.
- **Browser matrix.** No Android Chrome, desktop or iOS Home Screen verification was run, and no
  Next.js production build or Playwright run was executed in this worktree.

## Verification performed

Node 24.21.0, TypeScript 5.9.3 (the repository pin), from `apps/web`:

- `node --import ./src/features/chat/testing/register-ts.mjs --test src/features/push/*.test.ts`
  — 109 tests, 109 pass, 0 fail.
- `tsc --noEmit` over `src/features/push/**` with the repository's strict options
  (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`) — clean.
- ESLint 10.11.0 with the repository's type-aware rule set over the module's 18 files — 0 errors,
  0 warnings. The lint setup was itself checked against a deliberate probe file: it reported the
  floating `node:test` registration, the floating promise and the `console` statement before the
  probe was deleted.
- `python3 tools/security/check.py all` before commit and the repository hooks on commit and push.

The full workspace typecheck, lint, production build and browser suite run in hosted CI on the
pull request; this worktree has no `node_modules` and none were installed for this change.
