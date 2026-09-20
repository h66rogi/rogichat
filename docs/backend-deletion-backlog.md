# Read-only deletion backlog probe

`deletion-backlog.command` runs outside the API and deletion worker.
It uses the existing Nest database provider, exact migration readiness check,
Prisma aggregates and one read-only snapshot. It starts no job loop, reads no
message bodies, and returns no user/request/room IDs, provider keys or raw errors.
It requires the normal file-backed hosted database configuration and verified
TLS. It does not install itself, create credentials, modify a shared database,
or authorize a release. Invoke against a separately approved matching runtime:

```sh
node apps/api/dist/modules/deletion/deletion-backlog.command.js
```

The ordinary backend build compiles this entry into the runtime artifact; it is
not imported or started by the API or worker. Installation in private operations, periodic runs,
an independent missed-run/worker-heartbeat alarm, and named escalation owners
remain commissioning work. Do not execute an arbitrary candidate against QA or
production or treat this document as approval for that installation.

Exit codes: `0` means the **observed database subset** is below the one-hour
warning threshold with no enumerated errors, `2` requires attention, and `1`
means unavailable/invalid evidence. A caller must alert on `1`, absent output,
stale `observedAt`, malformed JSON or a missing scheduled invocation, not convert
them into zero backlog. There is no public HTTP endpoint.

The probe measures BLOCKED/PURGING MESSAGE requests, BLOCKED/PURGING ACCOUNT
obligations, and unapplied DB intents separately; these sets can overlap and
must not be summed. It uses the immutable original `requested_at`, not the last
retry, lease, job creation or worker restart time. Ages use database UTC after
the read snapshot is established. Thresholds are inclusive: one hour warning,
twelve hours urgent, twenty-four hours breach. Future/inconsistent timestamps
and unsafe counts fail closed. Failed PURGE jobs, uncovered active account
guards, invalid/conflicting replay evidence and current discovery errors require attention
even before an age threshold. Retained error history after successful recovery
does not by itself remain an active error. `replayRetryWithFailureHistory` is an
informational count only: existing durable replay state uses RETRY both for
failed work and for a recovered record's next-generation re-observation. It does
not distinguish current transient failures from preserved history. This probe
therefore does not claim immediate transient-replay-failure detection from that
field; worker failure diagnostics and independent ledger observation are still
required. The original pending deletion age thresholds apply in either case.

Every report includes `coverage: "database-only"` and
`completionVerified: false`. Empty output counts do **not** establish external
ledger completeness, R2 termination/absence, historical orphan coverage, backup
expiry, complete physical purge, or restore safety. External-only intents and
missing/restored DB obligations need independent ledger inventory/reconciliation;
that remains mandatory. LIVE_PURGED/BACKUPS_EXPIRED database state is excluded
from the pending aggregate, not independently certified by this probe. Large
aggregate scans retain the provider statement and transaction deadlines; timeout
is unavailable evidence, not a truncated successful result. No schema/index
change is bundled.
