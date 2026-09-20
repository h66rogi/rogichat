# M12 isolated quality evidence

This batch evaluates frozen integration `f4c89d853a7c5e35a8d542e6bd383c72009f5568`
with test-only changes, then normally merges reconciled QA base
`3f6b8bf92ee3ab8d5acc8283e819f5755b277dd9`; API runtime/schema remain identical.
It does not authorize production promotion or claim the entire M12 launch gate
is complete. Observed results follow below.

## Reproduction and isolation

The `Backend M12 isolated quality` PR workflow builds the real API on one
GitHub-hosted Ubuntu runner with digest-pinned MySQL 8.0.44. No cloud credentials,
QA accounts, public service URLs, self-hosted runners or deployment jobs are used.
It runs:

```sh
cd apps/api
node test/run-mysql.mjs --quality
```

The runner supplies `ROGICHAT_TEST_MYSQL=disposable`, `TEST_MYSQL_PORT` and the
ephemeral service root credential. The existing harness generates a new schema
and least-privilege runtime user, runs generated Prisma migrations and removes
only those owned resources in `finally`. Quality mode refuses local MySQL
datadir fallback. The suite also checks loopback URL, generated schema/user,
test environment and disabled loopback TLS before opening its fixtures.

The restore drill creates a second generated schema, restores only its own
synthetic backup, grants the fixture user DML rights, and removes that schema
and temporary backup afterward. Credentials, backups and synthetic message
contents are not evidence artifacts. Only scalar measurements and test output
are published as `m12-evidence-<run>-<attempt>` for 14 days. A nonzero test exit
fails the job even though logs upload on failure.

## Assertions and measurements

* 1,000 distinct synthetic accounts hold 1,000 real authenticated WebSockets,
  split 500/500 across two separate API processes using one MySQL database.
  Connections are paced within the unchanged admission limit. Eight concurrent
  senders submit 80 shared messages to one room across both processes.
* Every account performs REST snapshot recovery and must see exactly the 80
  acknowledged IDs without duplicates. A disconnected tail recipient recovers
  the last message without another message or hint. One API is SIGKILLed,
  restarted, and its 500 clients reconnect and verify all 81 acknowledged IDs.
  Final message, receipt and event counts must agree exactly.
* Reported ACK and REST snapshot p50/p95/p99/max include sample counts. Socket
  ramp duration, command throughput, hint recipient counts, tail recovery and
  full restart/reconnect duration are measured, never inferred from thresholds.
* Existing API egress-proxy ACK loss and purge-worker pre/post-COMMIT SIGKILL
  tests execute unchanged, along with deletion replay generation fencing,
  missing-parent obligations, session guards and realtime audience assertions.
* A consistent logical backup is written before external MESSAGE and ACCOUNT
  deletion obligations, then restored into another schema. Missing, unavailable
  or corrupt ledger evidence rejects the test release guard. Valid receipts
  block the deleted data. All restored WEB and NATIVE sessions are invalidated;
  fresh survivor sessions reconstruct permission through the real HTTP snapshot
  endpoint. Owner/member access succeeds, outsiders and deleted accounts fail,
  and deleted private content must not appear. Outstanding physical purge stays
  explicitly outstanding.

## Architectural and evidence limits

The serving design has no Redis/Socket.IO cross-node adapter. Competing API
consumers claim a shared hint queue but dispatch only to local sockets. Hint
delivery is lossy and can be absent on another node; correctness depends on
foreground/reconnect/periodic REST sync. The test records hint recipients but
does not assert or advertise full cross-node realtime delivery.

The restore release guard is test scaffolding with an externally retained exact
fixture manifest. It does not implement a production restore orchestrator or
prove a real object-store inventory complete. The drill explicitly demonstrates
that a restored old session remains valid before operational invalidation.
The ledger store is an isolated in-memory adapter and the backup is a logical
MySQL copy, not an Aurora snapshot/PITR or a real storage-media restore.

One runner is not a multi-host network, production capacity benchmark or cost
forecast. The 1,000-socket test is a bounded exercise, not a 30-minute soak;
video overlap, rendered screen latency, automatic reconnect storms, live SOOP
login, independent deployment/rollback, 24-hour purge and 30-day backup expiry
proof remain separate evidence obligations. The MVP starting targets (ACK p95
500 ms, visible sync p95 1 s, foreground recovery 20 s) are comparison points;
measured violations must remain visible rather than being relabeled as passes.

## Observed execution

[Hosted run 35505971573](https://github.com/h66rogi/rogichat/actions/runs/35505971573)
completed successfully on 2026-09-20, 10:45:50–10:49:05 UTC (19:45:50–19:49:05 KST).
PR head was `68f5397d7be08f3127f2137420f18a850802ba1e`; the actual tested PR merge
checkout was `8e939f8eaa728fde567055c2c3c6330cb1b7cea0`. Hosted build/lint passed,
and all **33 tests passed, zero failed/skipped**, in 109.82 seconds. Node was
24.21.0, on the workflow's Ubuntu 24.04/MySQL 8.0.44 service.

The durable [scalar evidence JSON](evidence/m12/2026-09-20-run-35505971573.json)
retains the exact source, timestamps and measurements. The full execution log
and original JSON reports are in artifact `m12-evidence-35505971573-1` on that run.
No application defect was reproduced by these scenarios.

| Observed load measurement | Result |
| --- | --- |
| Simultaneous authenticated sockets / distinct accounts | 1,000 / 1,000 |
| Sockets per API process | 500 / 500 |
| Connection ramp | 25.48 s |
| Hot-room commands / concurrency | 80 / 8 |
| Hot-room elapsed / observed throughput | 2.74 s / 29.21 commands/s |
| Cross-process retries of the same command | 2; exact original ACK, no duplicate |
| ACK samples, p50 / p95 / p99 / max | 83; 174.74 / 280.57 / 292.00 / 292.00 ms |
| REST snapshot samples, p50 / p95 / p99 / max | 1,501; 117.64 / 154.24 / 200.74 / 261.29 ms |
| Recipients of at least one hint over the 80-command batch | 500 / 500; not a per-event delivery result |
| Disconnected tail recipient, explicit REST recovery | 333.72 ms, including a 300 ms injected wait |
| SIGKILL, API startup, paced reconnect and sync of all 500 affected clients | **24.19 s** |
| Final connected sockets | 1,000 |
| Distinct committed messages / receipts / events | 81 / 81 / 81 |
| Hot-room scenario duration including fixtures and recovery | 91.84 s |

ACK p95 is below the 500 ms starting comparison point. REST p95 is below 1 s,
but does not measure rendered screen latency. The **24.19 s aggregate restart
exercise exceeds the 20 s comparison point**; it includes deliberate reconnect
pacing and all 500 REST recoveries, so it must not be described as proof that a
single foreground client misses or meets 20 s. Per-client foreground latency,
automatic backoff/storm behavior and stable long-run capacity remain unmeasured.
No latency target is silently substituted for these observed values.

| Observed restore/fault measurement | Result |
| --- | --- |
| Consistent backup tables / serialized bytes | 47 / 60,867 |
| Backup write / restore into second schema | 64.15 / 638.37 ms |
| Deletion replay, invalidation and HTTP permission checks | 457.21 ms |
| Post-backup external obligations | 2 (MESSAGE and ACCOUNT) |
| Rejected evidence conditions | missing, unavailable, corrupt |
| Invalidated sessions | 8, covering WEB and NATIVE |
| Restored old session before invalidation | accepted, confirming quarantine requirement |
| Permission assertions | owner/member allowed; outsider/deleted account denied; deleted private body absent |
| Physical account purge | explicitly still outstanding; no completion claim |
| Actual lost ACK + API SIGKILL + new-process retry test | 2,467.41 ms, passed |
| Purge-worker pre-COMMIT SIGKILL rollback/recovery test | 2,051.20 ms, passed |
| Purge-worker post-COMMIT SIGKILL exact-proof replay test | 2,051.31 ms, passed |

Fault-test durations cover the entire named test, not isolated recovery latency.
Security hooks and the full-history scanner passed before publication. Required
PR checks are tracked separately from this quality-run result; this report does
not assert QA merge, deployment or public-route verification.


## Follow-up: exact fanout, automatic recovery and restore quarantine

The first run above is retained as its observed baseline. The subsequent
`realtime-storm.test.mjs` adds a single-event recipient count per API and the
latency from send to hint and successful REST projection, without conflating
periodic polling with cross-node fanout. It SIGKILLs both APIs and measures each
of 1,000 clients using real Socket.IO automatic backoff (1 s initial, 5 s maximum,
0.5 randomization). Foreground snapshot requests are immediate and unbatched.
Every client's successful recovery must meet the unchanged 20 s gate; failures
and timeouts are written to evidence before the assertion fails. Local hint
recipient REST projection p95 is compared to the unchanged 1 s target.

A final single-API probe places all 1,000 sockets on the MVP serving topology
and requires HTTP readiness to remain reachable. This checks REST headroom,
including the interaction between the configured 1,000 HTTP connection ceiling
and the configured 1,000 realtime ceiling. It is an isolated characterization,
not a production capacity claim.

The logical restore drill now also models a post-backup owner transfer, ban,
private-grant revocation and birthday-visibility withdrawal. Before any serving
API starts, its test-only operator procedure invalidates sessions, increments
room/content/ACL/profile/membership epochs, resets birthday visibility OFF,
and disables all restored memberships, positive grants, owner, creator and
administrator rights. Only the independently approved current owner receives
a new membership period. Former-owner login/rejoin/publication, restored admin
rights, old private grants and pre-restore cursors must remain denied/reset.
This demonstrates the required procedure on disposable SQL; it still does not
supply the missing production restore-release orchestrator, independent ledger
inventory proof, media/orphan reconstruction or Aurora PITR evidence.

Execution results for these follow-up assertions are pending and must not be
inferred from the passing 33-test baseline.
