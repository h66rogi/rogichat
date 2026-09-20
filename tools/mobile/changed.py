"""Keep the mandatory mobile result present without rebuilding unrelated docs."""
import os
import re
import subprocess


def mobile_changed(paths):
    return any(path.startswith((b"apps/android/", b"apps/ios/", b"tools/mobile/"))
               or path == b".github/workflows/mobile.yml" for path in paths)


def main():
    base = os.environ.get("BASE_SHA", "")
    event = os.environ.get("EVENT_NAME", "")
    if event == "workflow_dispatch" or base == "0" * 40:
        changed = True
    else:
        if event not in {"push", "pull_request"} or not re.fullmatch(r"[a-f0-9]{40}", base):
            raise SystemExit("Cannot establish the mobile change boundary")
        result = subprocess.run(["git", "diff", "--no-renames", "--name-only", "-z", base, "HEAD", "--"],
                                capture_output=True)
        if result.returncode:
            raise SystemExit("Cannot inspect the mobile change boundary")
        changed = mobile_changed(result.stdout.split(b"\0"))
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write("changed=" + str(changed).lower() + "\n")


if __name__ == "__main__":
    main()
