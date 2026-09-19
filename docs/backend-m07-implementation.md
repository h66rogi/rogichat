# M07 durable text publication and reactions

M07 adds a real worker consumer, room command budgets, anonymous text publication and
one-emoji-per-member reactions. It does not enable unimplemented media or purge handlers.

## HTTP and client contract

All commands require the current verified session, exact Origin and CSRF proof. Reads also
re-evaluate current membership, participation period, grant and source deletion state.

| Route | Contract |
|---|---|
| `POST /v1/rooms/:roomId/messages/:messageId/publications` | Empty object; 202 with publicationId and preparing/published/revoked status |
| `GET /v1/rooms/:roomId/publications/:publicationId` | Current publishing room owner only; messageId only when published |
| `GET /v1/rooms/:roomId/messages/:messageId/reactions` | Sorted emoji counts and viewer's own emoji or null; no reactor identities |
| `PUT /v1/rooms/:roomId/messages/:messageId/reactions/me` | One complete Unicode emoji; another replaces it; null removes it |
| `DELETE /v1/rooms/:roomId/messages/:messageId/reactions/me` | Idempotent removal; empty or absent body |

Unknown fields and cross-room identifiers are rejected. CORS explicitly allows PUT, including
credentialed browser preflight. Reaction mutations advance the message resource version and
append a durable MESSAGE_UPDATED event. Sync upserts trigger an authorized reaction GET rather
than embedding other users' reaction information in message DTOs. The executable reference is
`packages/contracts/interactions-client.mjs`; this is not a shipped gesture/UI implementation.
Right-to-left swipe opens a PRIVATE draft, never sends it. A failed target preserves that draft
and cannot silently switch to shared delivery.

## Publication and deletion

Only the current streamer room owner can publish a private original, independently of ordinary
read-grant/history visibility. No fan consent flag is introduced. The worker rechecks owner,
account, room, original and content revision when finalizing. Deletion, moderation or loss of
authority revokes the request. The copy has a new message UUID, anonymous projection, separate
reaction set and the original content owner/deletion root. No source or fan identifier appears
in the public DTO. A separate content_revision makes reaction-only version changes irrelevant
to publication idempotence. One source revision has one publication request.

Deleting the original immediately clears linked public text and blocks copies/quotes/reactions;
it also revokes preparing or published publication records. Existing sync source invalidation
removes derived client content without disclosing the private source ID. Physical reaction/job
purge and backup reconciliation are M10 work; access denial is not reported as physical erasure.

## Worker and multi-process invariants

The worker claims only registered purposes; currently PUBLICATION. Unimplemented MEDIA, PURGE,
PUSH and LEDGER_EXPORT jobs remain pending without consuming attempts. The API alone consumes
REALTIME_HINT. Claims are short transactions, one job at a time, with bounded polling and no
overlapping ticks. Domain mutation, event/hint and conditional lease completion commit together.
An expired or stolen lease rolls back all domain effects. Safe bounded retry codes contain no
message text or credentials. Shutdown stops new claims and waits for an active handler within
the existing process deadline. Actual SIGKILL/restart is covered by a MySQL-backed test.

Rate policies are DB-backed and apply across processes, with a fixed account bucket before
per-room keys. Random missing room IDs cannot create unlimited bucket cardinality. Send,
reaction and publication respectively allow account/minute 60/120/30, room/minute 30/60/20 and
room/second 5/10/5. Charges commit separately, so denied commands do not refund the budget.
Retries may encounter 429 and must back off while preserving the original idempotency key.
Expired-rate GC is bounded and cannot delete still-live buckets. These are initial protective
defaults, not evidence that a 1,000-connection workload has passed.

Reaction uniqueness is scoped to room/message/member. Binary emoji grouping preserves skin
tones and presentation variants despite the database's default text collation. Deleted/deleting
accounts are excluded from counts. Reaction and deletion races serialize through current
resource locks. Mixed owner/source-account lock contention remains a dedicated M12 load scenario;
bounded deadlock retries already protect atomicity.

## Verification and release boundaries

Local checks pass: 69 unit, 56 real-MySQL integration, 14 HTTP/process and 2 contract tests,
plus lint and type checking. Integration cases cover stale lease rollback, source-delete versus
publication/reaction races, two-pool shared rate budgets, worker restart, current private ACL,
anonymous copy counts, browser preflight, CSRF and strict response projections.

Sub-agent review found the missing PUT preflight allowlist; the implementation and an actual
HTTP regression were added. The rate fixture expires only its synthetic burst bucket between
independent phases; production limits were not weakened. Media, external login, actual QA R2,
real-device behavior and restore drills retain their own release gates. Passing these tests is
not a claim that those later stages or the live QA deployment are complete.
