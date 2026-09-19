# Atlantis connectivity stage

This deployment is deliberately **version-only**. It does not run Terraform and is
not the completed infrastructure automation worker. Public source CI remains
credential-free; the App is selected for private `h66rogi/rogichat-ops` only.

- Atlantis and the webhook gateway listen through loopback. Reach the basic-auth
  UI with an operator SSH port forward, using the private inventory and pinned host
  key. Do not add public or tailnet-wide rules for ports 4141/4142.
- Caddy's optional `edge` Compose profile exposes only POST `/events` on HTTPS.
  HTTP is for ACME and redirect. Other HTTPS paths return 404; no public UI/logs.
- The gateway verifies HMAC, exact private repo/installation, fresh actor and PR
  data, and durable delivery **and signed-body** deduplication. A fixed eight-thread
  limit bounds concurrency; Caddy bounds body/header receive time and body size.
- Only the exact `atlantis version` command is forwarded. Push, edited comments,
  and other PR events never launch code. Invalid requests get fixed text. Atlantis
  separately disables all commands except version, discovery, autoplan, custom
  workflows, overrides and Terraform downloads. All workflow hooks fail closed.
- App credentials live under root-owned `/etc/rogichat-atlantis` on encrypted EBS.
  Atlantis requires write-git-creds for App authentication; its Git credential
  helper/config lives in a private HOME tmpfs, separate from persisted plan/lock data.
  The container receives its App key read-only; systemd uses LoadCredential for the
  gateway. Neither receives operator SSH private keys, Cloudflare credentials,
  Terraform state or a cloud apply role. The EC2 instance role remains SSM-only.
- ApprovalStore is tested scaffolding, **not an enabled authorization service**.
  Plan/apply still require an isolated worker, constrained cloud/broker permissions,
  saved-plan storage, authenticated operator approval and negative live API tests.

`tools/automation/register_app.py` implements a one-shot loopback manifest exchange.
Its output directory must be new and outside Git. App registration starts with the
webhook inactive. The App requires Contents/Issues/Metadata read and PR/Statuses
write; Issues read is necessary for GitHub's issue_comment event subscription.
No Actions, administration, Secrets, organization membership, or Contents write
permission is requested. API probes verified PR reads and actor permission queries.

Do not copy live credentials into sample files or use a repository push to update
server-owned policy. The private ops installer explicitly deploys reviewed source
blobs from a full commit SHA through pinned operator SSH. Opening ingress and
activating the hook remain separate from installing this connectivity stage.

References: [GitHub App manifests](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest),
[Atlantis security](https://www.runatlantis.io/docs/security).
