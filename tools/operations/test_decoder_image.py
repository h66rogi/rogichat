#!/usr/bin/env python3
"""Hosted-only real image verification; no registry, provider or database credentials."""
import json
import re
from pathlib import Path
import subprocess
import sys
import time
import uuid


def docker(*args, input=None, timeout=300):
    result = subprocess.run(['docker', *args], input=input, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        print(result.stdout, file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        result.check_returncode()
    return result.stdout.strip()


def verify(image):
    config = json.loads(docker('image', 'inspect', image))[0]
    assert config['Architecture'] == 'amd64' and config['Os'] == 'linux'
    assert config['Config']['User'] == '10001:10001'
    assert config['Config']['Entrypoint'] == ['node']
    assert config['Config']['Cmd'] == ['dist/media-decoder-main.js']
    assert config['Config']['WorkingDir'] == '/app/apps/api'
    # Mount source tests read-only only in this disposable test invocation. The
    # released image contains no fixtures/tests and the server proof below has no binds.
    tests = Path(__file__).resolve().parents[2] / 'apps/api/test'
    result = docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                    '--security-opt', 'no-new-privileges', '--pids-limit', '128',
                    '--memory', '512m', '--cpus', '1',
                    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=134217728,uid=10001,gid=10001,mode=0700',
                    '--mount', f'type=bind,src={tests},dst=/app/apps/api/test,readonly', image,
                    '--test', '--test-concurrency=1', '--test-reporter=tap',
                    'test/unit/media-image-decoder.test.mjs',
                    'test/decoder/video.test.mjs', 'test/decoder/video-ipc.test.mjs')
    print(result)
    assert re.search(r'^# fail 0$', result, re.M) and re.search(r'^# skipped 0$', result, re.M)
    assert re.search(r'^# cancelled 0$', result, re.M)
    volume = 'rogichat-decoder-proof-' + uuid.uuid4().hex
    docker('volume', 'create', '--driver', 'local', '--opt', 'type=tmpfs', '--opt', 'device=tmpfs',
           '--opt', 'o=size=1048576,uid=10001,gid=10001,mode=0700,noexec,nosuid,nodev', volume)
    container = ''
    try:
        container = docker('run', '-d', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                           '--security-opt', 'no-new-privileges', '--pids-limit', '128',
                           '--memory', '512m', '--cpus', '1',
                           '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=134217728,uid=10001,gid=10001,mode=0700',
                           '--mount', f'type=volume,src={volume},dst=/run/decoder,volume-nocopy',
                           '-e', 'DECODER_ISOLATED=true', image)
        state = json.loads(docker('inspect', container))[0]
        host = state['HostConfig']
        assert host['NetworkMode'] == 'none' and host['ReadonlyRootfs']
        assert host['CapDrop'] == ['ALL'] and host['PidsLimit'] == 128
        assert host['Memory'] == 512 * 1024**2 and host['NanoCpus'] == 10**9
        assert not host['Binds'] and not host['Privileged']
        assert host['Tmpfs']['/tmp'] == 'rw,noexec,nosuid,nodev,size=134217728,uid=10001,gid=10001,mode=0700'
        socket_mount = next(m for m in state['Mounts'] if m['Destination'] == '/run/decoder')
        assert socket_mount['Name'] == volume and socket_mount['RW']
        for _ in range(60):
            try:
                docker('exec', container, 'node', '-e', "if(!require('node:fs').statSync('/run/decoder/image.sock').isSocket())process.exit(1)")
                break
            except subprocess.CalledProcessError:
                time.sleep(0.5)
        else:
            raise AssertionError('Decoder socket did not start')
        # Worker-equivalent client has its own scratch and a read-only socket
        # volume: actual cross-container IPC must work with UID 10001 and mode 0600.
        result = docker('run', '--rm', '-i', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                        '--security-opt', 'no-new-privileges', '--pids-limit', '128',
                        '--memory', '512m', '--cpus', '1',
                        '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=134217728,uid=10001,gid=10001,mode=0700',
                        '--mount', f'type=volume,src={volume},dst=/run/decoder,readonly,volume-nocopy',
                        image, '--input-type=module', input=Path(__file__).with_name('decoder_image_smoke.mjs').read_text())
        print(result)
        docker('exec', container, 'node', '-e', "if(require('node:fs').readdirSync('/tmp').length)process.exit(1)")
        print('Read-only shared socket volume: cross-container IPC passed; decoder private scratch empty.')
        # A connected, incomplete request must not prevent graceful SIGTERM.
        docker('exec', '-d', container, 'node', '--input-type=module', '-e', """
          import { connect } from 'node:net';
          import { writeFileSync } from 'node:fs';
          import { frame } from './dist/common/media/media-decoder-protocol.js';
          const s = connect('/run/decoder/image.sock', () => {
            s.write(frame({version:1,intent:{kind:'PHOTO',contentType:'image/png',byteLength:100}}));
            writeFileSync('/tmp/shutdown-client-ready', 'ready');
          });
          s.on('error', () => {});
        """)
        for _ in range(30):
            try:
                docker('exec', container, 'node', '-e', "require('node:fs').accessSync('/tmp/shutdown-client-ready')")
                break
            except subprocess.CalledProcessError:
                time.sleep(0.1)
        else:
            raise AssertionError('Shutdown fixture did not connect')
        docker('stop', '--time', '15', container, timeout=30)
        stopped = json.loads(docker('inspect', container))[0]['State']
        assert stopped['ExitCode'] == 0 and not stopped['OOMKilled']
        print('Decoder SIGTERM with active IPC request: clean exit 0; no OOM or forced kill.')
    finally:
        if container:
            docker('rm', '-f', container)
        docker('volume', 'rm', volume)


if __name__ == '__main__':
    verify(sys.argv[1])
