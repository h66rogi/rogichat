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

### Observed supplementary failures, run 35507401036

[Actual hosted run](https://github.com/h66rogi/rogichat/actions/runs/35507401036)
on PR merge `dc442000b9efb7ab6ab6d04ce34aa883b9a5d132` failed the automatic
recovery assertion. [Durable sanitized measurements](evidence/m12/2026-09-20-run-35507401036.json)
preserve failure, source, timestamps and error counts. Strengthened restoration
quarantined every restored positive membership, grant, owner, admin and creator
permission, reset birthdays OFF, rejected former-owner access and stale cursors,
and passed. The earlier paced 1,000-client hot-room test also passed again.

A single event reached **500/1,000 sockets on one API only**. Of 500 simultaneous
hint-triggered REST projections, **399 returned HTTP 500**; the 101 successful
projections had p95 **1,947 ms**. Following death of both APIs, only **570/1,000**
clients recovered their projection, with **430 missing the 20-second deadline**,
269 REST failures and 1,174 connection errors. The single-API capacity follow-up
reached only 926 sockets while readiness remained 200: this does **not** isolate
or prove the proposed HTTP connection-cap collision. Application owners received
the concrete evidence. No runtime fix or cross-node guarantee is claimed here.
These are supplementary stress failures, not an inflated replacement for the
MVP criterion of ten clients, 30 minutes, one message/second and one video worker.

### Thirty-minute MVP execution lane

Apply the `m12-soak` PR label to run `Backend M12 30-minute MVP soak`. It runs once
per label event (remove/reapply deliberately for a new execution), avoiding a
30-minute run for every documentation commit. The credential-free Ubuntu runner
owns ephemeral MySQL, one real API, one actual media queue worker and a decoder
broker that has no database/auth environment. The 45-minute job bound includes
native-video preflight, the fixed 30-minute workload and cleanup. No shortened
mode or live-target configuration is accepted.

`node test/run-mysql.mjs --soak` extends the existing disposable-database runner.
The suite provisions ten synthetic users and sockets, sends 1,800 real commands
at one/second, and applies hints/events to the existing executable reference cache.
The checks require 18,000 unique projections, exact final message sets, ACK p95
≤500 ms, send-to-cache p95 ≤1,000 ms and every client's restart recovery ≤20 seconds.
The API receives SIGKILL halfway through; identical command identities survive
transport retry. Existing separate quality tests cover lost ACK after commit and
restore deletion obligations.

A real 20-second 720p H.264/AAC fixture goes through the production media service,
MySQL job fencing, Unix decoder protocol, native per-job FFmpeg and canonical
video/poster verification. A private disk adapter replaces R2 only in this test.
One video runs at a time; six jobs overlap the text workload after a preflight job.
SIGKILL during the first timed decode leaves the genuine five-minute lease to
expire, after which the replacement worker must reclaim and complete it. There
is no manual lease expiry, mocked decoder or fabricated READY result. Measurements
include video-overlap ACK/cache samples, job generations, worker recovery, and
sampled API/worker/broker RSS high-water marks. Cache commit is not UI rendering,
disk is not R2, and RSS samples exclude short-lived native decoder children.
The lane's implementation is present; its observed result must be attached before
claiming that this MVP acceptance criterion passed.

### Observed schema26 thirty-minute soak, run 35537369172

[Hosted run 35537369172](https://github.com/h66rogi/rogichat/actions/runs/35537369172)
passed at 2026-09-20 21:33:40 UTC. PR head was
`b7b599f48068e5c7ed92e9772db364406757d27d`; the actual tested PR merge was
`01400e731bcb85c3538bb2301d704c097d6bec1a`. A complete tree comparison with
the deployed schema26 source `a63bbdae583dcd84c42b07872b1c374c84bd6b01`
showed only a documentation change: API runtime, tests, dependency lock and
soak workflow were identical. Build/lint passed and the full soak test passed
with zero failures/skips; no shorter mode or relaxed threshold was used.

[Durable sanitized scalar evidence](evidence/m12/2026-09-20-run-35537369172.json)
retains source, timestamps, artifact digest and the measurements. The original
artifact `m12-soak-evidence-35537369172-1` includes the complete test log and
worker frames; synthetic asset identifiers are omitted from the durable summary.

| Measurement | Observed result |
| --- | --- |
| Timed workload | 21:03:35.554–21:33:36.332 UTC; 1,800.769 seconds |
| Connected clients / committed commands / unique projections | 10 / 1,800 / 18,000; every final message set matched |
| ACK p50 / p95 / p99 / max | 39.52 / 75.13 / 99.38 / 1,287.13 ms; 1,800 samples |
| Send-to-reference-cache p50 / p95 / p99 / max | 293.64 / 433.57 / 479.33 / 6,065.41 ms; 18,000 samples |
| Video-overlap ACK p95 / max | 75.83 / 295.39 ms; 100 samples |
| Video-overlap cache p95 / p99 / max | 583.48 / 4,258.71 / 6,065.41 ms; 1,048 samples |
| API SIGKILL and automatic client recovery | All ten recovered; maximum 3,850.99 ms |
| Native video completion | Seven videos (one preflight plus six timed jobs), each canonical video/poster validated |
| Worker SIGKILL → first subsequent completion | 313,267.58 ms, with the genuine five-minute lease unchanged |
| Injected-restart transport errors / unexpected errors | 7 / 0 |
| Sampled process high-water RSS: API / worker / decoder broker | 557,880 / 222,620 / 74,228 KiB |

ACK p95, cache p95 and every-client recovery passed the unchanged 500 ms,
1,000 ms and 20,000 ms gates. Maximum latencies are **not** below those p95
targets and remain visible above; injected failure errors are not described as
zero errors. The worker's 313-second metric ends at the first post-crash
completion of **another queued video**, not at the killed video's completion
or lease reclamation. Separate frames confirm that the killed video was retried
at generation two and completed; all seven outputs passed native codec checks.

This is the isolated low-cost MVP topology, not 1,000-user or cross-host capacity
certification. Cache commit is not browser render time, private disk is not R2,
and process RSS samples exclude short-lived native children and do not establish
a production memory budget or absence of leaks. Live profile/login/room and
administrator/reviewer results are recorded separately in
[backend live acceptance](backend-live-acceptance.md). Actual R2, push-provider,
Aurora restore and deletion/backup evidence remain independent launch gates.
