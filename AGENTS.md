# Rogichat contributor rules

## Production product requirement (all apps)

- Build the real releasable product in both QA and production. QA changes service
  configuration and data, not the product into a demo or preview application.
- Do not implement or ship preview routes, role selectors, synthetic accounts,
  fabricated conversations, fake success, or fixture-backed product adapters.
  Missing data must render an honest empty state; failed or unavailable services
  must expose the appropriate error/retry or unavailable state without inventing data.
- Synthetic fixtures belong only in isolated automated tests and must not enter
  application runtime bundles. This applies to web, API, Android and iOS equally.
- Implement real authentication, authorization, persistence and API integrations.
  Track unavailable dependencies explicitly and continue independent work.
- Deployment completion requires the running immutable artifact, health checks
  and actual user route verification; a build, preview or published image alone
  is not deployment completion.

## Mobile first principle: reuse Meloming implementations

- For Android/iOS, reuse as much applicable implementation from `meloming-android`
  and `meloming-ios` as possible. Read the corresponding source before designing
  or writing a replacement. Prefer adapting existing screens, feature flows,
  navigation, settings, shared UI, permissions and lifecycle code, including
  their useful tests. Reuse is not limited to small visual primitives.
- Record source commit/path, destination and necessary changes in
  `docs/mobile-reuse-audit.md`. For new implementations, record the concrete
  reason reuse is unsuitable. Reading a reference and rewriting it is not reuse.
- Preserve useful structure and behavior; adapt branding, product contracts,
  dependencies and platform APIs to Rogichat. An older library version alone
  is not a reason to discard reusable application code.
- The user's exclusion of Meloming chat UX/Talk/TalkV2 remains in force.
  Reference repositories stay read-only; the restrictions below on credentials,
  private configuration, legacy assets and identifiers still apply.
- Build a production-quality MVP. QA and prod use the same product composition
  and user flows, with environment-specific configuration and real account state.
  Synthetic accounts/rooms and role or access selectors belong only in isolated
  automated tests. Do not create a separate preview product composition.
- Backend blockers belong in the implementation plan. Continue independent
  product implementation without fake success, disconnected placeholder controls
  or developer diagnostics presented as finished user-facing functionality.
- Follow `docs/mobile-implementation-plan.md` for the current execution order.
  Historical wireframe/review records do not authorize shipping a demo product.

## Repository and publishing rules

- This repository is PUBLIC. Inspect new files and history before every push.
- Product display name is 로기챗. Do not ship legacy brand names, assets, analytics,
  app identifiers, or user-facing links. Keep required broker URLs server-side.
- SSH private keys must stay outside GitHub, including Secrets, logs and images.
  Approved public keys belong only in PRIVATE h66rogi/rogichat-ops access manifests;
  public keys remain forbidden in this PUBLIC repository. Use OpenSSH over Tailscale.
- Target `qa` through a task branch and pull request. The owner approved this
  repository-specific exception to the former direct-QA workflow on 2026-09-20.
  Required security/build checks must pass against current QA before merge;
  do not bypass the rules or push directly to QA. Another person's approval is
  not mandatory for this single-owner project. Production promotion remains a
  separate reviewed change to `main`.
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

## Fast completion loop

- For a review request, deliver the findings once the requested evidence is checked.
  Start implementation only when the user asks for a change or identifies a defect to fix.
- Before a UI change, identify the reference behavior and the user-visible entry,
  success, failure and recovery states. Verify the changed interaction with a
  focused reproduction before expanding the test scope.
- Use the changed paths to select focused local checks. Run independent checks in
  parallel when resources allow; rerun a full suite only when changed code or a
  concrete failure makes the prior result stale.
- If a broad suite fails, reproduce and fix the failing test in isolation, then
  run the broad suite once against the final source snapshot.
- After publishing, follow the exact commit's CI and QA delivery receipt. Wait
  on the relevant dependency with a bounded check, then investigate a stalled
  step. Prepare independent release work while CI runs instead of serially
  watching unrelated workflows. Do not repeatedly wait for unrelated tasks
  after the requested result can be verified.
- Report elapsed local validation, CI queue, CI execution and QA delivery time
  separately when evaluating speed. A faster CI run alone is not faster work.
