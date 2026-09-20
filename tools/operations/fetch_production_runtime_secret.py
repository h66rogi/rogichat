#!/usr/bin/env python3
"""Production-only runtime credential delivery. Never reads a migration secret."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile

from backend_release import protected, digest, require, run

HOST = Path('/etc/rogichat/prod/host.json')
DIRECTORY = Path('/run/rogichat-prod/secrets')
TARGET = DIRECTORY / 'database.json'
SECRET_ID = 'rogichat/prod/database/runtime'


def host_binding():
    value = json.loads(protected(HOST, mode=0o600))
    require(type(value) is dict and set(value) == {'environment', 'machine_id_sha256', 'database_host_sha256'}
            and value['environment'] == 'production')
    require(all(type(value[k]) is str and re.fullmatch(r'[a-f0-9]{64}', value[k])
                for k in ('machine_id_sha256', 'database_host_sha256')))
    require(digest(protected(Path('/etc/machine-id')).strip()) == value['machine_id_sha256'])
    return value


def validate_credential(value, host_hash):
    require(type(value) is dict and set(value) == {'host', 'port', 'database', 'username', 'password'})
    require(value['username'] == 'rogichat_app' and value['database'] == 'rogichatprod'
            and type(value['port']) is int and value['port'] == 3306
            and type(value['password']) is str and 32 <= len(value['password']) <= 1024
            and type(value['host']) is str
            and re.fullmatch(r'rogichat-prod\.cluster-[a-z0-9]+\.ap-northeast-2\.rds\.amazonaws\.com', value['host'])
            and digest(value['host'].encode()) == host_hash)
    return value


def main():
    require(os.geteuid() == 0)
    binding = host_binding()
    require(run(['/usr/bin/findmnt','--noheadings','--output','FSTYPE','--target',str(DIRECTORY.parent)]).strip() == b'tmpfs')
    # Lazy import allows pure negative tests without a cloud SDK or credentials.
    import boto3
    response = boto3.client('secretsmanager', region_name='ap-northeast-2').get_secret_value(SecretId=SECRET_ID)
    raw = response['SecretString']
    require(type(raw) is str and 0 < len(raw.encode()) <= 16384)
    value = validate_credential(json.loads(raw), binding['database_host_sha256'])
    # RuntimeDirectory belongs to systemd; it must exist on tmpfs before delivery.
    parent = DIRECTORY.parent
    require(parent.is_dir() and not parent.is_symlink() and parent.stat().st_uid == 0)
    if not DIRECTORY.exists():
        DIRECTORY.mkdir(mode=0o750)
    require(not DIRECTORY.is_symlink() and DIRECTORY.stat().st_uid == 0)
    os.chown(parent, 0, 10001)
    os.chmod(parent, 0o750)
    os.chown(DIRECTORY, 0, 10001)
    os.chmod(DIRECTORY, 0o750)
    if TARGET.exists() or TARGET.is_symlink():
        protected(TARGET, mode=0o440)
    fd, name = tempfile.mkstemp(prefix='.database-', dir=DIRECTORY)
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o440)
            os.fchown(stream.fileno(), 0, 10001)
            stream.write(json.dumps(value) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, TARGET)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    print('Production runtime credential delivered.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Production runtime credential delivery rejected.', file=sys.stderr)
        sys.exit(1)
