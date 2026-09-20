# M10 deletion write-ahead foundation

Status: isolated implementation only, not registered by API/worker and not deployed.
No existing deletion endpoint, schema, cloud resource or credential is changed.
This does **not** complete M10 or establish a 24-hour purge/30-day backup guarantee.

`DeletionLedgerModule` owns a real R2 adapter and its Nest shutdown lifecycle.
It exports only the internal `DeletionLedger` port, not the storage client.
There is no runtime in-memory store, alternate success path or public ledger URL.
The synthetic store exists only in isolated tests.

## Immutable intent contract

The canonical v1 record contains only environment, request UUID, authorized actor
UUID, target UUID, MESSAGE/ACCOUNT scope, optional room UUID and initial UTC time.
An ACCOUNT target must equal its actor; MESSAGE ownership is the future caller's
authorization responsibility. No message/profile/provider identity, credentials,
object keys or signed URLs belong in the record. Parsing rejects extra fields,
invalid UTF-8, duplicate JSON keys, noncanonical dates/bytes and records over 1 KiB.

The private key is `<environment>/<request UUID>/intent.json`. Creation uses
`If-None-Match: *`, followed by an exact, bounded read-back. Neither a successful
PUT acknowledgement alone nor a failed/ambiguous write establishes durability.
On write-ACK loss, read-back may establish the same immutable intent. A missing,
inaccessible, malformed or mismatched record fails closed. Only confirmed
`NoSuchKey`/404 means absent; access denied does not mean absent.

Concurrent/retried requests converge on the first durable record. The original
UTC time is returned unchanged; retrying cannot restart a deletion deadline.
The same request UUID cannot be reused for a different actor, target, room or scope.
The receipt includes a SHA-256 for later private checkpoint comparison; neither
receipt nor intent is a public DTO. Intent persistence is not live deletion or
backup expiry, and this module has no method claiming those states.

All external I/O belongs outside the database transaction. The future use case
must authorize the immutable target, capture trusted server/DB UTC and a stable
request UUID, then persist intent before committing access blocking and its job.
It must reconcile accepted external intents even after a DB write/ACK failure;
it cannot discard the intent because a later session check fails. The ledger port
itself does not authorize a user or accept caller-supplied timestamps over HTTP.

## Deployment gates still required

- A separately reviewed private ledger bucket and credential, distinct from media,
  with no public endpoint/CORS exposure. The adapter rejects the configured media
  bucket and fixes HTTPS R2 origin/region, environment and object grammar.
- Verify environment/account binding, independent credential scope, encryption and
  retention/immutability in actual infrastructure. A different bucket name is not
  proof of different credentials; absence of a DELETE method is not IAM enforcement.
  App credentials must not be able to erase the only restore ledger copy. Configure
  and test provider retention controls or an independent operational copy before
  activation; no lifecycle rule may expire pending obligations.
- File-only secret loading with owner/mode/link checks and explicit production
  composition. No credential reader, mount or automatic activation is added here.
- DB checkpoints, account/message authorization, blocking and purge workers;
  intent reconciliation, bounded inventory and restore replay. Actual object absence,
  late-write fences, backup inventory/expiry and external alerts remain separate gates.
- Real R2 conditional-write, cancellation, permissions and durability tests. Current
  tests inspect real SDK commands with isolated transport substitution; they are not
  cloud evidence and do not establish provider failure guarantees.

The operation has a ten-second abort budget; adapter connection/read deadlines are
shorter, retries/region redirects are disabled, and streamed record data is capped.
Stalled response bodies are destroyed on cancellation. Error messages are fixed
codes and never include SDK exceptions, credentials, URLs or object contents.

Official behavior references: [R2 conditional requests](https://developers.cloudflare.com/r2/api/s3/extensions/),
[bucket-scoped credentials](https://developers.cloudflare.com/r2/api/tokens/), and
[bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/).

## Local verification

Build, typecheck and lint pass. The isolated ledger suite has nine tests, included
in 231 passing unit/HTTP/contract checks; all 130 disposable MySQL regressions also
pass. These cover concurrent intent conflicts, lost acknowledgements, unchanged
first-request time, canonical input, strict bounded SDK commands, cancellation and
Nest shutdown. Cross-repository symbol inspection found no existing consumer;
API routes, response contracts, schema and application composition are unchanged.
Cloud infrastructure and actual R2 behavior remain the deployment gates above.
