# QA event-driven publication capacity

The independent web and backend publishers start on successful **Mobile
foundation** completion and check the exact five QA push runs. A fifteen-minute
scheduled sweep for each component repairs a missed completion or an image push
that finished without its publication proof. Each workflow serializes runs by
source SHA; each reusable publisher also serializes its own source and component.
Every publisher builds and scans only after the five-check gate. Just before
registry authentication, it verifies that the source is still the QA head or
an ancestor of that head. The downstream export and receiver independently
verify provenance. A failed backend run cannot hide or retry a successful web
run, and vice versa.

For the first canary, the existing QA push publishers remain enabled and
serialize with the new reusable publishers by source SHA. Their existing web
export continues until the new publication/export path is verified. This
temporary overlap retains the old runner cost; remove it in a separate
reviewed change after the new path is proven.

Each component compares the current QA source with its last **earlier proven
publication**, not merely the latest merge parent. A fixed-name artifact only
discovers candidates; the source-specific marker, exact run/attempt/result job,
and web proof must validate before a candidate becomes the base. A missing or
uncertain base becomes all zeroes, which makes the change classifier rebuild
that component. Excluding a marker for the current source keeps missing current
images or proofs eligible for recovery. Thus a missed web publication at A is
still detected if a docs-only B becomes the QA head before the next sweep.

The preflight skips a component on any trigger only when its source-tagged registry
images exist **and** a successful `qa-web-publication.yml` or
`qa-backend-publication.yml` run has its own successful aggregate job and
completion marker. Both components additionally require their original
publication proof artifact in that same run and attempt. A missing or
failed proof causes a new build and scan. A rebuilt image that differs from an
existing immutable tag fails closed and needs operator investigation.
Backend export starts from the successful backend aggregate, downloads its
exact run/attempt proof ZIP, and binds all three registry digests and scanned
config IDs to the exported archive. The archive verifier repeats that proof
comparison before host use. The export run's own head SHA may be newer than
the publication source, so its ancestry is checked separately.

The backend export also has a separate five-minute scheduled recovery. It reads
the latest page of fixed-name publication markers and selects the highest
originating run ID so a slower older publisher cannot supersede a newer one.
It checks for a successful source-specific export marker or an active export,
downloads and verifies the small original publication proof ZIP, rechecks the QA ref, and dispatches one
`backend-export.yml` run with its exact three digests and proof artifact digest.
The dispatched export independently checks the same proof before registry
authentication. Its marker is written only after the full archive upload and
becomes eligible only when that export run succeeds. This is a read-only
recovery request; it does not activate a host. A manually dispatched run with
the same complete proof is still eligible under the archive contract, so the
descriptor pins the original publication attempt and proof digest, proving
image provenance even if that publication run is later rerun.

Web export has its own five-minute recovery after a proven web publication.
It verifies the exact publication run, attempt, required-check jobs and image
proof before dispatching a missing export. An in-flight export or successful
source-specific export marker suppresses duplicate dispatch. The export repeats
the publication proof check before it reads the registry. Neither recovery
activates a host. Scheduled publication sweeps skip the export workflow's
empty result runner; if a sweep actually publishes, the export recovery
requests its export within the next sweep instead.

## Measured latency and fixed cost

Recent QA hosted runs spent about 2.8 minutes on the web build, checks, scan,
push and proof, and about 7 minutes on the backend guard, three builds, runtime
checks, scan and pushes, excluding their prior idle wait for required QA checks.
At QA `079993094f7a689a6046868a1b5e795ed9976bc9`, the legacy web publisher
held its Ubuntu `publish` job from 18:21:48 to 18:32:33 UTC while the five QA
required checks only completed around 18:31 UTC. That 10m45s run included
roughly nine minutes before the check gate was ready. The first dual-path
canary intentionally retains this cost until the legacy path is removed.
The same source's legacy backend publisher built from 18:22:26–18:24:36,
scanned from 18:24:53–18:27:23, then waited for exact checks until 18:32:05
before pushing by 18:33:08 UTC. The new path builds and scans only after the
five checks, freeing that waiting runner but moving about five minutes of
backend build and scan work after the gate. It may increase merge-to-delivery
latency even while reducing runner occupation. The B canary must measure both
runner minutes and source-to-delivery time against the 15-minute target.
The normal Mobile completion route has no scheduled wait and is the route to
measure against the 15-minute delivery target. A missed completion event can
wait up to fifteen minutes for a publication sweep, then about seven more
minutes for the backend publish before export and receiver delivery. This
recovery path does not meet that latency target. The five-minute export sweeps
keep already published images moving without spending publisher gate/API
capacity every five minutes. Hosted queue time, image cache variation, and
GitHub scheduled-event delay still need canary measurement; this schedule is
**not** a 15-minute delivery guarantee. GitHub documents that scheduled events
may be delayed or dropped under load.

The current exact-check gate reads the QA ref plus five run lists, five exact
attempts and five attempt-job lists: **16 REST requests** per invocation. Two
fifteen-minute sweeps on a fully green QA head make **128 REST requests and start
8 gate jobs per hour**, if GitHub starts every scheduled run. Each paired
web/backend sweep adds two prior-source listings and one lightweight web-export
result read, bringing the nominal
publication cost to **8 Ubuntu jobs and about 140 REST reads per hour** before
candidate verification and current-marker checks. A nearest proven prior
web/backend candidate adds about seven reads per sweep (the search examines at
most five candidates per component); checking both current completion
markers can add another seven. These reads do not hold a publisher runner
while waiting for checks.

The web export recovery adds 12 short Ubuntu jobs and about 48 baseline REST
reads per hour; validating a candidate publication adds more. The export
`publication-result` jobs are skipped for scheduled publisher events, including
quiet sweeps. Together, the scheduled workflows therefore start about **32
Ubuntu jobs and use at least 236 REST reads per hour** on a quiet, green QA
head. GitHub can delay or drop scheduled runs, so these are workload estimates
rather than timing guarantees.

One QA source with both components changed invokes four exact gates (two callers
and two reusable publishers): **64 REST requests**, plus two prior-source
listings, up to four final ancestry reads, one web-export result read, registry probes, and export
provenance reads. A literal **50 successful QA source publications in one hour**
would need at least **3,536 GitHub REST requests** from exact gates, baseline
listings and fixed sweeps alone (50 × 66 + 236), and roughly **3,786** before
export provenance when ancestry and result reads are included. Verified prior
markers, current-marker checks and other CI add more. It would create up to ten Ubuntu
jobs per changed source (two gates, two publishers, two publication results,
two export results and two archive jobs) plus 32 fixed jobs per hour. Fifty simultaneous developers
need not produce 50 QA publications per hour, but this is **a current-volume
latency fix, not proof of 50-developer capacity**. GitHub Free's `GITHUB_TOKEN`
limit of 1,000 requests per repository per hour cannot support that literal
burst. An Enterprise 15,000-per-hour allowance would leave room for these
calls, but the total repository load and hosted queue times still need a load
rehearsal. The first canary also incurs the retained legacy polling and image
builds; these figures describe the post-bridge target after legacy removal.
Do not remove exact source, attempt, job, proof or image checks to
reduce API use.

The gate and recovery helper throw on GitHub API 403/429. They never turn a
rate-limited response into a successful publication; the next fifteen-minute
publication sweep, or five-minute export sweep after publication, is the
recovery path after budget becomes available.
Each export recovery starts 12 short Ubuntu jobs per hour. Its normal sweep
uses one name-filtered publication-marker page, one source-specific
export-marker page, and two active-export run listings: roughly 48 reads per
hour before proof and ancestry checks. GitHub's artifact
API does not document its page ordering, so the first 100 marker uploads are a
bounded discovery window, not a proof that an older page has no higher run ID.
At 50 simultaneous publications a late older completion can displace at most
49 newer markers; larger backlogs require an expanded discovery mechanism.
Measure page ordering, missed events, and API calls in the 50-source canary.
Free repository token limits remain insufficient for 50 QA pushes per hour.

References: [GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [artifact name filtering](https://docs.github.com/en/rest/actions/artifacts#list-artifacts-for-a-repository).
