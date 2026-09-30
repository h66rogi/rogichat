# Repository disclosure guard

Run `python3 tools/security/install.py` after cloning, stage the intended changes,
and run `python3 tools/security/check.py all` before publishing. The hooks check
the exact index at commit time and the complete outgoing candidate history at
push time. The pre-push hook receives Git's actual outgoing refs and checks each
pushed branch tip or tag separately, including when another branch is checked
out. CI must fetch complete history. A shallow checkout fails closed.
The separately dispatched Public exposure audit runs `python3 tools/security/fetch_public_refs.py`
to fetch all advertised public PR refs anonymously and check object integrity,
then `python3 tools/security/check.py audit` across every locally reachable ref.
It validates the exact repository/origin, rejects credential-bearing HTTP config
and URL rewrites, disables prompts/helpers, and never executes fetched PR code.
It forwards only basic process environment variables and refuses an existing
`~/.netrc` or `~/_netrc` without reading it, because Git/libcurl can implicitly
use those credentials. Use the clean manual CI audit when such a local credential
file is present. It never changes `HOME` or the credential files.
Local hooks do not initiate network access; run that helper explicitly when an
up-to-date public PR history audit is needed.
Do not make this exhaustive untrusted-PR audit a required QA merge/publication
gate: one unrelated malicious fork PR would otherwise block every normal change.
The required Security workflow checks the candidate's exact index and every
commit/tree reachable from its checked-out `HEAD`. It also scans the current
branch name, GitHub's candidate ref names, and tags whose target objects are
reachable from that history. Other fetched branches, their names, and tags
pointing only into those branches belong to the separate full audit. Each
candidate PR must pass its own checks. A sibling PR's unreviewed binary or
secret therefore cannot block a clean candidate's required gate, but its own
candidate gate and the full audit detect it. An audit failure requires private
triage and does not authorize ignoring a failure in the candidate itself.

The repository guard (`check.py`) uses the checksum-pinned Gitleaks release and
its default detectors, plus the repository's public-key and GitHub
installation-token detectors. The repository guard rejects policy changes that
do not match the reviewed rule structure, index/worktree policy differences,
implicit ignore files, scanner environment overrides and inline exemptions.

The additive installation-token rule covers `ghs_` legacy and variable-length
formats with a 36-character minimum suffix, no upper length or assignment
requirement, and no leading word boundary. Tokens remain detectable next to
other literals, including in minified or compiled content. The independent image
scanner (`image_scan.py`) embeds the same rule and scans image layers and
configuration, including decoded content; regression tests check rule parity.
Errors omit filenames, file contents and raw scanner diagnostics. Inspect a
failure privately; do not upload unredacted diagnostic output to an issue.

Current index and every historical tree in the selected scope are checked for
forbidden paths, including files subsequently deleted or renamed. Unique
historical blobs, commit messages, relevant annotated tag messages, selected ref
names and file names are scanned. `audit` retains the original all-refs scope,
including tag-only blobs and trees.
Operational Terraform state and plan JSON are prohibited by structure even when
renamed. Ordinary JSON contracts, HCL source, backend examples and SQL migrations
remain supported. Git refs that were never fetched, unreachable objects and
external artifacts are outside this repository command's coverage.

Source archives and packaged build outputs are rejected by path and content
signature. A renamed, malformed or oversized archive does not become a skipped
scanner input. The only archive exception is the exact upstream Gradle wrapper
at `apps/android/gradle/wrapper/gradle-wrapper.jar`, bound to its reviewed SHA-256
and bounded ZIP integrity check. The checksum is published by
[Gradle](https://services.gradle.org/distributions/gradle-9.8.0-wrapper.jar.sha256).
A Gradle upgrade requires verifying the new upstream artifact and reviewing the
pin change together. The history scan retains the previous reviewed checksum,
while the current index requires the new checksum. Do not allow all JAR files or
all files in that directory.

UTF-8 source and structurally checked PNG assets are supported. PNG text, EXIF,
unknown chunks, invalid checksums and trailing payloads are rejected. The five
official NanumSquare Neo static WOFF2 files are separately bound to exact source
paths, published SHA-256 values, and minimally valid WOFF2/TrueType headers; a
changed or renamed font fails closed. New binary asset formats need a reviewed
validator; build products belong in the separate artifact/image validation and
distribution path. This does not prevent builds from producing local ignored
archives, native packages or generated files.

Limits are explicit: 16 MiB per blob, 512 MiB total materialized input, 25,000
objects/commits/materialized files, 64 nested annotated tags, 120 seconds per Git command and 600 seconds for Gitleaks.
Exceeding a limit blocks publication rather than dropping coverage. Raise a
limit only with an accompanying capacity and negative-test review. Decode depth
is five; the approved wrapper's archive depth is two. Arbitrary programmatic
secret reconstruction and image steganography require human review and are not
claimed to be solvable by these detectors.

The isolated regression suite generates disposable keys and fake tokens at run
time. No real key, token or operational Terraform document is a committed test
fixture. Run it with:

```sh
python3 -m unittest discover -s tools/security -p 'test_guard.py'
```

These local checks are accidental-disclosure protection. Someone able to edit
and execute the checker can change it; independently enforced CI and review of
security policy changes remain necessary.
