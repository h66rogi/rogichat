# Management webhook DNS

This root owns only `atlantis.qa.rogi.chat`, a DNS-only IPv4 record for Caddy HTTPS.
It does not own `api.qa.rogi.chat`, the zone, or production records.
Use a separate backend key `rogichat/management/cloudflare.tfstate`; provide
`zone_id` and `management_static_ip` from protected files outside Git.

Creating the DNS record does not enable Terraform execution. The gateway currently
accepts only authenticated connectivity checks. Apply needs an approved exact plan.
