#!/usr/bin/env python3
"""Build and inspect all environment configurations without signing or a simulator."""
import argparse
from pathlib import Path
import plistlib
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--derived-data", type=Path, default=ROOT / ".build/ios")
    args = parser.parse_args()
    destination = args.derived_data.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    version = subprocess.check_output(["xcodebuild", "-version"], text=True)
    if version.strip() != "Xcode 26.6\nBuild version 17F113":
        raise SystemExit("Select Xcode 26.6 (17F113) using DEVELOPER_DIR.")
    subprocess.run(["xcodebuild", "-checkFirstLaunchStatus"], check=True)
    for environment, suffix in (("qa", "QA"), ("prod", "Prod")):
        scheme_file = ROOT / "apps/ios/Rogichat.xcodeproj/xcshareddata/xcschemes" / ("Rogichat-" + suffix + ".xcscheme")
        scheme = ET.parse(scheme_file).getroot()
        for action, mode in (("LaunchAction", "Debug"), ("TestAction", "Debug"), ("AnalyzeAction", "Debug"), ("ProfileAction", "Release"), ("ArchiveAction", "Release")):
            if scheme.find(action).get("buildConfiguration") != mode + "-" + suffix:
                raise SystemExit(f"{scheme_file.name}: wrong {action} configuration")
        expected_id = "chat.rogi.rogichat" + (".qa" if environment == "qa" else "")
        expected_url = "https://api." + ("qa." if environment == "qa" else "") + "rogi.chat/v1/"
        for mode in ("Debug", "Release"):
            configuration = mode + "-" + suffix
            log = destination / (configuration + ".log")
            command = [
                "xcodebuild", "-project", str(ROOT / "apps/ios/Rogichat.xcodeproj"),
                "-target", "Rogichat", "-configuration", configuration, "-sdk", "iphoneos",
                "SYMROOT=" + str(destination / "Build/Products"),
                "OBJROOT=" + str(destination / "Build/Intermediates.noindex"),
                "-jobs", "2", "CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "build",
            ]
            with log.open("w") as output:
                result = subprocess.run(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT)
            if result.returncode:
                print(log.read_text()[-12000:])
                raise SystemExit(result.returncode)
            app = destination / "Build/Products" / (configuration + "-iphoneos") / "Rogichat.app"
            with (app / "Info.plist").open("rb") as source:
                info = plistlib.load(source)
            expected = {
                "CFBundleIdentifier": expected_id,
                "CFBundleDisplayName": "로기챗 QA" if environment == "qa" else "로기챗",
                "RogichatEnvironment": environment,
                "RogichatAPIBaseURL": expected_url,
                "MinimumOSVersion": "18.0",
                "UIDeviceFamily": [1],
                "CFBundleSupportedPlatforms": ["iPhoneOS"],
                "ITSAppUsesNonExemptEncryption": False,
            }
            for key, value in expected.items():
                if info.get(key) != value:
                    raise SystemExit(f"{configuration}: unexpected {key}: {info.get(key)!r}")
            if "NSAppTransportSecurity" in info or (app / "embedded.mobileprovision").exists():
                raise SystemExit("Unexpected transport exception or provisioning profile")
            executable = app / info["CFBundleExecutable"]
            macho = subprocess.check_output(["xcrun", "vtool", "-show-build", str(executable)], text=True)
            if "platform IOS" not in macho or "minos 18.0" not in macho:
                raise SystemExit("Unexpected executable platform or minimum OS")
            print(f"{configuration}: unsigned build and bundle configuration verified", flush=True)


if __name__ == "__main__":
    main()
