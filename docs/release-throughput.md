# QA release throughput

The QA release jobs classify changed tracked paths before building images. Changes
under `apps/web` publish the web image; changes under `apps/api` publish the API,
migration and decoder images. Shared build, workflow, security and operations
inputs publish both, except the web verification, publication and export workflows,
which affect only the web pipeline. Unknown paths also publish both. Mobile and
documentation
changes publish neither. `apps/api/package.json` is shared because the web
Dockerfile copies it. The fixed web release helper, its tests and operator guide
affect only the web pipeline; changes to other operations tools remain shared.
An unavailable Git comparison publishes both.

The five required source checks also run for GitHub merge groups targeting QA or
production. Component and mobile change detection compares the merge group's
base SHA with the checked-out group head, so a batch is evaluated as one candidate.
Backend and web groups run their pre-merge container safety checks when those
components change. Their required aggregate jobs still report a stable result
when a component is unchanged. Merge group checks do not publish images; only a
trusted QA push starts publication. After the PR's five required checks pass,
`python3 tools/automation/enqueue_qa_pr.py <PR_NUMBER>` enters the QA merge
queue. It reads the exact current PR head and uses GitHub's `enqueuePullRequest`
mutation with `expectedHeadOid` and `jump: false`. A changed head is rejected by
GitHub; an already queued PR is reported without another mutation. This keeps
repository-wide auto-merge disabled, because production promotion to `main` has
a separate review policy. The queue reruns the required checks on its synthetic
commit before updating QA.

The Security workflow runs the scanner test suite for every PR and QA push.
Web container verification and publication each scan their actual image layers;
they do not rerun the scanner's fixture suite. The publisher still requires the
exact successful Security workflow run before registry authentication.

Web and backend verification have stable required job names even when their
component is unchanged. Backend static checks and four disposable MySQL
integration shards run concurrently. A shard owns a separate database and every
integration test file is selected exactly once. On pull requests, container
checks still build and scan each relevant image. On QA pushes, the web publisher
builds, checks and scans the image while source verification runs, waits for the
exact successful source checks, then authenticates to the registry. This removes
the duplicate QA web container build. The backend publisher follows the same
ordering. A skipped web publisher does not start an export.

An exact `apps/api/Dockerfile`-only change runs the backend image safety gate
without repeating application static and MySQL tests; it changes image assembly,
not the application source those tests execute. Mixed or unknown backend inputs
still run both test jobs. The backend required check remains stable, and image
safety is still mandatory before merge.

Docker builds use a BuildKit cache mount for the pnpm download store. It is
discarded from image layers. Pull request container jobs record cold and warm
build durations and uncompressed runtime image sizes in their job summaries;
publisher jobs record release build durations and sizes. Export jobs record the
transport tar sizes. Compare several runs of the same target, including a cold
runner and a changed dependency lockfile, before changing the image base or
transport format. The image scanners and isolated runtime checks remain gates.

The migration target installs pinned Prisma CLI and MySQL driver dependencies
in a separate workspace package, then combines them with production API
dependencies, compiled migration hooks, schema and migrations in a slim Node
image. It excludes build tooling and development dependencies. PR image checks
require the actual CLI, schema engine, driver, compiled migration manifest and
default room initializer, plus an image smaller than 1 GB (the original image
was 1,670,142,141 bytes). Publication repeats runtime checks before login.

The trusted QA receiver may reuse an earlier web artifact only if its source is
an ancestor of the current QA head and every web release input has the same Git
blob and file mode. The operations repository owns that policy. Deploy the
reviewed receiver/poller generation together with the public workflow change;
otherwise the old poller will report `not-ready:autoexport` after a backend-only
QA push. Publication, export and a successful workflow do not by themselves
prove the running host version; verify its receipt and route separately.
