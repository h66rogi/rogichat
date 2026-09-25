# QA event-driven publication capacity

The new publisher starts on successful **Mobile foundation** completion and
checks the exact five QA push runs. A five-minute scheduled sweep repairs a
missed completion or an image push that finished without its publication proof.
The source SHA has one serialized caller concurrency group; web and backend
reusable publishers each have a separate source-and-component group. Every
publisher builds and scans only after the five-check gate. Just before registry
authentication, it verifies that the source is still the QA head or an ancestor
of that head. The downstream export and receiver independently verify provenance.

The scheduled preflight skips a component only when its source-tagged registry
images exist **and** a successful `qa-publication.yml` run has the corresponding
successful aggregate job and completion marker. Web additionally requires the
original publication proof artifact in that same run and attempt. A missing or
failed proof causes a new build and scan. A rebuilt image that differs from an
existing immutable tag fails closed and needs operator investigation.

## Measured latency and fixed cost

Recent QA hosted runs spent about 2.8 minutes on the web build, checks, scan,
push and proof, and about 7 minutes on the backend guard, three builds, runtime
checks, scan and pushes, excluding their prior idle wait for required QA checks.
The five-minute sweep gives a nominal worst-case detection plus backend publish
time of about 12 minutes, before export and receiver delivery. A 10-minute sweep
would take about 17 minutes by the same measurement and miss the 15-minute
target. The normal Mobile completion route has no scheduled wait. Hosted queue
time, image cache variation, and GitHub scheduled-event delay still need canary
measurement; this schedule is **not** a 15-minute delivery guarantee. GitHub
documents that scheduled events may be delayed or dropped under load.

The current exact-check gate reads the QA ref plus five run lists, five exact
attempts and five attempt-job lists: **16 REST requests** per invocation. A no-op
sweep therefore makes at least **192 GitHub REST requests and starts 12 gate jobs
per hour**. Each sweep also starts one lightweight web-export result job; when
both components changed and completion markers are present, preflight can add
about seven GitHub REST reads per sweep. These reads do not hold a publisher
runner while waiting for checks.

One QA source with both components changed can invoke the gate in the caller
and each publisher: **48 REST requests**, plus up to four final ancestry reads,
one web-export result read, registry probes, and export provenance reads. A
literal **50 successful QA source publications in one hour** would need at
least 2,592 GitHub REST requests from these calls alone (50 × 48 + 192), and up
to roughly 2,842 before export provenance when adding ancestry and result
reads. That exceeds the GitHub Free `GITHUB_TOKEN` primary limit of 1,000
requests per repository per hour. It would also create up to seven Ubuntu jobs
per changed source (gate, two publishers, two result jobs, web export result and
archive) plus two lightweight jobs per sweep. Fifty simultaneous developers
need not produce 50 QA publications per hour, but that burst is **not supported
by this design**. Before raising QA merge throughput to that level, batch or
cache exact-check reads under a reviewed trust model, or use a narrowly scoped
GitHub App with a measured higher budget. Do not remove the exact source,
attempt, job, proof or image checks merely to reduce API use.

References: [GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [artifact name filtering](https://docs.github.com/en/rest/actions/artifacts#list-artifacts-for-a-repository).
