#!/usr/bin/env python3
"""Monitor disk pressure and preserve work; verified completed dependencies only.

Optional cleanup retains a byte-verified external recovery copy. It never removes
worktrees, branches, AI history, credentials or uncertain work.
"""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

GIB = 1024 ** 3
ENV = dict(os.environ, GIT_OPTIONAL_LOCKS='0')


def run(args, timeout=45):
    p = subprocess.run([str(a) for a in args], capture_output=True, text=True,
                       errors='replace', timeout=timeout, env=ENV)
    if p.returncode:
        raise RuntimeError(f'{args[0]} failed ({p.returncode}): {p.stderr[:300]}')
    return p.stdout


def atomic(path, value):
    tmp = path.with_suffix(path.suffix + '.new')
    with tmp.open('w') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def append_log(path, value):
    # Rotate only files created by this tool. Never rotate AI/product logs.
    if path.exists() and path.stat().st_size > 1024 * 1024:
        for i in range(3, 0, -1):
            src = Path(str(path) + (f'.{i}' if i else ''))
            if i == 3:
                src.unlink(missing_ok=True)
            elif src.exists():
                os.replace(src, Path(str(path) + f'.{i+1}'))
        os.replace(path, Path(str(path) + '.1'))
    with path.open('a') as f:
        f.write(json.dumps(value, ensure_ascii=False) + '\n')


def orca(config, *args):
    d = json.loads(run([config['orca'], *args, '--json']))
    if not d.get('ok'):
        raise RuntimeError('Orca query unsuccessful')
    r = d['result']
    if r.get('truncated') or r.get('hostScope', {}).get('omittedHostIds'):
        raise RuntimeError('Orca inventory incomplete')
    return r


def git(path, *args):
    return run(['git', '-C', path, *args])


def git_worktrees(repo):
    rows = []
    for block in git(repo, 'worktree', 'list', '--porcelain').strip().split('\n\n'):
        row = dict(line.split(' ', 1) if ' ' in line else (line, True)
                   for line in block.splitlines())
        if 'worktree' in row:
            rows.append(row)
    return rows


def disk(path):
    p = Path(path)
    if not p.exists():
        return {'path': str(p), 'mounted': False}
    # Never mistake an unmounted external directory for the external volume.
    if str(p).startswith('/Volumes/') and not os.path.ismount(p):
        return {'path': str(p), 'mounted': False}
    d = shutil.disk_usage(p)
    return {'path': str(p), 'mounted': True, 'device': p.stat().st_dev,
            'total': d.total, 'free': d.free, 'used': d.used}


def trend(samples, now, free):
    points = [s for s in samples if now - s['time'] <= 4 * 3600]
    if len(points) < 3 or points[-1]['time'] - points[0]['time'] < 3600:
        return {'sustained': False, 'reason': 'need >=3 samples spanning >=1 hour'}
    rates = [(a['free'] - b['free']) / (b['time'] - a['time'])
             for a, b in zip(points, points[1:]) if b['time'] > a['time']]
    if len(rates) < 2 or not all(r > 0 for r in rates):
        return {'sustained': False, 'reason': 'decline not continuous'}
    rate = (points[0]['free'] - points[-1]['free']) / (points[-1]['time'] - points[0]['time'])
    return {'sustained': True, 'estimated': True, 'bytes_per_hour': rate * 3600,
            'estimated_20gib_epoch': now + max(0, free - 20 * GIB) / rate,
            'estimated_zero_epoch': now + free / rate}


def usage(path):
    if Path(path).is_symlink():
        return {'bytes': 0, 'symlink': True, 'target': os.readlink(path)}
    output = run(['/usr/bin/du', '-skx', path], timeout=180)
    return {'bytes': int(output.split()[0]) * 1024, 'symlink': False}


def process_inventory():
    # Machine-readable lsof; no process argv or file contents retained.
    p = subprocess.run(['/usr/sbin/lsof', '-nP', '-Fpcfn'], capture_output=True,
                       text=True, errors='replace', timeout=60)
    entries, pid, command, fd = [], None, None, None
    for line in p.stdout.splitlines():
        if line.startswith('p'):
            pid = line[1:]
        elif line.startswith('c'):
            command = line[1:]
        elif line.startswith('f'):
            fd = line[1:]
        elif line.startswith('n/'):
            entries.append({'pid': pid, 'command': command, 'fd': fd, 'path': line[1:]})
    return entries, {'exit_code': p.returncode, 'warnings': p.stderr[:1000],
                     'scope': 'current user visibility; absence is not exclusive-use proof'}


def within(name, root):
    return name == root or name.startswith(root + '/')


def inspect_git(path):
    if Path(git(path, 'rev-parse', '--show-toplevel').strip()).resolve() != Path(path).resolve():
        raise RuntimeError('directory is not the worktree root')
    head = git(path, 'rev-parse', 'HEAD').strip()
    branch = git(path, 'symbolic-ref', '-q', 'HEAD').strip() if git(path, 'branch', '--show-current').strip() else None
    status = git(path, 'status', '--porcelain=v1', '--untracked-files=all').splitlines()
    refs = git(path, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags').splitlines()
    others = [r for r in refs if r != branch]
    args = ['rev-list', '--count', head] + (['--not', *others] if others else [])
    unique = int(git(path, *args).strip())
    preserved_by = git(path, 'for-each-ref', '--contains', head, '--format=%(refname)',
                       'refs/heads', 'refs/remotes', 'refs/tags').splitlines()
    return {'head': head, 'branch': branch, 'changes': status,
            'untracked_count': sum(s.startswith('??') for s in status),
            'commits_not_in_other_refs': unique,
            'preserved_by': [r for r in preserved_by if r != branch],
            'ref_evidence': 'local snapshot, no remote fetch/prune'}


def artifacts(path):
    # This is an inventory, never a deletion allowlist. Ignore status is not proof.
    candidates = []
    root = Path(path)
    for base, dirs, files in os.walk(root, followlinks=False):
        relbase = Path(base).relative_to(root)
        if len(relbase.parts) > 4:
            dirs[:] = []
            continue
        for name in list(dirs):
            child = Path(base) / name
            if name == '.git':
                dirs.remove(name)
            elif name in {'node_modules', '.next', '.turbo', 'dist', 'build', '.build', '.gradle', 'DerivedData'}:
                try:
                    candidates.append({'relative_path': str(child.relative_to(root)), **usage(child),
                                       'regeneration_verified': False})
                except Exception as e:
                    candidates.append({'relative_path': str(child.relative_to(root)), 'error': str(e)})
                dirs.remove(name)
            elif child.is_symlink():
                dirs.remove(name)
    locks = [n for n in ('pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock') if (root/n).is_file()]
    return candidates, locks


def audit(config, state_dir):
    started = time.time()
    registered, actual, errors = {}, {}, []
    repos = orca(config, 'repo', 'list')['repos']
    ps = orca(config, 'worktree', 'ps')
    live = {w['path']: w for w in ps['worktrees'] if w.get('hostId') == 'local'}
    terminal_result = orca(config, 'terminal', 'list')
    terminals = terminal_result['terminals']
    for repo in repos:
        if not Path(repo['path']).exists():
            errors.append({'repo': repo['path'], 'error': 'not local or missing'})
            continue
        try:
            for w in orca(config, 'worktree', 'list', '--repo', 'id:' + repo['id'])['worktrees']:
                if w.get('hostId') == 'local':
                    registered[w['path']] = w
            for w in git_worktrees(repo['path']):
                actual[w['worktree']] = w
        except Exception as e:
            errors.append({'repo': repo['path'], 'error': str(e)})
    directories = set()
    for base in config['workspace_roots']:
        root = Path(base)
        if root.is_dir():
            directories.update(str(p) for p in root.iterdir() if p.is_dir() or p.is_symlink())
    entries, visibility = process_inventory()
    rows = []
    for path in sorted(set(registered) | set(actual) | directories):
        row = {'path': path, 'registered': path in registered, 'git_registered': path in actual,
               'exists': Path(path).exists(), 'skip_reasons': []}
        reasons = row['skip_reasons']
        w, activity = registered.get(path, {}), live.get(path, {})
        row['workspace_status'] = w.get('workspaceStatus')
        row['runtime_status'] = activity.get('status')
        row['terminals'] = [{k: t.get(k) for k in ('handle', 'connected', 'orphaned', 'agentIdentity')}
                            for t in terminals if t.get('worktreePath') == path]
        row['agent_states'] = [a.get('state') for a in activity.get('agents', [])]
        uses = [e for e in entries if within(e['path'], path)]
        row['processes'] = list({(e['pid'], e['command'], e['fd'] == 'cwd'): (e['pid'], e['command'], e['fd'] == 'cwd') for e in uses}.values())
        row['open_file_count'] = len(uses)
        if path not in registered or path not in actual or not row['exists']:
            reasons.append('registration/filesystem mismatch')
        if w.get('workspaceStatus') != 'completed':
            reasons.append('completion not explicitly confirmed')
        if activity.get('status') != 'inactive' or activity.get('hasAttachedPty') or activity.get('liveTerminalCount') or row['terminals'] or row['agent_states']:
            reasons.append('active session or uncertain runtime state')
        if uses:
            reasons.append('open files or working-directory processes')
        if not row['exists'] or Path(path).is_symlink():
            reasons.append('missing or symbolic-link worktree')
        else:
            try:
                row['git'] = inspect_git(path)
                if row['git']['changes']:
                    reasons.append('uncommitted or untracked files')
                if row['git']['commits_not_in_other_refs']:
                    reasons.append('commits absent from other refs')
            except Exception as e:
                row['git_error'] = str(e)
                reasons.append('Git state uncertain')
            # Avoid scanning arbitrary large folder contexts outside explicit target roots.
            if any(within(path, str(Path(r))) for r in config['measure_roots']):
                try:
                    row['usage'] = usage(path)
                    row['artifacts'], row['lockfiles'] = artifacts(path)
                except Exception as e:
                    row['size_error'] = str(e)
        reasons.append('cleanup requires verified external backup and fresh safety checks')
        row['safe_reclaim_bytes'] = 0
        rows.append(row)
    previous_path = state_dir/'audit.json'
    if previous_path.exists():
        previous = json.loads(previous_path.read_text())
        old = {r['path']: r for r in previous.get('worktrees', [])}
        for row in rows:
            before = old.get(row['path'], {}).get('usage', {}).get('bytes')
            after = row.get('usage', {}).get('bytes')
            if before is not None and after is not None:
                row['size_delta_bytes'] = after - before
        elapsed = started - previous.get('time', started)
    else:
        elapsed = None
    report = {'time': started, 'time_local': dt.datetime.now().astimezone().isoformat(),
              'duration_seconds': time.time()-started, 'previous_sample_seconds': elapsed,
              'errors': errors, 'process_visibility': visibility, 'worktrees': rows,
              'mode': 'preservation-first', 'deleted': [], 'reclaimed_bytes': 0}
    atomic(previous_path, report)
    return report


def notify(config, message):
    if not config.get('notifications', True):
        return
    # Fixed script and argv, no interpolation into AppleScript source.
    run(['/usr/bin/osascript', '-e', 'on run argv\ndisplay notification (item 1 of argv) with title "Orca Disk Guard"\nend run', message])


def tick(config, state_dir, full=False):
    now = time.time()
    oldpath = state_dir/'state.json'
    state = json.loads(oldpath.read_text()) if oldpath.exists() else {}
    volumes = [disk(p) for p in config['volumes']]
    internal = volumes[0]
    if not internal['mounted']:
        raise RuntimeError('internal volume unavailable')
    free = internal['free']
    samples = state.get('samples', [])
    if not samples or now-samples[-1]['time'] >= 60:
        samples.append({'time': now, 'free': free})
    samples = samples[-336:]  # seven days at 30 minute intervals
    estimate = trend(samples, now, free)
    level = 'urgent' if free < 5*GIB else 'warning' if free < 20*GIB else 'normal'
    record = {'time': now, 'time_local': dt.datetime.now().astimezone().isoformat(),
              'volumes': volumes, 'level': level, 'trend': estimate,
              'swap': run(['/usr/sbin/sysctl', '-n', 'vm.swapusage']).strip()}
    append_log(state_dir/'capacity.jsonl', record)
    state.update(samples=samples, last_tick=now, trend=estimate)
    atomic(oldpath, state)
    # Lightweight ticks never traverse worktrees. Review at most once per two hours,
    # or each half hour under pressure. No force flag can relax cleanup checks.
    due = full or now-state.get('last_review', 0) >= 7200 or free < 20*GIB
    alert_key = level if level != 'normal' else ('declining' if estimate['sustained'] else 'normal')
    if alert_key != 'normal' and state.get('alert_key') != alert_key:
        message = f'{level}: internal free {free/GIB:.1f} GiB. Uncertain work stays protected; only verified completed dependencies may be cleaned.'
        if estimate['sustained']:
            eta = dt.datetime.fromtimestamp(estimate['estimated_20gib_epoch']).astimezone().isoformat(timespec='minutes')
            zero = dt.datetime.fromtimestamp(estimate['estimated_zero_epoch']).astimezone().isoformat(timespec='minutes')
            message += f' Estimate: 20 GiB {eta}; exhaustion {zero}.'
        append_log(state_dir/'alerts.jsonl', {'time': now, 'message': message})
        notify(config, message)
    local = dt.datetime.fromtimestamp(now).astimezone()
    next_tick = local.replace(minute=0 if local.minute < 30 else 30, second=0, microsecond=0) + dt.timedelta(minutes=30)
    state.pop('next_capacity_check_approx', None)
    state.update(samples=samples, alert_key=alert_key, last_tick=now,
                 next_calendar_check_nominal=next_tick.timestamp(), trend=estimate)
    atomic(oldpath, state)
    if due:
        report = audit(config, state_dir)
        state['last_review'] = time.time()
        cleanup = []
        if config.get('cleanup_enabled') and (free < 20*GIB or now-state.get('last_cleanup_attempt', 0) >= 7200):
            import cleaner
            cleanup = cleaner.review(sys.modules[__name__], config, state_dir, report)
            state['last_cleanup_attempt'] = time.time()
        append_log(state_dir/'reviews.jsonl', {
            'time': now, 'action': 'reviewed', 'cleanup_outcomes': cleanup,
            'remaining_bytes': disk(config['volumes'][0])['free'],
            'targets': [{'path': w['path'], 'reasons': w['skip_reasons'],
                         'safe_reclaim_bytes': 0} for w in report['worktrees']]})
    atomic(oldpath, state)
    print(json.dumps({'level': level, 'free_gib': round(free/GIB, 2), 'reviewed': due,
                      'mode': 'verified-backup-cleanup' if config.get('cleanup_enabled') else 'preserve-and-report'}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--audit', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    config = json.loads(args.config.read_text())
    directory = Path(config['state_dir'])
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Advisory lock shared by manual audit and scheduled tick; crash releases it.
    with (directory/'guard.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('guard already running; skipped')
            return
        try:
            tick(config, directory, full=args.audit)
            (directory/'failure.json').unlink(missing_ok=True)
        except Exception as e:
            append_log(directory/'errors.jsonl', {'time': time.time(), 'error': str(e), 'action': 'preserve all'})
            failure = directory/'failure.json'
            if not failure.exists():
                atomic(failure, {'time': time.time(), 'error': str(e)})
                try:
                    notify(config, 'Disk guard inspection failed; all work preserved. Inspect errors.jsonl.')
                except Exception:
                    pass
            print(str(e), file=sys.stderr)
            sys.exit(1)


if __name__ == '__main__':
    main()
