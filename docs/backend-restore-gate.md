# Operator restore gate

This graph is separate from API and worker composition. No public route or
serving activation is provided. A consumed checkpoint always reports
`servingAuthorized: false`; the independent operator retains custody and verifies
the committed receipt before a separately reviewed release.

## Inputs and trust

`node dist/modules/restore-gate/restore-gate.command.js prepare|observe|consume`
reads `RESTORE_GATE_CONFIG_FILE`, a private canonical JSON file with exactly
`boundaryProofFile`, `boundaryPublicKeyFile`, `isolationSocket`, `releaseProofFile`
(string or null), `releasePublicKeyFile`, and `scope`. Proof and issuer key files
must be canonical absolute paths to private, singly linked regular files owned
by root or the effective process user. Metadata is checked before and after
reading. Keys are provisioned independently; a proof cannot choose its trust key.

The exact scope binds environment, source commit, migration-manifest digest,
restore run, snapshot digest, target database, and independent ledger source.
Those bindings do not themselves verify a build or backup: the external operator
must verify the actual clean immutable checkout, compiled tree and backup bytes
against independently protected expectations. Neither SQL discovery nor an R2
listing can create an authoritative complete-ledger boundary.

The independent boundary issuer signs canonical UTF-8 bytes with Ed25519. Its
boundary includes a resolved admission fence and the exact sorted receipt key and
SHA-256 inventory, with a maximum one-hour lifetime. The release issuer is a
different Ed25519 key and signs the exact observed state, boundary, scope and
single-use nonce for at most five minutes. The IPC authority answers a fresh
challenge with a five-second custody proof. The command verifies the actual
MySQL server UUID, connection-owned named lease and target inside each guarded
transaction; an idle socket, signed stale document or process mutex is insufficient.
The same signed response includes `storageScopeSha256` and `storageFenceId`.
Both bind the checkpoint and observed digest, must remain unchanged across media
scan/final transaction/postcommit checks, and must match the actual media scope.
The isolated Linux authority uses a fresh object-tree copy inside a private
read-only mount namespace with dropped writer privileges; an ordinary writable
directory or macOS permission bit is not equivalent. Live R2 release remains
unsupported without an independently enforced storage-writer exclusion authority.
IPC has a three-second absolute deadline, independent of incoming byte activity.

## Authorization and quarantine

`AUTHORIZATION_EPOCH_FILE` contains exactly `{"authorizationEpoch":"<UUIDv4>"}`.
It uses the same protected-file constraints. The authority provisions a fresh
value outside the restored database. HMAC domain separation derives the
session-token/cache/scope proof key from the stable auth key, audience and epoch.
Without this optional file the pre-existing key behavior is byte-for-byte
unchanged. The stable auth key still decrypts Apple revocation obligations;
rotating it is not a restore invalidation mechanism.

`prepare` verifies the independently sealed ledger before mutation, revokes WEB
and native sessions, fails/scrubs pending authentication, revokes push bindings,
closes membership periods, bans restored members, removes room ownership, revokes
all grants, disables administrator and creator capabilities, clears birthday
visibility, and increments authorization/profile/room generations. Provider
quarantine uses the exported Apple lifecycle port with its cursor committed in
the same fenced checkpoint transaction. Retained provider tokens remain durable
revocation obligations, never invented successful revocations.

Every independently recorded deletion receipt is replayed using the existing
DeletionApplyService through its transaction-aware restore port. Each apply or
scrub page has a current custody check before domain work and a final check after
all domain lock waits, in that same transaction. ACCOUNT binding scrubbing is resumed through that service.
Blocked visibility is not a physical-purge claim. Missing, corrupt, extra,
duplicate, incomplete or unavailable ledger entries keep the gate closed.

`observe` performs fresh bounded media inventory and byte verification through
the exported RestoreMediaService. In the final transaction a checkpoint locking
read serializes concurrent operators without creating a consistent snapshot;
media `bind` is the first consistent read. Issued evidence, exact storage scope,
DB snapshot and verified media status must all match. Missing objects, changed
bytes, orphan objects, unresolved writer/deletion obligations or unavailable
storage keep the gate closed, including for an empty restored database.

`observe` independently reads current sessions, privileges, privacy choices,
generation identities, deletion application and provider readiness. `consume`
repeats observation in a fresh transaction and atomically consumes the exact
observation digest and nonce. A lost COMMIT acknowledgment is an unknown outcome:
retain custody and reconcile the persisted receipt through observation, never
blindly replay or enable serving.

Restored permissions are not reconstructed by copying historical grants. After
release, current identity verification, ordinary membership transitions, fresh
room ownership approval and explicit privacy choices reconstruct access through
normal domain operations. Old membership/cursor proofs must remain invalid even
if numeric counters and member periods are later recreated.

## Execution boundaries

The disposable joined driver must invoke this compiled module and exported
ports, not substitute quarantine SQL. Its isolation authority must independently
exclude runtime database connections and media writers through final readback.
Media inventory/hashing is point-in-time evidence and does not prove sustained
storage custody. No live QA/production database, host or object store is used by
the M12 harness. Public evidence contains synthetic measurements only; private
keys, proofs, production identifiers and connection details are never artifacts.

Genuine Prisma migration `20260920114316_restore_gate_checkpoint` follows the
frozen 23-migration base. Schema-manifest readiness is mandatory. The checkpoint
stores bindings, provider progress, observed digest and single-use receipt; it is
not a global completeness watermark or an admission queue.

## Validation recorded before joined execution

The source24 implementation passed a clean disposable MySQL 8.0.44 migration
replay (all 24 applied, schema in sync). Three real-MySQL regressions passed: custody
lost during an actual account lock wait rolls back domain and receipt changes;
custody lost between binding-scrub pages prevents the next page from committing;
a prior checkpoint permits a fresh target while retaining consumed nonce history.
The auth/session, epoch/proof, protected-file, IPC, media and architecture batch
passed 60 tests with no skips, and the operator module startup test passed. These are component evidence, not a joined
backup/restore release or a production storage-custody claim. The separately
pinned operator driver must still execute the compiled gate and independent
readback against the exact published source and build digest.

## Subsequent restores and target identity

Every restore uses a **fresh unique database name**, including a restore from a
snapshot which carries a previous successful restore checkpoint. `targetId` must
be that actual database name; changing only `restoreRunId` is insufficient. The
unique target constraint deliberately refuses a second run for the same target.
Old checkpoint rows and consumed nonces remain intact in the new database. This
implementation has no in-place supersession or checkpoint-deletion procedure.
Operators must provision and fence the new target before invoking the gate; an
in-place database-name reuse remains unsupported and fails closed.
