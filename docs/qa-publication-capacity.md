# QA event-driven publication capacity

The independent web and backend publishers start on successful **Mobile
foundation** completion and check the exact five QA push runs. A five-minute
scheduled sweep for each component repairs a missed completion or an image push
that finished without its publication proof. Each workflow serializes runs by
source SHA; each reusable publisher also serializes its own source and component.
Every publisher builds and scans only after the five-check gate. Just before
registry authentication, it verifies that the source is still the QA head or
an ancestor of that head. The downstream export and receiver independently
verify provenance. A failed backend run cannot hide or retry a successful web
run, and vice versa.

The preflight skips a component on any trigger only when its source-tagged registry
images exist **and** a successful `qa-web-publication.yml` or
`qa-backend-publication.yml` run has its own successful aggregate job and
completion marker. Web additionally requires the
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
attempts and five attempt-job lists: **16 REST requests** per invocation. Two
five-minute sweeps on a fully green QA head make **384 REST requests and start
24 gate jobs per hour**, if GitHub starts every scheduled run. Each web sweep
also starts one lightweight web-export result job and makes one job-list REST
read, for **36 fixed Ubuntu jobs and about 396 REST reads per hour** before
marker checks. When both components changed and their
completion markers are present, preflight can add about seven REST reads per
sweep. These reads do not hold a publisher runner while waiting for checks.

One QA source with both components changed invokes four exact gates (two callers
and two reusable publishers): **64 REST requests**, plus up to four final
ancestry reads, one web-export result read, registry probes, and export
provenance reads. A literal **50 successful QA source publications in one hour**
would need at least **3,584 GitHub REST requests** from exact gates and fixed
sweeps alone (50 × 64 + 384), and roughly **3,834** before export provenance
when ancestry and result reads are included. It would create up to eight Ubuntu
jobs per changed source (two gates, two publishers, two result jobs, web export
result and archive) plus 36 fixed jobs per hour. Fifty simultaneous developers
need not produce 50 QA publications per hour, but this is **a current-volume
latency fix, not proof of 50-developer capacity**. GitHub Free's `GITHUB_TOKEN`
limit of 1,000 requests per repository per hour cannot support that literal
burst. An Enterprise 15,000-per-hour allowance would leave room for these
calls, but the total repository load and hosted queue times still need a load
rehearsal. Do not remove exact source, attempt, job, proof or image checks to
reduce API use.

The gate and recovery helper throw on GitHub API 403/429. They never turn a
rate-limited response into a successful publication; the next five-minute
scheduled sweep is the bounded recovery path after budget becomes available.

References: [GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [artifact name filtering](https://docs.github.com/en/rest/actions/artifacts#list-artifacts-for-a-repository).
