#!/usr/bin/env python3
"""Exercise production Swift state plus test-only scenarios without a simulator.

The historical command name remains compatible with existing local scripts.
"""
import argparse
from pathlib import Path
import subprocess
import sys
import tempfile
from product_guards import inspect_product_sources
from ios_dependencies import inspect_ios_dependencies

ROOT = Path(__file__).resolve().parents[2]
SELECTED = None
SEEN = set()
CONVERSATION_CONTRACTS = [
    "Packages/RogichatRooms/Sources/RogichatRooms/ConversationContract.swift",
    "Packages/RogichatRooms/Sources/RogichatRooms/ConversationSync.swift",
    "Packages/RogichatRooms/Sources/RogichatRooms/ConversationProfiles.swift",
    "Packages/RogichatRooms/Sources/RogichatRooms/TextCommand.swift",
]
MEDIA_SOURCES = [
    "Sources/Core/Media/MediaContract.swift", "Sources/Core/Media/MediaClient.swift",
    "Sources/Core/Media/MediaUpload.swift", "Sources/Core/Media/MediaDownload.swift",
    "Sources/Core/Media/ProviderAvatarLoads.swift",
]
ACTION_SOURCES = [
    "Sources/Core/MessageActions/MessageActions.swift", "Sources/Core/MessageActions/MessageActionWire.swift",
    "Sources/Core/MessageActions/ModerationWire.swift", "Sources/Core/MessageActions/ActorBlocks.swift",
    "Sources/Core/MessageActions/MessageReadPosition.swift", "Sources/Core/MessageActions/MessageViewport.swift",
]
IDENTITY_SOURCES = [
    "Sources/Core/Identity/IdentityAttempt.swift", "Sources/Core/Identity/AppleIdentityContract.swift",
    "Sources/Core/Identity/AppleIdentityRequest.swift", "Sources/Core/Identity/AppleIdentityProblem.swift",
]
PUSH_SOURCES = [
    "Sources/Core/Push/PushLifecycle.swift", "Sources/Core/Push/NativePushContract.swift",
    "Sources/Core/Push/NativePushRequest.swift", "Sources/Core/Push/NativePushWake.swift",
    "Sources/Core/Push/PushRouteGate.swift",
]
SESSION_FEATURE_SOURCES = [
    "Sources/Core/Push/PushLifecycle.swift", "Sources/Core/Push/NativePushContract.swift",
    "Sources/Core/Realtime/RealtimeContract.swift", "Sources/Core/Realtime/RealtimeSession.swift",
]
NATIVE_FEATURE_SOURCES = [
    *MEDIA_SOURCES, *ACTION_SOURCES, *IDENTITY_SOURCES, *PUSH_SOURCES,
    "Sources/Core/Navigation/PendingRoute.swift",
    "Sources/Core/Identity/AppleIdentityCoordinator.swift",
    "Sources/Core/Push/NativePushStore.swift",
    "Sources/Core/Realtime/RealtimeContract.swift", "Sources/Core/Realtime/RealtimeSession.swift",
    "Sources/Core/Session/AccountFeatureGateway.swift",
    "Sources/Core/MessageActions/OwnBlockRooms.swift",
]
NATIVE_MODULE_NAME = "RogichatNativeStateChecks"


def swiftc(sdk, directory):
    return [
        "xcrun", "--sdk", "macosx", "swiftc", "-sdk", sdk, "-swift-version", "6",
        "-strict-concurrency=complete", "-j", "2",
        "-module-cache-path", str(directory / "ModuleCache"),
    ]


def compile_and_run(sdk, directory, name, sources):
    executable = directory / name
    subprocess.run([
        *swiftc(sdk, directory),
        *(str(ROOT / "apps/ios" / source) for source in sources), "-o", str(executable),
    ], check=True)
    subprocess.run([str(executable)], check=True)


def run_checks(sdk, directory, name, sources):
    if wanted(name):
        compile_and_run(sdk, directory, name, sources)


def run_native_checks(sdk, directory, name, common_sources, extras):
    if not wanted(name):
        return
    # A single --only check remains the fastest local loop without module setup.
    if SELECTED is not None and len(SELECTED) == 1:
        compile_and_run(sdk, directory, name, [*common_sources, *extras])
        return

    module = directory / f"{NATIVE_MODULE_NAME}.swiftmodule"
    library = directory / f"lib{NATIVE_MODULE_NAME}.dylib"
    if not module.exists():
        subprocess.run([
            *swiftc(sdk, directory), "-parse-as-library", "-module-name", NATIVE_MODULE_NAME,
            "-enable-testing", "-emit-library", "-emit-module",
            "-emit-module-path", str(module),
            *(str(ROOT / "apps/ios" / source) for source in common_sources),
            "-o", str(library),
        ], check=True)

    # The existing scenario files still run as independent executables. An
    # imported testable module gives them the same internal declarations without
    # recompiling all 49 product sources for every scenario.
    prepared = []
    for index, source in enumerate(extras):
        copied = directory / f"{name}-{index}.swift"
        copied.write_text(f"@testable import {NATIVE_MODULE_NAME}\n"
                          + (ROOT / "apps/ios" / source).read_text(encoding="utf-8"),
                          encoding="utf-8")
        prepared.append(copied)
    executable = directory / name
    subprocess.run([
        *swiftc(sdk, directory), "-parse-as-library", "-I", str(directory),
        "-L", str(directory), f"-l{NATIVE_MODULE_NAME}",
        "-Xlinker", "-rpath", "-Xlinker", str(directory),
        *(str(source) for source in prepared), "-o", str(executable),
    ], check=True)
    subprocess.run([str(executable)], check=True)


def wanted(name):
    SEEN.add(name)
    return SELECTED is None or name in SELECTED


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-scratch", type=Path, default=ROOT / ".build/rooms-tests")
    parser.add_argument("--package-cache", type=Path, default=ROOT / ".build/swiftpm-cache")
    parser.add_argument("--only", action="append", metavar="CHECK",
                        help="Run one named check for fast local feedback; repeat for more checks")
    args = parser.parse_args()
    global SELECTED
    SELECTED = set(args.only) if args.only else None
    SEEN.clear()
    inspect_ios_dependencies(ROOT)
    inspect_product_sources(platforms=("ios",))
    sdk = subprocess.check_output(["xcrun", "--sdk", "macosx", "--show-sdk-path"], text=True).strip()
    with tempfile.TemporaryDirectory(prefix="rogichat-state-checks-") as temporary:
        run_checks(sdk, Path(temporary), "channel-write-checks", [
            "Sources/Features/Channel/Channel.swift",
            "Sources/Features/Channel/Song.swift",
            "Sources/Features/Channel/Schedule.swift",
            "Sources/Features/Channel/PricingSettings.swift",
            "Sources/Features/Channel/ConsoleSession.swift",
            "Sources/Features/Channel/ConsoleSongRequest.swift",
            "Sources/Features/Channel/SongRequest.swift",
            "Sources/Features/Channel/ChannelAPIEndpoint.swift",
            "Tests/Channel/ChannelWriteChecks.swift",
        ])
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
            *CONVERSATION_CONTRACTS,
            "Sources/Core/AccountDeletion/AccountDeletionState.swift",
            "Sources/Core/Session/AppSession.swift",
            *SESSION_FEATURE_SOURCES,
            "Tests/Product/ProductStateChecks.swift",
        ])
        native_sources = [
            "Sources/Core/Navigation/ShellNavigation.swift",
            "Sources/Features/Settings/ProfileEditor.swift",
            "Sources/Features/Settings/ProfileDraft.swift",
            "Sources/Core/Notifications/M11Contract.swift",
            "Sources/Core/Notifications/M11Endpoint.swift",
            "Packages/RogichatRooms/Sources/RogichatRooms/RoomsContract.swift",
            *CONVERSATION_CONTRACTS,
            "Sources/Core/Rooms/RoomsEndpoint.swift",
            "Sources/Core/Conversation/ConversationEndpoint.swift",
            "Sources/Core/AccountDeletion/AccountDeletionState.swift",
            "Sources/Core/Session/AppSession.swift",
            "Sources/Core/AccountDeletion/AccountDeletionContract.swift",
            "Sources/Core/Network/NativeAPIClient.swift",
            "Sources/Core/Session/NativeCredentialStore.swift",
            "Sources/Core/Session/NativeSessionDTO.swift",
            "Sources/Core/Session/NativeSessionService.swift",
            "Sources/Core/Auth/SOOPAuthContract.swift",
            "Sources/Core/Auth/SOOPPending.swift",
            "Sources/Core/Auth/SOOPAuthCoordinator.swift",
        ]
        native_sources += NATIVE_FEATURE_SOURCES
        run_native_checks(sdk, Path(temporary), "native-transport-checks", native_sources, [
            "Tests/Product/NativeTransportChecks.swift",
        ])
        run_native_checks(sdk, Path(temporary), "native-auth-checks", native_sources, [
            "Tests/Product/SOOPAuthChecks.swift",
        ])
        run_native_checks(sdk, Path(temporary), "notification-contract-checks", native_sources, [
            "Sources/Features/Settings/AccountNotificationModel.swift",
            "Tests/Product/M11Checks.swift",
        ])
        run_native_checks(sdk, Path(temporary), "rooms-transport-checks", native_sources, [
            "Tests/Product/RoomsTransportChecks.swift",
        ])
        run_native_checks(sdk, Path(temporary), "conversation-transport-checks", native_sources, [
            "Tests/Product/ConversationTransportChecks.swift",
        ])
        run_native_checks(sdk, Path(temporary), "account-deletion-checks", native_sources, [
            "Tests/Product/AccountDeletionChecks.swift",
        ])
        run_native_checks(sdk, Path(temporary), "apple-composition-checks", native_sources, [
            "Tests/Features/AppleCompositionChecks.swift",
        ])
        for name, source in (
            ("native-feature-admission-checks", "Tests/Features/NativeFeatureAdmissionChecks.swift"),
            ("push-composition-checks", "Tests/Features/PushCompositionChecks.swift"),
            ("own-block-room-checks", "Tests/Features/OwnBlockRoomsChecks.swift"),
        ):
            run_native_checks(sdk, Path(temporary), name, native_sources, [source])
        run_checks(sdk, Path(temporary), "rooms-model-checks", [
            "Sources/Core/Navigation/ShellNavigation.swift",
            "Sources/Features/Settings/ProfileEditor.swift",
            "Sources/Features/Settings/ProfileDraft.swift",
            "Sources/Core/Notifications/M11Contract.swift",
            "Packages/RogichatRooms/Sources/RogichatRooms/RoomsContract.swift",
            *CONVERSATION_CONTRACTS,
            "Sources/Core/AccountDeletion/AccountDeletionState.swift",
            "Sources/Core/Session/AppSession.swift",
            *SESSION_FEATURE_SOURCES,
            "Sources/Core/State/Loadable.swift",
            "Sources/Core/Rooms/RoomsScreenModel.swift",
            "Sources/Features/Conversation/ConversationScreenModel.swift",
            "Tests/Product/RoomsModelChecks.swift",
        ])
        run_checks(sdk, Path(temporary), "conversation-model-checks", [
            "Packages/RogichatRooms/Sources/RogichatRooms/RoomsContract.swift",
            *CONVERSATION_CONTRACTS,
            "Sources/Core/State/Loadable.swift",
            "Sources/Features/Conversation/ConversationScreenModel.swift",
            "Tests/Product/ConversationModelChecks.swift",
        ])
        run_checks(sdk, Path(temporary), "media-regressions", [
            *MEDIA_SOURCES, "Tests/Media/MediaRegression.swift",
        ])
        run_checks(sdk, Path(temporary), "message-action-checks", [
            *ACTION_SOURCES, "Tests/MessageActions/MessageActionChecks.swift",
        ])
        run_checks(sdk, Path(temporary), "identity-checks", [
            "Sources/Core/Identity/IdentityAttempt.swift", "Sources/Core/Identity/AppleIdentityContract.swift",
            "Sources/Core/Identity/AppleIdentityProblem.swift", "Tests/Identity/IdentityChecks.swift",
        ])
        run_native_checks(sdk, Path(temporary), "push-checks", native_sources, [
            "Tests/Push/PushChecks.swift",
        ])
        run_checks(sdk, Path(temporary), "realtime-lifecycle-checks", [
            "Sources/Core/Realtime/RealtimeContract.swift", "Sources/Core/Realtime/NativeRealtimeManager.swift",
            "Tests/Realtime/RealtimeChecks.swift",
        ])
        run_checks(sdk, Path(temporary), "engine-io-checks", [
            "Sources/Core/Realtime/RealtimeContract.swift", "Sources/Core/Realtime/NativeEngineIOState.swift",
            "Sources/Core/Realtime/RealtimeWebSocketRequest.swift", "Tests/Realtime/EngineIOChecks.swift",
        ])
    if wanted("realtime-transport-checks"):
        subprocess.run([sys.executable, str(ROOT / "apps/ios/Tests/Realtime/run_transport_checks.py")], check=True)
    # Run real on-disk SQLite/GRDB regressions on the macOS host. The device SDK
    # build separately validates iOS packaging; no simulator or app test mode.
    if wanted("rooms-package-tests"):
        subprocess.run([
            "xcrun", "swift", "test", "--package-path", str(ROOT / "apps/ios/Packages/RogichatRooms"),
            "--scratch-path", str(args.package_scratch.resolve()), "--force-resolved-versions",
            "--cache-path", str(args.package_cache.resolve()), "--manifest-cache", "local",
            "--jobs", "2", "-Xswiftc", "-strict-concurrency=complete",
        ], check=True)
    if wanted("conversation-recovery-checks"):
        subprocess.run([
            sys.executable, str(ROOT / "tools/mobile/check_ios_conversation_recovery.py"),
            "--package-scratch", str(args.package_scratch.resolve()),
        ], check=True)
    if SELECTED is not None and (unknown := SELECTED - SEEN):
        parser.error("Unknown check: " + ", ".join(sorted(unknown)))


if __name__ == "__main__":
    main()
