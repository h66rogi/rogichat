#!/usr/bin/env python3
"""Fail-closed, credential-free Docker-save scanner. Never runs or extracts images.

Scans every layer independently, including deleted files, and config/history. Raw
findings live only in a mode-0700 temporary directory; public output is counts.
Only reviewed exact file bytes may suppress a specific upstream fixture rule.
"""
import argparse
import bz2
import gzip
import hashlib
import io
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import struct
import sys
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
MAX_FILE = 256 * 1024 * 1024
MAX_LAYER = 2 * 1024**3
MAX_TOTAL = 8 * 1024**3
MAX_MEMBERS = 250_000
MAX_DEPTH = 5
CHUNK = 4 * 1024 * 1024
OVERLAP = 64 * 1024
ASCII = bytes(i if i in (9, 10, 13) or 32 <= i < 127 else 10 for i in range(256))
POLICY = '''[extend]
useDefault = true
[[rules]]
id = "image-public-key"
description = "Public SSH and PEM key material is not publishable"
regex = '(?m)(?:ssh-(?:rsa|ed25519|dss)(?:-cert-v01@openssh\\.com)?|ecdsa-sha2-nistp[0-9]+(?:-cert-v01@openssh\\.com)?|sk-ssh-ed25519@openssh\\.com|sk-ecdsa-sha2-nistp256@openssh\\.com)[ \\t]+[A-Za-z0-9+/=]{20,}|-----BEGIN (?:RSA |EC )?PUBLIC KEY-----(?:\\r?\\n|\\\\n)[A-Za-z0-9+/=]{20,}|---- BEGIN SSH2 PUBLIC KEY ----(?:\\r?\\n|\\\\n)'
'''


class Blocked(Exception):
    pass


def public_failure_category(error):
    """Return only a fixed label, never exception text or archive-controlled data."""
    if not isinstance(error, Blocked):
        return 'scanner_or_parser_failure'
    reason = str(error)
    if reason == 'secret findings require review':
        return 'content_findings'
    if reason in {'forbidden file in image', 'Terraform state or plan content', 'malformed Terraform state or plan content'}:
        return 'content_policy'
    if reason in {'tar header size limit exceeded', 'PAX metadata limit exceeded', 'GNU name limit exceeded',
                  'archive stream byte limit exceeded', 'member limit exceeded', 'expanded content limit exceeded',
                  'ZIP directory limit exceeded', 'archive depth exceeded', 'scanner report limit exceeded',
                  'outer member limit exceeded', 'oversized image metadata'}:
        return 'resource_limit'
    if reason in {'OCI blob digest mismatch', 'image config or rootfs digest mismatch', 'truncated archive member'}:
        return 'image_integrity'
    if reason in {'unexpected scanner version', 'secret scanner failed', 'invalid scanner result', 'invalid scanner finding'}:
        return 'scanner_failure'
    return 'archive_or_policy_validation'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_name(name):
    if not isinstance(name, str) or len(name) > 4096 or '\x00' in name:
        raise Blocked('invalid archive name')
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name:
        raise Blocked('unsafe archive name')
    return str(path)


def forbidden(name):
    p = PurePosixPath(name)
    n = p.name.lower()
    return ('.ssh' in p.parts or '.aws' in p.parts or n in {'authorized_keys', 'known_hosts', 'credentials'}
            or n == '.env' or (n.startswith('.env.') and not n.endswith(('.example', '.sample', '.template')))
            or n.endswith(('.tfstate', '.tfstate.backup', '.tfplan', '.tfvars', '.tfvars.json', '.jks', '.p12', '.pfx', '.pub')))


def tar_header(data):
    if len(data) < 512 or data[:512] == b'\x00' * 512:
        return False
    if data[257:262] == b'ustar':
        return True
    try:
        tarfile.TarInfo.frombuf(data[:512], 'utf-8', 'surrogateescape')
        return True
    except tarfile.HeaderError:
        return False


class BoundedTarInfo(tarfile.TarInfo):
    def _proc_member(self, archive):
        # tarfile consumes PAX/GNU extension payloads before yielding a member.
        # Bound them before that internal allocation, not only in the caller.
        if self.size < 0 or self.size > MAX_LAYER:
            raise Blocked('tar header size limit exceeded')
        if self.type in (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.SOLARIS_XHDTYPE) and self.size > 4 * 1024**2:
            raise Blocked('PAX metadata limit exceeded')
        if self.type in (tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK) and self.size > 4096:
            raise Blocked('GNU name limit exceeded')
        if self.type == tarfile.GNUTYPE_SPARSE:
            raise Blocked('unsupported sparse tar encoding')
        return super()._proc_member(archive)


class LimitedReader:
    def __init__(self, source, limit):
        self.source, self.remaining = source, limit

    def read(self, size=-1):
        size = self.remaining + 1 if size < 0 else min(size, self.remaining + 1)
        data = self.source.read(size)
        self.remaining -= len(data)
        if self.remaining < 0:
            raise Blocked('archive stream byte limit exceeded')
        return data


class Scanner:
    def __init__(self, work, scanner=None, fixtures=None):
        self.work = Path(work)
        self.corpus = self.work / 'corpus'
        self.corpus.mkdir()
        self.policy = self.work / 'policy.toml'
        self.policy.write_text(POLICY)
        self.scanner = Path(scanner or ROOT / '.tools/gitleaks').resolve()
        version = subprocess.run([str(self.scanner), 'version'], capture_output=True, timeout=10)
        if version.returncode or version.stdout.strip() != b'8.30.1':
            raise Blocked('unexpected scanner version')
        self.outer_members = 0
        self.fixtures = fixtures if fixtures is not None else json.loads((Path(__file__).with_name('image_fixtures.json')).read_text())['files']
        for fixture in self.fixtures:
            if fixture.get('kind') == 'entry-name-metadata':
                parts = fixture['metadata']
                name = f"{parts['directory']}/{parts['package']}:{parts['architecture']}.{parts['extension']}"
                if digest(json.dumps({'name': name}).encode()) != fixture['sha256']:
                    raise Blocked('metadata fixture digest mismatch')
        self.allowed = {(x['sha256'], rule) for x in self.fixtures for rule in x['rules']}
        self.total = self.members = self.layers = self.suppressed = self.candidates = 0
        self.seen = set()
        self.failures = []
        self.matched_fixtures = set()
        if any(not re.fullmatch('[a-f0-9]{64}', x['sha256']) or not isinstance(x['rules'], list) or not x['rules'] for x in self.fixtures):
            raise Blocked('invalid reviewed fixture policy')

    def entry(self, name, size, nested=False):
        if nested:
            # Dependency test archives may contain absolute/traversing names.
            # Names are scanned as data; no member is ever extracted or followed.
            if not isinstance(name, str) or len(name) > 4096 or '\x00' in name:
                raise Blocked('invalid nested archive name')
        else:
            safe_name(name)
        self.members += 1
        if self.members > MAX_MEMBERS or size < 0 or size > MAX_FILE:
            raise Blocked('member limit exceeded')
        if forbidden(name):
            raise Blocked('forbidden file in image')
        self.content(json.dumps({'name': name}).encode(), inspect=False)

    def content(self, data, depth=0, inspect=True):
        self.total += len(data)
        if self.total > MAX_TOTAL or depth > MAX_DEPTH or len(data) > MAX_FILE:
            raise Blocked('expanded content limit exceeded')
        sha = digest(data)
        if sha in self.seen:
            return
        self.seen.add(sha)
        # Scan both raw printable strings and Unicode text (including UTF-16).
        variants = [data.translate(ASCII)]
        if data.startswith((b'\xff\xfe', b'\xfe\xff')):
            variants.append(data.decode('utf-16', errors='replace').encode())
        for pattern, encoding in ((rb'(?:[ -~]\x00){16,}', 'utf-16-le'), (rb'(?:\x00[ -~]){16,}', 'utf-16-be')):
            runs = re.findall(pattern, data)
            if runs:
                variants.append(b'\n'.join(run.decode(encoding).encode() for run in runs))
        for variant, text in enumerate(variants):
            for offset in range(0, max(1, len(text)), CHUNK - OVERLAP):
                (self.corpus / f'{sha}.{variant}.{offset}.txt').write_bytes(text[offset:offset + CHUNK])
        if not inspect:
            return
        structured = data.decode('utf-16', errors='replace').encode() if data.startswith((b'\xff\xfe', b'\xfe\xff')) else data
        stripped = structured.removeprefix(b'\xef\xbb\xbf').lstrip()
        if stripped.startswith((b'{', b'[')):
            try:
                pending = [json.loads(stripped)]
                while pending:
                    obj = pending.pop()
                    if isinstance(obj, dict):
                        if (('terraform_version' in obj and ('resources' in obj or 'planned_values' in obj or 'resource_changes' in obj))
                                or ('lineage' in obj and 'serial' in obj and 'resources' in obj)
                                or ('format_version' in obj and ('planned_values' in obj or 'resource_changes' in obj or 'values' in obj or 'prior_state' in obj))):
                            raise Blocked('Terraform state or plan content')
                        pending.extend(obj.values())
                    elif isinstance(obj, list):
                        pending.extend(obj)
            except (ValueError, UnicodeError):
                if (b'"terraform_version"' in stripped or b'"format_version"' in stripped) and any(key in stripped for key in (b'"resources"', b'"planned_values"', b'"resource_changes"', b'"values"', b'"prior_state"')):
                    raise Blocked('malformed Terraform state or plan content')
        # Do not let archive scanners silently skip encrypted/oversize members.
        if data.startswith(b'PK\x03\x04') or data.startswith(b'PK\x05\x06'):
            end = data.rfind(b'PK\x05\x06', max(0, len(data) - 65557))
            if end < 0 or len(data) - end < 22:
                raise Blocked('invalid ZIP directory')
            entries = struct.unpack_from('<H', data, end + 10)[0]
            directory_size = struct.unpack_from('<I', data, end + 12)[0]
            if entries == 65535 or entries + self.members > MAX_MEMBERS or directory_size > 16 * 1024**2:
                raise Blocked('ZIP directory limit exceeded')
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                if len(archive.infolist()) != entries:
                    raise Blocked('inconsistent ZIP directory')
                for member in archive.infolist():
                    self.entry(member.filename, member.file_size, nested=True)
                    if member.flag_bits & 1:
                        raise Blocked('encrypted nested archive')
                    if not member.is_dir():
                        self.content(archive.read(member), depth + 1)
        elif data.startswith((b'\x1f\x8b', b'BZh', b'\xfd7zXZ\x00')):
            opener = gzip.GzipFile if data.startswith(b'\x1f\x8b') else bz2.BZ2File if data.startswith(b'BZh') else lzma.LZMAFile
            with (opener(fileobj=io.BytesIO(data)) if opener is gzip.GzipFile else opener(io.BytesIO(data))) as stream:
                expanded = stream.read(MAX_FILE + 1)
            self.content(expanded, depth + 1)
        elif tar_header(data):
            self.layer(io.BytesIO(data), depth + 1, nested=True)
        elif data.startswith(b'!<arch>\n'):
            position = 8
            while position < len(data):
                header = data[position:position + 60]
                if len(header) != 60 or header[58:] != b'`\n':
                    raise Blocked('invalid ar archive')
                size = int(header[48:58].strip())
                if size < 0 or position + 60 + size > len(data):
                    raise Blocked('invalid ar member size')
                self.entry('ar-member', size, nested=True)
                self.content(header, inspect=False)
                self.content(data[position + 60:position + 60 + size], depth + 1)
                position += 60 + size + (size % 2)
        elif data.startswith((b'\x04\x22\x4d\x18', b'\x1f\x9d', b'PK\x07\x08', b'7z\xbc\xaf\x27\x1c', b'Rar!\x1a\x07', b'\x28\xb5\x2f\xfd')):
            raise Blocked('unsupported nested archive compression')

    def layer(self, stream, depth=0, nested=False):
        if depth > MAX_DEPTH:
            raise Blocked('archive depth exceeded')
        if not nested:
            self.layers += 1
        with tarfile.open(fileobj=stream, mode='r|', tarinfo=BoundedTarInfo) as archive:
            for member in archive:
                self.entry(member.name, member.size, nested=nested)
                self.content(json.dumps({'pax': member.pax_headers, 'user': member.uname, 'group': member.gname}).encode(), inspect=False)
                if member.issym() or member.islnk():
                    # Rootfs links can legitimately be absolute. Never follow them.
                    self.content(json.dumps({'link': member.linkname}).encode(), inspect=False)
                elif member.isfile():
                    self.content(archive.extractfile(member).read(MAX_FILE + 1), depth)
                elif not (member.isdir() or member.ischr() or member.isblk() or member.isfifo()):
                    raise Blocked('unsupported layer entry')
            while tail := archive.fileobj.read(1024 * 1024):
                if tail.strip(b'\x00'):
                    raise Blocked('unexpected data after layer')
        if not nested:
            self.flush()

    def flush(self):
        if not any(self.corpus.iterdir()):
            return
        report = self.work / 'findings.json'
        env = {k: v for k, v in os.environ.items() if not k.startswith('GITLEAKS_')}
        process = subprocess.run([str(self.scanner), 'dir', str(self.corpus), '--config', str(self.policy),
                                  '--gitleaks-ignore-path', os.devnull, '--ignore-gitleaks-allow',
                                  '--max-decode-depth', '10', '--report-format', 'json', '--report-path', str(report),
                                  '--redact=100', '--no-banner'], cwd=self.work, env=env, capture_output=True, timeout=600)
        if process.returncode not in (0, 1) or not report.is_file():
            raise Blocked('secret scanner failed')
        if report.stat().st_size > 16 * 1024**2:
            raise Blocked('scanner report limit exceeded')
        findings = json.loads(report.read_text())
        if not isinstance(findings, list) or bool(findings) != (process.returncode == 1):
            raise Blocked('invalid scanner result')
        for finding in findings:
            sha = Path(finding['File']).name.split('.')[0]
            rule = finding['RuleID']
            if not re.fullmatch('[a-f0-9]{64}', sha):
                raise Blocked('invalid scanner finding')
            self.candidates += 1
            if (sha, rule) in self.allowed:
                self.suppressed += 1
                self.matched_fixtures.add((sha, rule))
            else:
                self.failures.append({'sha256': sha, 'rule': rule})
        report.unlink()
        for file in self.corpus.iterdir():
            file.unlink()

    def image(self, stream):
        members, layers, configs = {}, {}, {}
        manifest = None
        with tarfile.open(fileobj=LimitedReader(stream, MAX_TOTAL), mode='r|', tarinfo=BoundedTarInfo) as archive:
            for member in archive:
                self.outer_members += 1
                if self.outer_members > MAX_MEMBERS:
                    raise Blocked('outer member limit exceeded')
                name = safe_name(member.name)
                self.content(json.dumps({'pax': member.pax_headers, 'user': member.uname, 'group': member.gname}).encode(), inspect=False)
                if member.isdir():
                    continue
                if not member.isfile() or name in members or member.size < 0 or member.size > MAX_LAYER:
                    raise Blocked('invalid Docker archive member')
                # Spool one layer at a time, outside the repository; no extraction paths.
                with tempfile.SpooledTemporaryFile(max_size=8 * 1024**2, dir=self.work) as spool:
                    source = archive.extractfile(member)
                    hasher = hashlib.sha256()
                    count = 0
                    while chunk := source.read(1024 * 1024):
                        count += len(chunk)
                        hasher.update(chunk)
                        spool.write(chunk)
                    sha = hasher.hexdigest()
                    if count != member.size:
                        raise Blocked('truncated archive member')
                    if name.startswith('blobs/sha256/') and name != 'blobs/sha256/' + sha:
                        raise Blocked('OCI blob digest mismatch')
                    members[name] = sha
                    spool.seek(0)
                    header = spool.read(512)
                    spool.seek(0)
                    self.content(json.dumps({'member': name}).encode(), inspect=False)
                    if tar_header(header) or (count >= 1024 and header == b'\x00' * 512):
                        layers[name] = 'sha256:' + sha
                        self.layer(spool)
                    else:
                        if count > MAX_FILE:
                            raise Blocked('oversized image metadata')
                        data = spool.read()
                        obj = json.loads(data)
                        self.content(data)
                        if name == 'manifest.json':
                            manifest = obj
                        if isinstance(obj, dict) and 'rootfs' in obj:
                            configs[name] = obj
            while tail := archive.fileobj.read(1024 * 1024):
                if tail.strip(b'\x00'):
                    raise Blocked('unexpected data after image')
        if not isinstance(manifest, list) or len(manifest) != 1:
            raise Blocked('expected one Docker-save image')
        item = manifest[0]
        if not isinstance(item.get('Layers'), list) or not item['Layers']:
            raise Blocked('missing image layers')
        config = configs.get(item.get('Config'))
        if not config or [layers.get(x) for x in item['Layers']] != config['rootfs'].get('diff_ids') or any(x not in layers for x in item['Layers']):
            raise Blocked('image config or rootfs digest mismatch')
        self.flush()
        if self.failures:
            raise Blocked('secret findings require review')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', help='docker image save archive, or - for stdin')
    parser.add_argument('--report', type=Path, help='optional private hash/rule diagnostics outside checkout; never upload')
    args = parser.parse_args()
    scanner = None
    try:
        if args.report and args.report.resolve().is_relative_to(ROOT):
            raise Blocked('diagnostic reports must be outside checkout')
        with tempfile.TemporaryDirectory(prefix='rogichat-image-scan-') as directory:
            os.chmod(directory, 0o700)
            scanner = Scanner(directory)
            if args.archive == '-':
                scanner.image(sys.stdin.buffer)
            else:
                with open(args.archive, 'rb') as source:
                    scanner.image(source)
            print(f'Image scan passed: {scanner.layers} layers, {scanner.members} entries; {scanner.suppressed} exact reviewed fixture matches.')
    except Exception as error:  # All failures stay sanitized, including unknown parser errors.
        # Neither archive-controlled filenames nor scanner output may reach CI logs.
        if args.report and not args.report.resolve().is_relative_to(ROOT) and scanner is not None:
            try:
                descriptor = os.open(args.report, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(descriptor, 'w') as destination:
                    json.dump({'reason': str(error) if isinstance(error, Blocked) else type(error).__name__, 'layers': scanner.layers, 'entries': scanner.members, 'failures': scanner.failures}, destination)
            except OSError:
                pass
        print(f'Image scan blocked: {public_failure_category(error)}. Review privately.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
