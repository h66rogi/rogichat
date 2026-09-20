# Database overload and realtime admission

The API bounds pending transactions, including driver acquisition and rollback,
to five times its configured pool size (25 at the default five connections).
This is a resource bound, not a supported client-count claim. It retains the
1,200 ms pool acquisition, 3,000 ms statement and 8,000 ms transaction deadlines.
A caller timing out does not free its admission slot until driver work settles.
No extra database pool, SQL persistence layer or command replay is introduced.

Known admission, acquisition and deadline failures return HTTP 503 `UNAVAILABLE`
with `Retry-After: 1`. Safe operational logs contain only fixed reason categories;
driver errors, SQL, credentials and request bodies are not recorded. Unknown
commit outcomes remain HTTP 500 and are never replayed by the server. Clients
must reconcile an interrupted command by its existing idempotency contract.
P2028 is classified as acquisition failure only before callback entry; callback
misuse and ordinary internal exceptions retain their existing failure behavior.

During socket authentication, an identified temporary database failure closes
the Engine.IO transport so standard Socket.IO backoff/reconnect remains active.
Invalid credentials still receive the existing namespace authentication denial.
Current session, terms, SOOP and room ACL checks remain in place. No account or
message is invented to recover availability.

Cross-account native push rebinding retains its NOWAIT lock order. Only the
pinned MySQL 3572 lock-contention error becomes a controlled 409 `CONFLICT`;
unrelated database and programming failures propagate unchanged. A deterministic
hosted regression holds the previous account lock, verifies the driver category,
checks the 409 result and proves the original generation survives rollback.

The reviewed MVP uses one API with local, lossy hints. Competing API job consumers
do not form a distributed fanout bus. Foreground/reconnect/periodic REST recovery
remains required; this change does not add Redis or a cross-node delivery promise.

## Evidence boundary

Hosted run [35507401036](https://github.com/h66rogi/rogichat/actions/runs/35507401036)
measured 399 HTTP 500 responses among 500 immediate hint-triggered REST reads,
and 269 HTTP 500 responses during the supplementary 1,000-client restart drill.
Those artifacts did not contain server exception categories, so pool exhaustion
is a hypothesis, not a proven explanation for every failure. The new bounded
admission and safe diagnostics make future measurements classifiable. Returning
503 instead of 500 does not satisfy a successful-projection assertion or prove
capacity. Diagnostic thresholds must remain unchanged.

Run [35511656540](https://github.com/h66rogi/rogichat/actions/runs/35511656540)
on source `81f2603773506596459aa1ab20a1beab14442365` reached all 1,000 connected
sockets but recovered only 946 projections: 54 immediate REST requests returned
503 and missed the unchanged 20-second target. The local hint reached 500 sockets;
40 immediate reads succeeded and 460 returned 503. A single API at 1,000 upgraded
connections rejected a fresh readiness transport. The [failed receipt](evidence/m12/2026-09-20-run-35511656540.json)
preserves these outcomes; changing error classification did not make the load pass.

The shared Node transport now permits 1,064 connections, comprising the unchanged
1,000 realtime ceiling and 64 connections of HTTP headroom. Upgraded sockets count
toward Node's HTTP limit. This finite headroom prevents the realtime ceiling alone
exhausting ordinary requests; it does not reserve an invulnerable health channel
against arbitrary HTTP exhaustion. Pool sizes and database admission are unchanged.
The configured-API regression holds actual upgraded TCP connections, checks fresh
health responses and verifies rejection at the finite total. It is a transport
regression, not a 1,000-user authenticated product-capacity test.

The documented single-user MVP keeps its 33 release quality cases. The unchanged
1,000-client storm assertions live in `test/expansion/realtime-storm.test.mjs` and
run via `node test/run-mysql.mjs --expansion` on explicit disposable MySQL.
`Backend expansion benchmark (1000 clients)` runs on the `m12-expansion-benchmark`
PR label or manual dispatch. Its failing assertions fail that job, and artifacts
are retained even on failure; no `continue-on-error`, test-only retry or raised
workload threshold is used. Expansion capacity remains unvalidated.

Focused regressions cover bounded admission, late checkout settlement, no replay,
safe HTTP errors and real Socket.IO automatic retry after a temporary rejection.
Full credential-free hosted CI must validate the combined source head. This
document is not evidence of a scale pass, live deployment or real user-route test.
