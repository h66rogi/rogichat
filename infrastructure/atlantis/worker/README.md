# Disposable worker isolation canary

Status: **applied and live canary verified on 2026-09-20**. All 25 additions
completed with no existing resource changes/deletions; the post-apply plan is empty.
All 12 diagnostic checks passed on one disposable EC2, and termination, root-disk
deletion and absence of remaining worker network interfaces were verified.
Atlantis remains in connectivity-only mode. This worker runs fixed diagnostics, never Terraform,
repository code, provisioners, hooks or downloaded executables.

The source lives here and in
[`management/worker`](../../environments/management/worker). Private ops records
the reviewed public SHA, exact saved-plan digest and, after apply, the live launch
template ID, numeric version and complete configuration digest. The operator-only
private `tools/run_worker_canary.py` requires a clean, approved ops commit. Neither
a public PR nor a private merge launches a worker.

## Applied resources

The approved and applied full plan had 25 additions and no modifications/deletions:

| Purpose | Resources |
| --- | ---: |
| Dedicated VPC, subnet, route table/association, SG/egress, S3 gateway endpoint | 7 |
| Private S3 bucket, public access block, ownership, encryption, versioning, lifecycle, TLS policy | 7 |
| Canary role, write-only policy, instance profile, launch template | 4 |
| Reaper role/policy, Lambda, logs, schedule/target, invocation permission | 7 |

No existing VPC, application, Aurora, DNS or management role changes. No NAT,
public IPv4, peering, SSH key, Tailscale enrollment or always-running worker.
The launch template pins Amazon's AL2023 standard AMI and t3a.small with 8 GiB
encrypted gp3, standard CPU credits, IMDSv2 and delete-on-termination storage.
The role can only put objects in this dedicated bucket's `canary/` prefix. It
cannot read state/secrets/artifacts or modify infrastructure.

The independent reaper runs every five minutes. Its code selects only matching
tags **and** this launch template, then terminates canaries at least 20 minutes
old. IAM independently limits termination to the canary tags in this account and
region. It can describe account-wide EC2 instance metadata in Seoul because that
API does not support per-instance resource restriction. It has no tagging,
launching, IAM, SSH, application or database permissions.

An additional guest timer powers off after 15 minutes; EC2 shutdown terminates
the instance. The operator launcher also cleans up in `finally` and verifies
termination. The live canary completed and shut down before the guest deadline;
the scheduled reaper was invoked successfully with zero expired instances. A
forced guest-failure/expired-instance cleanup drill has not yet been performed. The AWS reaper remains effective if the guest never boots or the
operator disconnects. The typical fallback window is 20–25 minutes; AWS scheduler
or service failures can delay this, so this is not a guaranteed spending cap.

## Verification before declaring isolation successful

The trusted guest uses a non-root systemd unit with empty capabilities, protected
filesystem, no new privileges, limits and explicit IPv4/IPv6 IMDS denial. A root
IMDS positive control proves the endpoint was available for the negative test.
Any successful TCP connection to IMDS fails the test, including an unauthorized
HTTP response. A failed/unsupported systemd sandbox fails closed.

Additional checks require failed TCP connections to the public Internet and the
existing app/management addresses. S3 probes must show actual `AccessDenied`, not
timeouts. The read probe first creates a harmless object and then verifies it
cannot read that existing object. Only fixed labels and booleans enter the private
result. The launcher requires **all 12 exact checks** and verified termination.
No result, malformed/partial result or unexpected instance/template is failure.

S3 gateway access has no additional endpoint hourly charge. EC2/EBS accrue only
while the canary exists; S3, Lambda, EventBridge and logs are usage-priced. The
private plan review records current regional prices. Diagnostic objects expire
after seven days (noncurrent versions after one further day); logs retain seven
days. No logs or results are published to GitHub.

## Still required before credentialed plan/apply

This canary is evidence for a network/OS boundary, **not** proof that untrusted
Terraform is safe to execute. In particular:

- VPC resolver DNS is not blocked by security groups. DNS egress filtering must be
  installed and tested before a worker receives state or cloud credentials.
- The diagnostic role has prefix-wide write access; real jobs need per-job
  credentials, immutable artifacts and saved-plan digest checks.
- AWS API access, scoped QA read/apply roles and bootstrap/IAM ownership still
  need separate plans. The worker currently cannot contact those APIs at all.
- Source/archive/provider validation, durable SHA/state/plan-bound operator
  approval, serialization and revocation must be connected to the executor.
- Cloudflare requires a QA-record-restricted broker; the zone-wide token must
  never be passed to untrusted code. Management must never execute PR source.
- IAM launch-template conditions do not freeze every parameter, such as user
  data. Only the trusted operator launcher is used here; no RunInstances or
  PassRole rights are added to Atlantis or the management role.

References: [AWS launch-template authorization](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/use-launch-templates-to-control-launching-instances.html),
[EC2 IAM examples](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ExamplePolicies_EC2.html),
[S3 gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html),
[AL2023 standard packages](https://docs.aws.amazon.com/linux/al2023/ug/amzn2-al2023-ami.html).
