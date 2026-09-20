# Production web implementation

2026-09-20. Base `092c76b`; task branch `dokdo2013/web-production-service`; application source commit `6b2bbba`.
This report supersedes the historical FW01 preview description. QA and production run the same application with real API requests and different explicitly validated runtime configuration.

## Implemented source

- Removed `src/preview`, all preview pages, synthetic role/settings/chat harnesses and their route tests. Retained the existing channel shell, home layout, shared UI, and presentation components with their reuse attribution.
- Added runtime API configuration and minimal `/healthz`. Only exact QA/production origin pairs are valid. The optional default room UUID is a deployment binding, never a room-list heuristic; absent/empty means unopened.
- Added a typed browser API client: direct API origin, credentialed cookies, no cache, no followed API redirects, 15-second timeout, CSRF on mutations, safe HTTP errors, response validation for session/profile, and SOOP login/link start.
- Connected home account status, login, callback failure handling, completion session verification, chat entry/membership, profile PATCH, explicit room join/leave, and logout to real backend responses. No response is replaced by a success fixture.
- Private views unmount on pagehide/hidden state and reauthorize on restore, foreground focus, online recovery, storage events, or cross-tab invalidation. Profile reads are bracketed by session checks so a changed cookie cannot publish another session's profile under an older authorization.
- Logout locks before sending. Local storage holds only a SHA-256 digest of the session-bound CSRF HMAC plus attempt nonce, never the credential. Recovery revokes only the matching session. Compare-and-clear prevents an older completion from clearing a newer intent; a changed session requires explicit confirmation without revocation.
- Chat implementation is owned by the parallel chat worker: real manifest/profile/snapshot/events/history/recipient/send adapters, stable retry IDs, authorization cleanup and websocket hints. Browser tests use the actual production routes with isolated intercepted server responses.

## Contract and deployment boundaries

The application reads committed Nest controllers/services/DTOs and never edits the backend. Session read returns `authenticated`, `soopLinkStatus`, and `csrfToken`; it does not provide a user ID. Self profile provides account identity after a verified SOOP session. Mutations require the server-issued CSRF token and browser Origin. The API keeps host-only HttpOnly cookies; no Next proxy, cookie-domain widening, broker secret or credential is introduced.

`/v1/realtime` is the Engine.IO path, websocket only, default Socket.IO namespace. Explicit private-recipient discovery is defined in backend commit `ac69ca2`; rollout remains a deployment prerequisite, and visible profiles or message authors are not grants. Backend default-room provisioning and runtime IDs remain private operational configuration, owned by the coordinator/infrastructure workstream.

Existing server persistence is the source of truth after reload. Private query caches and drafts are memory-only. This change does not claim durable browser outbox recovery across process termination, full media support, web push subscription, account deletion or moderation completion. Those settings remain truthfully unavailable. Real provider login, real user chat and final deployment require separate operational evidence; isolated tests do not establish those outcomes.

## Validation evidence

- Final integrated source: application commits `6b2bbba` / `08c46bc`, native follow-up `adcc786`, the notification-state correction in this change, and the pipeline-owned Next/header configuration. The external build snapshot matched 96 source, test, public and configuration files byte-for-byte with the workspace.
- Node 24.21.0 production build `zhIkiKG8Wa3o8uO4GI3fH` passed. Full TypeScript, web ESLint, 45 unit/contract tests and production artifact isolation passed.
- One final full desktop/mobile browser run: **90 passed, 2 platform-specific skips, 24.9 seconds**. This includes real-response auth/profile/room flows, logout/session races, notification unavailability, chat send/delete/multiple recipients, native callback privacy and QA association JSON. All tested axe serious/critical checks passed.
- The same production artifact passed both QA and production runtime probes: health, exact API origin, untrusted Host isolation, no preview/API proxy, safe relative auth redirect, fixed callback no-store/no-referrer/CSP and non-reflection, QA-only association identities and empty production associations. The owned temporary runtime servers were stopped after verification.
- The first production browser run exposed native fetch receiver binding; the lexical transport wrapper has a unit regression and real Chromium verification. The session-race regression observes DOM mutations throughout changing sessions, asserts private settings never mount, then requires stable-session recovery.
- Checksum-verified scanner installation, configured hooks and `python3 tools/security/check.py all` passed. Source commit hooks also passed. PR #20's Linux application check passed at remote checkpoint `cf026efc`; the container all-layer content scan failed at that historical checkpoint. That publication blocker was subsequently resolved as recorded below; it is not a current unresolved failure.

## Side effects and remaining gates

Runtime API/default-room configuration changes require the matching deployment configuration; the pipeline owner owns Docker/Next/CI/scripts. No backend schema, host/DNS/Caddy, reference repository, credential, or other-worker source was modified by this worker. Removed session-gate symbols were searched across neighboring worktrees: matches are historical copies of this repository, with no external package consumer found. Public origin names are intentional public configuration; real deployment room identifiers are excluded.

Publishing uses a normal task-branch PR into latest QA, required checks, and reviewed merge. Production promotion to main remains separate. A local source/build result is not a claim of remote deployment.

## Native callback follow-up

The same workstream adds QA-only Apple/Android associations and a fixed private callback fallback, with production identities deliberately empty. See [the native association report](frontend-web-native-association.md) for verified identity provenance, official schema references, no-query-consumption behavior and remaining real-device/deployment gates.

## Remote deletion privacy correction

Independent review found that an incoming `message.deleted` event removed the timeline item but left its author/excerpt in unsent per-target quotes. The coordinator transferred this bounded chat correction to the web worker after the original chat worker completed. Remote deletion now uses the existing full privacy epoch reset: cached messages, visible and hidden drafts, quotes and target selection are discarded before a fresh authorized snapshot. This deliberately clears unrelated unsent drafts too, matching local deletion, because derived anonymous copies cannot be reliably traced in the client. The same-session uncertain-command ID map remains intact; deleted-source quotes still fail normal source authorization rather than being silently submitted as a different command.

The corrected production build `arvEOuqYfagopMu8Wp7Ty` passed compilation and TypeScript, web ESLint passed, and all **46 unit/contract tests** passed. A focused production-browser rerun passed **16/16 desktop/mobile chat cases in 7.6 seconds**, including incoming deletion with both visible and hidden quoted drafts, all-target draft removal, identical uncertain-command retry IDs, normal/error/empty/unauthorized chat, keyboard behavior and axe checks. The preceding full 90-pass browser run and QA/production runtime evidence above remain the broader baseline; this follow-up reran checks relevant to the changed chat controller. Independent re-review and remote CI remain coordinator-owned integration gates.

## Final publication evidence — 2026-09-20

[PR #20](https://github.com/h66rogi/rogichat/pull/20) merged to QA commit
`90a73e1a490c4ae6b3056cbc07e67e253da7c75b`. All five post-merge checks completed
successfully at attempt 1: [web 35491740175](https://github.com/h66rogi/rogichat/actions/runs/35491740175),
[backend 35491740143](https://github.com/h66rogi/rogichat/actions/runs/35491740143),
[security 35491740079](https://github.com/h66rogi/rogichat/actions/runs/35491740079),
[infrastructure 35491740066](https://github.com/h66rogi/rogichat/actions/runs/35491740066),
and [mobile 35491740065](https://github.com/h66rogi/rogichat/actions/runs/35491740065).
[Web publisher 35491740135](https://github.com/h66rogi/rogichat/actions/runs/35491740135)
and [manual export 35492296924](https://github.com/h66rogi/rogichat/actions/runs/35492296924)
also completed successfully at attempt 1.

The original publication proof artifact `10599164094`, verified against GitHub
SHA-256 `ca69a9b2412e66ce77285d6e6039eecf73080fd6acca3271ee246bb19f7cf127`,
binds those five exact CI attempts and source to
`ghcr.io/h66rogi/rogichat-web@sha256:08d8affd8da7eb54b45d7179783c0d8a1a687d44cac5b4c68df62dfb88c1463a`.
The earlier container scan failure was resolved with a keyless image,
per-runtime ephemeral keys and a reviewed narrow scanner exception; scanner
execution and all-layer checks remain required.

This establishes publication and manual export, not host activation or automatic
export completion. Actual QA web activation remains pending the infrastructure
owner's running-artifact, health and route evidence. Production promotion remains
a separate reviewed change.
