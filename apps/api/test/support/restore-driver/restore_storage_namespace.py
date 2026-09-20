#!/usr/bin/env python3
"""Credential-free hosted Linux fixture namespace; never mount on a local/live host.

Copy fixture bytes into a fresh private tree, bind read-only in a private mount
and PID namespace, and run the test as its original unprivileged owner. The
privileged custodian only waits; it never offers a remount/write command.
"""
import argparse
import ctypes
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import tempfile


def refuse():
    raise RuntimeError('restore_storage_namespace_rejected')


def approved_runner():
    if (sys.platform != 'linux' or os.geteuid() != 0
            or os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted'
            or os.environ.get('RUNNER_OS') != 'Linux'
            or os.environ.get('GITHUB_SERVER_URL') != 'https://github.com'
            or os.environ.get('GITHUB_REPOSITORY') != 'h66rogi/rogichat'):
        refuse()
    uid, gid = int(os.environ.get('SUDO_UID', '0')), int(os.environ.get('SUDO_GID', '0'))
    if uid <= 0 or gid <= 0:
        refuse()
    return uid, gid


def copy_tree(source, target, uid, gid):
    count = size = 0
    source = Path(source)
    if not source.is_dir() or source.is_symlink():
        refuse()
    target.mkdir(mode=0o700)
    os.chown(target, uid, gid)
    for directory, dirs, files in os.walk(source, followlinks=False):
        for name in dirs + files:
            path = Path(directory) / name
            info = path.lstat()
            count += 1
            if count > 10000 or stat.S_ISLNK(info.st_mode):
                refuse()
            destination = target / path.relative_to(source)
            if stat.S_ISDIR(info.st_mode):
                destination.mkdir(mode=0o700)
                os.chown(destination, uid, gid)
            else:
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    refuse()
                size += info.st_size
                if size > 256 * 1024 * 1024:
                    refuse()
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(fd, 'rb') as reader:
                    checked = os.fstat(reader.fileno())
                    if (checked.st_dev, checked.st_ino, checked.st_size) != (info.st_dev, info.st_ino, info.st_size):
                        refuse()
                    with destination.open('xb') as writer:
                        shutil.copyfileobj(reader, writer)
                if destination.stat().st_size != info.st_size:
                    refuse()
                os.chmod(destination, 0o600)
                os.chown(destination, uid, gid)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--objects', required=True)
    parser.add_argument('--inside', action='store_true')
    parser.add_argument('--root')
    parser.add_argument('--backing')
    parser.add_argument('--parent-namespace')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    uid, gid = approved_runner()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or not Path(command[0]).is_absolute():
        refuse()
    if not args.inside:
        with tempfile.TemporaryDirectory(prefix='rogichat-backing-') as backing_parent, tempfile.TemporaryDirectory(prefix='rogichat-readonly-') as root:
            # Backing parent stays root-owned0700 in EVERY namespace.
            backing = Path(backing_parent) / 'objects'
            copy_tree(args.objects, backing, uid, gid)
            def outer_user():
                os.setgroups([gid])
                os.setgid(gid)
                os.setuid(uid)
            probe = '''import os,sys
try:
    os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT, 0o600)
except PermissionError:
    sys.exit(0)
sys.exit(1)
'''
            subprocess.run([sys.executable, '-c', probe, str(backing / 'probe.txt')], preexec_fn=outer_user, check=True)
            print('Outer same-UID known backing path write denied', flush=True)
            # Outer mountpoint is root-owned and not replaceable by the runner.
            os.chmod(root, 0o755)
            namespace = str(os.stat('/proc/self/ns/mnt').st_ino)
            child = ['/usr/bin/unshare', '--mount', '--pid', '--fork', '--mount-proc', '--kill-child=SIGKILL',
                     sys.executable, str(Path(__file__).resolve()), '--inside', '--objects', args.objects,
                     '--root', root, '--backing', str(backing), '--parent-namespace', namespace, '--', *command]
            # Only this owned namespace process is signaled on timeout/interruption.
            process = subprocess.Popen(child)
            def stop(_signum, _frame):
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                raise RuntimeError('restore_storage_namespace_interrupted')
            signal.signal(signal.SIGTERM, stop)
            signal.signal(signal.SIGINT, stop)
            try:
                return process.wait(timeout=600)
            except subprocess.TimeoutExpired:
                stop(None, None)
    if os.getpid() != 1 or not args.root or not args.parent_namespace or str(os.stat('/proc/self/ns/mnt').st_ino) == args.parent_namespace:
        refuse()
    subprocess.run(['/usr/bin/mount', '--make-rprivate', '/'], check=True, capture_output=True)
    target = Path(args.root) / 'objects'
    if not args.backing or Path(args.backing).parent.stat().st_uid != 0 or stat.S_IMODE(Path(args.backing).parent.stat().st_mode) != 0o700:
        refuse()
    target.mkdir(mode=0o755)
    subprocess.run(['/usr/bin/mount', '--bind', args.backing, str(target)], check=True, capture_output=True)
    subprocess.run(['/usr/bin/mount', '-o', 'remount,bind,ro,nosuid,nodev,noexec', str(target)], check=True, capture_output=True)
    allowed = ('PATH', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'RUNNER_OS', 'GITHUB_SERVER_URL', 'GITHUB_REPOSITORY',
               'APP_ENV', 'NODE_ENV', 'DB_TLS_MODE', 'ROGICHAT_TEST_MYSQL', 'DATABASE_URL', 'TEST_ADMIN_URL',
               'AUTH_SECRET_FILE', 'AUTHORIZATION_EPOCH_FILE', 'M12_SOURCE_SHA', 'M12_EVIDENCE_DIR',
               'RESTORE_GATE_CONFIG_FILE', 'M12_RESTORE_FIXTURE_FILE')
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    env['RESTORE_READONLY_ROOT'] = str(target)
    def drop_privileges():
        libc = ctypes.CDLL(None, use_errno=True)
        # PR_CAPBSET_DROP(CAP_SYS_ADMIN), PR_SET_NO_NEW_PRIVS. No consumer can remount.
        if libc.prctl(24, 21, 0, 0, 0) != 0 or libc.prctl(38, 1, 0, 0, 0) != 0:
            os._exit(125)
        os.setgroups([gid])
        os.setgid(gid)
        os.setuid(uid)
    # PID-namespace init exits after this child. Kernel kills/reaps all remaining
    # namespace descendants before the outer custodian removes the copied tree.
    return subprocess.run(command, env=env, preexec_fn=drop_privileges).returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('restore_storage_namespace_rejected', file=sys.stderr)
        sys.exit(1)
