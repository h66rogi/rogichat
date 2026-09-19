# Retired Lightsail root

The QA API moved to EC2 with Aurora MySQL. This deliberately empty root retains
the original provider/backend configuration to verify the retired state at
`rogichat/qa/aws.tfstate`. It must never use the EC2/Aurora backend.

Retirement removes exactly five legacy resources: the instance, imported public
key, static IP, IP attachment and firewall. No application or database data was
stored here. Apply retirement only after DNS propagation and verified Caddy HTTPS
on the new EC2, using the reviewed saved plan. Do not pass the old variable file.

Current infrastructure: [EC2/Aurora](../aws-ec2/README.md). Historical launch and
recovery configuration remains in Git history; do not restore it into active ops.
