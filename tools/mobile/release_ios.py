"""QA archive, validated export and explicitly invoked TestFlight upload."""
import json
from pathlib import Path
import plistlib
import shutil
import stat
import tempfile
import zipfile
from keychain_unlock import unlock
from product_guards import inspect_ios_app, inspect_ios_package, inspect_product_sources
from ios_associations import inspect_signed_callback, require_qa_signing
from ios_dependencies import inspect_ios_dependencies, XCODE_RESOLVED_FLAGS

from release_common import APP_ID, API_URL, ROOT, AppStoreConnect, capture, external, manifest, new_output, private_write, run, save_manifest, sha256, tree_sha256


def unlock_signing(cfg):
    """Optional dedicated QA keychain; never unlock or modify another keychain."""
    ios = cfg["ios"]
    if not ios.get("keychain"):
        return
    unlock(ios["keychain"], ios["keychain_password_file"])


def inspect_info(info, number, version):
    for key, expected in {"CFBundleIdentifier": APP_ID, "CFBundleVersion": str(number),
                          "CFBundleShortVersionString": version, "RogichatEnvironment": "qa",
                          "RogichatAPIBaseURL": API_URL, "UIDeviceFamily": [1]}.items():
        if info.get(key) != expected:
            raise ValueError("iOS bundle configuration mismatch: " + key)


def inspect_archive(path, number, version, cfg):
    require_qa_signing(cfg)
    app = path / "Products/Applications/Rogichat.app"
    with (app / "Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    inspect_info(info, number, version)
    inspect_ios_app(app, info.get("CFBundleExecutable", ""))
    capture(["codesign", "--verify", "--deep", "--strict", str(app)])
    if not (app / "embedded.mobileprovision").is_file():
        raise ValueError("Archive has no provisioning profile")
    inspect_signed_callback(app, (app / "embedded.mobileprovision").read_bytes(), cfg)
    return app / info["CFBundleExecutable"]


def inspect_ipa(path, number, version, cfg):
    require_qa_signing(cfg)
    with zipfile.ZipFile(path) as ipa:
        names = [name for name in ipa.namelist() if name.startswith("Payload/")
                 and name.count("/") == 2 and name.endswith(".app/Info.plist")]
        if len(names) != 1:
            raise ValueError("Expected exactly one application in IPA")
        info = plistlib.loads(ipa.read(names[0]))
        inspect_info(info, number, version)
        inspect_ios_package(ipa, names[0].removesuffix("Info.plist"), info.get("CFBundleExecutable", ""))
        prefix = names[0].removesuffix("Info.plist")
        profile = prefix + "embedded.mobileprovision"
        executable = prefix + info["CFBundleExecutable"]
        if ipa.namelist().count(profile) != 1 or ipa.namelist().count(executable) != 1:
            raise ValueError("IPA must contain one signed executable and provisioning profile")
        if len(ipa.namelist()) != len(set(ipa.namelist())):
            raise ValueError("Duplicate IPA entries")
        # Verify the whole signed app and its sealed resources in an isolated
        # directory, not only entitlement text from an extracted executable.
        with tempfile.TemporaryDirectory(prefix="rogichat-ipa-callback-") as directory:
            app = Path(directory) / "Rogichat.app"
            app.mkdir(mode=0o700)
            for entry in ipa.infolist():
                if not entry.filename.startswith(prefix):
                    continue
                relative = Path(entry.filename.removeprefix(prefix))
                if relative.is_absolute() or ".." in relative.parts or stat.S_ISLNK(entry.external_attr >> 16):
                    raise ValueError("Unsafe signed IPA entry")
                target = app / relative
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True, mode=0o700)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    with ipa.open(entry) as source, target.open("wb") as destination:
                        shutil.copyfileobj(source, destination)
                    target.chmod(0o700 if entry.external_attr >> 16 & 0o111 else 0o600)
            (app / info["CFBundleExecutable"]).chmod(0o700)
            capture(["codesign", "--verify", "--deep", "--strict", str(app)])
            inspect_signed_callback(app, ipa.read(profile), cfg)


def archive(cfg, number, version):
    inspect_product_sources(platforms=("ios",))
    inspect_ios_dependencies(ROOT)
    require_qa_signing(cfg)
    unlock_signing(cfg)
    asc = AppStoreConnect(cfg)
    asc.bundle()
    directory = new_output(cfg, "ios", number)
    path = directory / "Rogichat-QA.xcarchive"
    run(["xcodebuild", "-project", str(ROOT / "apps/ios/Rogichat.xcodeproj"),
         *XCODE_RESOLVED_FLAGS,
         "-scheme", "Rogichat-QA", "-configuration", "Release-QA", "-destination", "generic/platform=iOS",
         "-archivePath", str(path), "-derivedDataPath", str(directory / "DerivedData"), "-jobs", "2",
         "-clonedSourcePackagesDirPath", str(directory / "SourcePackages"),
         "-packageCachePath", str(directory / "PackageCache"),
         "CODE_SIGN_STYLE=Manual", "DEVELOPMENT_TEAM=" + cfg["ios"]["team_id"],
         "CODE_SIGN_IDENTITY=" + cfg["ios"]["signing_certificate"],
         "PROVISIONING_PROFILE_SPECIFIER=" + cfg["ios"]["provisioning_profile"],
         "CURRENT_PROJECT_VERSION=" + str(number), "MARKETING_VERSION=" + version, "archive"], directory / "archive.log")
    executable = inspect_archive(path, number, version, cfg)
    manifest_path = save_manifest(directory, "ios", number, version,
                                  {"archive_info": path / "Info.plist", "executable": executable})
    value = json.loads(manifest_path.read_text())
    value["archive_path"] = str(path)
    value["archive_sha256"] = tree_sha256(path)
    private_write(manifest_path, json.dumps(value, indent=2) + "\n")
    print("Signed QA archive verified. Manifest:", manifest_path)


def export_options(team, destination, ios=None):
    require_qa_signing({"ios": ios or {}})
    if ios["team_id"] != team or destination not in ("export", "upload"):
        raise ValueError("QA export team differs from the configured signing identity")
    options = {"method": "app-store-connect", "destination": destination, "teamID": team,
            "signingStyle": "manual", "manageAppVersionAndBuildNumber": False,
            "testFlightInternalTestingOnly": True, "uploadSymbols": True}
    options.update(signingCertificate=ios["signing_certificate"], provisioningProfiles={APP_ID: ios["provisioning_profile"]})
    return options


def export(cfg, manifest_path):
    require_qa_signing(cfg)
    value = manifest(manifest_path, "ios")
    if "ipa" in value["artifacts"]:
        raise ValueError("QA export already exists; do not overwrite verified artifacts")
    unlock_signing(cfg)
    asc = AppStoreConnect(cfg)
    asc.app()  # Fail before an expensive export when the QA app record is absent.
    directory = external(manifest_path).parent
    path = external(value["archive_path"])
    inspect_archive(path, value["build_number"], value["version"], cfg)
    working = _working_archive(path, directory, value["archive_sha256"], "Export")
    options = directory / "ExportOptions.plist"
    private_write(options, plistlib.dumps(export_options(cfg["ios"]["team_id"], "export", cfg["ios"])).decode())
    run(["xcodebuild", "-exportArchive", "-archivePath", str(working), "-exportOptionsPlist", str(options),
         "-exportPath", str(directory / "export"), *asc.signing_args()], directory / "export.log")
    manifest(manifest_path, "ios")  # Xcode cannot alter the canonical signed archive.
    ipas = list((directory / "export").glob("*.ipa"))
    if len(ipas) != 1:
        raise ValueError("Expected exactly one exported IPA")
    inspect_ipa(ipas[0], value["build_number"], value["version"], cfg)
    run(["xcrun", "altool", "--validate-app", str(ipas[0]), "--api-key", cfg["ios"]["key_id"],
         "--api-issuer", cfg["ios"]["issuer_id"], "--p8-file-path", str(external(cfg["ios"]["key_file"]))],
        directory / "apple-validation.log")
    value["artifacts"]["ipa"] = {"path": str(ipas[0]), "sha256": sha256(ipas[0])}
    value["apple_validated"] = True
    private_write(manifest_path, json.dumps(value, indent=2) + "\n")
    print("QA IPA exported and Apple validation passed. No upload performed.")


def upload_working_archive(path, directory, expected_hash):
    # Xcode appends Distributions to archive Info.plist after uploading. Preserve
    # the signed canonical archive and its manifest; retain the working copy as
    # private upload evidence instead of accepting a changed canonical hash.
    return _working_archive(path, directory, expected_hash, "Upload")


def _working_archive(path, directory, expected_hash, operation):
    if operation not in ("Upload", "Export"):
        raise ValueError("Unsupported archive operation")
    working = directory / (operation + "Working.xcarchive")
    shutil.copytree(path, working, symlinks=True)
    for item in working.rglob("*"):
        if item.is_symlink() and not item.resolve().is_relative_to(working):
            raise ValueError("Archive links must remain inside its independent working copy")
    if tree_sha256(working) != expected_hash:
        raise ValueError(operation + " working archive differs from the verified canonical archive")
    return working


def upload(cfg, manifest_path):
    require_qa_signing(cfg)
    value = manifest(manifest_path, "ios", uploading=True)
    unlock_signing(cfg)
    if not value.get("apple_validated") or "ipa" not in value["artifacts"]:
        raise ValueError("Run ios-export and pass Apple validation before uploading")
    asc = AppStoreConnect(cfg)
    if asc.builds(value["build_number"]):
        raise ValueError("Build number already exists; inspect ios-status instead of uploading again")
    directory = external(manifest_path).parent
    attempt = directory / "testflight-upload-attempt.json"
    if attempt.exists():
        raise ValueError("An upload was already attempted. Check ios-status and private logs; never blindly retry")
    path = external(value["archive_path"])
    inspect_archive(path, value["build_number"], value["version"], cfg)
    inspect_ipa(external(value["artifacts"]["ipa"]["path"]), value["build_number"], value["version"], cfg)
    working = upload_working_archive(path, directory, value["archive_sha256"])
    options = directory / "UploadOptions.plist"
    private_write(options, plistlib.dumps(export_options(cfg["ios"]["team_id"], "upload", cfg["ios"])).decode())
    receipt = {"build_number": value["build_number"], "state": "attempted", "commit": value["commit"],
               "archive_sha256": value["archive_sha256"], "ipa_sha256": value["artifacts"]["ipa"]["sha256"],
               "upload_archive_path": str(working)}
    private_write(attempt, json.dumps(receipt) + "\n")
    run(["xcodebuild", "-exportArchive", "-archivePath", str(working), "-exportOptionsPlist", str(options),
         "-exportPath", str(directory / "upload"), *asc.signing_args()], directory / "upload.log")
    receipt["state"] = "transport_completed"
    private_write(attempt, json.dumps(receipt) + "\n")
    print("Upload transport completed. Run ios-finalize to verify processing, Korean notes and approved internal tester access.")


def status(cfg, number):
    values = AppStoreConnect(cfg).builds(number)
    if not values:
        print("No matching build visible yet. Do not automatically re-upload.")
    for value in values:
        attributes = value["attributes"]
        print(json.dumps({key: attributes.get(key) for key in
                          ("version", "processingState", "uploadedDate", "expired")}, ensure_ascii=False))
