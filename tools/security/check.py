#!/usr/bin/env python3
"""Scan exact index blobs and history; never print secret-bearing scanner output."""
import fnmatch
import hashlib
import io
import json
import re
import tomllib
import zipfile
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
BINARY = ROOT / ".tools" / "gitleaks"
PRIVATE_OPS = False
MAX_BLOB = 16 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_OBJECTS = 25000
# Verified against the official Gradle 9.7.1 wrapper checksum. This is an exact
# path AND content exception, never a wildcard JAR/archive exemption.
# https://services.gradle.org/distributions/gradle-9.7.1-wrapper.jar.sha256
WRAPPER = "apps/android/gradle/wrapper/gradle-wrapper.jar"
WRAPPER_SHA256 = "7a9ce74cff467ca1bf60a4fcd9f05185acceda4d0f382434d393e17864262c5d"
SSH_REGEX = r"(?:ssh-(?:rsa|ed25519|dss)(?:-cert-v01@openssh\.com)?|ecdsa-sha2-nistp(?:256|384|521)(?:-cert-v01@openssh\.com)?|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+[A-Za-z0-9+/]{20,}={0,3}"
PUBLIC_REGEX = r"(?:-----BEGIN (?:RSA |EC )?PUBLIC KEY-----|---- BEGIN SSH2 PUBLIC KEY ----)\r?\n"
KEY_PATH = r"(^|/)access/qa/keys/[a-z0-9_-]+\.pub$"
ARCHIVE_SUFFIXES = (".zip", ".jar", ".war", ".ear", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".zst", ".lz4", ".apk", ".aab", ".ipa", ".dmg", ".iso", ".deb", ".rpm", ".aar")


def blocked(reason):
    # No untrusted names, scanner diagnostics or exception strings in CI output.
    raise SystemExit("Security check blocked: " + reason + ".")


def expected_policy():
    rules = [{"id": "rogichat-ssh-public-key", "description": "SSH public key material is also prohibited by repository policy", "regex": SSH_REGEX},
             {"id": "rogichat-public-key-formats", "description": "PEM and RFC4716 public keys are prohibited", "regex": PUBLIC_REGEX},
             {"id": "rogichat-github-installation-token", "description": "GitHub installation tokens including variable-length formats",
              "regex": r"ghs_[A-Za-z0-9._-]{36,}", "keywords": ["ghs_"]}]
    if PRIVATE_OPS:
        rules[0]["allowlists"] = [{"paths": [KEY_PATH]}]
    return {"title": "Rogichat private ops secret policy" if PRIVATE_OPS else "Rogichat public repository secret policy",
            "extend": {"useDefault": True}, "rules": rules}


def is_archive(data):
    signatures = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08", b"\x1f\x8b", b"BZh", b"\xfd7zXZ\x00", b"7z\xbc\xaf\x27\x1c", b"Rar!", b"\x28\xb5\x2f\xfd", b"\x04\x22\x4d\x18", b"!<arch>\n", b"\xed\xab\xee\xdb")
    return data.startswith(signatures) or data[257:262] == b"ustar"


def operational_json(value):
    if isinstance(value, list):
        return any(operational_json(item) for item in value)
    if not isinstance(value, dict):
        return False
    keys = set(value)
    if {"version", "serial", "lineage"} <= keys and ("resources" in keys or "modules" in keys):
        return True
    if "format_version" in keys and keys.intersection({"resource_changes", "planned_values", "prior_state", "values"}):
        return True
    return any(operational_json(item) for item in value.values())


def inspect_blob(name, data):
    if len(data) > MAX_BLOB:
        blocked("blob size exceeds reviewed scan budget")
    if not PRIVATE_OPS and name == WRAPPER:
        if hashlib.sha256(data).hexdigest() != WRAPPER_SHA256:
            blocked("Gradle wrapper differs from reviewed upstream artifact")
        # Immutable upstream bytes were audited; Gitleaks also traverses this
        # small, valid ZIP. Bound its expansion before invoking the scanner.
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 128 or sum(item.file_size for item in entries) > MAX_BLOB:
                blocked("Gradle wrapper expansion exceeds scan budget")
            if archive.testzip() is not None:
                blocked("Gradle wrapper integrity failure")
        return
    if is_archive(data):
        blocked("archive content is forbidden in source")
    # NUL-bearing unknown binaries cannot be silently skipped by text scanners.
    # PNG is the current source asset format; require a complete image with no
    # text/EXIF/custom chunks or trailing payload. Pixel steganography is outside
    # the accidental disclosure threat model and still requires asset review.
    if b"\0" in data:
        if not data.startswith(b"\x89PNG\r\n\x1a\n"):
            blocked("unreviewed binary source format")
        inspect_png(data)
    else:
        try:
            data.decode("utf-8")
        except UnicodeError:
            blocked("unreviewed binary source encoding")
    stripped = data.lstrip().removeprefix(b"\xef\xbb\xbf").lstrip()
    if stripped.startswith((b"{", b"[")):
        try:
            value = json.loads(stripped)
        except (ValueError, UnicodeError):
            # Truncated operational JSON is still prohibited, without rejecting
            # every non-JSON source/template that begins with a brace.
            fields = set(re.findall(rb'"([a-z_]+)"\s*:', data))
            if ({b"version", b"serial", b"lineage"} <= fields or
                    b"format_version" in fields and fields.intersection({b"resource_changes", b"planned_values", b"prior_state", b"values"})):
                blocked("malformed operational Terraform document")
        else:
            if operational_json(value):
                blocked("operational Terraform document")


def inspect_png(data):
    import struct
    import zlib
    offset, chunks = 8, []
    while offset + 12 <= len(data):
        size = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        end = offset + size + 12
        if end > len(data) or kind not in {b"IHDR", b"IDAT", b"IEND", b"PLTE", b"tRNS", b"sRGB", b"gAMA", b"cHRM", b"pHYs"}:
            blocked("unreviewed or malformed PNG payload")
        fixed_sizes = {b"IHDR": 13, b"IEND": 0, b"sRGB": 1, b"gAMA": 4, b"cHRM": 32, b"pHYs": 9}
        if kind in fixed_sizes and size != fixed_sizes[kind]:
            blocked("invalid PNG chunk size")
        if kind == b"PLTE" and (not 3 <= size <= 768 or size % 3):
            blocked("invalid PNG palette size")
        if kind == b"tRNS" and size > 256:
            blocked("invalid PNG transparency size")
        payload = data[offset + 4:end - 4]
        if zlib.crc32(payload) != struct.unpack(">I", data[end - 4:end])[0]:
            blocked("invalid PNG integrity")
        chunks.append(kind)
        offset = end
        if kind == b"IEND":
            break
    if not chunks or chunks[0] != b"IHDR" or chunks[-1] != b"IEND" or b"IDAT" not in chunks or offset != len(data):
        blocked("incomplete PNG or trailing payload")


def forbidden(name):
    if PRIVATE_OPS and re.fullmatch(r"access/qa/keys/[a-z0-9_-]+\.pub", name):
        return False
    if not PRIVATE_OPS and name == WRAPPER:
        return False
    path = PurePosixPath(name.lower())
    base = path.name
    if any(p in {".aws", ".ssh", ".terraform", "secrets", "node_modules", "dist", "build", ".next", ".gradle", ".turbo", "coverage"} for p in path.parts):
        return True
    if base.endswith(ARCHIVE_SUFFIXES):
        return True
    # Templates are still content-scanned; only env/tfvars/backend examples are allowed.
    if base.endswith(".example") and (base.startswith(".env") or ".tfvars" in base or "backend" in base):
        return False
    patterns = [".env", ".env.*", "*.pem", "*.key", "*.pub", "authorized_keys", "known_hosts", "*.p8", "*.p12", "*.pfx",
                "*.jks", "*.keystore", "*.mobileprovision", "*.tfstate*", "*.tfplan",
                "*.plan", "*.tfvars", "*.tfvars.json", "backend.hcl", "*.backend.hcl",
                "*.dump", "*.sqlite*", "*.db", "*.log", "google-services.json",
                "googleservice-info.plist", "credentials.json", "service-account*.json",
                "local.properties", "key.properties", ".npmrc", ".netrc", ".gitleaksignore", "id_rsa", "id_ed25519"]
    if base.endswith(".sql") and "migrations" not in path.parts:
        return True
    return any(fnmatch.fnmatchcase(base, pattern) for pattern in patterns)


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, stderr=subprocess.PIPE, timeout=120)


def scan(directory, config, ignore):
    env = {key: value for key, value in os.environ.items() if not key.startswith("GITLEAKS_")}
    result = subprocess.run([str(BINARY), "dir", str(directory), "--config", str(config),
                             "--gitleaks-ignore-path", str(ignore), "--max-decode-depth", "5",
                             "--max-archive-depth", "2", "--redact=100", "--ignore-gitleaks-allow",
                             "--no-banner", "--exit-code", "23"],
                            cwd=directory, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600)
    if result.returncode:
        blocked("potential secret detected" if result.returncode == 23 else "scanner failed")


def entries(raw, index=False):
    result = {}
    for record in raw.split(b"\0"):
        if not record:
            continue
        metadata, raw_name = record.split(b"\t", 1)
        mode, middle, last = metadata.decode("ascii").split()
        oid = middle if index else last
        if mode not in {"100644", "100755"} or (index and last != "0") or (not index and middle != "blob"):
            blocked("unmerged path, symlink, or submodule")
        name = os.fsdecode(raw_name)
        if (PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts or
                "\\" in name or forbidden(name)):
            blocked("forbidden tracked or historical path")
        result[name] = oid
    if len(result) > MAX_OBJECTS:
        blocked("tree exceeds reviewed scan budget")
    return result


def materialize(mapping, directory, blob_cache, budget):
    for name, oid in mapping.items():
        if oid not in blob_cache:
            if len(blob_cache) >= MAX_OBJECTS:
                blocked("history exceeds reviewed object budget")
            size = int(git("cat-file", "-s", oid))
            if size > MAX_BLOB or sum(len(value) for value in blob_cache.values()) + size > MAX_TOTAL:
                blocked("content exceeds reviewed scan budget")
            blob_cache[oid] = git("cat-file", "blob", oid)
        data = blob_cache[oid]
        inspect_blob(name, data)
        budget[0] += len(data)
        budget[1] += 1
        if budget[1] > MAX_OBJECTS:
            blocked("materialized files exceed reviewed scan budget")
        if budget[0] > MAX_TOTAL:
            blocked("materialized content exceeds reviewed scan budget")
        target = directory / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def validate_access(directory):
    if PRIVATE_OPS and (directory / "access/qa/keys").exists():
        result = subprocess.run([sys.executable, str(ROOT / "tools/access.py"), "validate", "--root", str(directory)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        if result.returncode:
            blocked("approved public-key manifest validation failed")


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in {"staged", "all"}:
        raise SystemExit("Usage: python3 tools/security/check.py staged|all")
    if not BINARY.is_file():
        blocked("Gitleaks missing; run python3 tools/security/install.py first")
    if subprocess.check_output([str(BINARY), "version"], text=True, stderr=subprocess.PIPE, timeout=10).strip() != "8.30.1":
        blocked("unexpected Gitleaks version; reinstall the pinned scanner")
    index = entries(git("ls-files", "--stage", "-z"), index=True)
    if ".gitleaks.toml" not in index:
        blocked("scanner policy must be tracked in the index")
    policy = git("cat-file", "blob", index[".gitleaks.toml"])
    if (ROOT / ".gitleaks.toml").read_bytes() != policy:
        blocked("scanner policy differs between index and working tree")
    if tomllib.loads(policy.decode("utf-8")) != expected_policy():
        blocked("scanner policy differs from reviewed rules; exemptions are not permitted")
    cache, budget = {}, [0, 0]
    with tempfile.TemporaryDirectory(prefix="rogichat-security-") as temporary:
        base = Path(temporary)
        content = base / "content"
        content.mkdir()
        config, ignore = base / "policy.toml", base / "empty-ignore"
        config.write_bytes(policy)
        ignore.write_bytes(b"")
        materialize(index, content / "index", cache, budget)
        validate_access(content / "index")
        names = set(index)
        if sys.argv[1] == "all":
            if git("rev-parse", "--is-shallow-repository").strip() != b"false":
                blocked("full history is required; fetch complete history")
            commits = git("rev-list", "--all").decode("ascii").splitlines()
            if len(commits) > MAX_OBJECTS:
                blocked("history exceeds reviewed commit budget")
            seen_trees, seen_pairs = set(), set()
            metadata = content / "metadata"
            metadata.mkdir()
            for commit in commits:
                if int(git("cat-file", "-s", commit)) > MAX_BLOB:
                    blocked("commit metadata exceeds reviewed scan budget")
                raw_commit = git("cat-file", "commit", commit)
                budget[0] += len(raw_commit)
                budget[1] += 1
                if budget[1] > MAX_OBJECTS:
                    blocked("metadata files exceed reviewed scan budget")
                if budget[0] > MAX_TOTAL:
                    blocked("metadata exceeds reviewed scan budget")
                (metadata / commit).write_bytes(raw_commit)
                tree = raw_commit.split(b"\n", 1)[0].removeprefix(b"tree ").decode("ascii")
                if tree in seen_trees:
                    continue
                seen_trees.add(tree)
                mapping = entries(git("ls-tree", "-r", "-z", tree))
                names.update(mapping)
                fresh = {name: oid for name, oid in mapping.items() if (name, oid) not in seen_pairs}
                # Keep actual path suffixes for the narrowly approved public-key
                # detector exception; every other detector scans those keys too.
                materialize(fresh, content / "history" / tree, cache, budget)
                seen_pairs.update(mapping.items())
                if PRIVATE_OPS and any(name.startswith("access/qa/keys/") for name in mapping):
                    with tempfile.TemporaryDirectory(prefix="rogichat-access-") as access:
                        materialize({name: oid for name, oid in mapping.items() if name.startswith("access/qa/")}, Path(access), cache, budget)
                        validate_access(Path(access))
            refs = git("for-each-ref", "--format=%(objecttype) %(objectname)").decode("ascii").splitlines()
            if len(refs) > MAX_OBJECTS:
                blocked("refs exceed reviewed scan budget")
            for ref in refs:
                kind, oid = ref.split()
                # Annotated tags can contain credentials even when their target
                # tree is clean. Include tag-of-tag chains, with a finite budget.
                seen_tags = set()
                while kind == "tag":
                    if oid in seen_tags or len(seen_tags) >= 64:
                        blocked("invalid annotated tag chain")
                    seen_tags.add(oid)
                    if int(git("cat-file", "-s", oid)) > MAX_BLOB:
                        blocked("tag metadata exceeds reviewed scan budget")
                    tag = git("cat-file", "tag", oid)
                    budget[0] += len(tag)
                    budget[1] += 1
                    if budget[1] > MAX_OBJECTS:
                        blocked("metadata files exceed reviewed scan budget")
                    if budget[0] > MAX_TOTAL:
                        blocked("metadata exceeds reviewed scan budget")
                    (metadata / oid).write_bytes(tag)
                    headers = dict(line.split(b" ", 1) for line in tag.split(b"\n\n", 1)[0].splitlines() if b" " in line)
                    oid, kind = headers[b"object"].decode("ascii"), headers[b"type"].decode("ascii")
                if kind == "blob":
                    materialize({oid + ".txt": oid}, content / "tag-targets", cache, budget)
                elif kind == "tree":
                    mapping = entries(git("ls-tree", "-r", "-z", oid))
                    names.update(mapping)
                    materialize(mapping, content / "tag-trees" / oid, cache, budget)
                    validate_access(content / "tag-trees" / oid)
            (metadata / "refs").write_bytes(git("for-each-ref", "--format=%(refname)"))
        # Filenames themselves can contain credentials; keep them inside the
        # captured scanner boundary rather than echoing them in error messages.
        (content / "tracked-names").write_bytes("\n".join(sorted(names)).encode("utf-8", errors="surrogateescape"))
        scan(content, config, ignore)
    print("Private-ops security checks passed." if PRIVATE_OPS else "Public-repository security checks passed.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError, RecursionError, zipfile.BadZipFile, subprocess.SubprocessError):
        blocked("validation failed; inspect privately without publishing raw diagnostics")
