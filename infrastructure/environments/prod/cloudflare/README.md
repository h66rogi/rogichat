# Dormant production DNS

Default `publish_dns=false`: no record is created, replaced or deleted during foundation preparation.
The existing Rogichat cutover manages `rogi.chat` and `api.rogi.chat`. A separate,
default-off Marble cutover manages exactly `marble.rogi.chat` and
`marble-api.rogi.chat`. All are DNS-only A records with TTL 300. Each cutover
requires its independently verified application EIP. Caddy terminates public
HTTPS directly.

Use the independent production backend and private zone input. Authentication stays in the
external executor environment. Existing zone records must be inspected for ownership before cutover.
A shared zone token cannot constrain QA vs production names; credentialed QA automation requires
its own record-scoped broker. This root does not alter zone settings or QA/management DNS.

Keep `publish_marble_dns=false` until the Marble host, Caddy configuration and
both HTTPS routes have passed private readiness checks. Supply `marble_static_ip`
only through the private operator input. Review a saved plan that contains exactly
the two expected creates and no changes or deletes before applying that plan.
