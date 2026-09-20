# Optional deletion ledger copy destination

Default `ledger_copy_principals = {}` creates no resources and leaves the bucket
policy unchanged. Enabling either qa or production with approved exact role/user
principals creates two roles and two inline policies per environment, and adds four prefix-only
deny statements per environment to the existing bucket policy. No compute, existing role,
endpoint, encryption, versioning, lifecycle, or reaper changes are intended.
Private operators must supply bindings outside public source and review an exact
plan. No apply authorization follows from this source.

Writer: conditional single PutObject and same-prefix GetObject/GetObjectVersion
for exact-key response-loss recovery; no list/delete/admin. Verifier: same-prefix
GetObject/GetObjectVersion and prefix-bounded ListBucket/ListBucketVersions;
no write. Trust principals are exact role or user ARNs, not account roots.
The same approved operator may assume each separate destination role; use separate
sessions and execution capabilities. This is not independent administrative custody. These new roles receive no AssumeRole or PassRole grants.

All writes require literal If-None-Match `*`; missing/wrong conditions, server-side
copy, and deletes are denied at the ledger prefixes. Multipart initialization is
intentionally denied (no ObjectCreationOperation exemption). Use small body-free
records in a single PUT, not SDK transfer-manager multipart or CopyObject.
Existing canary egress cannot reach ledger prefixes; use a separately reviewed
operator execution lane, do not expand the canary endpoint.

Versioning and conditional creation are not WORM: administrators may change
policy, and lifecycle can remove evidence independently of a bucket-policy deny.
No new lifecycle is introduced. Keep records at least 31 days and until linked
backups/exports are gone and no restore is running; retirement and minimal
anti-recreation markers require separate review. No cross-account or latest
admission completeness claim follows from a copy or signed inventory.

Reviewed AWS docs (2026-09-20):
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html
- https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition_operators.html

AWS documents the header keys and multipart exemption; this design omits the
exemption deliberately. If-None-Match tests the current version, so a current
delete marker permits recreation. 412 is a conflict, not automatic success;
read the exact bytes/version and compare with the independently held source.
409 or ambiguous transport failure requires bounded reconciliation, never an
unconditional retry. AWS's enforcement page and newer conditional-write page
disagree on CopyObject support; this interface explicitly denies copy requests.

Offline validation (pinned Terraform, no credentials/backend):
```
terraform init -backend=false -input=false -lockfile=readonly
terraform validate
terraform test -json -verbose > /private/path/mock.jsonl
python3 test_ledger_copy_policy.py /private/path/mock.jsonl
```
The JSONL contains mock state and must remain outside Git. The Python evaluator
covers only emitted policy operators, not AWS's full authorization engine.
Actual provider behavior, trust reachability, SCPs/session/endpoint policies,
retention and independent custody remain operator acceptance gates.
