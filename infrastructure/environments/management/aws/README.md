# Management EC2 foundation

Dedicated VPC, no peering to app/DB, no public inbound ports. Ubuntu 24.04,
`t3a.small` (2 vCPU / 2 GiB), encrypted gp3 30 GiB, one public IPv4, SSM recovery,
operator public key supplied from private ops. No private key in GitHub/user-data.
State: `rogichat/management/aws.tfstate`, backend inputs outside Git.

This provisions the management host only. It does **not** enable Atlantis,
a cloud apply role, a self-hosted Actions runner, webhook, or automatic deployment.
See [management design and activation gates](../../../atlantis/management.md).
The user approved its exact 15-resource creation plan and recurring cost; applied
on 2026-09-20. Atlantis activation remains a separate verification step.
