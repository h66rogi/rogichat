# Physical MESSAGE purge process-death coverage

The isolated MySQL integration runner discovers `message-purge-crash.test.mjs`.
Its two cases run the production `MessagePurgeModule`, service, repositories and
transaction implementation in OS child processes. No runtime failure switches,
schema changes or PURGE worker handler are introduced.

- Before final COMMIT: a test-only transaction-port wrapper pauses after the
  production callback has removed the root, written its proof and fenced the
  lease, but before returning to the real transaction implementation. The parent
  sends SIGKILL within one second of the barrier, with at least five seconds of
  transaction budget remaining when the barrier was emitted. It requires a live,
  nonfailed child and the exact SIGKILL exit, then obtains a current room lock in
  a fresh transaction. Root, absent proof, receipt, checkpoint and epoch must
  equal their pre-crash state. A fresh process performs the final step once.
- After successful COMMIT: the real transaction port resolves, but the child
  withholds its caller result. The parent independently observes root absence,
  exact immutable proof, terminal receipt and one epoch increment, then kills
  and reaps the child. A fresh process must return `rows_purged` with zero changes
  and preserve the identical durable snapshot. Original-command retry must
  return its retained deleted receipt in both cases.

This tests lost **caller results after a successful COMMIT**, not driver
COMMIT-acknowledgment loss or unknown COMMIT outcomes. Driver-level ambiguity,
concurrent-process lease takeover, media cleanup, backup replay and global
`LIVE_PURGED` completion remain outside these two cases. The external ledger is
an isolated test adapter used only for admission; these are not storage-provider
durability tests.

Both processes require the disposable-test markers, disabled test TLS and the
runner's generated loopback database/user pattern. The child receives only the
runtime database URL and minimal test environment, never the admin URL. IPC and
captured output are bounded; errors are fixed labels and captured logs are never
forwarded. Parent deadlines, a child watchdog and owned-PID cleanup bound hangs.
No message bodies, credentials or leases are intentionally logged.

Local validation is limited to syntax and public-repository scanners while the
mobile resource hold applies. Actual MySQL/process-death execution must be
confirmed by the exact-head hosted Backend CI result; source review and syntax
checks alone are not execution evidence.
