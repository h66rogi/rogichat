# macOS Orca disk preservation guard

This first rollout measures disk pressure and reviews worktrees. **It does not delete
worktrees, dependencies, build artifacts, branches, AI history, or user data.** No
reviewed, reproducible, exclusively inactive deletion target was available at rollout.
Even a future `completed` card is insufficient to authorize automatic deletion.
Reclamation remains deferred until a concrete target passes the preservation review.
The only automatically removed files are this guard's own rotated logs.

## Behavior

- One macOS user LaunchAgent samples at minute 00 and 30. It starts once at installation;
  sleeping or logged-out Macs cannot promise exact wall-clock execution. Missed sleep
  intervals coalesce on wake. No AI task is launched.
- Normal samples use volume statistics and swap only. Detailed review runs every two
  hours, or at each sample below 20 GiB. Manual `--audit` requests a detailed review.
- One nonblocking `flock` covers both scheduled and manual execution. A crash releases
  the lock. Inventory failures preserve everything and return nonzero.
- Review compares Orca repo/worktree lists, runtime activity and terminal inventory
  against Git worktrees and direct directories under configured roots. It records
  HEAD/branch, tracked changes, untracked paths, commits absent from *other* local refs,
  open files/cwd processes and sizes. Git uses `GIT_OPTIONAL_LOCKS=0`; it never fetches,
  prunes, resets, cleans or changes working files. Detached HEADs are included.
- `lsof` is current-user visibility, not proof that all other users or processes are
  absent. Snapshots are sequential and may change during running AI work. A skipped or
  inaccessible scan is uncertainty, never eligibility. Remote-host inventories are
  not treated as local. Folder contexts outside measurement roots retain status evidence
  but do not get a recursive size scan.
- `node_modules`, build-like directories and lockfiles are inventoried, not authorized
  for deletion. Symlinks are reported without traversing their targets. No ignored-file
  deletion occurs. `du` totals are allocated-byte estimates; APFS clones, sparse files,
  shared/hardlinked dependencies and concurrent writers can make actual reclaim differ.
- Records include timestamps, remaining space, review targets/reasons and zero reclaimed
  bytes. Subsequent reviews calculate per-worktree size changes. Capacity history retains
  336 samples (about seven days), and each JSONL log rotates at 1 MiB with three backups.
  Individual JSON snapshots are replaced in place. Operational records stay local and
  must not be committed to this public repository.
- Below 20 GiB warns; below 5 GiB is urgent. Native macOS notifications occur only on
  state transitions (including sustained decline), never for normal unchanged state.
  Alerts are also durably logged. Desktop delivery depends on macOS notification settings.
  Repeated identical failures do not flood notifications.
- At least three readings over an hour, all declining, are needed for estimated 20 GiB
  and exhaustion times. These are extrapolations, not guarantees. Short first-session
  measurements cannot establish a sustained depletion forecast.
- No external-volume writes or archival copies occur. An absent `/Volumes/...` mount is
  recorded as unavailable, never interpreted as free space on the root disk.

## Installation

Python 3.10+ and the currently installed Orca CLI are required. Read its installed
`orca skills get orca-cli` guide and inspect existing launchd/crontab/Orca/Codex schedules
first. The installer refuses an existing installation instead of restarting it.

Create a private JSON config outside the repository with `orca` (absolute executable),
`state_dir`, `volumes` (internal first, external mount roots after it), `workspace_roots`
(direct parents of worktrees), `measure_roots` (allowed recursive-measurement roots), and
`notifications` (boolean). Do not commit machine paths or operational snapshots.

```sh
python3 -m unittest discover -s tools/disk_guard -p 'test_*.py'
python3 tools/disk_guard/guard.py --config /absolute/private/config.json --audit
python3 tools/disk_guard/install.py --config /absolute/private/config.json
launchctl print gui/$(id -u)/com.rogichat.orca-disk-guard
```

Confirm the installed hash receipt, launchd calendar entries, successful actual launchd
execution and fresh `state.json`/`capacity.jsonl`. A loaded plist alone is not verification.
Check Orca readiness, original terminal handles/connections and `codex --version` without
sending terminal input or starting an AI session.

## Deferred destructive operations and external worktree placement

There is deliberately no `--force`, deletion allowlist or delete command in this rollout.
Before implementing reclamation, require explicit completion, no live/resumable or
uncertain session, clean tracked/untracked state, independent commit preservation,
verified reproduction instructions/lockfiles, protected-data checks, complete process
visibility and a fresh identical state immediately before removal. Any changed evidence
must skip the whole worktree. Never infer completion from age or CPU usage.

Installed Orca 1.4.205 documents `worktree rm --run-hooks` as its official removal path,
with failure blocking on archive-hook errors. It also attempts to delete local branches,
which conflicts with the branch-preservation requirement. Therefore do not invoke it,
`--force`, `--allow-failed-archive-hook`, or a direct filesystem-removal substitute.

The installed CLI supports `project setup-update --setup <id> --worktree-base-path
<external-path>` for future worktree placement. This is a separate proposed change;
never move active worktrees or replace them with symlinks. Validate actual mount identity,
free space and checksums before any future archive, and retain source until verification.
Windows monitoring and all existing services are outside this tool's mutation scope.
