#!/usr/bin/env python3
"""Scan exact index blobs and history; never print secret-bearing scanner output."""
import fnmatch
import hashlib
import io
import json
import re
import selectors
import struct
import time
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
# Verified against the official Gradle 9.8.0 wrapper checksum. This is an exact
# path AND content exception, never a wildcard JAR/archive exemption.
# https://services.gradle.org/distributions/gradle-9.8.0-wrapper.jar.sha256
WRAPPER = "apps/android/gradle/wrapper/gradle-wrapper.jar"
WRAPPER_SHA256 = "238e777fcddd7e34f9708186085def2abd6e08e658505b38718d79d74c21abd5"
HISTORICAL_WRAPPER_SHA256 = "7a9ce74cff467ca1bf60a4fcd9f05185acceda4d0f382434d393e17864262c5d"
REVIEWED_FONTS = {
    "apps/web/public/fonts/NanumSquareNeoTTF-aLt.woff2": "f0da0f2329935d3f88f7e4162b68fcdc0be393f74398736ea0967594282ca4e2",
    "apps/web/public/fonts/NanumSquareNeoTTF-bRg.woff2": "d13846b612acc829078aff4f91c272c637c08441b409d46bb1a4c802eb2967c3",
    "apps/web/public/fonts/NanumSquareNeoTTF-cBd.woff2": "97dfe9720fbed813fc988fcedbcf741e97eef9353515b2043717484ec0b90aa1",
    "apps/web/public/fonts/NanumSquareNeoTTF-dEb.woff2": "f27c0741248dba9a543520ff27eb32f9433de3ca50ac7ba4ccb5f5ede673c535",
    "apps/web/public/fonts/NanumSquareNeoTTF-eHv.woff2": "090b017020c0b5a8fd517460c5dfdf33819b726e1c860313c75bf0624162242d",
}
REVIEWED_TTF = {
    "apps/web/public/fonts/Paperlogy-4Regular.ttf": "05e1021e3de620dddc97875342e2be1a94c5f8e9b9f792bd16c4c1d0085343b3",
    "apps/web/public/fonts/Paperlogy-7Bold.ttf": "7effb892621474e9c2a9112f482eb87dd25b65a470e5ae5971be5a68d89ad89b",
    # Exact copies from meloming-android ecb3dbedb1dde5364bd617f072bc1ac4091b1a17.
    # Each path is hash-pinned and structurally checked below; no suffix exemption.
    "apps/android/app/src/main/res/font/ibm_plex_sans_kr_bold.ttf": "66be40fea728d36f22ea7ca37bcd2aad15ce6fc298a5f5e8b3572e9e73d7f197",
    "apps/android/app/src/main/res/font/ibm_plex_sans_kr_light.ttf": "cbfdac1f7937a9b9c78973b57b9d0831d05069b0a048dc73ae50671d26f506e1",
    "apps/android/app/src/main/res/font/ibm_plex_sans_kr_medium.ttf": "8c0f583c268f87de572bd82462b01f86e0a359a289ccfbff4061f8b5141ddd34",
    "apps/android/app/src/main/res/font/ibm_plex_sans_kr_regular.ttf": "691e167e7b78c7376992bafa04ac2478e22963b2ff7d9fc478d1c9cca5f85b9e",
    "apps/android/app/src/main/res/font/ibm_plex_sans_kr_semibold.ttf": "d87730d860b553c460c3a8bb123510b4bf1aedcdc589c344f56f033f326c8f97",
    "apps/android/app/src/main/res/font/paperlogy_bold.ttf": "7effb892621474e9c2a9112f482eb87dd25b65a470e5ae5971be5a68d89ad89b",
    "apps/android/app/src/main/res/font/paperlogy_extrabold.ttf": "fb0324f8ac057e50f4f4632331617e347bfe5a04184f7b0db514be682fb6b25c",
    "apps/android/app/src/main/res/font/paperlogy_medium.ttf": "f3c97ace885bb7d2a53a73dc71d832fa79988d5f546c2562abbb87aa07492f4b",
    "apps/android/app/src/main/res/font/paperlogy_regular.ttf": "05e1021e3de620dddc97875342e2be1a94c5f8e9b9f792bd16c4c1d0085343b3",
    "apps/android/app/src/main/res/font/paperlogy_semibold.ttf": "ca92034a1c4602a57c55434dfdbf8428a0bb88ac84a99a5effec1a41f0118127",
}
REVIEWED_PNG = {
    "apps/web/public/static/chzzk-square.png": "88c73a21da0cffa4025dec1e188e23a799c70dc101ace0343acf70a99d8e01cd",
    "apps/web/public/static/cime_square.png": "ca2e7277480266f58427f46f0cd367afb13349e30130a9c767dd539eacf552be",
    "apps/web/public/static/soop-square.png": "ca183b75de8233df7172f689d827f9c148d0c0e7321e85103bd6d64355b0b1c6",
}
# The standalone Meloming OBS overlay ships 26 selectable self-hosted Google
# font families. Their CSS references 1,609 WOFF2 subsets, so pruning the
# binaries would silently break font selection for Korean/Japanese text. Pin
# the complete upstream binary set by path and SHA-256 via its reviewed Merkle-
# style listing in the exact-copy manifest; changes require a policy edit.
OVERLAY_BINARY_SET_SHA256 = "50aa52ecf38c7510ab29f220970689f82bf1b51ba72559dcd4ca46c20c7afac3"
OVERLAY_BINARY_SUFFIXES = {".woff", ".woff2", ".png", ".ico"}


def reviewed_overlay_binaries():
    manifest = ROOT / "docs/meloming-overlay-source-manifest.tsv"
    try:
        rows = manifest.read_text().splitlines()
        if not rows[0].startswith("# source-repo=dylabs/meloming-overlay source-commit=540dd2a ") or rows[1] != "path\tsha256":
            blocked("overlay binary source manifest is invalid")
        result = {}
        for row in rows[2:]:
            name, digest = row.split("\t")
            if PurePosixPath(name).suffix.lower() not in OVERLAY_BINARY_SUFFIXES:
                continue
            path = "apps/overlay/" + name
            if path in result or not re.fullmatch(r"[a-f0-9]{64}", digest):
                blocked("overlay binary source manifest is invalid")
            result[path] = digest
        listing = "".join(f"{name.removeprefix('apps/overlay/')}\t{digest}\n"
                          for name, digest in sorted(result.items()))
        if len(result) != 1624 or hashlib.sha256(listing.encode()).hexdigest() != OVERLAY_BINARY_SET_SHA256:
            blocked("overlay binary source set differs from reviewed upstream")
        return result
    except (OSError, ValueError, IndexError):
        blocked("overlay binary source manifest is unreadable")


REVIEWED_OVERLAY_BINARIES = reviewed_overlay_binaries() if not PRIVATE_OPS and (ROOT / "docs/meloming-overlay-source-manifest.tsv").exists() else {}
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
              "regex": r"\bghs_[A-Za-z0-9._-]{36,}", "keywords": ["ghs_"]}]
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
    if name in REVIEWED_OVERLAY_BINARIES:
        if hashlib.sha256(data).hexdigest() != REVIEWED_OVERLAY_BINARIES[name]:
            blocked("overlay binary differs from reviewed upstream artifact")
        suffix = PurePosixPath(name).suffix.lower()
        if suffix == ".png":
            inspect_png(data, reviewed_metadata=True)
        elif suffix == ".ico":
            inspect_ico(data)
        else:
            inspect_woff(data, suffix)
        return
    if not PRIVATE_OPS and name == WRAPPER:
        if hashlib.sha256(data).hexdigest() not in {WRAPPER_SHA256, HISTORICAL_WRAPPER_SHA256}:
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
    if not PRIVATE_OPS and name in REVIEWED_FONTS:
        if hashlib.sha256(data).hexdigest() != REVIEWED_FONTS[name]:
            blocked("font differs from reviewed upstream artifact")
        if len(data) < 48:
            blocked("reviewed font header is truncated")
        header = struct.unpack(">4s4sIHHIIHHIIIII", data[:48])
        signature, flavor, length, tables, reserved, sfnt_size, compressed_size = header[:7]
        if (signature != b"wOF2" or flavor != b"\0\1\0\0" or length != len(data) or
                not 0 < tables <= 63 or reserved != 0 or sfnt_size == 0 or
                compressed_size == 0 or 48 + compressed_size > len(data)):
            blocked("reviewed font structure is invalid")
        return
    if not PRIVATE_OPS and name in REVIEWED_TTF:
        if hashlib.sha256(data).hexdigest() != REVIEWED_TTF[name]:
            blocked("font differs from reviewed upstream artifact")
        if len(data) < 28 or data[:4] != b"\x00\x01\x00\x00":
            blocked("reviewed TrueType font header is invalid")
        table_count = struct.unpack(">H", data[4:6])[0]
        if not 1 <= table_count <= 64 or 12 + table_count * 16 > len(data):
            blocked("reviewed TrueType font table count is invalid")
        tags = set()
        for offset in range(12, 12 + table_count * 16, 16):
            tag, _, start, size = struct.unpack(">4sIII", data[offset:offset + 16])
            if tag in tags or start < 12 + table_count * 16 or start + size > len(data):
                blocked("reviewed TrueType font table is invalid")
            tags.add(tag)
        return
    if not PRIVATE_OPS and name in REVIEWED_PNG:
        if hashlib.sha256(data).hexdigest() != REVIEWED_PNG[name]:
            blocked("image differs from reviewed upstream artifact")
        # The source icons contain only EXIF image dimensions or a Figma
        # software tag. They are exact-hash pinned and structurally checked.
        inspect_png(data, reviewed_metadata=True)
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


def inspect_woff(data, suffix):
    if suffix == ".woff2":
        if len(data) < 48:
            blocked("reviewed overlay font header is truncated")
        signature, flavor, length, tables, reserved, sfnt_size, compressed_size = struct.unpack(
            ">4s4sIHHII", data[:24])
        if (signature != b"wOF2" or flavor not in {b"\0\1\0\0", b"OTTO"} or
                length != len(data) or not 0 < tables <= 255 or reserved or
                sfnt_size == 0 or compressed_size == 0 or 48 + compressed_size > len(data)):
            blocked("reviewed overlay WOFF2 structure is invalid")
        return
    if len(data) < 44:
        blocked("reviewed overlay font header is truncated")
    signature, flavor, length, tables, reserved, sfnt_size = struct.unpack(
        ">4s4sIHHI", data[:20])
    if (signature != b"wOFF" or flavor not in {b"\0\1\0\0", b"OTTO"} or
            length != len(data) or not 0 < tables <= 255 or reserved or sfnt_size == 0 or
            44 + tables * 20 > len(data)):
        blocked("reviewed overlay WOFF structure is invalid")
    for offset in range(44, 44 + tables * 20, 20):
        _, start, compressed_size, original_size, _ = struct.unpack(">4sIIII", data[offset:offset + 20])
        if start < 44 + tables * 20 or not 0 < compressed_size <= original_size or start + compressed_size > len(data):
            blocked("reviewed overlay WOFF table is invalid")


def inspect_ico(data):
    if len(data) < 22 or data[:4] != b"\0\0\1\0":
        blocked("reviewed overlay icon header is invalid")
    count = struct.unpack("<H", data[4:6])[0]
    if not 1 <= count <= 32 or 6 + count * 16 > len(data):
        blocked("reviewed overlay icon directory is invalid")
    for offset in range(6, 6 + count * 16, 16):
        size, start = struct.unpack("<II", data[offset + 8:offset + 16])
        if size < 40 or start < 6 + count * 16 or start + size > len(data):
            blocked("reviewed overlay icon image is invalid")
        image = data[start:start + size]
        if not image.startswith((b"\x89PNG\r\n\x1a\n", b"(\0\0\0")):
            blocked("reviewed overlay icon image format is invalid")


def inspect_png(data, reviewed_metadata=False):
    import struct
    import zlib
    offset, chunks = 8, []
    while offset + 12 <= len(data):
        size = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        end = offset + size + 12
        safe_chunks = {b"IHDR", b"IDAT", b"IEND", b"PLTE", b"tRNS", b"sRGB", b"gAMA", b"cHRM", b"pHYs"}
        if reviewed_metadata:
            safe_chunks.update({b"eXIf", b"tEXt"})
        if end > len(data) or kind not in safe_chunks:
            blocked("unreviewed or malformed PNG payload")
        if kind == b"eXIf" and (size != 68 or data[offset + 8:offset + 12] != b"MM\x00*"):
            blocked("reviewed PNG EXIF payload is invalid")
        if kind == b"tEXt" and data[offset + 8:end - 4] != b"Software\x00Figma":
            blocked("reviewed PNG text payload is invalid")
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


class ObjectReader:
    """One invocation's bounded, fail-closed immutable cat-file connection."""

    def __init__(self):
        self.process = None
        self.selector = None
        self.buffer = bytearray()
        self.timeout = 120

    def __enter__(self):
        try:
            self.process = subprocess.Popen(["git", "cat-file", "--batch"], cwd=ROOT,
                                            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                            stderr=subprocess.PIPE, bufsize=0)
            self.selector = selectors.DefaultSelector()
            for pipe in (self.process.stdin, self.process.stdout, self.process.stderr):
                os.set_blocking(pipe.fileno(), False)
            self.selector.register(self.process.stdout, selectors.EVENT_READ)
            self.selector.register(self.process.stderr, selectors.EVENT_READ)
            return self
        except OSError:
            self.close()
            blocked("object reader startup failed")

    def close(self):
        if self.selector is not None:
            self.selector.close()
        if self.process is not None:
            if self.process.poll() is None:
                self.process.kill()
            self.process.wait()
            for pipe in (self.process.stdin, self.process.stdout, self.process.stderr):
                pipe.close()

    def __exit__(self, exc_type, exc, traceback):
        try:
            if exc_type is None:
                self.finish()
        finally:
            self.close()

    def events(self, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            blocked("object reader deadline exceeded")
        events = self.selector.select(remaining)
        if not events:
            blocked("object reader deadline exceeded")
        # Git is silent on successful batch reads. Never store or echo stderr;
        # even a diagnostic flood is rejected after at most 4096 bytes.
        for key, _ in events:
            if key.fileobj is self.process.stderr:
                if os.read(key.fd, 4096):
                    blocked("object reader reported an error")
                self.selector.unregister(key.fileobj)
        return events

    def receive(self, deadline):
        while True:
            for key, _ in self.events(deadline):
                if key.fileobj is self.process.stdout:
                    return os.read(key.fd, 65536)

    def exact(self, size, deadline):
        result = bytearray()
        while len(result) < size:
            if not self.buffer:
                self.buffer.extend(self.receive(deadline))
                if not self.buffer:
                    blocked("object reader returned premature EOF")
            count = min(size - len(result), len(self.buffer))
            result.extend(self.buffer[:count])
            del self.buffer[:count]
        return bytes(result)

    def read(self, oid, kind, limit=MAX_BLOB):
        if (not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", oid) or
                kind not in {"blob", "commit", "tag"} or not 0 <= limit <= MAX_BLOB):
            blocked("invalid immutable object request")
        deadline = time.monotonic() + self.timeout
        try:
            request = (oid + "\n").encode("ascii")
            self.selector.register(self.process.stdin, selectors.EVENT_WRITE)
            try:
                while request:
                    for key, _ in self.events(deadline):
                        if key.fileobj is self.process.stdin:
                            count = os.write(key.fd, request)
                            if count <= 0:
                                blocked("object reader request failed")
                            request = request[count:]
            finally:
                self.selector.unregister(self.process.stdin)
            header = bytearray()
            while len(header) < 128:
                header.extend(self.exact(1, deadline))
                if header.endswith(b"\n"):
                    break
            match = re.fullmatch(rb"([0-9a-f]{40}|[0-9a-f]{64}) (blob|commit|tag) (0|[1-9][0-9]{0,9})\n", header)
            if not match or match[1] != oid.encode("ascii") or match[2] != kind.encode("ascii"):
                blocked("object reader returned invalid identity or header")
            size = int(match[3])
            if size > limit:
                blocked("object content exceeds reviewed scan budget")
            data = self.exact(size, deadline)
            if self.exact(1, deadline) != b"\n":
                blocked("object reader returned invalid separator")
            if self.process.poll() is not None:
                blocked("object reader exited unexpectedly")
            return data
        except (OSError, ValueError, subprocess.SubprocessError):
            blocked("object reader communication failed")

    def finish(self):
        """Require clean EOF and zero exit before declaring the scan successful."""
        deadline = time.monotonic() + self.timeout
        try:
            self.process.stdin.close()
            if self.buffer or self.receive(deadline):
                blocked("object reader returned unsolicited output")
            self.selector.unregister(self.process.stdout)
            while self.selector.get_map():
                self.events(deadline)
            remaining = deadline - time.monotonic()
            if remaining <= 0 or self.process.wait(timeout=remaining) != 0:
                blocked("object reader failed to exit cleanly")
        except (OSError, ValueError, subprocess.SubprocessError):
            blocked("object reader shutdown failed")


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


def materialize(mapping, directory, blob_cache, budget, reader):
    for name, oid in mapping.items():
        if oid not in blob_cache:
            if len(blob_cache) >= MAX_OBJECTS:
                blocked("history exceeds reviewed object budget")
            remaining = MAX_TOTAL - sum(len(value) for value in blob_cache.values())
            blob_cache[oid] = reader.read(oid, "blob", min(MAX_BLOB, remaining))
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
    with ObjectReader() as reader:
        run(reader)
    print("Private-ops security checks passed." if PRIVATE_OPS else "Public-repository security checks passed.")


def run(reader):
    if len(sys.argv) != 2 or sys.argv[1] not in {"staged", "all"}:
        raise SystemExit("Usage: python3 tools/security/check.py staged|all")
    if not BINARY.is_file():
        blocked("Gitleaks missing; run python3 tools/security/install.py first")
    if subprocess.check_output([str(BINARY), "version"], text=True, stderr=subprocess.PIPE, timeout=10).strip() != "8.30.1":
        blocked("unexpected Gitleaks version; reinstall the pinned scanner")
    index = entries(git("ls-files", "--stage", "-z"), index=True)
    if not PRIVATE_OPS and (WRAPPER not in index or
                            hashlib.sha256(reader.read(index[WRAPPER], "blob")).hexdigest() != WRAPPER_SHA256):
        blocked("current Gradle wrapper differs from reviewed upstream artifact")
    if ".gitleaks.toml" not in index:
        blocked("scanner policy must be tracked in the index")
    policy = reader.read(index[".gitleaks.toml"], "blob")
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
        materialize(index, content / "index", cache, budget, reader)
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
                raw_commit = reader.read(commit, "commit")
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
                materialize(fresh, content / "history" / tree, cache, budget, reader)
                seen_pairs.update(mapping.items())
                if PRIVATE_OPS and any(name.startswith("access/qa/keys/") for name in mapping):
                    with tempfile.TemporaryDirectory(prefix="rogichat-access-") as access:
                        materialize({name: oid for name, oid in mapping.items() if name.startswith("access/qa/")}, Path(access), cache, budget, reader)
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
                    tag = reader.read(oid, "tag")
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
                    materialize({oid + ".txt": oid}, content / "tag-targets", cache, budget, reader)
                elif kind == "tree":
                    mapping = entries(git("ls-tree", "-r", "-z", oid))
                    names.update(mapping)
                    materialize(mapping, content / "tag-trees" / oid, cache, budget, reader)
                    validate_access(content / "tag-trees" / oid)
            (metadata / "refs").write_bytes(git("for-each-ref", "--format=%(refname)"))
        # Filenames themselves can contain credentials; keep them inside the
        # captured scanner boundary rather than echoing them in error messages.
        (content / "tracked-names").write_bytes("\n".join(sorted(names)).encode("utf-8", errors="surrogateescape"))
        scan(content, config, ignore)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError, RecursionError, zipfile.BadZipFile, subprocess.SubprocessError):
        blocked("validation failed; inspect privately without publishing raw diagnostics")
