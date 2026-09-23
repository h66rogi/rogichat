"""Adversarial tests run only in isolated temporary repositories with fake tokens."""
import hashlib
import io
import json
import os
import struct
import zipfile
import zlib
import base64
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from check import ROOT, PRIVATE_OPS, MAX_BLOB, REVIEWED_FONTS, WRAPPER, forbidden, inspect_blob


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="rogichat-guard-test-")
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        (self.repo / "tools/security").mkdir(parents=True)
        (self.repo / ".tools").mkdir()
        shutil.copy2(ROOT / "tools/security/check.py", self.repo / "tools/security/check.py")
        shutil.copy2(ROOT / ".gitleaks.toml", self.repo / ".gitleaks.toml")
        shutil.copy2(ROOT / ".tools/gitleaks", self.repo / ".tools/gitleaks")
        if PRIVATE_OPS:
            shutil.copy2(ROOT / "tools/access.py", self.repo / "tools/access.py")
        self.git("init", "-q")
        (self.repo / "README.md").write_text("Test repository\n")
        self.git("add", "README.md", ".gitleaks.toml")
        self.commit()

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True)

    def commit(self):
        # Isolated test identity, never changes any user's Git configuration.
        self.git("-c", "user.name=Guard Test", "-c", "user.email=test@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "-qm", "fixture")

    def check(self, mode="staged"):
        return subprocess.run(["python3", "tools/security/check.py", mode], cwd=self.repo,
                              capture_output=True, text=True)

    def fake_token(self):
        return "gh" + "p_" + hashlib.sha256(b"rogichat synthetic detector fixture").hexdigest()[:36]

    def installation_token(self, length, structured=False):
        # Construct only disposable synthetic strings; no token-shaped source literal.
        prefix = "gh" + "s_"
        body = ("123456_" + "eyJ" + "hbGciOiJIUzI1NiJ9." if structured else "")
        alphabet = "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7" + ("._-" if structured else "")
        return prefix + (body + alphabet * length)[:length - len(prefix)]

    def assert_installation_blocked(self, token, mode="staged"):
        result = self.check(mode)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret", result.stdout + result.stderr)
        self.assertNotIn(token, result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stdout + result.stderr)

    def test_installation_token_formats_in_exact_staged_blob(self):
        for length in (40, 390, 520, 1024, 4096):
            for structured in (False, True):
                for assignment in (False, True):
                    with self.subTest(length=length, structured=structured, assignment=assignment):
                        token = self.installation_token(length, structured)
                        self.stage_file("settings.txt", ("token=" if assignment else "") + token + "\n")
                        (self.repo / "settings.txt").write_text("clean worktree\n")
                        self.assert_installation_blocked(token)

    def test_installation_token_short_template_and_boundary(self):
        for value in ("gh" + "s_APPID_JWT", "gh" + "s_" + "a" * 35):
            self.stage_file("template.txt", value)
            self.assertEqual(self.check().returncode, 0)
        token = "gh" + "s_" + "a" * 36
        self.stage_file("template.txt", token)
        self.assert_installation_blocked(token)

    def test_installation_token_deleted_history(self):
        token = self.installation_token(520, True)
        self.stage_file("settings.txt", token)
        self.commit()
        self.git("rm", "settings.txt")
        self.commit()
        self.assertEqual(self.check().returncode, 0)
        self.assert_installation_blocked(token, "all")

    def test_installation_token_commit_metadata(self):
        token = self.installation_token(4096, True)
        self.git("-c", "user.name=Guard Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false",
                 "commit", "--allow-empty", "-qm", token)
        self.assert_installation_blocked(token, "all")

    def test_installation_token_filename_without_echo(self):
        # A filesystem component cannot contain a 390-character token; use legacy length.
        token = self.installation_token(40)
        self.stage_file(token + ".txt", "public content")
        self.assert_installation_blocked(token)

    def test_clean_repository_passes(self):
        self.assertEqual(self.check("all").returncode, 0)

    def test_force_added_ignored_path_is_blocked(self):
        (self.repo / ".gitignore").write_text(".env\n")
        (self.repo / ".env").write_text("MODE=qa\n")
        self.git("add", "-f", ".env")
        self.assertNotEqual(self.check().returncode, 0)

    def test_staged_secret_cannot_hide_behind_clean_worktree(self):
        path = self.repo / "settings.txt"
        path.write_text(self.fake_token() + " # gitleaks:allow\n")
        self.git("add", "settings.txt")
        path.write_text("clean working tree\n")
        result = self.check()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(self.fake_token(), result.stdout + result.stderr)

    def test_deleted_historical_secret_blocks_push(self):
        path = self.repo / "settings.txt"
        path.write_text(self.fake_token() + "\n")
        self.git("add", "settings.txt")
        self.commit()
        self.git("rm", "settings.txt")
        self.commit()
        self.assertEqual(self.check().returncode, 0)
        self.assertNotEqual(self.check("all").returncode, 0)

    def test_missing_scanner_fails_closed(self):
        (self.repo / ".tools/gitleaks").unlink()
        self.assertNotEqual(self.check().returncode, 0)

    def test_public_key_in_arbitrary_file_is_blocked(self):
        # Synthetic data, not a real key. Constructed so this test source contains no key.
        key = "ssh-" + "ed25519 " + base64.b64encode(b"synthetic public key policy fixture").decode()
        (self.repo / "bootstrap.txt").write_text(key + "\n")
        self.git("add", "bootstrap.txt")
        result = self.check()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(key, result.stdout + result.stderr)

    def test_deleted_historical_public_key_blocks_push(self):
        key = "ssh-" + "rsa " + base64.b64encode(b"synthetic historical public key fixture").decode()
        (self.repo / "bootstrap.txt").write_text(key + "\n")
        self.git("add", "bootstrap.txt")
        self.commit()
        self.git("rm", "bootstrap.txt")
        self.commit()
        self.assertNotEqual(self.check("all").returncode, 0)

    def stage_file(self, name, content):
        target = self.repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content if isinstance(content, bytes) else content.encode())
        self.git("add", "-f", name)

    def assert_blocked(self, mode="staged"):
        result = self.check(mode)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(self.fake_token(), result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stdout + result.stderr)

    def test_public_pem_and_rfc4716_formats_are_blocked(self):
        for kind in ["PUBLIC KEY", "RSA PUBLIC KEY", "EC PUBLIC KEY", "SSH2 PUBLIC KEY"]:
            with self.subTest(kind=kind):
                marker = ("---- BEGIN " + kind + " ----") if kind.startswith("SSH2") else ("-----BEGIN " + kind + "-----")
                self.stage_file("renamed.txt", marker + "\n" + base64.b64encode(b"disposable synthetic key-shaped content").decode() + "\n")
                self.assert_blocked()

    def test_generated_real_public_key_formats_are_blocked(self):
        with tempfile.TemporaryDirectory(prefix="rogichat-disposable-key-") as temporary:
            key = Path(temporary) / "disposable"
            subprocess.run(["ssh-keygen", "-q", "-t", "rsa", "-b", "2048", "-N", "", "-f", str(key)], check=True, capture_output=True)
            for kind in ["PKCS8", "PEM", "RFC4716"]:
                with self.subTest(kind=kind):
                    result = subprocess.run(["ssh-keygen", "-e", "-m", kind, "-f", str(key) + ".pub"], check=True, capture_output=True)
                    self.stage_file("renamed.txt", result.stdout)
                    self.assert_blocked()

    def test_archives_and_renamed_archives_are_blocked(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("payload.txt", self.fake_token())
        for name, data in [("asset.zip", stream.getvalue()), ("renamed.txt", stream.getvalue()),
                           ("malformed.txt", b"PK\x03\x04truncated"), ("app.apk", b"harmless"),
                           ("binary.txt", b"\0unsupported"), ("build/client.js", b"harmless")]:
            with self.subTest(name=name):
                self.stage_file(name, data)
                self.assert_blocked()
                self.git("rm", "--cached", name)

    def test_gzip_tar_and_compressed_magic_are_blocked(self):
        import gzip
        import tarfile
        tar_stream = io.BytesIO()
        with tarfile.open(fileobj=tar_stream, mode="w") as archive:
            info = tarfile.TarInfo("payload.txt")
            payload = self.fake_token().encode()
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))
        for data in [tar_stream.getvalue(), gzip.compress(tar_stream.getvalue()), b"7z\xbc\xaf\x27\x1c", b"\xfd7zXZ\0"]:
            self.stage_file("renamed.txt", data)
            self.assert_blocked()

    def test_deleted_historical_paths_are_blocked(self):
        self.stage_file("archive.tfstate", "{}")
        self.commit()
        self.git("rm", "archive.tfstate")
        self.commit()
        self.assertEqual(self.check().returncode, 0)
        self.assert_blocked("all")

    def test_renamed_and_truncated_terraform_documents_are_blocked(self):
        documents = [{"version": 4, "serial": 0, "lineage": "synthetic", "resources": []},
                     {"format_version": "1.2", "resource_changes": []},
                     {"format_version": "1.0", "values": {"root_module": {}}},
                     {"nested": {"format_version": "1.2", "planned_values": {}}}]
        for document in documents:
            with self.subTest(fields=sorted(document)):
                self.stage_file("renamed.txt", json.dumps(document))
                self.assert_blocked()
        self.stage_file("renamed.txt", json.dumps(documents[0])[:-1])
        self.assert_blocked()

    def test_utf8_bom_state_and_plan_are_blocked_but_normal_json_passes(self):
        self.stage_file("bom.txt", b"\xef\xbb\xbf" + json.dumps({"version": 1, "name": "public contract"}).encode())
        self.assertEqual(self.check().returncode, 0)
        for document in [{"version": 4, "serial": 0, "lineage": "synthetic", "resources": []},
                         {"format_version": "1.2", "resource_changes": []}]:
            self.stage_file("bom.txt", b"\xef\xbb\xbf" + json.dumps(document).encode())
            self.assert_blocked()

    def test_normal_json_templates_and_migrations_pass(self):
        self.stage_file("example.json", json.dumps({"version": 1, "resources": [], "format_version": "contract-v1"}))
        self.stage_file("apps/api/migrations/001.sql", "CREATE TABLE example (id INT);")
        self.stage_file("backend.hcl.example", 'bucket = "example-only"\n')
        self.assertEqual(self.check("all").returncode, 0)

    def test_untracked_ignore_does_not_suppress_detection(self):
        self.stage_file("payload.txt", self.fake_token())
        self.commit()
        self.git("rm", "payload.txt")
        self.commit()
        # Obtain the actual original Git detector fingerprint in this disposable
        # repository. It must never act as an implicit baseline for the wrapper.
        report = self.repo / "report.json"
        subprocess.run([str(self.repo / ".tools/gitleaks"), "git", ".", "--config", str(self.repo / ".gitleaks.toml"),
                        "--report-format", "json", "--report-path", str(report), "--redact=100"], cwd=self.repo, capture_output=True)
        findings = json.loads(report.read_text())
        self.assertTrue(findings)
        (self.repo / ".gitleaksignore").write_text("\n".join(item["Fingerprint"] for item in findings))
        self.assert_blocked("all")

    def test_worktree_or_staged_policy_exemptions_are_blocked(self):
        policy = self.repo / ".gitleaks.toml"
        policy.write_text(policy.read_text() + "\n[allowlist]\nregexes = ['.*']\n")
        self.assert_blocked()
        self.git("add", ".gitleaks.toml")
        self.assert_blocked()

    def test_scanner_environment_override_is_ignored(self):
        self.stage_file("payload.txt", self.fake_token())
        env = os.environ.copy()
        env["GITLEAKS_CONFIG_TOML"] = "[allowlist]\nregexes = ['.*']"
        result = subprocess.run(["python3", "tools/security/check.py", "staged"], cwd=self.repo, env=env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)

    def test_forbidden_filename_is_not_echoed(self):
        self.stage_file(".env." + self.fake_token(), "harmless")
        self.assert_blocked()

    def test_secret_in_other_filename_is_blocked_without_echo(self):
        self.stage_file(self.fake_token() + ".txt", "harmless")
        self.assert_blocked()

    def test_oversized_blob_fails_closed(self):
        self.stage_file("oversized.txt", b"a" * (MAX_BLOB + 1))
        self.assert_blocked()

    def test_symlink_in_index_is_blocked(self):
        (self.repo / "link.txt").symlink_to("README.md")
        self.git("add", "link.txt")
        self.assert_blocked()

    def test_annotated_tag_metadata_blocks_push(self):
        self.git("-c", "user.name=Guard Test", "-c", "user.email=test@example.invalid", "-c", "tag.gpgsign=false",
                 "tag", "-a", "v-fixture", "-m", self.fake_token())
        self.assert_blocked("all")

    def test_secret_in_tag_only_blob_blocks_push(self):
        payload = self.repo / "temporary.txt"
        payload.write_text(self.fake_token())
        oid = self.git("hash-object", "-w", str(payload)).stdout.decode().strip()
        self.git("-c", "tag.gpgsign=false", "tag", "blob-fixture", oid)
        self.assert_blocked("all")

    def test_tag_chain_and_tree_targets_are_scanned(self):
        # Exercise clean tag-of-tag traversal before making only its target dirty.
        self.git("-c", "user.name=Guard Test", "-c", "user.email=test@example.invalid",
                 "-c", "tag.gpgsign=false", "tag", "-a", "inner", "-m", "fixture")
        self.git("-c", "user.name=Guard Test", "-c", "user.email=test@example.invalid",
                 "-c", "tag.gpgsign=false", "tag", "-a", "outer", "inner", "-m", "fixture")
        self.assertEqual(self.check("all").returncode, 0)
        self.stage_file("payload.txt", self.fake_token())
        tree = self.git("write-tree").stdout.decode().strip()
        self.git("-c", "tag.gpgsign=false", "tag", "tree-fixture", tree)
        self.git("rm", "--cached", "payload.txt")
        self.assertEqual(self.check().returncode, 0)
        self.assert_blocked("all")

    def test_refname_secret_is_scanned(self):
        self.git("branch", self.fake_token())
        self.assert_blocked("all")

    def test_shared_blob_does_not_exempt_forbidden_historical_path(self):
        self.stage_file("allowed.txt", "same bytes")
        self.stage_file(".env", "same bytes")
        self.commit()
        self.git("rm", ".env")
        self.commit()
        self.assertEqual(self.check().returncode, 0)
        self.assert_blocked("all")

    def test_scanner_failure_and_wrong_version_fail_closed(self):
        scanner = self.repo / ".tools/gitleaks"
        scanner.write_text('#!/bin/sh\nif [ "$1" = version ]; then echo 8.30.1; else exit 2; fi\n')
        self.assert_blocked()
        scanner.write_text('#!/bin/sh\necho 0.0.0\n')
        self.assert_blocked()

    def test_secret_in_commit_metadata_blocks_push(self):
        self.git("-c", "user.name=Guard Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false",
                 "commit", "--allow-empty", "-qm", self.fake_token())
        self.assert_blocked("all")

    def test_png_payload_and_integrity(self):
        def chunk(kind, payload):
            return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
        png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        png += chunk(b"IDAT", zlib.compress(b"\0\0\0\0")) + chunk(b"IEND", b"")
        inspect_blob("icon.png", png)
        for data in [png + b"trailing", png[:-1], png[:33] + chunk(b"tEXt", self.fake_token().encode()) + png[33:]]:
            with self.assertRaises(SystemExit):
                inspect_blob("icon.png", data)

    @unittest.skipIf(PRIVATE_OPS, "Gradle exception belongs only to public source")
    def test_exact_gradle_wrapper_passes_but_changed_or_renamed_fails(self):
        data = (ROOT / WRAPPER).read_bytes()
        self.stage_file(WRAPPER, data)
        self.assertEqual(self.check("all").returncode, 0)
        self.stage_file(WRAPPER, data + b"trailing")
        self.assert_blocked()
        with self.assertRaises(SystemExit):
            inspect_blob("renamed.txt", data)

    @unittest.skipIf(PRIVATE_OPS, "Reviewed web fonts belong only to public source")
    def test_exact_reviewed_fonts_pass_but_changed_or_renamed_fail(self):
        for name in REVIEWED_FONTS:
            with self.subTest(name=name):
                data = (ROOT / name).read_bytes()
                inspect_blob(name, data)
                with self.assertRaises(SystemExit):
                    inspect_blob(name, data + b"trailing")
                with self.assertRaises(SystemExit):
                    inspect_blob("apps/web/public/fonts/renamed.woff2", data)

        first_name = next(iter(REVIEWED_FONTS))
        self.stage_file(first_name, (ROOT / first_name).read_bytes())
        self.assertEqual(self.check().returncode, 0)

    @unittest.skipUnless(PRIVATE_OPS, "Private access manifest policy")
    def test_private_manifest_keys_remain_usable_and_history_checked(self):
        with tempfile.TemporaryDirectory(prefix="rogichat-disposable-access-") as temporary:
            key = Path(temporary) / "disposable"
            subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True, capture_output=True)
            public = Path(str(key) + ".pub").read_bytes()
            self.stage_file("access/qa/keys/operator.pub", public)
            self.assert_blocked()
            self.stage_file("access/qa/manifest.json", json.dumps({"version": 1, "user": "ubuntu", "keys": [{"file": "keys/operator.pub", "owner": "operator", "purpose": "admin"}]}))
            self.assertEqual(self.check("all").returncode, 0)
            self.commit()
            self.git("rm", "-r", "access")
            self.commit()
            self.assertEqual(self.check("all").returncode, 0)
            self.stage_file("copied.txt", public)
            self.assert_blocked()

    def test_sensitive_paths_and_templates(self):
        for path in ["apps/api/.env.qa", "x/terraform.tfstate.backup", "x/key.p8",
                     "x/credentials.json", "x/prod.tfvars.json", "x/.gitleaksignore",
                     "ssh/deploy.pub", "ssh/authorized_keys", "ssh/known_hosts"]:
            self.assertTrue(forbidden(path), path)
        for path in ["apps/api/.env.example", "qa.tfvars.example", "backend.hcl.example",
                     "infrastructure/.terraform.lock.hcl", "apps/api/migrations/001.sql"]:
            self.assertFalse(forbidden(path), path)


if __name__ == "__main__":
    unittest.main()
