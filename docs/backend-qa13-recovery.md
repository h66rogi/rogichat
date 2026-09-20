# Thirteen-migration source recovery candidate

This is a source-only fallback candidate, not a deployment or a feature-QA
promotion. Application capability reference: `f6958c5b344e0a50aa519c02be433c6c90477ec2`.
Schema/application-security reference: `397d2f0b59868c1a0579c92ef74a1852c5ce66e6`.
The branch starts from `597a745`, retaining the subsequent web network helper fix,
and incorporates reviewed security revision `049a197` unchanged, including
variable-length installation-token scanning. Operational helpers remain unchanged.
Do not merge this capability rollback into the active feature QA branch.

## Capability and client contract

The fixed product composition restores web OAuth and existing web/native Bearer
session, logout, authorization, messaging and sync contracts. The existing
WEB-channel predicate remains mandatory so old web callbacks cannot consume
native transactions stored by a newer release. Existing expiry, client binding,
CSRF/Origin and mixed-credential rejection remain enforced.

New native SOOP issuance/link/completion routes are absent (404), including
completion of an in-flight native login. Existing valid native Bearer sessions
continue to work until revoked or expired. There is no refresh route. Current
native clients depend on the absent issuance endpoints: a fresh login or relink
cannot succeed. This candidate is not a compatible native-login release; do not
promise login, silently substitute web cookies, or release mobile clients against
it as if native issuance were available.

New publication admission is TEXT-only; PHOTO publication fails with
`INVALID_REQUEST`. Video transform jobs fail with `INVALID_RESOURCE` before
storage reads or committed output allocation. The earlier reservation/upload
surface can still accept a VIDEO intent; upload completion does not promise
successful video processing. Clients must not promise photo publication or new
video processing. Existing authorized message/media reads are retained.

Already-created photo-copy jobs retain revocation, discard, lease fencing and
deletion cleanup. Existing DELETING media, including video, still cleans up.
Image decoding keeps the newer hardened IPC implementation. Thus this is the
earlier capability set with mandatory later safety behavior, not byte-identical
old application code and not a second installation of the newer feature release.
The candidate has an independent source/artifact identity but shares the database
driver, hardened decoder and substantial core implementation with the newer
release. It cannot be claimed to fix regressions in all shared code; deployment
requires evidence for the actual incident, not a generic rollback-safety promise.

## Security delta retained

All application deltas from the capability reference to the schema reference were
reviewed in auth, media IPC/decoder, media worker/copy, publication, deletion and
composition code. No security-bearing implementation is reverted:

| Area | Retained protection |
| --- | --- |
| Native auth | Current locking reads for concurrent login (`de02c6a`), transport/channel separation, binding/generation/recent-auth checks, one-use launch/completion, PKCE, encrypted payloads, broker redirect validation, confirmed-rollback-only retry. Native issuance implementation remains unregistered. |
| Decoder IPC | Canonical JSON, fatal UTF-8 and BOM rejection (`bd00a7f`), strict manifests, exact byte lengths, truncation/trailing-byte rejection, bounded streams and cancellation. |
| Decoder process | Credential-free child environment, bounded output/deadlines, process-group termination, shutdown draining, no-follow output opens and file/length validation. |
| Worker | Lease renewal and fail-closed unknown outcomes, immutable attempts, budget/finalization fences, source/output disposal, deletion-before-membership lock ordering. |
| Photo copies | Scratch-admission source close (`f3bace3`), independent keys, digest/length validation, authorization rechecks, discard/recovery and job fences. |
| Deletion ledger | Immutable intent storage, conditional writes, identity validation and fail-closed behavior remain unchanged. |

Full-feature safety regressions use explicit isolated test registration. Product
modules always select recovery classes; no environment switch, preview route,
role selector or synthetic runtime adapter is introduced. Normal OpenAPI export
uses product registration and omits native issuance.

## Schema and evidence boundary

`schema.prisma`, all thirteen generated migration SQL files and the manifest are
byte-identical to the schema reference. Generated Prisma Client remains build
output only. Security tooling matches reviewed revision `049a197`; CI,
Dockerfiles and operational helpers are unchanged. Runtime readiness still compares exact ledger names/checksums and
completion state; it does not detect physical-schema drift. The separate reviewed
physical-fingerprint deployment gate remains required.

The new serial disposable-MySQL test applies the original first twelve migrations,
checks API/worker rejection, applies the unchanged thirteenth, checks readiness,
then proves no-op deploy by unchanged ledger and physical fingerprint. Partial,
checksum-drift and unexpected fourteenth ledger entries must fail both entrypoints.
Additional real-MySQL product tests reject new native/PHOTO/VIDEO capabilities and
retain existing-copy/video deletion cleanup. Existing web/native transport,
logout, message, sync and feature security suites remain included.

Local build, lint and focused auth/OpenAPI/schema checks passed during preparation.
Full MySQL and full-suite results require the candidate's hosted CI result;
they are not implied by the focused checks or by this document.

## Release boundary

Any later runtime and migrator must be built from the same approved recovery
commit, with truthful OCI revision/source labels pointing to that commit, never
relabeled as either reference commit. The runtime's generated client and
migrator's schema/SQL must match this exact thirteen-migration source. Publishing
or export requires a separate coordinator decision after security/web review.
Deployment additionally requires explicit recovery approval, exact target schema
and fingerprint verification, compatible client capability handling, immutable
artifact verification, API/worker health and actual authenticated user-route
verification. No image publication, shared database change, deployment or
production readiness is established by this source PR.
