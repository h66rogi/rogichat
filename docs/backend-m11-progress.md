# M11 implementation and acceptance gates

M11 starts from `de02c6aa73d549edc56e38d726f0f85bc928c27b`. This record separates
implementation evidence from integration and live acceptance. No QA merge,
provider activation, provisioning or deployment is authorized by this work.

## Dependency checklist

| Gate | Dependencies | Status and required evidence |
| --- | --- | --- |
| Contract | Existing session, membership, message visibility and job services | Frozen in backend-m11-contract.md and composed packages/contracts/m11.openapi.json |
| Schema | One schema owner; unchanged historical migrations | Generated/applied 20260920061207_m11_notifications_read_state in disposable MySQL 8.0.44; checksum manifest updated |
| Own read state | Schema; current authorized message and membership period | Implemented with signed session/period context; 4 focused unit tests passed; never derives from sync cursor |
| Preferences and subscriptions | Schema; current session binding and environment | Implemented with preference/subscription CAS and safe retry rules; 6 focused unit tests passed; default push disabled |
| Wake transport | Schema; current account/session/access/preferences | Implemented encrypted wake-only Web Push; 4 transport unit tests passed; missing provider is unavailable |
| Composition | Frozen feature modules and transport settings | API/worker/runtime imports, body-free producer, bounded fanout and consumer handlers implemented |
| Security and race review | Concrete implementation | Independent security source review passed after SOOP, deletion, room and lease lock-wait fixes; runtime evidence pending |
| Consumer review | Exact endpoint/DTO/error contract | Independent review drove CAS/retry and exact OpenAPI/error parity; consumer implementation remains external |
| Focused validation | Integrated implementation | Compile/lint, 14 feature unit tests and 23 contract/module/HTTP baseline tests passed; final compile/lint after review fixes passed |
| Hosted CI | Draft QA PR at frozen SHA | Publishing draft QA PR; full backend, MySQL persistence/races and security checks pending |
| M10 integration | Exported deletion ports and M10 account purge implementation | External acceptance gate; does not block independent feature code |
| Live product | Reviewed integration release, provider configuration, clients | External gate; real browser/device foreground/background sync and revocation evidence required |

## Frozen storage direction

- `own_read_states`: per member and stream, associated with the active membership
  period; advancing one restricted stream must not mark another stream read.
- `notification_preferences`: account preference and generation, disabled by default.
- `push_subscriptions`: account/session/audience binding, endpoint digest and
  subscription/account generations; credential fields never enter responses or logs.
- `push_deliveries`: subscription/message references and generation fences;
  `PUSH` jobs reference the delivery UUID and contain no content or endpoint.
- Push payload contains only `{ "type": "sync_required", "version": 1 }`.

The schema owner maintains the exact schema and contract. Cross-feature deletion
uses exported transaction-scoped service ports, never another module's repository.
Deletion must remove referencing delivery jobs and deliveries before subscriptions,
subscriptions before sessions, and own read state before membership periods.

## Required test evidence

- Persisted monotonic own-read advancement validates an actually readable message;
  stale periods, inaccessible streams and another user's state are rejected.
- Concurrent advances, logout, account deletion, membership removal and preference
  changes cannot use a stale snapshot to authorize new state or a dispatch.
- Account switching cannot transfer an old session's subscription or revive an old
  delivery; endpoint replacement and 404/410 cleanup respect generation fences.
- HTTPS destination policy rejects redirects, private/reserved IPs and DNS rebinding;
  transport timeouts and provider failures cannot report fake delivery success.
- QA and production credentials and audiences remain separate; unconfigured
  providers are explicitly unavailable.
- Retries and duplicate notifications trigger idempotent authorized sync. Queue ACK
  means processing, not device delivery or a message becoming read.

Network I/O stays outside database transactions. The final authorization check is
the dispatch admission boundary; already in-flight provider delivery cannot be
recalled by a later revocation. No private content is carried even in that case.

## Verification and publication

The existing Backend foundation PR workflow runs disposable MySQL 8.0 integration
tests discovered from `apps/api/test/integration`, contract checks and credential-free
image security checks. Use that hosted gate for full verification. Required scanner
installation and Git hooks are configured in the integration checkout. Test results,
final commit SHA, PR URL and review outcomes will be recorded when available.

## Implementation evidence and external obligations

- Four tables plus a composite session ownership index; migration SHA-256
  `759241f53ea3c007439d7498142b0ec285ced3e83642c26d7d9c2cd39fd6d372`.
- Local migration evidence: `node test/run-mysql.mjs --migration-only
  --migration-name=m11_notifications_read_state` created and applied the migration
  with Prisma 7.10 against MySQL 8.0.44 and reported the database in sync. The
  harness cleaned its private temporary datadir/user/database. macOS required a
  temporary shell launcher for pnpm and PTY confirmation of the additive unique
  index; no repository deployment helper was changed.
- Backend effects: AppModule mounts own-state APIs; worker mounts PUSH fanout and
  delivery; message creation enqueues only a UUID reference. Message updates and
  deletions do not enqueue new notifications. Every fanout transaction handles
  one recipient, pages hold at most 50 IDs, and retries skip durable prior intents.
- Independent reviews identified and corrected stale-period read requests,
  preference stale-write replay, lost registration/delete responses, cross-account
  endpoint takeover ambiguity, missing SOOP validation, content-owner deletion
  inventory and lease expiry while waiting for admission/completion locks.
- Published OpenAPI is reproducible with
  `node packages/contracts/generate-m11-openapi.mjs` after building the API; its
  contract test prevents fragment/artifact drift.
- Client symbol scan found no existing M11 calls in the checked-out web/iOS/Android
  source. This additive backend change does not itself implement their transports,
  browser service worker, durable wake handling or native FCM/APNs adapters.
- M10 must call the exported cleanup ports before removing messages, sessions or
  membership periods. Message-only and account/content-root deletion need both
  null-room fanout job and room-bound delivery job cleanup. This acceptance gate
  is open until M10 integration and restore/replay evidence are verified.
- The provider's already in-flight request cannot be recalled. Final admission
  rejects prior revocations; a later wake still contains no private identifiers or
  body. Clients must reauthenticate and sync, and clear stale account/period state.

No QA/production database, provider, host or cloud configuration was changed.
No branch merge, release image or live product readiness is claimed here.
