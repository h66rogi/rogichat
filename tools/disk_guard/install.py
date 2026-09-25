#!/usr/bin/env python3
"""Install a new user LaunchAgent, without reloading any existing service."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

LABEL = 'com.rogichat.orca-disk-guard'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config', type=Path, required=True)
    args = p.parse_args()
    if sys.platform != 'darwin':
        p.error('macOS only')
    os.umask(0o077)
    config = json.loads(args.config.read_text())
    state = Path(config['state_dir']).resolve()
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = state/'guard.py'
    configpath = state/'config.json'
    launchfile = Path.home()/'Library/LaunchAgents'/f'{LABEL}.plist'
    service = f'gui/{os.getuid()}/{LABEL}'
    loaded = subprocess.run(['launchctl', 'print', service], capture_output=True).returncode == 0
    if loaded or launchfile.exists() or target.exists():
        p.error('existing installation found; refusing duplicate or service restart')
    # Inspect user and system jobs for a competing guard before installing.
    for directory in [Path.home()/'Library/LaunchAgents', Path('/Library/LaunchAgents'), Path('/Library/LaunchDaemons')]:
        for path in directory.glob('*.plist'):
            text = path.read_bytes().lower()
            if any(x in text for x in [b'disk-guard', b'disk_guard', b'disk-clean', b'disk_clean', b'orca-clean', b'orca_clean']):
                p.error(f'possible competing job: {path}; inspect first')
    source = Path(__file__).with_name('guard.py')
    shutil.copyfile(source.with_name('cleaner.py'), state/'cleaner.py')
    shutil.copyfile(source, target)
    if args.config.resolve() != configpath:
        shutil.copyfile(args.config, configpath)
    # Stable interpreter and PATH are essential when launched outside a terminal.
    document = {'Label': LABEL, 'ProgramArguments': [str(Path(sys.executable).resolve()), str(target), '--config', str(configpath)],
                'WorkingDirectory': str(state), 'StartCalendarInterval': [{'Minute': 0}, {'Minute': 30}], 'RunAtLoad': True,
                'ProcessType': 'Background', 'Nice': 10, 'LowPriorityIO': True,
                'EnvironmentVariables': {'PATH': os.environ['PATH']},
                'StandardOutPath': '/dev/null', 'StandardErrorPath': '/dev/null'}
    launchfile.parent.mkdir(parents=True, exist_ok=True)
    with launchfile.open('wb') as f:
        plistlib.dump(document, f)
    subprocess.run(['plutil', '-lint', str(launchfile)], check=True)
    subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(launchfile)], check=True)
    receipt = {'label': LABEL, 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
               'installed_sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
               'cleaner_sha256': hashlib.sha256((state/'cleaner.py').read_bytes()).hexdigest(),
               'interval_seconds': 1800, 'mode': 'verified-backup-cleanup' if config.get('cleanup_enabled') else 'preserve-and-report'}
    (state/'installation.json').write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
