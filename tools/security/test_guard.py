"""Adversarial tests run only in isolated temporary repositories with fake tokens."""
import hashlib
import base64
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from check import ROOT, forbidden


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
        self.git("init", "-q")
        (self.repo / "README.md").write_text("Test repository\n")
        self.git("add", "README.md")
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
