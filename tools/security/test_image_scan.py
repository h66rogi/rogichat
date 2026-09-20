#!/usr/bin/env python3
"""Exercise real scanner and image boundary failures using ephemeral fake secrets."""
import gzip
from contextlib import redirect_stderr
import io
import json
from pathlib import Path
import secrets
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

import image_scan as scan


def tar(entries):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as bundle:
        for name, data in entries:
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            bundle.addfile(entry, io.BytesIO(data))
    return stream.getvalue()


def image(layers, env=None, history=None):
    config = json.dumps({'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + scan.digest(x) for x in layers]},
                         'config': {'Env': env or []}, 'history': history or []}).encode()
    names = ['blobs/sha256/' + scan.digest(x) for x in layers]
    config_name = 'blobs/sha256/' + scan.digest(config)
    manifest = json.dumps([{'Config': config_name, 'Layers': names, 'RepoTags': ['fixture:test']}]).encode()
    return tar(list(zip(names, layers)) + [(config_name, config), ('manifest.json', manifest)])


class ImageScanTests(unittest.TestCase):
    def token(self):
        return ('gh' + 'p_' + ''.join(secrets.choice('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') for _ in range(36))).encode()

    def run_scan(self, data, *, fixtures=None, scanner=None):
        with tempfile.TemporaryDirectory() as work:
            worker = scan.Scanner(work, fixtures=fixtures or [], scanner=scanner)
            worker.image(io.BytesIO(data))
            return worker

    def installation_token(self, length, structured=False):
        prefix = "gh" + "s_"
        body = ("123456_" + "eyJ" + "hbGciOiJIUzI1NiJ9." if structured else "")
        alphabet = "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7" + ("._-" if structured else "")
        return (prefix + (body + alphabet * length)[:length - len(prefix)]).encode()

    def test_installation_token_layers_environment_history_and_encoding(self):
        import base64
        for length in (40, 390, 520, 1024, 4096):
            for structured in (False, True):
                token = self.installation_token(length, structured)
                value = token.decode()
                cases = {
                    "bare": image([tar([('app/data', token)]), tar([('app/.wh.data', b'')])]),
                    "assignment": image([tar([('app/data', b'token=' + token)])]),
                    "env": image([tar([('app/main', b'ok')])], env=['TOKEN=' + value]),
                    "history": image([tar([('app/main', b'ok')])], history=[{'created_by': 'RUN TOKEN=' + value}]),
                    "base64": image([tar([('app/data', base64.b64encode(token))])]),
                    "utf16": image([tar([('app/data', value.encode('utf-16'))])]),
                }
                for location, data in cases.items():
                    with self.subTest(length=length, structured=structured, location=location):
                        with self.assertRaises(scan.Blocked) as caught:
                            self.run_scan(data)
                        self.assertEqual(str(caught.exception), 'secret findings require review')
                        self.assertNotIn(value, str(caught.exception))

    def test_installation_token_adjacent_literals_in_binary_and_utf16(self):
        token = self.installation_token(520, True)
        for prefix, suffix in ((b"X", b""), (b"TOKEN_", b""), (b"v2", b""),
                               (b"someOtherStringLiteral", b"nextLiteral")):
            value = prefix + token + suffix
            for encoding, payload in (("binary", b"\0\xff" + value + b"\0"),
                                      ("utf16", value.decode().encode("utf-16"))):
                with self.subTest(prefix=prefix, suffix=suffix, encoding=encoding):
                    with self.assertRaises(scan.Blocked) as caught:
                        self.run_scan(image([tar([('app/data', payload)])]))
                    self.assertEqual(str(caught.exception), 'secret findings require review')
                    self.assertNotIn(token.decode(), str(caught.exception))

    def test_installation_token_short_template_and_boundary(self):
        for value in ("gh" + "s_APPID_JWT", "gh" + "s_" + "a" * 35):
            self.run_scan(image([tar([('app/data', value.encode())])]))
        with self.assertRaisesRegex(scan.Blocked, '^secret findings require review$'):
            self.run_scan(image([tar([('app/data', ("gh" + "s_" + "a" * 36).encode())])]))

    def test_installation_token_policy_matches_repository_rule(self):
        import tomllib
        from check import expected_policy
        rule_id = 'rogichat-github-installation-token'
        repository = next(rule for rule in expected_policy()['rules'] if rule['id'] == rule_id)
        embedded = next(rule for rule in tomllib.loads(scan.POLICY)['rules'] if rule['id'] == rule_id)
        self.assertEqual(repository, embedded)

    def test_normal_image_with_links_and_compressed_documentation(self):
        data = image([tar([('app/main.js', b'console.log("ready")'), ('usr/share/doc/readme.gz', gzip.compress(b'public documentation'))])])
        self.assertEqual(self.run_scan(data).layers, 1)

    def test_secret_in_removed_lower_layer(self):
        with self.assertRaises(scan.Blocked):
            self.run_scan(image([tar([('app/data', self.token())]), tar([('app/.wh.data', b'')])]))

    def test_environment_and_history_secrets(self):
        for field in ('env', 'history'):
            value = self.token().decode()
            kwargs = {'env': ['TOKEN=' + value]} if field == 'env' else {'history': [{'created_by': 'RUN TOKEN=' + value}]}
            with self.subTest(field=field), self.assertRaises(scan.Blocked):
                self.run_scan(image([tar([('app/main', b'ok')])], **kwargs))

    def test_nested_zip_and_gzip(self):
        zipped = io.BytesIO()
        with zipfile.ZipFile(zipped, 'w') as archive:
            archive.writestr('data', self.token())
        for data in (zipped.getvalue(), gzip.compress(self.token())):
            with self.assertRaises(scan.Blocked):
                self.run_scan(image([tar([('app/data', data)])]))

    def test_encoded_and_binary_embedded_secret(self):
        import base64
        for data in (b'\0\xff' + self.token() + b'\0', base64.b64encode(self.token()), self.token().decode().encode('utf-16')):
            with self.assertRaises(scan.Blocked):
                self.run_scan(image([tar([('app/data', data)])]))

    def test_exact_fixture_cannot_hide_modified_content(self):
        fixture = b'token=' + self.token()
        allowed = [{'sha256': scan.digest(fixture), 'rules': ['github-pat', 'generic-api-key']}]
        self.run_scan(image([tar([('public-fixture', fixture)])]), fixtures=allowed)
        with self.assertRaises(scan.Blocked):
            self.run_scan(image([tar([('public-fixture', fixture + b'\n' + self.token())])]), fixtures=allowed)

    def test_exact_fixture_does_not_suppress_other_rules(self):
        fixture = b'token=' + self.token()
        allowed = [{'sha256': scan.digest(fixture), 'rules': ['unrelated-reviewed-rule']}]
        with self.assertRaises(scan.Blocked):
            self.run_scan(image([tar([('public-fixture', fixture)])]), fixtures=allowed)

    def test_forbidden_paths_state_and_traversal(self):
        for name, data in [('app/.env', b'x'), ('../escape', b'x'), ('app/data', b'{"terraform_version":"1.0","resources":[]}')]:
            with self.subTest(name=name), self.assertRaises(scan.Blocked):
                self.run_scan(image([tar([(name, data)])]))

    def test_no_scanner_fails_closed(self):
        with self.assertRaises(OSError):
            self.run_scan(image([tar([('app/main', b'ok')])]), scanner='/missing/scanner')

    def test_digest_and_archive_corruption(self):
        data = image([tar([('app/main', b'ok')])])
        with self.assertRaises((scan.Blocked, tarfile.TarError, ValueError)):
            self.run_scan(data.replace(b'ok', b'NO', 1))

    def test_error_output_never_echoes_archive_names(self):
        token = self.token()
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / 'image.tar'
            path.write_bytes(image([tar([('../' + token.decode(), b'x')])]))
            result = subprocess.run([sys.executable, str(Path(scan.__file__)), str(path)], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(token, result.stdout + result.stderr)

    def test_public_failure_categories_never_echo_exception_details(self):
        token = self.token().decode()
        cases = [
            (scan.Blocked('secret findings require review'), 'content_findings'),
            (scan.Blocked('forbidden file in image'), 'content_policy'),
            (scan.Blocked('expanded content limit exceeded'), 'resource_limit'),
            (scan.Blocked('OCI blob digest mismatch'), 'image_integrity'),
            (scan.Blocked('secret scanner failed'), 'scanner_failure'),
            (scan.Blocked(token), 'archive_or_policy_validation'),
            (ValueError(token), 'scanner_or_parser_failure'),
        ]
        for error, expected in cases:
            worker = Mock()
            worker.image.side_effect = error
            output = io.StringIO()
            with self.subTest(category=expected), patch.object(scan, 'Scanner', return_value=worker), \
                    patch.object(sys, 'argv', ['image_scan.py', '-']), redirect_stderr(output):
                self.assertEqual(scan.main(), 1)
            self.assertEqual(output.getvalue(), f'Image scan blocked: {expected}. Review privately.\n')
            self.assertNotIn(token, output.getvalue())

    def test_empty_layer_is_valid(self):
        self.assertEqual(self.run_scan(image([b'\x00' * 1024])).layers, 1)

    def test_pax_metadata_and_trailing_payload_are_checked(self):
        token = self.token()
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w', format=tarfile.PAX_FORMAT) as bundle:
            entry = tarfile.TarInfo('app/main')
            entry.pax_headers = {'comment': token.decode()}
            entry.size = 2
            bundle.addfile(entry, io.BytesIO(b'ok'))
        with self.assertRaises(scan.Blocked):
            self.run_scan(image([stream.getvalue()]))
        with self.assertRaises(scan.Blocked):
            self.run_scan(image([tar([('app/main', b'ok')]) + token]))
        with self.assertRaises(scan.Blocked):
            self.run_scan(image([tar([('app/main', b'ok')])]) + token)

    def test_nested_archive_names_never_become_filesystem_paths(self):
        nested = tar([('../../escape', b'public archive fixture')])
        self.run_scan(image([tar([('app/fixture.tar', nested)])]))

    def test_legacy_tar_cannot_hide_nested_zip(self):
        zipped = io.BytesIO()
        with zipfile.ZipFile(zipped, 'w') as archive:
            archive.writestr('data', self.token())
        legacy = bytearray(tar([('data.zip', zipped.getvalue())]))
        legacy[257:512] = b'\x00' * 255
        legacy[148:156] = b' ' * 8
        legacy[148:156] = ('%06o\0 ' % sum(legacy[:512])).encode()
        with self.assertRaises(scan.Blocked):
            self.run_scan(image([tar([('fixture', bytes(legacy))])]))

    def test_operational_json_variants_and_normal_bom(self):
        for data in (b'[ {"format_version":"1.0","values":{}} ]', b'\xef\xbb\xbf{"format_version":"1","prior_state":{}}', '{"format_version":"1","values":{}}'.encode('utf-16')):
            with self.assertRaises(scan.Blocked):
                self.run_scan(image([tar([('app/data', data)])]))
        self.run_scan(image([tar([('app/data', b'\xef\xbb\xbf{"public":"config"}')])]))

    def test_unknown_compression_blocks(self):
        for magic in (b'\x04\x22\x4d\x18', b'\x1f\x9d', b'PK\x07\x08'):
            with self.assertRaises(scan.Blocked):
                self.run_scan(image([tar([('data', magic + b'payload')])]))

    def test_public_key_material_requires_content_not_header_literal(self):
        header = b'-----BEGIN ' + b'PUBLIC KEY-----'
        body = secrets.token_bytes(48)
        import base64
        with self.assertRaises(scan.Blocked):
            self.run_scan(image([tar([('app/data', header + b'\n' + base64.b64encode(body) + b'\n')])]))
        self.run_scan(image([tar([('app/main.js', b'const prefix="' + header + b'";')])]))

    def test_ar_member_secret_and_encrypted_zip_block(self):
        token = self.token()
        header = b'payload/        ' + b'0           ' + b'0     ' + b'0     ' + b'100644  ' + str(len(token)).encode().ljust(10) + b'`\n'
        archive = b'!<arch>\n' + header + token + (b'\n' if len(token) % 2 else b'')
        with self.assertRaises(scan.Blocked):
            self.run_scan(image([tar([('app/data', archive)])]))
        zipped = io.BytesIO()
        with zipfile.ZipFile(zipped, 'w') as bundle:
            bundle.writestr('data', b'public')
        data = bytearray(zipped.getvalue())
        central = data.index(b'PK\x01\x02')
        data[central + 8] |= 1
        with self.assertRaises(scan.Blocked):
            self.run_scan(image([tar([('app/data', bytes(data))])]))

    def test_stream_byte_limit_and_wrong_version(self):
        reader = scan.LimitedReader(io.BytesIO(b'123456'), 5)
        with self.assertRaises(scan.Blocked):
            reader.read(100)
        with tempfile.TemporaryDirectory() as work:
            fake = Path(work) / 'scanner'
            fake.write_text('#!/bin/sh\necho 0.0.0\n')
            fake.chmod(0o700)
            with self.assertRaises(scan.Blocked):
                self.run_scan(image([tar([('app/data', b'public')])]), scanner=fake)

    def test_pax_allocation_and_zip_directory_limits(self):
        entry = tarfile.TarInfo('PaxHeader')
        entry.type = tarfile.XHDTYPE
        entry.size = 5 * 1024**2
        with self.assertRaises(scan.Blocked):
            self.run_scan(image([entry.tobuf()]))
        zipped = io.BytesIO()
        with zipfile.ZipFile(zipped, 'w') as bundle:
            bundle.writestr('data', b'public')
        data = bytearray(zipped.getvalue())
        end = data.rfind(b'PK\x05\x06')
        data[end + 10:end + 12] = b'\xff\xff'
        with self.assertRaises(scan.Blocked):
            self.run_scan(image([tar([('app/data', bytes(data))])]))

    def test_resource_limit_blocks_instead_of_skipping(self):
        previous = scan.MAX_FILE
        try:
            scan.MAX_FILE = 512
            with self.assertRaises(scan.Blocked):
                self.run_scan(image([tar([('app/data', b'x' * 513)])]))
        finally:
            scan.MAX_FILE = previous


if __name__ == '__main__':
    unittest.main()
