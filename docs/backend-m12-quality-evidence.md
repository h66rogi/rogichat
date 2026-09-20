# M12 isolated quality evidence

This batch evaluates frozen integration `f4c89d853a7c5e35a8d542e6bd383c72009f5568`
with test-only changes. It does not authorize production promotion or claim the
entire M12 launch gate is complete. Observed run results are recorded below once
the hosted execution finishes.

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

Pending hosted execution. No throughput, latency, recovery or restore success
is claimed from syntax checks or harness implementation alone.
