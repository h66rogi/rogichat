#!/usr/bin/env python3
"""Exercise the actual Swift UI state reducer on macOS, without a simulator."""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    sdk = subprocess.check_output(["xcrun", "--sdk", "macosx", "--show-sdk-path"], text=True).strip()
    with tempfile.TemporaryDirectory(prefix="rogichat-wireframe-") as temporary:
        executable = Path(temporary) / "state-checks"
        subprocess.run([
            "xcrun", "--sdk", "macosx", "swiftc", "-sdk", sdk, "-swift-version", "6",
            "-strict-concurrency=complete", "-D", "ROGICHAT_QA",
            str(ROOT / "apps/ios/Sources/QA/WireframeState.swift"),
            str(ROOT / "apps/ios/Tests/WireframeStateChecks.swift"), "-o", str(executable),
        ], check=True)
        subprocess.run([str(executable)], check=True)


if __name__ == "__main__":
    main()
