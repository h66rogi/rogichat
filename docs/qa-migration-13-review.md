# QA migration 13: execution review, not execution authority

Reviewed source: `397d2f0b59868c1a0579c92ef74a1852c5ce66e6` (PR #35).
This document performs no SQL, host change, credential operation or deployment.
The infrastructure coordinator currently reserves the QA host for initial web
activation. That reservation must be released before backend host operations.

## Exact change and baseline

The previously verified QA release is `f6958c5b344e0a50aa519c02be433c6c90477ec2`
with twelve successfully applied migrations. This is baseline evidence, not a
fresh assertion about the database at execution time. All twelve historical SQL
files are unchanged in the reviewed source. The only new migration is:

- `20260920044559_native_soop_transactions`
- SHA-256 `2745e58fc8f95fe15792d4b8b6e74b3c9eb937316331f79240e7c99e924edd21`

It adds twelve columns to `login_transactions`: eleven nullable native-login
challenge, launch/completion, binding and payload columns, plus `channel` with
the non-null default `WEB`. It creates unique indexes on the two newly nullable
binary digests, `launch_digest` and `completion_digest`. Existing rows acquire
the WEB discriminator and null native fields. There is no DROP, DELETE, UPDATE,
foreign-key change, privilege change or historical migration edit. The generated
unique-index warning is reviewed: preexisting rows cannot already contain
duplicate non-null values in columns that did not previously exist.

The ALTER and two CREATE INDEX statements can acquire metadata locks and consume
time/storage. They are not a transactional all-or-nothing unit: MySQL DDL can
commit before a later statement fails. Do not promise zero downtime or automatic
rollback. Existing login flows are drained with API/worker admission during the
single release operation; clients must handle unavailable/retry states.

## Published provenance

All four exact-source push gates passed:

| Gate | Run |
| --- | --- |
| Backend | 35494858409 |
| Security | 35494858482 |
| Infrastructure | 35494858477 |
| Image publication | 35494858399 |

Published immutable registry images:

- Runtime: `ghcr.io/h66rogi/rogichat-api@sha256:54343a3d1e62b46851769cba1e4d324d4019011cf8a5c1cc3e0772e11c4a32a7`
- Migrator: `ghcr.io/h66rogi/rogichat-api-migration@sha256:b23eed75f6059351b552f4e22dcde99a8c6dd6421708ae5ff16a70a4cc8a8e79`

Reviewed-source tool hashes (not claims about currently installed host files):

| File | SHA-256 |
| --- | --- |
| tools/operations/migrate_entry.mjs | cc4769c3ae7f2834b1ec2cd0aa8fd72a064f6907de761246e33fe728e458a51a |
| tools/operations/backend_release.py | 66a1ee09cde74093f07a3425ee67fd860bb1232af035360ad6fb4c196e0e3153 |
| tools/operations/backend_archive.py | de080861afb71e5053f31f5cf28cb2cef164b9f09da9b15c05a54e2ecaea9459 |

At review time there is no successful backend export for source 397d2f0. Earlier
f6958c5 archives contain only twelve migrations and cannot execute this change.
A fresh trusted export of these exact published images must establish its run,
attempt, artifact ID, artifact ZIP digest, config IDs and typed archive execution
IDs. Reuse the reviewed archive/migrator mechanism, not an older image/archive.
Do not invent or substitute those missing identities. A later source requires
its own evidence even if the SQL is unchanged.

## Execution gates

1. Obtain explicit QA authorization for this concrete thirteenth migration and
   its maintenance/failure boundary. The user's QA workflow exception permits the
   mechanism, not unreviewed future schema changes. Production remains excluded.
2. Wait for the coordinator to release the host lane. Inspect actual installed
   helper/archive hashes, current revision, edge topology and current Caddy hash;
   first web activation may have changed them. Never reuse the old approval.
3. Verify the fresh export and its complete cryptographic chain; prepare a new
   private root-owned expiring approval with all thirteen name/checksum entries,
   exact source/images/artifacts/host binding and a fresh request UUID. Do not put
   host identifiers, credentials or approval records in this public repository.
4. Under the existing exclusive deployment lock, recheck TLS hostname identity,
   approved QA database, runtime DML-only grants, restricted migrator grants and
   a successful exact twelve-entry prefix. Unexpected, failed, rolled-back or
   checksum-drifted history blocks execution. Do not repair it automatically.
5. Use only the separate one-shot migrator with a temporary read-only credential
   mount. The wrapper runs the fixed `prisma migrate deploy` command with a
   five-minute bound, checks the exact thirteen-entry result and runtime grants,
   and removes the migrator/container credential before activating API/worker.
6. Verify both running immutable images and source labels, readiness/restarts,
   public live/ready/infra routes, unauthenticated session rejection and current
   OpenAPI contract. Image publication alone is not deployment evidence. Native
   broker subject verification and media/provider activation remain separate.

## Failure and no-data-loss boundary

Before DDL, abort with the existing runtime intact where the release phase permits.
After maintenance admission begins, the release helper's failure contract is
bootstrap 503 with API/worker stopped, not silent continuation or fake success.
Inspect actual state after host/Docker failure; successful cleanup is not assumed.

**Do not roll directly back to f6958c5 after migration 13 succeeds.** Its database
readiness requires an exact twelve-entry migration manifest; the added entry
would fail readiness despite additive SQL compatibility. Recovery requires a new
reviewed runtime that recognizes all thirteen migrations and the actual schema,
plus a new release approval. No compatible rollback artifact is claimed here.

Partial DDL failure requires read-only schema/history inspection and a separately
reviewed recovery decision. No reset, destructive down migration, edited generated
SQL, migration-history rewrite or automatic `migrate resolve` is authorized.
Retaining existing rows and added columns is the no-data-loss recovery boundary;
dropping the new columns or restoring a database over newer writes is not a
permitted shortcut. Backup availability and a recovery artifact are operational
preconditions to assess before execution, not evidence supplied by this document.
