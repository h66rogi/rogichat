"""Bind host persistence tests and Xcode product builds to reviewed SDK revisions."""
import hashlib
import json
from pathlib import Path
import plistlib
import re

ROOT = Path(__file__).resolve().parents[2]
GRDB_URL = "https://github.com/groue/GRDB.swift.git"
GRDB_VERSION = "7.11.1"
GRDB_REVISION = "b83108d10f42680d78f23fe4d4d80fc88dab3212"
GRDB_PRIVACY_PATH = "GRDB_GRDB.bundle/PrivacyInfo.xcprivacy"
GRDB_LICENSE_PATH = "GRDB-LICENSE.txt"
GRDB_LICENSE_SHA256 = "9853f9dce81365fcc1d9b46004633354450164b8d17904e92e80c444545f7e87"
GRDB_PRIVACY = {"NSPrivacyTracking": False, "NSPrivacyTrackingDomains": [],
                "NSPrivacyCollectedDataTypes": [], "NSPrivacyAccessedAPITypes": []}
RESOLVED_PATHS = (
    Path("apps/ios/Packages/RogichatRooms/Package.resolved"),
    Path("apps/ios/Rogichat.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"),
)
XCODE_RESOLVED_FLAGS = (
    "-onlyUsePackageVersionsFromResolvedFile",
    "-disableAutomaticPackageResolution",
)
EXPECTED_PIN = {
    "identity": "grdb.swift",
    "kind": "remoteSourceControl",
    "location": GRDB_URL,
    "state": {"revision": GRDB_REVISION, "version": GRDB_VERSION},
}
SOCKET_IO_PIN = {
    "identity": "socket.io-client-swift",
    "kind": "remoteSourceControl",
    "location": "https://github.com/socketio/socket.io-client-swift",
    "state": {"revision": "42da871d9369f290d6ec4930636c40672143905b", "version": "16.1.1"},
}
STARSCREAM_PIN = {
    "identity": "starscream",
    "kind": "remoteSourceControl",
    "location": "https://github.com/daltoniam/Starscream.git",
    "state": {"revision": "c6bfd1af48efcc9a9ad203665db12375ba6b145a", "version": "4.0.8"},
}
# Host persistence tests do not import networking SDKs. The app's independent
# resolver must include the reviewed realtime SDK and its transitive dependency.
EXPECTED_PINS_BY_PATH = {
    RESOLVED_PATHS[0]: [EXPECTED_PIN],
    RESOLVED_PATHS[1]: [EXPECTED_PIN, SOCKET_IO_PIN, STARSCREAM_PIN],
}
SDK_LICENSES = {
    GRDB_LICENSE_PATH: GRDB_LICENSE_SHA256,
    "SocketIO-LICENSE.txt": "97a00016e4ceff85ecd788e7f2ef38c56e9eab5dcba8278fc4437ec1c083bd8b",
    "Starscream-LICENSE.txt": "638a31c6b649beefbf234ce78425c4f80142452ef514727b635dc2a9f873ef09",
}
# These are the declarations in the pinned sources and actual device SDK app.
# Socket.IO 16.1.1 does not ship its own privacy manifest.
SDK_PRIVACY = {
    GRDB_PRIVACY_PATH: GRDB_PRIVACY,
    "Starscream_Starscream.bundle/PrivacyInfo.xcprivacy": {
        "NSPrivacyTracking": False, "NSPrivacyTrackingDomains": [],
        "NSPrivacyCollectedDataTypes": [], "NSPrivacyAccessedAPITypes": [],
    },
}
SDK_RESOURCE_PATHS = tuple(SDK_LICENSES) + tuple(SDK_PRIVACY)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate dependency lock field")
        result[key] = value
    return result


def inspect_ios_dependencies(root: Path = ROOT):
    """Require each independent resolver root to pin its reviewed dependencies.

    SwiftPM host tests and Xcode use different Package.resolved files. An exact
    version in Package.swift alone does not bind either resolver to a git commit.
    Resolution metadata may differ; each pin set must match its own allowlist.
    No resolver, network request, or credential access is performed here.
    """
    for relative in RESOLVED_PATHS:
        path = root / relative
        try:
            data = path.read_bytes()
            if len(data) > 64 * 1024:
                raise ValueError("Oversized dependency lock")
            value = json.loads(data, object_pairs_hook=_unique_object)
            if not isinstance(value, dict) or type(value.get("version")) is not int:
                raise ValueError("Invalid dependency lock schema")
            version = value["version"]
            if version not in (2, 3):
                raise ValueError("Unsupported dependency lock schema")
            keys = {"pins", "version"} | ({"originHash"} if version == 3 else set())
            if set(value) != keys:
                raise ValueError("Unexpected dependency lock fields")
            if version == 3 and (not isinstance(value["originHash"], str)
                                 or re.fullmatch(r"[0-9a-f]{64}", value["originHash"]) is None):
                raise ValueError("Invalid dependency resolution origin")
            if value["pins"] != EXPECTED_PINS_BY_PATH[relative]:
                raise ValueError("Unexpected dependency pin set")
        except (OSError, ValueError, TypeError, UnicodeError) as error:
            raise ValueError(f"{relative}: must pin exactly the reviewed SDK versions and revisions") from error


def inspect_sdk_resources(read_resource):
    """Inspect bytes from a real app directory or IPA without consulting caches."""
    for path, digest in SDK_LICENSES.items():
        if hashlib.sha256(read_resource(path)).hexdigest() != digest:
            raise ValueError(f"Packaged SDK license differs from the reviewed notice: {path}")
    for path, expected in SDK_PRIVACY.items():
        try:
            value = plistlib.loads(read_resource(path))
        except (plistlib.InvalidFileException, ValueError, TypeError, OverflowError) as error:
            raise ValueError(f"Invalid packaged SDK privacy manifest: {path}") from error
        if (not isinstance(value, dict) or value != expected
                or type(value.get("NSPrivacyTracking")) is not bool):
            raise ValueError(f"Packaged SDK privacy manifest differs from the reviewed SDK: {path}")
