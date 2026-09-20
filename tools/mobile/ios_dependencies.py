"""Bind host persistence tests and Xcode product builds to one reviewed GRDB revision."""
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


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate dependency lock field")
        result[key] = value
    return result


def inspect_ios_dependencies(root: Path = ROOT):
    """Require both independent resolver roots to pin exactly the reviewed dependency.

    SwiftPM host tests and Xcode use different Package.resolved files. An exact
    version in Package.swift alone does not bind either resolver to a git commit.
    Resolution metadata may differ, but both pin sets must match this allowlist.
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
            if value["pins"] != [EXPECTED_PIN]:
                raise ValueError("Unexpected dependency pin set")
        except (OSError, ValueError, TypeError, UnicodeError) as error:
            raise ValueError(f"{relative}: must pin only reviewed GRDB {GRDB_VERSION} at {GRDB_REVISION}") from error


def inspect_grdb_resources(privacy: bytes, license_text: bytes):
    """Verify the actual bundle retains the pinned SDK declaration and MIT notice."""
    try:
        value = plistlib.loads(privacy)
    except (plistlib.InvalidFileException, ValueError, TypeError, OverflowError) as error:
        raise ValueError("Invalid packaged GRDB privacy manifest") from error
    if (not isinstance(value, dict) or value != GRDB_PRIVACY
            or type(value.get("NSPrivacyTracking")) is not bool):
        raise ValueError("Packaged GRDB privacy manifest differs from the reviewed SDK")
    if hashlib.sha256(license_text).hexdigest() != GRDB_LICENSE_SHA256:
        raise ValueError("Packaged GRDB license differs from the reviewed MIT notice")
