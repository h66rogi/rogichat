#!/usr/bin/env python3
"""Inspect Docker's rendered runtime, including overlays, before any deployment."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_IMAGE = 'ghcr.io/h66rogi/rogichat-web@sha256:' + '0' * 64

def config(*files):
    argv = ['docker', 'compose']
    for file in files:
        argv.extend(['-f', str(ROOT / file)])
    result = subprocess.run(argv + ['config', '--format', 'json'], check=True,
        capture_output=True, text=True,
        env={**os.environ, 'ROGICHAT_WEB_IMAGE': FIXTURE_IMAGE, 'ROGICHAT_DEFAULT_ROOM_ID': ''})
    return json.loads(result.stdout)

def verify(env):
    runtime = config('infrastructure/runtime/web/compose.yaml', f'infrastructure/runtime/web/compose.{env}.yaml')
    web = runtime['services']['web']
    assert set(runtime['services']) == {'web'}
    assert web['image'] == FIXTURE_IMAGE
    assert web['container_name'] == f'rogichat-{env}-web'
    assert web['read_only'] and web['user'] == '10001:10001'
    assert not web.get('ports') and not web.get('volumes') and not web.get('privileged')
    assert web['cap_drop'] == ['ALL'] and 'no-new-privileges:true' in web['security_opt']
    assert set(web['networks']) == {'web'}
    assert runtime['networks']['web']['external'] is True
    assert runtime['networks']['web']['name'] == f'rogichat-{env}-web'
    expected = 'qa' if env == 'qa' else 'production'
    api = 'https://api.qa.rogi.chat' if env == 'qa' else 'https://api.rogi.chat'
    assert web['environment']['NODE_ENV'] == 'production'
    assert web['environment']['ROGICHAT_WEB_ENV'] == expected
    assert web['environment']['ROGICHAT_API_ORIGIN'] == api
    if env == 'qa':
        assert web['environment']['ROGICHAT_MEDIA_STORAGE_ORIGINS'] == '["https://36875e4c357ab3a6fcfabe48f617dfb7.r2.cloudflarestorage.com"]'
    else:
        assert 'ROGICHAT_MEDIA_STORAGE_ORIGINS' not in web['environment']
    assert web['environment']['ROGICHAT_DEFAULT_ROOM_ID'] == ''
    assert not any(k.startswith('NEXT_PUBLIC_') or 'SECRET' in k for k in web['environment'])
    bootstrap = 'infrastructure/runtime/compose.bootstrap.yaml' if env == 'qa' else 'infrastructure/environments/prod/runtime/compose.bootstrap.yaml'
    before = config(bootstrap)
    after = config(bootstrap, f'infrastructure/runtime/web/edge.{env}.yaml')
    assert after['name'] == before['name']
    assert set(after['services']) == {'caddy'}
    caddy = after['services']['caddy']
    assert caddy['ports'] == before['services']['caddy']['ports']
    assert set(caddy['networks']) == {'default', 'web'}
    mounts = {v['target']: v for v in caddy['volumes']}
    for volume in before['services']['caddy']['volumes']:
        assert mounts[volume['target']] == volume
    assert mounts['/etc/caddy/sites']['source'] == '/opt/rogichat/web/sites'
    assert mounts['/etc/caddy/sites']['read_only'] is True
    assert not mounts['/etc/caddy/sites'].get('bind', {}).get('create_host_path', False)
    assert after['networks']['web']['external'] is True
    assert after['networks']['web']['name'] == f'rogichat-{env}-web'

if __name__ == '__main__':
    for environment in ('qa', 'prod'):
        verify(environment)
    print('QA/production web and edge runtime isolation verified.')
