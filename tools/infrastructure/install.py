#!/usr/bin/env python3
"""Install checksum-pinned validation tools into ignored .tools, never system paths."""
import hashlib
import io
from pathlib import Path
import platform
import tarfile
import urllib.request
import zipfile

TARGETS = {
    ("Darwin", "arm64"): (
        "darwin_arm64", "c2c45425ea4568da9803e127e589186cb3798a5944d9aff5a5bc15dd18267560",
        "mac_arm64", "3190ae0df98b59ab4b6021556fa35adc3c526a4f3e138776b0eaec8a037cc26121cbbb1ad53453f565551b47d37d5ba4755e2c2c3652256737fe2ce9e53c8ec0",
    ),
    ("Linux", "x86_64"): (
        "linux_amd64", "093b6ae9a2228af5029c41606bc96eb583553528aad1bfe7e0b4d62fc91e25d8",
        "linux_amd64", "8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9",
    ),
}


def main():
    target = TARGETS.get((platform.system(), platform.machine()))
    if target is None:
        raise SystemExit("Supported validation hosts: macOS arm64 and Linux x86_64.")
    tf_target, tf_hash, caddy_target, caddy_hash = target
    destination = Path(__file__).resolve().parents[2] / ".tools"
    destination.mkdir(exist_ok=True)
    assets = [
        ("terraform", f"https://releases.hashicorp.com/terraform/1.16.3/terraform_1.16.3_{tf_target}.zip", tf_hash, "sha256"),
        ("caddy", f"https://github.com/caddyserver/caddy/releases/download/v2.11.4/caddy_2.11.4_{caddy_target}.tar.gz", caddy_hash, "sha512"),
    ]
    for name, url, checksum, algorithm in assets:
        archive = urllib.request.urlopen(url, timeout=60).read()
        if hashlib.new(algorithm, archive).hexdigest() != checksum:
            raise SystemExit(f"Checksum mismatch: {name}")
        if name == "terraform":
            with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
                binary = bundle.read(name)
        else:
            with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
                entry = bundle.getmember(name)
                if not entry.isfile():
                    raise SystemExit("Invalid archive entry")
                binary = bundle.extractfile(entry).read()
        path = destination / name
        temporary = path.with_suffix(".tmp")
        temporary.write_bytes(binary)
        temporary.chmod(0o755)
        temporary.replace(path)
    print("Installed checksum-pinned Terraform 1.16.3 and Caddy 2.11.4.")


if __name__ == "__main__":
    main()
