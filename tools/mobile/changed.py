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
SHA = re.compile(r"[a-f0-9]{40}\Z")
IOS_STATE_ONLY_TOOLS = {
    b"check_ios_wireframe.py", b"test_ios_focused_checks.py",
}


def affected_checks(paths):
    """Return Android, iOS state, and iOS bundle inputs independently."""
    android = ios = ios_build = False
    for path in paths:
        if path.startswith(b"apps/android/"):
            android = True
        elif path.startswith(b"apps/ios/"):
            ios = ios_build = True
        elif path == b".github/workflows/mobile.yml":
            android = ios = ios_build = True
        elif path.startswith(b"tools/mobile/"):
            name = path.removeprefix(b"tools/mobile/")
            if b"/" in name:
                android = ios = ios_build = True
            elif name.startswith(ANDROID_TOOLS):
                android = True
            elif name in IOS_STATE_ONLY_TOOLS:
                ios = True
            elif name.startswith(IOS_TOOLS):
                ios = ios_build = True
            else:
                android = ios = ios_build = True
    return android, ios, ios_build


def affected_platforms(paths):
    android, ios, _ = affected_checks(paths)
    return android, ios


def mobile_changed(paths):
    return any(affected_platforms(paths))


def pull_request_base(event_base, head):
    """Diff the checked merge result from its base parent, even if the event is stale."""
    if not SHA.fullmatch(event_base) or not SHA.fullmatch(head):
        return None
    checkout = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True)
    parents = subprocess.run(["git", "rev-list", "--parents", "-n", "1", head],
                             capture_output=True)
    if checkout.returncode or checkout.stdout.strip() != head.encode() or parents.returncode:
        return None
    parts = parents.stdout.decode("ascii", errors="replace").split()
    if len(parts) != 3 or parts[0] != head or not all(SHA.fullmatch(p) for p in parts):
        return None
    ancestor = subprocess.run(["git", "merge-base", "--is-ancestor", event_base, parts[1]],
                              capture_output=True)
    return parts[1] if ancestor.returncode == 0 else None


def main():
    base = os.environ.get("BASE_SHA", "")
    event = os.environ.get("EVENT_NAME", "")
    if event == "merge_group":
        head = os.environ.get("MERGE_GROUP_HEAD_SHA", "")
        github_sha = os.environ.get("GITHUB_SHA", "")
        base_ref = os.environ.get("MERGE_GROUP_BASE_REF", "")
        checkout = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True)
        if (base_ref not in {"refs/heads/qa", "refs/heads/main"}
                or not SHA.fullmatch(head)
                or head != github_sha
                or checkout.returncode or checkout.stdout.strip() != head.encode()
                or base == "0" * 40):
            raise SystemExit("Cannot establish the mobile change boundary")
    if event == "pull_request":
        base = pull_request_base(base, os.environ.get("GITHUB_SHA", ""))
        if base is None:
            raise SystemExit("Cannot establish the mobile pull-request boundary")
    if event == "workflow_dispatch" or base == "0" * 40:
        android = ios = ios_build = True
    else:
        if event not in {"push", "pull_request", "merge_group"} or not SHA.fullmatch(base):
            raise SystemExit("Cannot establish the mobile change boundary")
        result = subprocess.run(["git", "diff", "--no-renames", "--name-only", "-z", base, "HEAD", "--"],
                                capture_output=True)
        if result.returncode:
            raise SystemExit("Cannot inspect the mobile change boundary")
        android, ios, ios_build = affected_checks(result.stdout.split(b"\0"))
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write("android=" + str(android).lower() + "\n")
        output.write("ios=" + str(ios).lower() + "\n")
        output.write("ios_build=" + str(ios_build).lower() + "\n")


if __name__ == "__main__":
    main()
