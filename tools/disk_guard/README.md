# macOS Orca disk preservation guard

The guard monitors pressure and can archive then remove **root `node_modules` only**
from explicitly completed, inactive, clean worktrees. It never removes a worktree,
branch, conversation, source file, credential, database or uncertain result. Missing
proof always preserves the whole worktree. Other build directories are inventory-only.

## Schedule and monitoring

One user LaunchAgent samples at minute 00 and 30, without starting AI sessions. Normal
samples only query capacity and swap. A detailed review runs every two hours, or each
sample below 20 GiB. `--audit` requests a manual review; actual cleanup remains limited
to one attempt per two hours unless free space is below 20 GiB. A nonblocking `flock`
serializes both manual and scheduled work. Crashes release the lock. Sleep/log-out may
delay execution; launchd coalesces missed sleep intervals on wake.

Review compares Orca registration, runtime and terminals with Git worktrees and actual
directories. It records HEAD/branch, all nonignored tracked/untracked changes, commits
absent from other local refs, sizes, build-like directories, lockfiles, open files/cwd
processes and mismatches. Age/CPU/merged PRs are not completion proof. Ordinary audit
uses current-user `lsof`; destructive cleanup additionally requires successful,
warning-free `sudo -n lsof`. No password is requested and sudoers is never modified.
Unavailable full process visibility blocks deletion even for completed work.

Below 20 GiB warns; below 5 GiB is urgent. Native macOS notifications are emitted only
when entering a new warning/urgent/sustained-decline state. Normal unchanged runs stay
quiet. Delivery depends on macOS notification settings; alerts are also logged. Three
samples over at least an hour, all declining, are required for estimated 20 GiB and
exhaustion times. These are extrapolations, not promises.

The guard retains 336 capacity samples and rotates each own JSONL log at 1 MiB with
three backups. Other snapshots replace themselves. Raw operational evidence, host paths
and configuration stay private outside this public repository. `du` is allocated-byte
estimation; clones/hardlinks/concurrent writers can affect actual reclaim. Cleanup logs
record target, proof, retained recovery copy, observed free-space delta, remaining space,
and skip reason. The delta is explicitly qualified for concurrent disk activity.

## Automatic cleanup requirements

`cleanup_enabled` defaults off; enabling it does not bypass any check:

1. Orca registration and Git registration agree; both runtime and worktree detail say
   `completed`, with inactive runtime, no terminal, no agent, no attached PTY, and no
   main worktree. Dirty/untracked state or commits absent from independent refs blocks.
2. Fresh full process inspection reports no open files/cwd in the whole worktree.
   Another observed worktree linking to this worktree also blocks. No processes stop.
3. Root `node_modules` is an ordinary ignored directory with no tracked content.
   Tracked `package.json` and `pnpm-lock.yaml` exist; the configured pinned pnpm runs
   with the exact declared version. The dependency installation's metadata agrees.
   A frozen-lockfile reinstall command is recorded; no lifecycle scripts are run.
4. Every file/link/mode/xattr is fingerprinted. Protected names, local databases, keys,
   model-weight extensions and special files block the entire dependency directory.
   Symlinks are never traversed for deletion, copying or fingerprinting.
5. The configured external mount UUID/path must match, with at least the copy's size
   plus 20 GiB reserve. A native `ditto` copy preserves resource forks, xattrs and ACLs.
   Every copied byte/link/mode/xattr must match the unchanged source. Recovery copies
   are never automatically deleted. Deterministic backup locations avoid duplicate
   copies on failed retries; an incomplete/mismatched backup blocks.
6. Completion/session/process/Git evidence is refreshed after copying. The dependency
   directory is renamed to a unique temporary directory in the same inactive worktree;
   full checks and fingerprinting run again immediately before symlink-safe deletion.
   On failure it is restored if its original name is free; otherwise it remains intact
   for recovery. Only the exact guard-created transient path is excluded from the
   final untracked-file comparison. No persistent Git ignore rule changes.
7. After successful cleanup Orca readiness, existing terminal connections and
   `codex --version` are checked without sending input or launching an AI task.

One worktree is attempted per review, rotating among eligible candidates. Mount or
privilege failures do not relax safety. No safe target means zero deletion and logged
reasons. The guard does not infer that an `in-progress` card has secretly completed.
Snapshot rechecks reduce races but are not a lock obeyed by external editors/agents;
verified external recovery copies remain mandatory.

## Installation and verification

Python 3.10+ and the installed Orca CLI are required. Read its version-matched
`orca skills get orca-cli` guide. Inspect launchd/crontab/Orca/Codex schedules first.
The installer refuses existing installs rather than restarting any service.

Create private JSON config with `orca` (absolute executable), `state_dir`, `volumes`
(internal first), `workspace_roots`, `measure_roots`, and `notifications`. For cleanup
add `cleanup_enabled: true`, `cleanup_roots`, `pnpm_command` (absolute argv array),
`codex_command`, `archive_volume`, `archive_volume_uuid` and `archive_dir`. Do not commit
machine configuration. A broken pnpm shim must not count as a working reinstall tool.

```sh
python3 -m unittest discover -s tools/disk_guard -p 'test_*.py'
python3 tools/disk_guard/guard.py --config /absolute/private/config.json --audit
python3 tools/disk_guard/install.py --config /absolute/private/config.json
launchctl print gui/$(id -u)/com.rogichat.orca-disk-guard
```

Verify hashes of installed `guard.py` and `cleaner.py`, launchd calendar entries,
actual successful execution and fresh state/capacity records. Loaded plists alone are
not proof. To recover, verify a retained backup against `recovery.json` and restore the
whole `node_modules` to its recorded original inactive worktree; do not follow its
relative symlinks during copying. Source and branches were never removed.

## Whole worktrees and future placement

Orca 1.4.205 documents `worktree rm --run-hooks`; failed archive hooks block removal.
It also attempts to delete local branches, conflicting with branch preservation.
The guard therefore never invokes this command, force options or a filesystem removal
substitute. Whole-worktree removal remains disabled.

Official future placement is available via `project setup-update --setup <id>
--worktree-base-path <external-path>`. This remains a separate proposed setting change.
Never move active worktrees or replace them with symlinks. Windows monitoring and all
existing services are outside this tool's mutation scope.
