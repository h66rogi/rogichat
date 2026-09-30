"""Build signed QA APK/AAB locally; optionally upload APK to Firebase."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request
import android_firebase
import firebase_auth

from release_common import APP_ID, API_URL, ROOT, capture, cli_environment, external, manifest, new_output, private_write, required, run, save_manifest, sha256
from product_guards import inspect_android_package, inspect_product_sources
from android_associations import verify_callback_manifest

BUNDLETOOL_VERSION = "1.18.3"
BUNDLETOOL_SHA = "a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29"


def bundletool():
    path = ROOT / ".tools" / f"bundletool-{BUNDLETOOL_VERSION}.jar"
    if not path.exists():
        path.parent.mkdir(exist_ok=True)
        data = urllib.request.urlopen(f"https://github.com/google/bundletool/releases/download/{BUNDLETOOL_VERSION}/bundletool-all-{BUNDLETOOL_VERSION}.jar", timeout=120).read()
        import hashlib
        if hashlib.sha256(data).hexdigest() != BUNDLETOOL_SHA:
            raise ValueError("bundletool checksum mismatch")
        path.write_bytes(data)
    if sha256(path) != BUNDLETOOL_SHA:
        raise ValueError("bundletool checksum mismatch")
    return ["java", "-jar", str(path)]


def sdk_tool(name):
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if not sdk:
        raise ValueError("Set ANDROID_HOME")
    return str(Path(sdk) / "build-tools/37.0.0" / name)


def verify_apk(path, number, version):
    inspect_android_package(path)
    capture([sdk_tool("apksigner"), "verify", str(path)])
    info = capture([sdk_tool("aapt2"), "dump", "badging", str(path)])
    for expected in (f"package: name='{APP_ID}'", f"versionCode='{number}'", f"versionName='{version}-qa'", "application-label:'로기챗 QA'"):
        if expected not in info:
            raise ValueError("APK identity/version mismatch")
    if "application-debuggable" in info:
        raise ValueError("Tester APK must be the signed QA release variant")
    xml = capture([sdk_tool("aapt2"), "dump", "xmltree", str(path), "--file", "AndroidManifest.xml"])
    verify_callback_manifest(xml, "qa")
    if f'"{API_URL}"' not in xml:
        raise ValueError("Wrong API endpoint in APK")


def build(cfg, number, version):
    firebase = android_firebase.load(cfg, "qa")
    inspect_product_sources(platforms=("android",))
    android = cfg["android"]
    required(android, "keystore", "password_file", "key_alias")
    keystore = external(android["keystore"])
    password_file = external(android["password_file"])
    if password_file.stat().st_mode & 0o077 or keystore.stat().st_mode & 0o077:
        raise ValueError("QA signing files must have mode 600")
    password = password_file.read_text().strip()
    if not password:
        raise ValueError("QA signing password is empty")
    directory = new_output(cfg, "android", number)
    env = dict(android_firebase.build_environment(), ROGICHAT_QA_KEYSTORE=str(keystore), ROGICHAT_QA_STORE_PASSWORD=password,
               ROGICHAT_QA_KEY_ALIAS=android["key_alias"])
    if firebase is not None: env["ROGICHAT_QA_FIREBASE_CONFIG_FILE"] = str(firebase.path)
    run(["./gradlew", ":app:assembleQaRelease", ":app:bundleQaRelease",
         f"-ProgichatBuildNumber={number}", f"-ProgichatVersion={version}", "--no-daemon"],
        directory / "build.log", cwd=ROOT / "apps/android", env=env)
    artifacts = {}
    for kind, source in {"apk": "apk/qa/release/app-qa-release.apk", "aab": "bundle/qaRelease/app-qa-release.aab"}.items():
        target = directory / f"rogichat-qa-{version}-{number}.{kind}"
        shutil.copy2(ROOT / "apps/android/app/build/outputs" / source, target)
        target.chmod(0o600)
        artifacts[kind] = target
    verify_apk(artifacts["apk"], number, version)
    inspect_android_package(artifacts["aab"])
    run(bundletool() + ["validate", "--bundle=" + str(artifacts["aab"])], directory / "bundle-validation.log")
    for xpath, expected in (("/manifest/@package", APP_ID), ("/manifest/@android:versionCode", str(number)),
                            ("/manifest/@android:versionName", version + "-qa")):
        result = capture(bundletool() + ["dump", "manifest", "--bundle=" + str(artifacts["aab"]), "--xpath=" + xpath]).strip()
        if result != expected:
            raise ValueError("AAB identity/version mismatch")
    signing = capture(["jarsigner", "-verify", str(artifacts["aab"])])
    if "jar verified." not in signing:
        raise ValueError("AAB signature missing")
    android_firebase.inspect_apk(artifacts["apk"], firebase, sdk_tool("aapt2"), capture, environment="qa")
    android_firebase.inspect_aab(artifacts["aab"], firebase, bundletool(), capture, environment="qa")
    path = save_manifest(directory, "android", number, version, artifacts)
    value = json.loads(path.read_text()); value["firebase_sdk_state"] = android_firebase.state(firebase)
    private_write(path, json.dumps(value, indent=2) + "\n")
    print("Signed QA APK and AAB verified. Manifest:", path)


def firebase_json(arguments, directory, cfg):
    directory = external(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with firebase_auth.environment(cfg, directory) as env:
        result = subprocess.run(["firebase", *arguments, "--json", "--non-interactive"],
                                cwd=directory, env=env, capture_output=True, text=True)
    log = directory / ("firebase-" + arguments[0].replace(":", "-") + ".log")
    private_write(log, result.stdout + "\n" + result.stderr)
    if result.returncode:
        raise RuntimeError(f"Firebase request failed; inspect private log: {log}")
    value = json.loads(result.stdout)
    if value.get("status") != "success":
        raise RuntimeError("Firebase request failed; check service account and project permissions")
    # CLI 15's appdistribution:distribute returns {"status":"success"} without result.
    return value.get("result", value)


def verify_firebase_apk(path, cfg):
    settings = android_firebase.load(cfg, "qa")
    android_firebase.inspect_apk(path, settings, sdk_tool("aapt2"), capture, environment="qa")
    return android_firebase.state(settings)


def upload(cfg, manifest_path, notes_file):
    value = manifest(manifest_path, "android", uploading=True)
    apk = external(value["artifacts"]["apk"]["path"])
    verify_firebase_apk(apk, cfg)
    firebase = cfg["firebase"]
    required(firebase, "project_id", "app_id")
    directory = external(manifest_path).parent
    apps = firebase_json(["apps:list", "ANDROID", "--project", firebase["project_id"]], directory, cfg)
    matches = [app for app in apps if app["appId"] == firebase["app_id"] and app.get("packageName") == APP_ID]
    if len(matches) != 1:
        raise ValueError("Firebase target is not the Rogichat QA Android app")
    verify_apk(apk, value["build_number"], value["version"])
    # No --testers/--groups: uploading does not send tester invitations or distribute a release.
    receipt = firebase_json(["appdistribution:distribute", str(apk), "--project", firebase["project_id"],
                             "--app", firebase["app_id"], "--release-notes-file", str(external(notes_file))], directory, cfg)
    private_write(directory / "firebase-receipt.json", json.dumps(receipt, indent=2) + "\n")
    print("Firebase upload completed; private receipt saved. Run android-finalize to verify the release and distribute to the approved testers.")
