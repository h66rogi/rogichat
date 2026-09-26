# QA EC2 + Aurora root

Independent S3 state: `rogichat/qa/aws-ec2.tfstate`, with real backend configuration outside Git.
This root creates a dedicated network, EC2 app host and private Aurora MySQL database.
It does not import or delete the existing Lightsail resources and does not change DNS.

The initial approved plan created 28 resources. Subsequent changes require a new reviewed delta.
The app root volume is 120 GiB in live AWS; Terraform records that observed
size so later network changes do not attempt an impossible shrink to 80 GiB.
Apply requires the reviewed source SHA,
saved plan digest and explicit approval. See [transition and cost review](../../../../docs/ec2-aurora-review.md).

After apply: verify SSM Online, cloud-init completion, host firewall, SSH policy, pinned key,
Docker/Compose, Tailscale enrollment, Aurora availability and TLS. Caddy is deliberately staged
without starting until a separately reviewed Cloudflare DNS cutover. Read the master secret
only through an authorized operator session; provision an app-scoped user before deployment.
The EC2 instance role cannot read the DB admin secret.

Aurora has one writer and no failover reader. The separate restore-drill root exercises
backup recovery; its disposable copy never replaces the live source. Lightsail has been retired.

Provisioned and verified on 2026-09-20. API DNS now points at EC2; Caddy HTTPS
was verified before retiring the five legacy Lightsail resources. Reconciled bootstrap
accounts for SSM-first SSH socket activation. Tailnet DNS is deliberately not accepted on this
AWS workload: its RDS endpoints use native VPC DNS. Enrollment must preserve these preferences:
`tailscale up --hostname=rogichat-qa --accept-dns=false --accept-routes=false --ssh=false`.
Operator approval through the sign-in URL is required; never commit an auth key or sign-in URL.

The QA and management EIPs permit direct Tailscale UDP 41641 only from each
other's current `/32`. Both Terraform security groups and the host UFW rules
must agree; SSH and app ports remain tailnet/HTTPS only. The peer EIP is looked
up by its unique AWS `Name` tag, so its address is not copied into public
source. After applying a reviewed one-rule Terraform delta and the matching
host UFW rule, verify `tailscale ping` reports `direct` in both directions and
recheck the QA web/API routes. Remove the narrow rules if direct connection
does not establish; do not broaden their CIDRs or open UDP to the Internet.
