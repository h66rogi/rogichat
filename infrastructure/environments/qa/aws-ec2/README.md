# QA EC2 + Aurora root

Independent S3 state: `rogichat/qa/aws-ec2.tfstate`, with real backend configuration outside Git.
This root creates a dedicated network, EC2 app host and private Aurora MySQL database.
It does not import or delete the existing Lightsail resources and does not change DNS.

The initial approved plan created 28 resources. Subsequent changes require a new reviewed delta.
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
