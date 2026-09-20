# Automatic backend release: commissioned web preservation

This source-only follow-up depends on the manual release helper change
`9d336104fc748de586c70423f3fa07c3566a453b` and its
[reviewed topology contract](qa-backend-deployment.md). The automatic script must
load that reviewed helper (or a separately reviewed compatible successor) using
its exact private policy SHA-256 pin. Older helpers without callable
`snapshot_edge` and `verify_web` fail closed; there is no compatibility bypass.

The existing fixed `/run/lock/rogichat-deploy.lock` covers preparation and
activation. Preparation captures the helper's Caddy/web topology and verifies
commissioned web. Activation compares that same snapshot and checks web before
creating the request directory or consuming the request, after candidate health,
before writing current state/completion, and after fail-closed shutdown. Each
activation gate compares topology again after the route probes. Rollback
verification also runs when fail-closed shutdown raises; a failed maintenance
reload still attempts to stop both API and worker through the reviewed helper.
This is fail-closed shutdown, not automatic restoration of an older runtime.

The helper preserves Caddy identity, image, host configuration, mounts, network
identities, bootstrap Compose bytes, site imports and commissioned web identity.
It rejects unexpected networks and writable sites mounts. Commissioned web must
pass its health route, page and a same-origin referenced static asset. Prepared
but empty web topology remains distinct and makes no deployed-web or route-proof
claim. Backend health/completion does not prove authentication or full web E2E.

QA-only schema equality, exact current QA/source and hosted CI checks, archive
provenance and OCI identities, template/policy hashes, request expiry/replay
protection, fixed host lock and pinned helper loading remain unchanged. This
change grants no migration or credential authority and installs nothing on a host.

## Isolated validation

Run only the focused Python classes for this source review:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/operations python3 -m unittest test_backend_automatic.AutomaticTests test_backend_automatic.AutomaticEdgeTests -v
python3 tools/security/check.py all
```

The focused tests use temporary local files and mocked Docker, HTTP and systemd
boundaries. They cover preparation/activation drift, activation topology changes,
real helper rejection of unexpected networks and writable mounts, missing helper
capabilities, web route failure before completion, real fail-closed shutdown with
a failed Caddy reload, normal success and prepared-empty web without fabricated
route proof. No Docker, network, database or host deployment is exercised by the
Python tests. Hosted CI remains separate evidence against the published head.

## Private integration consequences

Before any operational activation, the parent integration owner must separately
review and install the automatic script and manual helper bytes, update the
private `release_helper_sha256` pin and applicable delivery manifest hashes,
recompute the canonical policy SHA-256, and issue a fresh request bound to that
policy and exact current QA/CI/OCI evidence. Installed old pins must never be
weakened. The web automatic policy also pins the Git blobs under
`tools/operations/`, including tests: both files changed here require its separate
review/regeneration before accepting subsequent web candidates. No private
policy, controller, host file or installation is changed by this PR.

The draft QA PR depends on the manual helper review; do not merge or deploy it
until that dependency and exact current-QA checks have been resolved by the
parent. Source tests and hosted CI are not proof of a running release or public
route availability. Operational rollout and immutable-artifact verification are
outside this task.
