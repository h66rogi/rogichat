#!/usr/bin/env python3
"""Exercise production Swift state plus test-only scenarios without a simulator.

The historical command name remains compatible with existing local scripts.
"""
from pathlib import Path
import subprocess
import tempfile
from product_guards import inspect_product_sources

ROOT = Path(__file__).resolve().parents[2]


def run_checks(sdk, directory, name, sources):
    executable = directory / name
    subprocess.run([
        "xcrun", "--sdk", "macosx", "swiftc", "-sdk", sdk, "-swift-version", "6",
        "-strict-concurrency=complete",
        *(str(ROOT / "apps/ios" / source) for source in sources), "-o", str(executable),
    ], check=True)
    subprocess.run([str(executable)], check=True)


def main():
    inspect_product_sources(platforms=("ios",))
    sdk = subprocess.check_output(["xcrun", "--sdk", "macosx", "--show-sdk-path"], text=True).strip()
    with tempfile.TemporaryDirectory(prefix="rogichat-state-checks-") as temporary:
        run_checks(sdk, Path(temporary), "navigation-state-checks", [
            "Sources/Core/Navigation/ShellNavigation.swift",
            "Sources/Core/Navigation/PendingRoute.swift",
            "Sources/Features/Settings/ProfileEditor.swift",
            "Sources/Core/Navigation/ForegroundState.swift",
            "Sources/Features/Settings/NotificationState.swift",
            "Tests/Fixtures/WireframeState.swift",
            "Tests/WireframeStateChecks.swift",
        ])
        run_checks(sdk, Path(temporary), "product-state-checks", [
            "Sources/Core/Navigation/ShellNavigation.swift",
            "Sources/Features/Settings/ProfileEditor.swift",
            "Sources/Features/Settings/ProfileDraft.swift",
            "Sources/Core/Session/AppSession.swift",
            "Tests/Product/ProductStateChecks.swift",
        ])
        run_checks(sdk, Path(temporary), "native-transport-checks", [
            "Sources/Core/Navigation/ShellNavigation.swift",
            "Sources/Features/Settings/ProfileEditor.swift",
            "Sources/Features/Settings/ProfileDraft.swift",
            "Sources/Core/Session/AppSession.swift",
            "Sources/Core/Network/NativeAPIClient.swift",
            "Sources/Core/Session/NativeCredentialStore.swift",
            "Sources/Core/Session/NativeSessionDTO.swift",
            "Sources/Core/Session/NativeSessionService.swift",
            "Tests/Product/NativeTransportChecks.swift",
        ])


if __name__ == "__main__":
    main()
