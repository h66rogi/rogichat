#!/usr/bin/env python3
"""Install a checksum-pinned Gitleaks binary without executing remote scripts."""
import hashlib
import io
import os
from pathlib import Path
import platform
import tarfile
import urllib.request

VERSION = "8.30.1"
CHECKSUMS = {
    "darwin_arm64": "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
    "darwin_x64": "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
    "linux_arm64": "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
    "linux_x64": "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
}


def main():
    arch = {"aarch64": "arm64", "x86_64": "x64"}.get(platform.machine(), platform.machine())
    target = f"{platform.system().lower()}_{arch}"
    if target not in CHECKSUMS:
        raise SystemExit("Unsupported platform; use a supported macOS/Linux host.")
    url = f"https://github.com/gitleaks/gitleaks/releases/download/v{VERSION}/gitleaks_{VERSION}_{target}.tar.gz"
    with urllib.request.urlopen(url, timeout=60) as response:
        archive = response.read()
    if hashlib.sha256(archive).hexdigest() != CHECKSUMS[target]:
        raise SystemExit("Gitleaks checksum mismatch; installation blocked.")
    destination = Path(__file__).resolve().parents[2] / ".tools" / "gitleaks"
    destination.parent.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as bundle:
        entry = bundle.getmember("gitleaks")
        if not entry.isfile():
            raise SystemExit("Invalid Gitleaks archive entry.")
        temporary = destination.with_suffix(".tmp")
        temporary.write_bytes(bundle.extractfile(entry).read())
        temporary.chmod(0o755)
        os.replace(temporary, destination)
    print(f"Installed checksum-verified Gitleaks {VERSION}.")


if __name__ == "__main__":
    main()
