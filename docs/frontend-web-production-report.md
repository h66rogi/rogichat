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

`/v1/realtime` is the Engine.IO path, websocket only, default Socket.IO namespace. Explicit private-recipient discovery is a backend prerequisite; visible profiles or message authors are not grants. Backend default-room provisioning and runtime IDs remain private operational configuration, owned by the coordinator/infrastructure workstream.

Existing server persistence is the source of truth after reload. Private query caches and drafts are memory-only. This change does not claim durable browser outbox recovery across process termination, full media support, web push subscription, account deletion or moderation completion. Those settings remain truthfully unavailable. Real provider login, real user chat and final deployment require separate operational evidence; isolated tests do not establish those outcomes.

## Validation evidence

- Source TypeScript check and full web ESLint passed after runtime, auth, settings and room integration.
- Combined contract/unit tests passed: 36 tests in the integrated pipeline snapshot, including API/CSRF/error/timeout boundaries, session shape validation, logout binding/races, runtime origin/default-room validation, and chat worker regressions.
- The pipeline owner confirmed the latest production build, artifact isolation and three negative runtime health cases (missing API origin, mismatched origin, invalid room UUID) pass. Browser verification covers 84 cases: 80 passed with 2 platform skips in the full run, then both corrected session-race cases passed against the unchanged production build (desktop 648 ms, mobile 644 ms). Thus 82 cases pass and 2 platform-specific cases skip across those bounded runs. Axe serious/critical checks pass on the tested production routes. The race regression observes all DOM mutations during repeated session changes, asserts private settings never mount, then requires successful recovery after session stabilization.
- The initial browser run exposed native fetch receiver binding; the API transport now uses a lexical wrapper, with a unit regression and successful real Chromium profile/CSRF test. Synthetic server data exists only in isolated test sources and does not establish real SOOP-provider or deployed-account verification.
- Security scanner installed with checksum verification and hooks configured; `python3 tools/security/check.py all` passed. Remote CI evidence remains required before merge.

## Side effects and remaining gates

Runtime API/default-room configuration changes require the matching deployment configuration; the pipeline owner owns Docker/Next/CI/scripts. No backend schema, host/DNS/Caddy, reference repository, credential, or other-worker source was modified by this worker. Removed session-gate symbols were searched across neighboring worktrees: matches are historical copies of this repository, with no external package consumer found. Public origin names are intentional public configuration; real deployment room identifiers are excluded.

Publishing uses a normal task-branch PR into latest QA, required checks, and reviewed merge. Production promotion to main remains separate. A local source/build result is not a claim of remote deployment.
