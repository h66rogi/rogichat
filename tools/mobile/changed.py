"""Select the native platforms affected by a change, failing closed on shared tools."""
import os
import re
import subprocess


ANDROID_TOOLS = (
    b"android_", b"check_android", b"release_android.py", b"test_android_", b"test_check_android",
)
IOS_TOOLS = (
    b"build_ios.py", b"check_ios", b"install_xcodegen.py", b"ios_", b"keychain_unlock.py",
    b"release_ios.py", b"test_ios_", b"test_keychain_unlock.py",
)


def affected_platforms(paths):
    android = ios = False
    for path in paths:
        if path.startswith(b"apps/android/"):
            android = True
        elif path.startswith(b"apps/ios/"):
            ios = True
        elif path == b".github/workflows/mobile.yml":
            android = ios = True
        elif path.startswith(b"tools/mobile/"):
            name = path.removeprefix(b"tools/mobile/")
            if b"/" in name:
                android = ios = True
            elif name.startswith(ANDROID_TOOLS):
                android = True
            elif name.startswith(IOS_TOOLS):
                ios = True
            else:
                android = ios = True
    return android, ios


def mobile_changed(paths):
    return any(affected_platforms(paths))


def main():
    base = os.environ.get("BASE_SHA", "")
    event = os.environ.get("EVENT_NAME", "")
    if event == "merge_group":
        head = os.environ.get("MERGE_GROUP_HEAD_SHA", "")
        github_sha = os.environ.get("GITHUB_SHA", "")
        base_ref = os.environ.get("MERGE_GROUP_BASE_REF", "")
        checkout = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True)
        if (base_ref not in {"refs/heads/qa", "refs/heads/main"}
                or not re.fullmatch(r"[a-f0-9]{40}", head)
                or head != github_sha
                or checkout.returncode or checkout.stdout.strip() != head.encode()
                or base == "0" * 40):
            raise SystemExit("Cannot establish the mobile change boundary")
    if event == "workflow_dispatch" or base == "0" * 40:
        android = ios = True
    else:
        if event not in {"push", "pull_request", "merge_group"} or not re.fullmatch(r"[a-f0-9]{40}", base):
            raise SystemExit("Cannot establish the mobile change boundary")
        result = subprocess.run(["git", "diff", "--no-renames", "--name-only", "-z", base, "HEAD", "--"],
                                capture_output=True)
        if result.returncode:
            raise SystemExit("Cannot inspect the mobile change boundary")
        android, ios = affected_platforms(result.stdout.split(b"\0"))
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write("android=" + str(android).lower() + "\n")
        output.write("ios=" + str(ios).lower() + "\n")


if __name__ == "__main__":
    main()
