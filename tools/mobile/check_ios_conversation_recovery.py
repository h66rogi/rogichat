#!/usr/bin/env python3
"""Run native cold-session/SQLite recovery after the locked SwiftPM test build.

Uses only existing package modules/objects. Does not resolve, download, launch a
simulator, contact the API, or access system Keychain (explicit test ByteStore).
"""
import argparse
from pathlib import Path
import subprocess
from check_ios_wireframe import NATIVE_FEATURE_SOURCES

ROOT = Path(__file__).resolve().parents[2]
NATIVE_SOURCES = [
    "Sources/Core/Navigation/ShellNavigation.swift",
    "Sources/Features/Settings/ProfileEditor.swift",
    "Sources/Features/Settings/ProfileDraft.swift",
    "Sources/Core/Notifications/M11Contract.swift",
    "Sources/Core/Notifications/M11Endpoint.swift",
    "Sources/Core/Rooms/RoomsEndpoint.swift",
    "Sources/Core/AccountDeletion/AccountDeletionState.swift",
    "Sources/Core/Session/AppSession.swift",
    "Sources/Core/Network/NativeAPIClient.swift",
    "Sources/Core/AccountDeletion/AccountDeletionContract.swift",
    "Sources/Core/Session/NativeCredentialStore.swift",
    "Sources/Core/Session/NativeSessionDTO.swift",
    "Sources/Core/Session/NativeSessionService.swift",
    "Sources/Core/Auth/SOOPAuthContract.swift",
    "Sources/Core/Auth/SOOPPending.swift",
    "Sources/Core/Auth/SOOPAuthCoordinator.swift",
    "Sources/Core/Conversation/ConversationEndpoint.swift",
    "Sources/Core/Rooms/NativeRoomsRemote.swift",
    *NATIVE_FEATURE_SOURCES,
    "Tests/Integration/ConversationRecoveryChecks.swift",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-scratch", required=True, type=Path)
    args = parser.parse_args()
    scratch = args.package_scratch.resolve()
    if not scratch.is_absolute() or not scratch.is_dir():
        parser.error("--package-scratch must be an existing locked SwiftPM build")
    bins = [p for p in scratch.glob("*-apple-macosx/debug") if (p / "Modules/GRDB.swiftmodule").is_file()]
    if len(bins) != 1:
        parser.error("expected exactly one macOS SwiftPM debug module directory")
    binary = bins[0]
    objects = sorted((binary / "GRDB.build").glob("*.o")) + sorted((binary / "RogichatRooms.build").glob("*.o"))
    if not objects or not (binary / "Modules/RogichatRooms.swiftmodule").is_file():
        parser.error("run the locked package tests before the recovery harness")
    output = scratch / "conversation-recovery-checks"
    cache = scratch / "conversation-recovery-module-cache"
    subprocess.run([
        "xcrun", "--sdk", "macosx", "swiftc", "-swift-version", "6",
        "-strict-concurrency=complete", "-j", "2", "-module-cache-path", str(cache),
        "-I", str(binary / "Modules"),
        "-I", str(scratch / "checkouts/GRDB.swift/Sources/GRDBSQLite"),
        *(str(ROOT / "apps/ios" / source) for source in NATIVE_SOURCES),
        *(str(p) for p in objects), "-lsqlite3", "-o", str(output),
    ], check=True)
    subprocess.run([str(output)], check=True)


if __name__ == "__main__":
    main()
