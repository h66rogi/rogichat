# Rogichat contributor rules

- This repository is PUBLIC. Inspect new files and history before every push.
- Product display name is 로기챗. Do not ship legacy brand names, assets, analytics,
  app identifiers, or user-facing links. Keep required broker URLs server-side.
- SSH private keys must stay outside GitHub, including Secrets, logs and images.
  Approved public keys belong only in PRIVATE h66rogi/rogichat-ops access manifests;
  public keys remain forbidden in this PUBLIC repository. Use OpenSSH over Tailscale.
- Work on `qa`. Production promotion is a separate reviewed change to `main`.
- Keep reference repositories read-only. Never copy their Git history, secrets,
  environment files, signing material, operational logs, or private infrastructure identifiers.
- Run `python3 tools/security/install.py` and `git config core.hooksPath .githooks`
  after cloning. Scanner absence or failure must block commit/push.
- Run `python3 tools/security/check.py all` before publishing. Do not bypass hooks,
  push protection, or add blanket scanner exemptions.
- No cloud credentials on public PR jobs. No `pull_request_target` checkout of PR code,
  self-hosted PR runners, or deployment triggered by untrusted artifacts.
- Keep Terraform state, plans, credentials and real backend config outside Git and images.
- Pin Actions to full commit SHAs and deploy container image digests.
- Implement the reviewed foundation first; feature extraction follows design review.
- Validate, commit and push your own authorized changes, then inspect remote CI.
  Report infrastructure as deployed only after verifying the running release and public route.
