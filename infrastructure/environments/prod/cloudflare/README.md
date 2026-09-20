# Dormant production DNS

Default `publish_dns=false`: no record is created, replaced or deleted during foundation preparation.
The only supported future records are `rogi.chat` and `api.rogi.chat`, DNS-only A records with TTL 300.
The verified production EIP is required when enabling them. Caddy terminates public HTTPS directly.

Use the independent production backend and private zone input. Authentication stays in the
external executor environment. Existing zone records must be inspected for ownership before cutover.
A shared zone token cannot constrain QA vs production names; credentialed QA automation requires
its own record-scoped broker. This root does not alter zone settings or QA/management DNS.
