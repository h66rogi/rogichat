# Dormant production DNS

Default `publish_dns=false`: no record is created, replaced or deleted during foundation preparation.
The only supported future records are `rogi.chat` and `api.rogi.chat`, DNS-only A records with TTL 300.
The verified production EIP is required when enabling them. Caddy terminates public HTTPS directly.

Use the independent production backend and private zone input. Authentication stays in the
external executor environment. Existing zone records must be inspected for ownership before cutover.
A shared zone token cannot constrain QA vs production names; credentialed QA automation requires
its own record-scoped broker. This root does not alter zone settings or QA/management DNS.

`publish_auth_dns=false` independently keeps `auth.rogi.chat` dormant. Enabling it
requires `publish_dns=true` and reuses `production_static_ip`; the separate `auth[0]`
resource adds one DNS-only A record, TTL 300. The existing `production` resource
and its addresses remain unchanged. Against already-managed production records,
the reviewed plan must be **one create, zero updates, zero deletes**; stop on any
other diff or pre-existing auth record until ownership is reconciled. Mock tests
are source checks, not proof of a live plan or EIP ownership.

Before enabling DNS or forwarding, the central operator must verify the dedicated
SOOP 로기챗 app display and exact callback
`https://auth.rogi.chat/v1/platform/oauth/rogichat/callback`, the existing production
EIP, ACME reachability, and private listener/source bindings. See
[auth templates](../../../runtime/auth/README.md). This source change performs no
DNS apply, provider registration, shared virtual-host edit, or live deployment.
