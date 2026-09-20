#!/usr/bin/env python3
"""Exercise production Swift state plus test-only scenarios without a simulator.

The historical command name remains compatible with existing local scripts.
"""
import argparse
from pathlib import Path
import subprocess
import tempfile
from product_guards import inspect_product_sources
from ios_dependencies import inspect_ios_dependencies

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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-scratch", type=Path, default=ROOT / ".build/rooms-tests")
    parser.add_argument("--package-cache", type=Path, default=ROOT / ".build/swiftpm-cache")
    args = parser.parse_args()
    inspect_ios_dependencies(ROOT)
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
            "Sources/Core/Notifications/M11Contract.swift",
            "Packages/RogichatRooms/Sources/RogichatRooms/RoomsContract.swift",
            "Sources/Core/Session/AppSession.swift",
            "Tests/Product/ProductStateChecks.swift",
        ])
        native_sources = [
            "Sources/Core/Navigation/ShellNavigation.swift",
            "Sources/Features/Settings/ProfileEditor.swift",
            "Sources/Features/Settings/ProfileDraft.swift",
            "Sources/Core/Notifications/M11Contract.swift",
            "Sources/Core/Notifications/M11Endpoint.swift",
            "Packages/RogichatRooms/Sources/RogichatRooms/RoomsContract.swift",
            "Sources/Core/Rooms/RoomsEndpoint.swift",
            "Sources/Core/Session/AppSession.swift",
            "Sources/Core/Network/NativeAPIClient.swift",
            "Sources/Core/Session/NativeCredentialStore.swift",
            "Sources/Core/Session/NativeSessionDTO.swift",
            "Sources/Core/Session/NativeSessionService.swift",
            "Sources/Core/Auth/SOOPAuthContract.swift",
            "Sources/Core/Auth/SOOPPending.swift",
            "Sources/Core/Auth/SOOPAuthCoordinator.swift",
        ]
        run_checks(sdk, Path(temporary), "native-transport-checks", [
            *native_sources, "Tests/Product/NativeTransportChecks.swift",
        ])
        run_checks(sdk, Path(temporary), "native-auth-checks", [
            *native_sources, "Tests/Product/SOOPAuthChecks.swift",
        ])
        run_checks(sdk, Path(temporary), "notification-contract-checks", [
            *native_sources,
            "Sources/Features/Settings/AccountNotificationModel.swift",
            "Tests/Product/M11Checks.swift",
        ])
        run_checks(sdk, Path(temporary), "rooms-transport-checks", [
            *native_sources, "Tests/Product/RoomsTransportChecks.swift",
        ])
        run_checks(sdk, Path(temporary), "rooms-model-checks", [
            "Sources/Core/Navigation/ShellNavigation.swift",
            "Sources/Features/Settings/ProfileEditor.swift",
            "Sources/Features/Settings/ProfileDraft.swift",
            "Sources/Core/Notifications/M11Contract.swift",
            "Packages/RogichatRooms/Sources/RogichatRooms/RoomsContract.swift",
            "Sources/Core/Session/AppSession.swift",
            "Sources/Core/State/Loadable.swift",
            "Sources/Core/Rooms/RoomsScreenModel.swift",
            "Tests/Product/RoomsModelChecks.swift",
        ])
    # Run real on-disk SQLite/GRDB regressions on the macOS host. The device SDK
    # build separately validates iOS packaging; no simulator or app test mode.
    subprocess.run([
        "xcrun", "swift", "test", "--package-path", str(ROOT / "apps/ios/Packages/RogichatRooms"),
        "--scratch-path", str(args.package_scratch.resolve()), "--force-resolved-versions",
        "--cache-path", str(args.package_cache.resolve()), "--manifest-cache", "local",
        "--jobs", "2", "-Xswiftc", "-strict-concurrency=complete",
    ], check=True)


if __name__ == "__main__":
    main()
