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
a prior checkpoint permits a new verified physical target while retaining consumed nonce history.
The auth/session, epoch/proof, protected-file, IPC, media and architecture batch
passed 60 tests with no skips, and the operator module startup test passed. These are component evidence, not a joined
backup/restore release or a production storage-custody claim. The separately
pinned operator driver must still execute the compiled gate and independent
readback against the exact published source and build digest.

## Subsequent restores and target identity

`scope.targetId` remains the actual logical database name. The persisted unique
checkpoint target is `SHA256("rogichat:restore-target:v1:" + canonical({version:1,
databaseName:scope.targetId,mysqlServerUuid}))`, where the UUID comes from signed
custody and is rechecked against `@@server_uuid` in each current transaction.
The UUID also binds checkpoint context and observed release state.

A fresh physical restore may therefore retain its logical database name while
carrying old checkpoints from another server. Old rows and consumed nonces stay
intact. A second run for the same verified server and database still fails closed;
there is no in-place supersession or checkpoint-deletion procedure. This binding
is not proof that a provider assigns globally unique physical identities: the
independent custodian must verify target provisioning and ownership. A clone
which retains an old server UUID is not automatically a new restore target.

## Joined hosted proof

The `m12-restore` PR label executes `node test/run-mysql.mjs --restore` on a disposable hosted MySQL service. The harness and runtime use separate checkouts: runtime is fixed at `7b559b645ef2b71fc5492d79895142745d0d6ead`, and its entire compiled tree must match independently reviewed SHA256 `5c711fee7fc14edd42f121c9b8c38757ab3113a6633417919ee5e32f4c2a6057`. The current harness build must match that same digest. No service credentials, deployment targets or live objects enter this job.

`test/restore/joined.test.mjs` reuses the existing logical backup and domain fixtures, then restores into another randomly named database. A protected namespace supplies real nonempty PHOTO and VIDEO objects. Generic test-only driver provenance and derivative hashes live in `test/support/restore-driver/provenance.json`. The custody helper rotates the dedicated disposable password and drains existing sessions; the fixture tests both the old writer and old authentication, as well as an INDEX-only foreign principal.

The scenario executes the actual operator module for ledger replay and quarantine, separate-process attestation, two concurrent consumers of one release nonce, independent receipt recovery, and actual lease loss. It probes product HTTP with old and new WEB/native sessions, restored numeric counters and membership periods, old cursors/M/A, and explicitly reconstructed permissions. Source/build mismatch, incomplete/corrupt/unavailable ledger, pending admission, permission drift, changed/missing/orphan media and replayed release must fail closed. Evidence is only accepted after an observed successful run; implementation alone is not execution evidence. The release receipt remains `servingAuthorized:false`, and local kernel custody is not proof of live R2 or Aurora PITR behavior.

Observed execution: [hosted run 35512581548](https://github.com/h66rogi/rogichat/actions/runs/35512581548) passed on 2026-09-20 at 13:09:11 UTC (22:09:11 KST). Harness head `29d9e05` executed as PR merge `390bc723e63048be92e834c46e51bd21d32125a0` against the separately pinned runtime above. The scenario took 16,696.59 ms (whole test process 17,464.67 ms), backed up/restored 61 tables and 79,463 bytes, replayed two deletion receipts, verified three nonempty media objects, and passed all 18 recorded rejection cases. Two concurrent release consumers produced exactly one committed nonce and one rejection; receipt recovery succeeded before actual MySQL lease loss rejected recovery. Six old WEB/native tokens returned HTTP 401 with fresh-session HTTP 200 controls, and same-session/period/counter ABA rejected old cursor/M while changing A/cache/native generation. A new approved owner period did not resurrect old private grants. Apple revocation ciphertext remained decryptable under the unchanged base key, with upstream revocation explicitly still pending.

Durable measurements, artifact checksum and precise source identities are in [the joined execution record](evidence/m12/2026-09-20-joined-restore.json). Verb durations in that record accumulate positive and negative probes, including concurrent calls; they are not latency percentiles. This is observed proof of the pinned leaf runtime, not proof of a later integration aggregate.
