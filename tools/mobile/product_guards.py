"""Keep the distributed app composition free of the retired synthetic product.

These checks deliberately name Rogichat's retired fixtures and entry points;
platform Preview APIs and third-party symbols are not evidence of a demo app.
Run source checks before building and artifact checks again before uploading.
"""
from pathlib import Path
import plistlib
import re
import zipfile
from ios_dependencies import SDK_RESOURCE_PATHS, inspect_sdk_resources

ROOT = Path(__file__).resolve().parents[2]

# Native profile writes transmit a screen name and optional birthday/preferences
# to the account's server record. Sync also transmits an installation UUID bound
# to the authenticated account; do not assume an unverified ephemeral exemption.
# Native TEXT commands also send account-linked message bodies and recipients.
# Media uploads send account-linked photos and videos for app functionality.
# Appearance remains app-private UserDefaults.
# New data flows or required-reason APIs must update declaration and policy together.
EXPECTED_IOS_PRIVACY = {
    "NSPrivacyTracking": False,
    "NSPrivacyTrackingDomains": [],
    "NSPrivacyCollectedDataTypes": [
        {
            "NSPrivacyCollectedDataType": category,
            "NSPrivacyCollectedDataTypeLinked": True,
            "NSPrivacyCollectedDataTypeTracking": False,
            "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        }
        for category in ("NSPrivacyCollectedDataTypeUserID", "NSPrivacyCollectedDataTypeOtherDataTypes",
                         "NSPrivacyCollectedDataTypeDeviceID", "NSPrivacyCollectedDataTypeEmailsOrTextMessages",
                         "NSPrivacyCollectedDataTypePhotosorVideos")
    ],
    "NSPrivacyAccessedAPITypes": [{
        "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults",
        "NSPrivacyAccessedAPITypeReasons": ["CA92.1"],
    }],
}

RETIRED_MARKERS = (
    "WireframeHost", "WireframeFixtures", "WireframeState", "WireframeScreens",
    "LinkWireframe", "RoomsWireframe", "ChatWireframe", "ReportWireframe",
    "PreviewRole", "PreviewAudience", "NotificationPreview", "onEndPreview",
    "sample-room-a", "sample-room-b", "QA · 화면 미리보기", "미리보기 역할",
    "연결 이후 화면 미리보기", "방 1개 계정 화면 미리보기", "미리보기 종료",
    "샘플 스트리머 A", "샘플 스트리머 B", "샘플 팬 A", "샘플 팬 B",
    "샘플 로그인 상태", "다시 시도 화면 미리보기", "저장 준비 중", "탈퇴 준비 중",
    "저장 · 준비 중", "로그아웃 · 준비 중", "탈퇴 · 준비 중", "계정 연결 기능 준비 중",
    "프로필 연결 준비 중", "사진 설정 준비 중", "선택 정보 설정 준비 중",
    "로그아웃 기능은 준비 중이에요", "탈퇴 기능과 데이터 처리 안내를 준비하고 있어요",
)


def inspect_product_data(data: bytes, label: str):
    for marker in RETIRED_MARKERS:
        # Android/Swift normally use UTF-8. Also cover compiled string resources.
        if any(marker.encode(encoding) in data for encoding in ("utf-8", "utf-16le", "utf-16be")):
            raise ValueError(f"{label}: retired demo content is not allowed in a distributed app ({marker})")


def inspect_android_package(path: Path):
    """APK and AAB are both zip files; inspect code and resources in all modules."""
    with zipfile.ZipFile(path) as package:
        names = [name for name in package.namelist() if not name.endswith("/")]
        if not any(name.endswith(".dex") for name in names):
            raise ValueError(f"{path.name}: Android package has no executable code")
        for name in names:
            inspect_product_data(package.read(name), f"{path.name}/{name}")


def inspect_ios_privacy(data: bytes, label: str):
    try:
        declaration = plistlib.loads(data)
    except (plistlib.InvalidFileException, ValueError, TypeError, OverflowError) as error:
        raise ValueError(f"{label}: invalid iOS privacy manifest") from error
    if (not isinstance(declaration, dict)
            or type(declaration.get("NSPrivacyTracking")) is not bool
            or declaration != EXPECTED_IOS_PRIVACY
            or any(type(item[key]) is not bool
                   for item in declaration["NSPrivacyCollectedDataTypes"]
                   for key in ("NSPrivacyCollectedDataTypeLinked", "NSPrivacyCollectedDataTypeTracking"))):
        raise ValueError(f"{label}: iOS privacy manifest must match profile/sync/message/media data and app-private UserDefaults use")


def inspect_ios_app(app: Path, executable_name: str):
    if not executable_name or Path(executable_name).name != executable_name:
        raise ValueError("iOS bundle has an invalid executable name")
    if not (app / executable_name).is_file():
        raise ValueError("iOS bundle has no executable code")
    privacy = app / "PrivacyInfo.xcprivacy"
    if not privacy.is_file():
        raise ValueError("iOS bundle is missing PrivacyInfo.xcprivacy")
    inspect_ios_privacy(privacy.read_bytes(), app.name)
    for path in app.rglob("*"):
        if path.is_file():
            inspect_product_data(path.read_bytes(), f"{app.name}/{path.relative_to(app)}")
    try:
        inspect_sdk_resources(lambda path: (app / path).read_bytes())
    except OSError as error:
        raise ValueError("iOS bundle must include reviewed SDK privacy and license resources") from error


def inspect_ios_package(package: zipfile.ZipFile, app_prefix: str, executable_name: str):
    if not executable_name or Path(executable_name).name != executable_name:
        raise ValueError("iOS bundle has an invalid executable name")
    if app_prefix + executable_name not in package.namelist():
        raise ValueError("IPA has no executable code")
    privacy = app_prefix + "PrivacyInfo.xcprivacy"
    if package.namelist().count(privacy) != 1:
        raise ValueError("IPA must contain exactly one app PrivacyInfo.xcprivacy")
    inspect_ios_privacy(package.read(privacy), app_prefix)
    for name in package.namelist():
        if name.startswith(app_prefix) and not name.endswith("/"):
            inspect_product_data(package.read(name), name)
    for relative in SDK_RESOURCE_PATHS:
        if package.namelist().count(app_prefix + relative) != 1:
            raise ValueError("IPA must contain exactly one of each reviewed SDK privacy and license resource")
    inspect_sdk_resources(lambda path: package.read(app_prefix + path))


def _inspect_android_sources(root: Path):
    android = root / "apps/android/app/src"
    shared_entry = android / "main/java/chat/rogi/rogichat/AppEntry.kt"
    if not shared_entry.is_file():
        raise ValueError("Android QA and prod must use the shared main AppEntry.kt")
    for source_set in android.iterdir():
        if not source_set.is_dir() or source_set.name.startswith(("test", "androidTest")):
            continue
        for path in source_set.rglob("*"):
            if not path.is_file():
                continue
            if path.name == "AppEntry.kt" and path != shared_entry:
                raise ValueError("Android variants must not replace the shared product AppEntry.kt")
            inspect_product_data(path.read_bytes(), str(path.relative_to(root)))


def _inspect_ios_sources(root: Path):
    ios = root / "apps/ios"
    entry = ios / "Sources/RogichatApp.swift"
    if not entry.is_file():
        raise ValueError("iOS must have one shared RogichatApp entry point")
    if re.search(r"^\s*#(?:if|elseif)\b[^\n]*\bROGICHAT_QA\b", entry.read_text(), re.MULTILINE):
        raise ValueError("iOS QA and prod must use the same product composition")
    # Local Swift packages are product code too. Scan their declared Sources
    # trees, including bundled resources, without pulling isolated Tests or
    # downloaded .build checkouts into the product-source check.
    directories = [ios / "Sources", ios / "Resources"]
    directories.extend(sorted((ios / "Packages").glob("*/Sources")))
    for directory in directories:
        for path in directory.rglob("*"):
            if path.is_file():
                inspect_product_data(path.read_bytes(), str(path.relative_to(root)))


def inspect_product_sources(root: Path = ROOT, *, platforms=("android", "ios")):
    checks = {"android": _inspect_android_sources, "ios": _inspect_ios_sources}
    if not platforms or any(platform not in checks for platform in platforms):
        raise ValueError("Unknown or empty product source platform selection")
    for platform in platforms:
        checks[platform](root)


if __name__ == "__main__":
    inspect_product_sources()
    print("Shared product entry points and test-only fixture isolation verified")
