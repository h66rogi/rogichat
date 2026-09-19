#!/usr/bin/env python3
"""Install the pinned project generator from its official, checksum-verified release."""
import hashlib
from pathlib import Path
import urllib.request
import io
import zipfile

ROOT = Path(__file__).resolve().parents[2]
URL = "https://github.com/yonaskolb/XcodeGen/releases/download/2.44.1/xcodegen.zip"
SHA256 = "a2e905fb68446e9bb4008cdfe2e13e3f176d0cbcca828b71770f8e53fca91b73"


def main():
    data = urllib.request.urlopen(URL, timeout=120).read()
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise SystemExit("XcodeGen checksum mismatch")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = [name for name in archive.namelist() if name.endswith("/bin/xcodegen")]
        if len(names) != 1:
            raise SystemExit("Unexpected XcodeGen archive layout")
        install = ROOT / ".tools/xcodegen-2.44.1"
        for name in archive.namelist():
            relative = Path(name)
            if relative.is_absolute() or ".." in relative.parts:
                raise SystemExit("Unsafe XcodeGen archive path")
            if name.endswith("/"):
                continue
            target = install / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))
        binary = install / names[0]
        binary.chmod(0o755)
    print("Installed XcodeGen 2.44.1 with SHA-256 verification")


if __name__ == "__main__":
    main()
