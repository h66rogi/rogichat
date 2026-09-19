#!/usr/bin/env python3
"""Verify packaged identities and environment metadata, not just source settings."""
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def main():
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if not sdk:
        raise SystemExit("Set ANDROID_HOME to the Android SDK directory")
    aapt = str(Path(sdk) / "build-tools/37.0.0/aapt2")
    signer = str(Path(sdk) / "build-tools/37.0.0/apksigner")
    for environment in ("qa", "prod"):
        app_id = "chat.rogi.rogichat" + (".qa" if environment == "qa" else "")
        url = "https://api." + ("qa." if environment == "qa" else "") + "rogi.chat/v1/"
        label = "로기챗 QA" if environment == "qa" else "로기챗"
        for mode in ("debug", "release"):
            name = f"app-{environment}-{mode}" + ("-unsigned" if mode == "release" else "") + ".apk"
            apk = ROOT / "apps/android/app/build/outputs/apk" / environment / mode / name
            badging = subprocess.check_output([aapt, "dump", "badging", str(apk)], text=True)
            for expected in (f"package: name='{app_id}'", f"application-label:'{label}'", "minSdkVersion:'29'", "targetSdkVersion:'37'"):
                if expected not in badging:
                    raise SystemExit(f"{name}: missing {expected}")
            manifest = subprocess.check_output([aapt, "dump", "xmltree", str(apk), "--file", "AndroidManifest.xml"], text=True)
            for expected in (f'"{environment}"', f'"{url}"'):
                if expected not in manifest:
                    raise SystemExit(f"{name}: wrong environment metadata")
            for attribute in ("allowBackup", "usesCleartextTraffic"):
                if not re.search(r"android:" + attribute + r"[^\n]*=false", manifest):
                    raise SystemExit(f"{name}: {attribute} must be false")
            debuggable = "application-debuggable" in badging
            if debuggable != (mode == "debug"):
                raise SystemExit(f"{name}: unexpected debuggable state")
            signing = subprocess.run([signer, "verify", str(apk)], capture_output=True)
            if (signing.returncode == 0) != (mode == "debug"):
                raise SystemExit(f"{name}: expected local debug signing or unsigned release")
            print(f"{environment}/{mode}: APK identity, endpoint and signing verified")


if __name__ == "__main__":
    main()
