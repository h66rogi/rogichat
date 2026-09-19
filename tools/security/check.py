#!/usr/bin/env python3
"""Scan exact index blobs and history; never print secret-bearing scanner output."""
import fnmatch
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
BINARY = ROOT / ".tools" / "gitleaks"


def forbidden(name):
    path = PurePosixPath(name.lower())
    base = path.name
    if any(p in {".aws", ".ssh", ".terraform", "secrets", "node_modules"} for p in path.parts):
        return True
    # Templates are still content-scanned; only env/tfvars/backend examples are allowed.
    if base.endswith(".example") and (base.startswith(".env") or ".tfvars" in base or "backend" in base):
        return False
    patterns = [".env", ".env.*", "*.pem", "*.key", "*.p8", "*.p12", "*.pfx",
                "*.jks", "*.keystore", "*.mobileprovision", "*.tfstate*", "*.tfplan",
                "*.plan", "*.tfvars", "*.tfvars.json", "backend.hcl", "*.backend.hcl",
                "*.dump", "*.sqlite*", "*.db", "*.log", "google-services.json",
                "googleservice-info.plist", "credentials.json", "service-account*.json",
                "local.properties", "key.properties", ".npmrc", ".netrc", ".gitleaksignore", "id_rsa", "id_ed25519"]
    if base.endswith(".sql") and "migrations" not in path.parts:
        return True
    return any(fnmatch.fnmatchcase(base, pattern) for pattern in patterns)


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def scan(*args):
    result = subprocess.run([str(BINARY), *args, "--config", str(ROOT / ".gitleaks.toml"),
                             "--redact=100", "--ignore-gitleaks-allow", "--no-banner", "--exit-code", "23"],
                            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        reason = "potential secret detected" if result.returncode == 23 else "scanner failed"
        raise SystemExit(f"Security check blocked: {reason}. Inspect locally with Gitleaks --redact=100; do not publish raw output.")


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in {"staged", "all"}:
        raise SystemExit("Usage: python3 tools/security/check.py staged|all")
    if not BINARY.is_file():
        raise SystemExit("Gitleaks missing: run python3 tools/security/install.py first.")
    if subprocess.check_output([str(BINARY), "version"], text=True).strip() != "8.30.1":
        raise SystemExit("Unexpected Gitleaks version; reinstall the pinned scanner.")
    # Scan every tracked index blob, including force-added ignored files and partial staging.
    records = git("ls-files", "--stage", "-z").split(b"\0")
    with tempfile.TemporaryDirectory(prefix="rogichat-index-") as temporary:
        for record in records:
            if not record:
                continue
            metadata, raw_name = record.split(b"\t", 1)
            mode, oid, stage = metadata.decode().split()
            name = os.fsdecode(raw_name)
            if stage != "0" or mode not in {"100644", "100755"}:
                raise SystemExit("Security check blocked: unmerged path, symlink, or submodule in index.")
            if forbidden(name):
                raise SystemExit(f"Security check blocked: forbidden tracked path {name!r}")
            path = Path(temporary) / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(git("cat-file", "blob", oid))
        scan("dir", temporary)
    if sys.argv[1] == "all":
        # All reachable refs: a deleted secret in an earlier commit still blocks a push.
        scan("git", ".", "--log-opts=--all")
    print("Public-repository security checks passed.")


if __name__ == "__main__":
    main()
