"""Build exact Prod artifacts locally. No store upload, submission or promotion."""
import argparse
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import stat
import tempfile
import xml.etree.ElementTree as ET
import zipfile
import android_firebase

from android_associations import verify_callback_manifest
from ios_dependencies import inspect_ios_dependencies, XCODE_RESOLVED_FLAGS
from keychain_unlock import unlock
from prod_signing import APP_ID, DEFAULT_CONFIG, prod_config, prepare_android
from prod_capabilities import TARGETS, validate as validate_capability_profile
from product_guards import inspect_android_package, inspect_ios_app, inspect_product_sources
from release_android import bundletool, sdk_tool
from release_common import ROOT, capture, external, private_write, run, sha256, tree_sha256, version_name, version_number

API_URL = "https://api.rogi.chat/v1/"
DOMAINS = {"applinks:rogi.chat", "webcredentials:rogi.chat"}
PROFILE_NAME = TARGETS["prod"][1]
_UNSET_FIREBASE = object()


def require_prod(cfg):
    if cfg.get("environment") != "prod" or cfg.get("app_id") != APP_ID:
        raise ValueError("Prod artifact operations require the exact Prod configuration")


def environment():
    return {key: value for key, value in os.environ.items() if key not in
            {"NODE_OPTIONS", "NODE_PATH", "PYTHONPATH", "DEBUG", "FIREBASE_DEBUG", "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"}
            and not key.startswith(("ROGICHAT_QA_", "ROGICHAT_PROD_"))}


def command(args):
    return capture(args, env=environment())


def source(expected):
    if not re.fullmatch(r"[0-9a-f]{40}", expected):
        raise ValueError("Expected an exact committed source SHA")
    head = command(["git", "rev-parse", "HEAD"]).strip()
    dirty = command(["git", "status", "--porcelain"])
    if head != expected or dirty.strip():
        raise ValueError("Prod build requires the exact clean committed source")


def output(cfg, platform, number):
    require_prod(cfg)
    directory = external(cfg["artifact_root"]) / "prod" / platform / str(number)
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    return directory


def save(directory, platform, number, version, commit, artifacts, **extra):
    source(commit)  # A source edit during a build cannot produce a verified receipt.
    value = {"schema": 1, "platform": platform, "environment": "prod", "app_id": APP_ID,
             "api_url": API_URL, "build_number": number, "version": version, "commit": commit,
             "source_dirty": False, "store_uploaded": False, "artifacts": {
                 name: {"path": str(path.resolve()), "sha256": sha256(path)} for name, path in artifacts.items()}, **extra}
    path = directory / "release.json"
    private_write(path, json.dumps(value, indent=2) + "\n")
    return path


def manifest(cfg, path, platform):
    require_prod(cfg)
    path = external(path); value = json.loads(path.read_text())
    if (value.get("schema") != 1 or value.get("platform") != platform or value.get("environment") != "prod"
            or value.get("app_id") != APP_ID or value.get("api_url") != API_URL
            or value.get("source_dirty") is not False or value.get("store_uploaded") is not False):
        raise ValueError("Expected a clean exact Prod artifact receipt")
    if type(value.get("build_number")) is not int:
        raise ValueError("Invalid Prod build number")
    number = version_number(value["build_number"]); version_name(value["version"])
    source(value["commit"])
    directory = external(cfg["artifact_root"]) / "prod" / platform / str(number)
    if path != directory / "release.json":
        raise ValueError("Prod receipt must remain in its canonical artifact directory")
    expected = {"apk", "aab"} if platform == "android" else {"archive_info", "executable"}
    entries = value.get("artifacts")
    if not isinstance(entries, dict) or set(entries) not in (expected, expected | ({"ipa"} if platform == "ios" else set())):
        raise ValueError("Unexpected Prod artifact set")
    for item in entries.values():
        artifact = external(item["path"])
        if not artifact.is_relative_to(directory) or not artifact.is_file() or sha256(artifact) != item["sha256"]:
            raise ValueError("Prod artifact location or checksum changed")
    if platform == "ios":
        archive = external(value["archive_path"])
        if archive != directory / "Rogichat-Prod.xcarchive" or tree_sha256(archive) != value.get("archive_sha256"):
            raise ValueError("Canonical Prod archive changed")
        if external(entries["archive_info"]["path"]) != archive / "Info.plist":
            raise ValueError("Wrong archive metadata")
        if external(entries["executable"]["path"]) != archive / "Products/Applications/Rogichat.app/Rogichat":
            raise ValueError("Wrong archive executable")
    return value


def inspect_info(info, number, version):
    for key, expected in {"CFBundleIdentifier": APP_ID, "CFBundleVersion": str(number),
                          "CFBundleShortVersionString": version, "CFBundleDisplayName": "로기챗",
                          "CFBundleExecutable": "Rogichat", "RogichatEnvironment": "prod",
                          "RogichatAPIBaseURL": API_URL, "UIDeviceFamily": [1], "MinimumOSVersion": "18.0",
                          "CFBundleSupportedPlatforms": ["iPhoneOS"], "ITSAppUsesNonExemptEncryption": False}.items():
        if info.get(key) != expected:
            raise ValueError("Prod iOS bundle mismatch: " + key)
    if "NSAppTransportSecurity" in info:
        raise ValueError("Transport exceptions are not allowed")


def verify_entitlements(ent, profile, cfg, certificate):
    validate_capability_profile(profile, "prod", cfg, certificate)
    team = cfg["ios"]["team_id"]
    domains = ent.get("com.apple.developer.associated-domains")
    if (not isinstance(domains, list) or len(domains) != 2 or set(domains) != DOMAINS
            or ent.get("application-identifier") != team + "." + APP_ID
            or ent.get("com.apple.developer.team-identifier") != team or ent.get("get-task-allow") is not False
            or ent.get("com.apple.developer.applesignin") != ["Default"]
            or ent.get("aps-environment") != "production"
            or profile.get("Entitlements", {}).get("aps-environment") != "production"):
        raise ValueError("Signed Prod entitlement binding mismatch")
    if hashlib.sha1(certificate).hexdigest().upper() != cfg["ios"]["signing_certificate"].upper():
        raise ValueError("Unexpected Prod signing certificate")


def inspect_app(app, cfg, number, version):
    info = plistlib.loads((app / "Info.plist").read_bytes()); inspect_info(info, number, version)
    inspect_ios_app(app, "Rogichat")  # Shared privacy, pinned GRDB resources and fixture exclusion.
    command(["codesign", "--verify", "--deep", "--strict", str(app)])
    ent = plistlib.loads(command(["codesign", "-d", "--entitlements", ":-", str(app)]).encode())
    profile = plistlib.loads(command(["security", "cms", "-D", "-i", str(app / "embedded.mobileprovision")]).encode())
    with tempfile.TemporaryDirectory(prefix="rogichat-prod-certificate-") as temporary:
        prefix = str(Path(temporary) / "signer")
        command(["codesign", "-d", "--extract-certificates", prefix, str(app)])
        certificate = Path(prefix + "0").read_bytes()
    verify_entitlements(ent, profile, cfg, certificate)
    macho = command(["xcrun", "vtool", "-show-build", str(app / "Rogichat")])
    if "platform IOS" not in macho or "minos 18.0" not in macho:
        raise ValueError("Unexpected Prod executable platform")
    return app / "Rogichat"


def inspect_ipa(path, cfg, number, version):
    with zipfile.ZipFile(path) as package, tempfile.TemporaryDirectory(prefix="rogichat-prod-ipa-") as temporary:
        names = package.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate IPA entries")
        for entry in package.infolist():
            parts = Path(entry.filename).parts
            if not parts or Path(entry.filename).is_absolute() or ".." in parts or stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError("Unsafe IPA entry")
        roots = [name for name in names if name.startswith("Payload/") and name.count("/") == 2 and name.endswith(".app/Info.plist")]
        if len(roots) != 1:
            raise ValueError("Expected one Prod application")
        package.extractall(temporary)
        inspect_app(Path(temporary) / roots[0].removesuffix("/Info.plist"), cfg, number, version)


def ios_archive(cfg, number, version, commit):
    require_prod(cfg)
    source(commit); inspect_product_sources(platforms=("ios",)); inspect_ios_dependencies(ROOT)
    ios = cfg["ios"]
    if ios.get("provisioning_profile") != PROFILE_NAME:
        raise ValueError("Use the separately prepared Prod profile")
    if command(["xcodebuild", "-version"]).strip() != "Xcode 26.6\nBuild version 17F113":
        raise ValueError("Select pinned Xcode through DEVELOPER_DIR")
    unlock(ios["keychain"], ios["keychain_password_file"])
    directory = output(cfg, "ios", number); archive = directory / "Rogichat-Prod.xcarchive"
    run(["xcodebuild", "-project", str(ROOT / "apps/ios/Rogichat.xcodeproj"), *XCODE_RESOLVED_FLAGS,
         "-scheme", "Rogichat-Prod", "-configuration", "Release-Prod", "-destination", "generic/platform=iOS", "-jobs", "2",
         "-archivePath", str(archive), "-derivedDataPath", str(directory / "DerivedData"),
         "-clonedSourcePackagesDirPath", str(directory / "SourcePackages"), "-packageCachePath", str(directory / "PackageCache"),
         "CODE_SIGN_STYLE=Manual", "DEVELOPMENT_TEAM=" + ios["team_id"], "CODE_SIGN_IDENTITY=" + ios["signing_certificate"],
         "PROVISIONING_PROFILE_SPECIFIER=" + PROFILE_NAME, "CURRENT_PROJECT_VERSION=" + str(number),
         "MARKETING_VERSION=" + version, "archive"], directory / "archive.log", env=environment())
    executable = inspect_app(archive / "Products/Applications/Rogichat.app", cfg, number, version)
    save(directory, "ios", number, version, commit, {"archive_info": archive / "Info.plist", "executable": executable},
         archive_path=str(archive), archive_sha256=tree_sha256(archive))


def export_options(cfg):
    require_prod(cfg)
    ios = cfg["ios"]
    if ios.get("provisioning_profile") != PROFILE_NAME:
        raise ValueError("Expected Prod provisioning profile")
    return {"method": "app-store-connect", "destination": "export", "teamID": ios["team_id"],
            "signingStyle": "manual", "signingCertificate": ios["signing_certificate"],
            "provisioningProfiles": {APP_ID: PROFILE_NAME}, "manageAppVersionAndBuildNumber": False,
            "uploadSymbols": False, "testFlightInternalTestingOnly": False}


def ios_export(cfg, path):
    value = manifest(cfg, path, "ios"); inspect_ios_dependencies(ROOT); inspect_product_sources(platforms=("ios",))
    if "ipa" in value["artifacts"]:
        raise ValueError("Prod export already exists; verify it instead of overwriting")
    directory = external(path).parent; archive = external(value["archive_path"])
    inspect_app(archive / "Products/Applications/Rogichat.app", cfg, value["build_number"], value["version"])
    unlock(cfg["ios"]["keychain"], cfg["ios"]["keychain_password_file"])
    working = directory / "ExportWorking.xcarchive"
    shutil.copytree(archive, working, symlinks=True)
    for item in working.rglob("*"):
        if item.is_symlink() and not item.resolve().is_relative_to(working):
            raise ValueError("Export copy has an external symlink")
    if tree_sha256(working) != value["archive_sha256"]:
        raise ValueError("Export working copy mismatch")
    options = directory / "ExportOptions.plist"; private_write(options, plistlib.dumps(export_options(cfg)).decode())
    run(["xcodebuild", "-exportArchive", "-archivePath", str(working), "-exportOptionsPlist", str(options),
         "-exportPath", str(directory / "export")], directory / "export.log", env=environment())
    files = list((directory / "export").glob("*.ipa"))
    if len(files) != 1:
        raise ValueError("Expected one Prod IPA")
    inspect_ipa(files[0], cfg, value["build_number"], value["version"])
    manifest(cfg, path, "ios")  # Canonical archive remains immutable after Xcode export.
    value["artifacts"]["ipa"] = {"path": str(files[0]), "sha256": sha256(files[0])}
    value["apple_validated"] = False  # Local signatures are not App Store acceptance.
    private_write(path, json.dumps(value, indent=2) + "\n")


def android_manifest(tree):
    """Read the same aapt2 node ownership used by the callback guard."""
    verify_callback_manifest(tree, "prod")
    stack = []; applications = []
    for line in tree.splitlines():
        node = re.match(r"^(\s*)E: ([\w-]+)(?:\s|$)", line)
        if node:
            depth = len(node[1])
            while stack and stack[-1][0] >= depth: stack.pop()
            value = {"tag": node[2], "attrs": {}, "children": []}
            if stack: stack[-1][1]["children"].append(value)
            if node[2] == "application": applications.append(value)
            stack.append((depth, value)); continue
        attr = re.match(r'^\s*A: (?:http://schemas.android.com/apk/res/android:|android:)([\w-]+)(?:\([^)]*\))?=("[^"]*"|\S+)', line)
        if attr and stack:
            if attr[1] in stack[-1][1]["attrs"]: raise ValueError("Duplicate manifest attribute")
            stack[-1][1]["attrs"][attr[1]] = attr[2].strip('"')
    if len(applications) != 1: raise ValueError("Expected one Prod application")
    app = applications[0]; metadata = {}
    for child in app["children"]:
        if child["tag"] == "meta-data":
            name = child["attrs"].get("name")
            if name in metadata: raise ValueError("Duplicate application metadata")
            metadata[name] = child["attrs"].get("value")
    if (metadata.get("chat.rogi.environment") != "prod" or metadata.get("chat.rogi.apiBaseURL") != API_URL
            or app["attrs"].get("debuggable", "false") != "false" or app["attrs"].get("usesCleartextTraffic") != "false"
            or app["attrs"].get("allowBackup") != "false"):
        raise ValueError("Prod manifest environment or transport mismatch")


def xmltree(xml):
    root = ET.fromstring(xml); lines = []
    def visit(node, depth):
        lines.append(" " * depth + "E: " + node.tag)
        for key, value in node.attrib.items():
            if key.startswith("{http://schemas.android.com/apk/res/android}"):
                lines.append(" " * (depth + 2) + 'A: android:' + key.split('}', 1)[1] + '=' + json.dumps(value))
        for child in node: visit(child, depth + 2)
    visit(root, 0)
    return "\n".join(lines)


def android_certificate(cfg):
    prepare_android(cfg)  # Read existing dedicated PrivateKeyEntry; never create or rotate here.
    return sha256(external(cfg["artifact_root"]) / "signing/android-prod-upload.der")


def inspect_android(apk, aab, cfg, number, version, *, firebase=_UNSET_FIREBASE):
    if firebase is _UNSET_FIREBASE: firebase = android_firebase.load(cfg, "prod")
    certificate = android_certificate(cfg)
    for path in (apk, aab): inspect_android_package(path)
    signed = command([sdk_tool("apksigner"), "verify", "--print-certs", str(apk)])
    fingerprints = re.findall(r"^Signer #[0-9]+ certificate SHA-256 digest: ([0-9a-fA-F]{64})$", signed, re.MULTILINE)
    if len(fingerprints) != 1 or fingerprints[0].lower() != certificate:
        raise ValueError("Prod APK signer is not the dedicated upload certificate")
    info = command([sdk_tool("aapt2"), "dump", "badging", str(apk)])
    for expected in (f"package: name='{APP_ID}'", f"versionCode='{number}'", f"versionName='{version}'", "application-label:'로기챗'"):
        if expected not in info: raise ValueError("Prod APK identity/version mismatch")
    if "application-debuggable" in info: raise ValueError("Debug APK is not a Prod release")
    android_manifest(command([sdk_tool("aapt2"), "dump", "xmltree", str(apk), "--file", "AndroidManifest.xml"]))
    args = bundletool()
    command(args + ["validate", "--bundle=" + str(aab)])
    xml = command(args + ["dump", "manifest", "--bundle=" + str(aab)])
    root = ET.fromstring(xml)
    if (root.get("package") != APP_ID or root.get("{http://schemas.android.com/apk/res/android}versionCode") != str(number)
            or root.get("{http://schemas.android.com/apk/res/android}versionName") != version):
        raise ValueError("Prod AAB identity/version mismatch")
    android_manifest(xmltree(xml))
    verified = command(["jarsigner", "-verify", str(aab)])
    if "jar verified." not in verified or "unsigned entries" in verified:
        raise ValueError("AAB signature is missing or incomplete")
    cert = command(["keytool", "-printcert", "-jarfile", str(aab), "-rfc"])
    certificates = re.findall(r"-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----", cert)
    if len(certificates) != 1 or hashlib.sha256(base64.b64decode(certificates[0])).hexdigest() != certificate:
        raise ValueError("AAB signer is not the dedicated Prod upload certificate")
    android_firebase.inspect_apk(apk, firebase, sdk_tool("aapt2"), command, environment="prod")
    android_firebase.inspect_aab(aab, firebase, args, command, environment="prod")


def android_build(cfg, number, version, commit):
    require_prod(cfg)
    firebase = android_firebase.load(cfg, "prod")
    source(commit); inspect_product_sources(platforms=("android",)); android_certificate(cfg)
    android = cfg["android"]; password = external(android["password_file"]).read_text().strip()
    if not password: raise ValueError("Prod upload password is empty")
    directory = output(cfg, "android", number)
    env = dict(environment(), ROGICHAT_PROD_KEYSTORE=str(external(android["keystore"])),
               ROGICHAT_PROD_STORE_PASSWORD=password, ROGICHAT_PROD_KEY_ALIAS=android["key_alias"])
    if firebase is not None: env["ROGICHAT_PROD_FIREBASE_CONFIG_FILE"] = str(firebase.path)
    run(["./gradlew", ":app:assembleProdRelease", ":app:bundleProdRelease", f"-ProgichatBuildNumber={number}",
         f"-ProgichatVersion={version}", "--no-daemon", "--max-workers=2"], directory / "build.log", cwd=ROOT / "apps/android", env=env)
    artifacts = {}
    for kind, relative in {"apk": "apk/prod/release/app-prod-release.apk", "aab": "bundle/prodRelease/app-prod-release.aab"}.items():
        target = directory / f"rogichat-prod-{version}-{number}.{kind}"
        shutil.copy2(ROOT / "apps/android/app/build/outputs" / relative, target); target.chmod(0o600); artifacts[kind] = target
    inspect_android(artifacts["apk"], artifacts["aab"], cfg, number, version, firebase=firebase)
    save(directory, "android", number, version, commit, artifacts, firebase_sdk_state=android_firebase.state(firebase))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("ios-archive", "ios-export", "android-build", "verify-ios", "verify-android"))
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--source-sha"); parser.add_argument("--build-number", type=version_number)
    parser.add_argument("--version", type=version_name); parser.add_argument("--manifest", type=Path)
    args = parser.parse_args(); os.umask(0o077); cfg = prod_config(args.config)
    if args.action == "android-build": android_firebase.load(cfg, "prod")
    directory = external(cfg["artifact_root"]); directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / "prod-release.lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action in ("ios-archive", "android-build"):
            if not args.source_sha or not args.build_number or not args.version: parser.error("Build requires --source-sha, --build-number and --version")
            (ios_archive if args.action == "ios-archive" else android_build)(cfg, args.build_number, args.version, args.source_sha)
        else:
            if not args.manifest: parser.error("This action requires --manifest")
            if args.action == "ios-export": ios_export(cfg, args.manifest)
            else:
                platform = args.action.removeprefix("verify-"); value = manifest(cfg, args.manifest, platform)
                inspect_product_sources(platforms=(platform,))
                if platform == "ios":
                    inspect_ios_dependencies(ROOT)
                    inspect_app(Path(value["archive_path"]) / "Products/Applications/Rogichat.app", cfg, value["build_number"], value["version"])
                    if "ipa" in value["artifacts"]: inspect_ipa(Path(value["artifacts"]["ipa"]["path"]), cfg, value["build_number"], value["version"])
                else: inspect_android(*(Path(value["artifacts"][kind]["path"]) for kind in ("apk", "aab")), cfg, value["build_number"], value["version"])
    print("Prod artifact operation verified locally. No store upload or promotion performed.")


if __name__ == "__main__":
    try: main()
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print("Prod artifact operation stopped:", type(error).__name__)
        raise SystemExit(1)
