"""Conservative, verified-backup cleanup of completed local pnpm worktrees.

Never removes a worktree or branch. A verified external copy is retained forever.
Any uncertainty (including unavailable full process visibility) blocks cleanup.
"""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import time
import uuid

PROTECTED = re.compile(r'(^|[._-])(env|secret|credential|token|upload|model)([._-]|$)|\.(db|sqlite|sqlite3|pem|key|p12|pfx|gguf|onnx|safetensors|pt|pth)$', re.I)


def eligible(row):
    return (row.get('registered') is True and row.get('git_registered') is True
            and row.get('exists') is True and row.get('workspace_status') == 'completed'
            and row.get('runtime_status') == 'inactive' and not row.get('terminals')
            and not row.get('agent_states') and not row.get('processes')
            and 'git' in row and not row['git'].get('changes')
            and row['git'].get('commits_not_in_other_refs') == 0)


def attributes(path):
    if hasattr(os, 'listxattr'):
        return {n: hashlib.sha256(os.getxattr(path, n, follow_symlinks=False)).hexdigest()
                for n in os.listxattr(path, follow_symlinks=False)}
    if sys.platform != 'darwin':
        raise RuntimeError('extended-attribute inspection unavailable')
    libc = ctypes.CDLL(None, use_errno=True)
    libc.listxattr.argtypes = [ctypes.c_char_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]
    libc.listxattr.restype = ctypes.c_ssize_t
    libc.getxattr.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint32, ctypes.c_int]
    libc.getxattr.restype = ctypes.c_ssize_t
    name = os.fsencode(path)
    size = libc.listxattr(name, None, 0, 1)
    if size < 0 or size > 16*1024*1024:
        raise RuntimeError('cannot inspect extended attributes')
    names = ctypes.create_string_buffer(size)
    if libc.listxattr(name, names, size, 1) != size:
        raise RuntimeError('extended attribute list changed')
    result = {}
    for attr in names.raw.split(b'\0'):
        if not attr:
            continue
        length = libc.getxattr(name, attr, None, 0, 0, 1)
        if length < 0 or length > 16*1024*1024:
            raise RuntimeError('cannot read extended attribute')
        value = ctypes.create_string_buffer(length)
        if libc.getxattr(name, attr, value, length, 0, 1) != length:
            raise RuntimeError('extended attribute changed')
        result[os.fsdecode(attr)] = hashlib.sha256(value.raw).hexdigest()
    return result


def hard_protected(name):
    return (name == '.env' or name.startswith('.env.') or
            name in {'.npmrc', '.netrc', '.git', 'id_rsa', 'id_ed25519', 'credentials', 'secrets', 'uploads'} or
            re.search(r'\.(db|sqlite|sqlite3|pem|key|p12|pfx|gguf|onnx|safetensors|pt|pth)$', name, re.I))


def vendor_allowances(root, store, lockfile):
    """Disambiguate vendor code names using locked pnpm receipts and CAS bytes.

This does not exempt credentials/DBs/weights, unknown content, or user directories.
Receipt DB is opened read-only; no pnpm store file is changed.
"""
    root, store = Path(root), Path(store)
    lock = Path(lockfile).read_text()
    db = sqlite3.connect((store/'index.db').as_uri() + '?mode=ro', uri=True)
    cache = {}
    def original(file):
        if file.is_symlink() or not file.is_file():
            return False
        package = file.parent
        while package != root and package.is_relative_to(root):
            manifest = package/'package.json'
            if manifest.is_file() and not manifest.is_symlink():
                data = json.loads(manifest.read_text())
                name, version = data.get('name', ''), data.get('version', '')
                if name and version:
                    key = name + '@' + version
                    if key not in cache:
                        suffix = '\t' + key
                        rows = db.execute('SELECT key,data FROM package_index WHERE substr(key,-length(?))=?', (suffix, suffix)).fetchall()
                        cache[key] = [blob for k, blob in rows if k.split('\t')[0] in lock]
                    digest = hashlib.sha512(file.read_bytes()).hexdigest()
                    # The bytes must be indexed by this exact locked package, and
                    # a correctly named content-addressed blob must still restore them.
                    if any(digest.encode() in blob for blob in cache[key]):
                        blob = store/'files'/digest[:2]/digest[2:]
                        if not blob.exists():
                            blob = blob.with_name(blob.name + '-exec')
                        if blob.is_file() and not blob.is_symlink() and hashlib.sha512(blob.read_bytes()).hexdigest() == digest:
                            return True
            package = package.parent
        return False
    allowed = set()
    try:
        for base, dirs, files in os.walk(root, followlinks=False):
            for name in dirs + files:
                if hard_protected(name):
                    raise RuntimeError('protected data name present; preserve complete dependency tree')
                if not PROTECTED.search(name):
                    continue
                path = Path(base)/name
                rel = path.relative_to(root)
                valid = False
                if path.is_symlink():
                    dest = path.resolve()
                    valid = dest.is_relative_to(root) and original(dest/'package.json' if dest.is_dir() else dest)
                elif path.is_file():
                    valid = original(path)
                elif path.is_dir() and len(rel.parts) == 2 and rel.parts[0] == '.pnpm':
                    # pnpm package slot, not an arbitrary user directory.
                    manifests = list((path/'node_modules').glob('*/package.json')) + list((path/'node_modules').glob('@*/*/package.json'))
                    valid = {p.name for p in path.iterdir()} == {'node_modules'} and any(original(p) for p in manifests if not p.parent.is_symlink())
                elif path.is_dir():
                    members = [p for p in path.rglob('*') if p.is_file() and not p.is_symlink()]
                    valid = bool(members) and all(original(p) for p in members)
                if not valid:
                    raise RuntimeError('protected-looking name lacks locked vendor content proof: ' + str(rel))
                allowed.add(str(rel))
    finally:
        db.close()
    return allowed


def fingerprint(root, protect=True, vendor_paths=frozenset()):
    """Hash all bytes, links, permissions and xattrs without following symlinks."""
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise RuntimeError('target is not an ordinary directory')
    result = {'.': {'type': 'directory', 'mode': stat.S_IMODE(root.stat().st_mode), 'xattrs': attributes(root)}}
    for base, dirs, files in os.walk(root, followlinks=False):
        for name in sorted(dirs + files):
            path = Path(base)/name
            rel = str(path.relative_to(root))
            if protect and (hard_protected(name) or (PROTECTED.search(name) and rel not in vendor_paths)):
                raise RuntimeError('protected name present; preserve complete dependency tree')
            before = path.lstat()
            if stat.S_ISLNK(before.st_mode):
                record = {'type': 'link', 'target': os.readlink(path)}
            elif stat.S_ISDIR(before.st_mode):
                record = {'type': 'directory'}
            elif stat.S_ISREG(before.st_mode):
                digest = hashlib.sha256()
                # Refuse symlinks swapped into a file while hashing.
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(fd, 'rb') as f:
                    opened = os.fstat(f.fileno())
                    if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
                        raise RuntimeError('file changed while opening')
                    for block in iter(lambda: f.read(1024*1024), b''):
                        digest.update(block)
                record = {'type': 'file', 'sha256': digest.hexdigest(), 'size': before.st_size}
            else:
                raise RuntimeError('special file present')
            # Copy verification includes metadata; unsupported xattrs fail closed.
            attrs = attributes(path)
            record.update(mode=stat.S_IMODE(before.st_mode), xattrs=attrs)
            after = path.lstat()
            if (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise RuntimeError('file changed while fingerprinting')
            result[rel] = record
    return result


def mounted_archive(config):
    volume = Path(config['archive_volume'])
    root = Path(config['archive_dir'])
    if not volume.is_mount() or volume.is_symlink():
        raise RuntimeError('archive volume is not mounted')
    info = plistlib.loads(subprocess.check_output(['/usr/sbin/diskutil', 'info', '-plist', str(volume)], timeout=20))
    if info.get('Internal') is not False or info.get('VolumeUUID') != config['archive_volume_uuid'] or info.get('MountPoint') != str(volume):
        raise RuntimeError('archive volume identity changed')
    if root == volume or not root.is_relative_to(volume) or root.resolve() != root:
        raise RuntimeError('archive path escaped mounted volume or contains symlinks')
    return root


def fresh(api, config, path):
    rows = api.orca(config, 'worktree', 'ps')['worktrees']
    row = next((r for r in rows if r.get('path') == str(path) and r.get('hostId') == 'local'), None)
    if not row or row.get('workspaceStatus') != 'completed' or row.get('status') != 'inactive':
        raise RuntimeError('work is not explicitly completed and inactive')
    if row.get('isMainWorktree') or row.get('agents') or row.get('hasAttachedPty') or row.get('liveTerminalCount'):
        raise RuntimeError('main worktree or session remains')
    terminals = api.orca(config, 'terminal', 'list')['terminals']
    if any(t.get('worktreePath') == str(path) for t in terminals):
        raise RuntimeError('terminal remains')
    shown = api.orca(config, 'worktree', 'show', '--worktree', 'path:' + str(path))['worktree']
    if shown.get('workspaceStatus') != 'completed' or shown.get('isMainWorktree'):
        raise RuntimeError('completion metadata changed')
    if str(path) not in {r['worktree'] for r in api.git_worktrees(path)}:
        raise RuntimeError('Git registration mismatch')
    info = api.inspect_git(path)
    if info['changes'] or info['commits_not_in_other_refs']:
        raise RuntimeError('uncommitted, untracked or unpreserved work')
    # No password prompt, no sudoers changes. Audit-only mode needs no privilege;
    # destructive cleanup requires visibility beyond the current user.
    opened = subprocess.run(['/usr/bin/sudo', '-n', '/usr/sbin/lsof', '-nP', '-Fpn'],
                            capture_output=True, text=True, timeout=60)
    if opened.returncode or opened.stderr:
        raise RuntimeError('complete process visibility unavailable; preserve')
    if any(line.startswith('n') and api.within(line[1:], str(path)) for line in opened.stdout.splitlines()):
        raise RuntimeError('open file or working-directory process')
    # Other worktrees may share dependencies even with no currently open FD.
    for other in rows:
        other_path = Path(other.get('path', ''))
        if other_path == path or other.get('hostId') != 'local' or not other_path.is_dir():
            continue
        for base, dirs, files in os.walk(other_path, followlinks=False):
            if len(Path(base).relative_to(other_path).parts) > 4:
                dirs[:] = []
                continue
            for name in dirs + files:
                p = Path(base)/name
                if p.is_symlink() and api.within(str(p.resolve()), str(path)):
                    raise RuntimeError('another worktree links to this worktree')
            dirs[:] = [n for n in dirs if n not in {'.git', 'node_modules', '.next', 'build', 'dist'} and not (Path(base)/n).is_symlink()]
    return {'git': info, 'instance': shown.get('instanceId'),
            'activity': shown.get('lastActivityAt'), 'runtime_instance': row.get('worktreeInstanceId')}


def separate_volume(volume, path):
    if volume.stat().st_dev == path.stat().st_dev:
        raise RuntimeError('recovery copy must be on a separate volume')


def clean_one(api, config, state_dir, row):
    path = Path(row['path'])
    if path.is_symlink() or path.resolve() != path:
        raise RuntimeError('worktree has symbolic-link path')
    target = path/'node_modules'
    if target.is_symlink() or not target.is_dir():
        raise RuntimeError('ordinary root node_modules not present')
    if not shutil.rmtree.avoids_symlink_attacks:
        raise RuntimeError('symlink-safe directory deletion unavailable')
    before = fresh(api, config, path)
    if before['git'] != row['git']:
        raise RuntimeError('Git evidence changed since audit')
    for name in ['package.json', 'pnpm-lock.yaml']:
        api.git(path, 'ls-files', '--error-unmatch', name)
        if (path/name).is_symlink():
            raise RuntimeError('manifest or lockfile is a symlink')
    api.git(path, 'check-ignore', 'node_modules')
    if api.git(path, 'ls-files', '--', 'node_modules').strip():
        raise RuntimeError('tracked dependency content')
    package = json.loads((path/'package.json').read_text())
    expected = package.get('packageManager', '')
    command = config['pnpm_command']
    if not expected.startswith('pnpm@') or api.run([*command, '--version']).strip() != expected.removeprefix('pnpm@'):
        raise RuntimeError('pinned reinstall tool unavailable or version mismatch')
    modules = json.loads((target/'.modules.yaml').read_text())
    if modules.get('packageManager') != expected or modules.get('nodeLinker') != 'isolated':
        raise RuntimeError('dependency installation provenance uncertain')
    vendor_paths = vendor_allowances(target, modules['storeDir'], path/'pnpm-lock.yaml')
    stamp = fingerprint(target, vendor_paths=vendor_paths)
    size = sum(f.get('size', 0) for f in stamp.values())
    root = mounted_archive(config)
    separate_volume(Path(config['archive_volume']), path)
    if shutil.disk_usage(root.parent if root.parent.exists() else Path(config['archive_volume'])).free < size + 20*api.GIB:
        raise RuntimeError('insufficient external reserve')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    identity = hashlib.sha256((str(target) + json.dumps(stamp, sort_keys=True)).encode()).hexdigest()
    archive = root/('deps-' + identity)
    backup = archive/'node_modules'
    if archive.is_symlink() or archive.resolve() != archive or backup.is_symlink():
        raise RuntimeError('recovery directory path is not ordinary')
    if not archive.exists():
        archive.mkdir(mode=0o700)
        if sys.platform == 'darwin':
            subprocess.run(['/usr/bin/ditto', '--rsrc', '--extattr', '--acl', '--qtn', '--nocache', str(target), 'node_modules'], cwd=archive, check=True, capture_output=True)
        else:
            shutil.copytree(target, backup, symlinks=True, copy_function=shutil.copy2)
    # Deterministic location prevents repeated failed attempts from filling the SSD.
    # Existing incomplete or altered backups block, never get overwritten.
    if fingerprint(backup, vendor_paths=vendor_paths) != stamp or fingerprint(target, vendor_paths=vendor_paths) != stamp:
        raise RuntimeError('copy verification or source stability failed; source retained')
    mounted_archive(config)
    if fresh(api, config, path) != before:
        raise RuntimeError('worktree changed after verified copy; preserve source')
    api.atomic(archive/'recovery.json', {
        'source': str(target), 'head': before['git']['head'], 'manifest': stamp,
        'restore': 'Copy archived node_modules back to the same inactive worktree; verify manifest first.',
        'reinstall_argv': [*command, 'install', '--frozen-lockfile'], 'verified_at': time.time()})
    free_before = shutil.disk_usage(path).free
    quarantine = path/('.disk-guard-verified-' + uuid.uuid4().hex)
    os.rename(target, quarantine)
    try:
        # Quarantine is deliberately untracked: ignore only this exact guard-owned
        # path for the final Git comparison, never unknown ignored/user files.
        current = fresh_after_rename(api, config, path, quarantine, before)
        if not current or fingerprint(quarantine, vendor_paths=vendor_paths) != stamp:
            raise RuntimeError('state changed immediately before removal')
        mounted_archive(config)
        shutil.rmtree(quarantine)
    except Exception:
        if not target.exists() and not target.is_symlink() and quarantine.exists():
            os.rename(quarantine, target)
        raise
    return {'target': str(target), 'backup': str(backup), 'reason': 'completed, inactive, clean, refs preserved, pinned reinstall and verified external backup',
            'verified_file_bytes': size, 'observed_free_delta_bytes': shutil.disk_usage(path).free-free_before,
            'remaining_bytes': shutil.disk_usage(path).free, 'concurrent_writers_may_affect_delta': True}


def fresh_after_rename(api, config, path, quarantine, before):
    # Git's untracked inventory is unchanged only if we explicitly exclude our own
    # transient quarantine via a per-command option, never a persistent ignore edit.
    original = api.inspect_git
    def excluding(p):
        result = original(p)
        prefix = '?? ' + quarantine.name + '/'
        result['changes'] = [s for s in result['changes'] if not s.startswith(prefix)]
        result['untracked_count'] = sum(s.startswith('??') for s in result['changes'])
        return result
    api.inspect_git = excluding
    try:
        return fresh(api, config, path) == before
    finally:
        api.inspect_git = original


def review(api, config, state_dir, report):
    outcomes = []
    if not config.get('cleanup_enabled') or report.get('errors') or report.get('process_visibility', {}).get('exit_code') != 0 or report.get('process_visibility', {}).get('warnings'):
        return outcomes
    attempts_path = state_dir/'cleanup-attempts.json'
    attempts = json.loads(attempts_path.read_text()) if attempts_path.exists() else {}
    live_paths = {w['path'] for w in report['worktrees']}
    attempts = {p: t for p, t in attempts.items() if p in live_paths}
    for row in sorted(report['worktrees'], key=lambda w: attempts.get(w['path'], 0)):
        if not eligible(row) or not any(api.within(row['path'], r) for r in config.get('cleanup_roots', [])):
            continue
        dependency_dir = Path(row['path'])/'node_modules'
        if not dependency_dir.is_dir() or dependency_dir.is_symlink():
            continue
        try:
            initial = api.orca(config, 'terminal', 'list')['terminals']
            outcome = clean_one(api, config, state_dir, row)
            outcome['action'] = 'archived-and-cleaned'
            try:
                current = {t['handle']: t for t in api.orca(config, 'terminal', 'list')['terminals']}
                outcome['health'] = {'runtime': api.orca(config, 'status')['runtime']['state'],
                    'codex': api.run(config.get('codex_command', ['codex']) + ['--version']).strip(),
                    'changed_terminal_handles': [t['handle'] for t in initial if t['handle'] not in current or not current[t['handle']].get('connected')]}
            except Exception as health_error:
                outcome['health_error'] = str(health_error)
        except Exception as e:
            outcome = {'action': 'preserved', 'target': row['path'], 'reason': str(e), 'reclaimed_bytes': 0}
        outcome['time'] = time.time()
        attempts[row['path']] = outcome['time']
        api.atomic(attempts_path, attempts)
        api.append_log(state_dir/'cleanup.jsonl', outcome)
        outcomes.append(outcome)
        # Bound pressure on disks and agents to one attempted worktree per review.
        break
    return outcomes
