"""QA archive, validated export and explicitly invoked TestFlight upload."""
import json
from pathlib import Path
import plistlib
import zipfile

from release_common import APP_ID, API_URL, ROOT, AppStoreConnect, capture, external, manifest, new_output, private_write, run, save_manifest, sha256, tree_sha256


def unlock_signing(cfg):
    """Optional dedicated QA keychain; never unlock or modify another keychain."""
    ios = cfg["ios"]
    if not ios.get("keychain"):
        return
    keychain = external(ios["keychain"])
    password_file = external(ios["keychain_password_file"])
    if password_file.stat().st_mode & 0o077:
        raise ValueError("Keychain password file must have mode 600")
    capture(["security", "unlock-keychain", "-p", password_file.read_text().strip(), str(keychain)])


def inspect_info(info, number, version):
    for key, expected in {"CFBundleIdentifier": APP_ID, "CFBundleVersion": str(number),
                          "CFBundleShortVersionString": version, "RogichatEnvironment": "qa",
                          "RogichatAPIBaseURL": API_URL, "UIDeviceFamily": [1]}.items():
        if info.get(key) != expected:
            raise ValueError("iOS bundle configuration mismatch: " + key)


def inspect_archive(path, number, version):
    app = path / "Products/Applications/Rogichat.app"
    with (app / "Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    inspect_info(info, number, version)
    capture(["codesign", "--verify", "--deep", "--strict", str(app)])
    if not (app / "embedded.mobileprovision").is_file():
        raise ValueError("Archive has no provisioning profile")
    return app / info["CFBundleExecutable"]


def inspect_ipa(path, number, version):
    with zipfile.ZipFile(path) as ipa:
        names = [name for name in ipa.namelist() if name.startswith("Payload/")
                 and name.count("/") == 2 and name.endswith(".app/Info.plist")]
        if len(names) != 1:
            raise ValueError("Expected exactly one application in IPA")
        inspect_info(plistlib.loads(ipa.read(names[0])), number, version)


def archive(cfg, number, version):
    unlock_signing(cfg)
    asc = AppStoreConnect(cfg)
    registered = asc.request("bundleIds", {"filter[identifier]": APP_ID})["data"]
    if len(registered) != 1:
        raise ValueError("Register the Rogichat QA bundle identifier first")
    directory = new_output(cfg, "ios", number)
    path = directory / "Rogichat-QA.xcarchive"
    run(["xcodebuild", "-project", str(ROOT / "apps/ios/Rogichat.xcodeproj"),
         "-scheme", "Rogichat-QA", "-configuration", "Release-QA", "-destination", "generic/platform=iOS",
         "-archivePath", str(path), "-derivedDataPath", str(directory / "DerivedData"), "-jobs", "2",
         "DEVELOPMENT_TEAM=" + cfg["ios"]["team_id"], "CURRENT_PROJECT_VERSION=" + str(number),
         "MARKETING_VERSION=" + version, *asc.signing_args(), "archive"], directory / "archive.log")
    executable = inspect_archive(path, number, version)
    manifest_path = save_manifest(directory, "ios", number, version,
                                  {"archive_info": path / "Info.plist", "executable": executable})
    value = json.loads(manifest_path.read_text())
    value["archive_path"] = str(path)
    value["archive_sha256"] = tree_sha256(path)
    private_write(manifest_path, json.dumps(value, indent=2) + "\n")
    print("Signed QA archive verified. Manifest:", manifest_path)


def export_options(team, destination, ios=None):
    options = {"method": "app-store-connect", "destination": destination, "teamID": team,
            "signingStyle": "automatic", "manageAppVersionAndBuildNumber": False,
            "testFlightInternalTestingOnly": True, "uploadSymbols": True}
    if ios and ios.get("provisioning_profile"):
        if not ios.get("signing_certificate"):
            raise ValueError("Manual export requires signing_certificate")
        options.update(signingStyle="manual", signingCertificate=ios["signing_certificate"],
                       provisioningProfiles={APP_ID: ios["provisioning_profile"]})
    return options


def export(cfg, manifest_path):
    value = manifest(manifest_path, "ios")
    unlock_signing(cfg)
    asc = AppStoreConnect(cfg)
    asc.app()  # Fail before an expensive export when the QA app record is absent.
    directory = external(manifest_path).parent
    path = external(value["archive_path"])
    inspect_archive(path, value["build_number"], value["version"])
    options = directory / "ExportOptions.plist"
    private_write(options, plistlib.dumps(export_options(cfg["ios"]["team_id"], "export", cfg["ios"])).decode())
    run(["xcodebuild", "-exportArchive", "-archivePath", str(path), "-exportOptionsPlist", str(options),
         "-exportPath", str(directory / "export"), *asc.signing_args()], directory / "export.log")
    ipas = list((directory / "export").glob("*.ipa"))
    if len(ipas) != 1:
        raise ValueError("Expected exactly one exported IPA")
    inspect_ipa(ipas[0], value["build_number"], value["version"])
    run(["xcrun", "altool", "--validate-app", str(ipas[0]), "--api-key", cfg["ios"]["key_id"],
         "--api-issuer", cfg["ios"]["issuer_id"], "--p8-file-path", str(external(cfg["ios"]["key_file"]))],
        directory / "apple-validation.log")
    value["artifacts"]["ipa"] = {"path": str(ipas[0]), "sha256": sha256(ipas[0])}
    value["apple_validated"] = True
    private_write(manifest_path, json.dumps(value, indent=2) + "\n")
    print("QA IPA exported and Apple validation passed. No upload performed.")


def upload(cfg, manifest_path):
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
    inspect_archive(path, value["build_number"], value["version"])
    options = directory / "UploadOptions.plist"
    private_write(options, plistlib.dumps(export_options(cfg["ios"]["team_id"], "upload", cfg["ios"])).decode())
    private_write(attempt, json.dumps({"build_number": value["build_number"], "state": "attempted"}) + "\n")
    run(["xcodebuild", "-exportArchive", "-archivePath", str(path), "-exportOptionsPlist", str(options),
         "-exportPath", str(directory / "upload"), *asc.signing_args()], directory / "upload.log")
    private_write(attempt, json.dumps({"build_number": value["build_number"], "state": "transport_completed"}) + "\n")
    print("Upload transport completed. Run ios-status until processingState is VALID; tester availability is separate.")


def status(cfg, number):
    values = AppStoreConnect(cfg).builds(number)
    if not values:
        print("No matching build visible yet. Do not automatically re-upload.")
    for value in values:
        attributes = value["attributes"]
        print(json.dumps({key: attributes.get(key) for key in
                          ("version", "processingState", "uploadedDate", "expired")}, ensure_ascii=False))
