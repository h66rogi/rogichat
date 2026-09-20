#!/usr/bin/env python3
"""Fetch untrusted public PR objects for scanning only, with no credentials."""
import os
import re
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "h66rogi/rogichat"
SOURCE = "https://github.com/" + REPOSITORY + ".git"
ORIGINS = {SOURCE, SOURCE.removesuffix(".git"), "git@github.com:" + REPOSITORY + ".git",
           "ssh://git@github.com/" + REPOSITORY + ".git"}


def run(*args, env):
    return subprocess.run(["git", *args], cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)


def has_netrc():
    # Check existence only, including symlinks; never read credential contents.
    return any(os.path.lexists(Path.home() / name) for name in (".netrc", "_netrc"))


def main():
    if os.environ.get("GITHUB_REPOSITORY", REPOSITORY) != REPOSITORY:
        raise ValueError("repository context")
    if has_netrc():
        raise ValueError("implicit curl credentials")
    # Ignore shell/global/system credential helpers, prompts and Git overrides.
    # Local origin must still identify this exact public repository.
    # Only process basics cross this boundary: no tokens, NETRC, CURL_*,
    # SSLKEYLOGFILE or upper/lower-case proxy credentials reach Git/libcurl.
    # Preserve HOME exactly; never substitute the user's home directory.
    basics = {"PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT"}
    env = {key: value for key, value in os.environ.items() if key in basics}
    env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull, GIT_CONFIG_NOSYSTEM="1",
               GIT_TERMINAL_PROMPT="0", GIT_ASKPASS="/usr/bin/false", SSH_ASKPASS="/usr/bin/false")
    origin = run("config", "--local", "--get", "remote.origin.url", env=env)
    if origin.returncode or origin.stdout.strip() not in ORIGINS:
        raise ValueError("origin")
    # Reject local rewrites, proxies, headers or includes that could redirect
    # the fixed anonymous fetch or attach a stored credential to its requests.
    options = run("config", "--local", "--no-includes", "--name-only", "--list", env=env)
    if options.returncode:
        raise ValueError("local configuration read")
    for option in options.stdout.splitlines():
        name = option.lower()
        if (name.startswith(("url.", "http.", "https.", "credential.", "include.", "includeif."))
                or re.fullmatch(r"remote\..*\.proxy", name)):
            raise ValueError("local network configuration")
    result = run("-c", "credential.helper=", "-c", "http.extraHeader=", "-c", "http.followRedirects=false",
                 "-c", "protocol.allow=never", "-c", "protocol.https.allow=always",
                 "fetch", "--quiet", "--force", "--no-tags", "--no-recurse-submodules", SOURCE,
                 "+refs/pull/*:refs/remotes/security-pull/*", env=env)
    if result.returncode:
        raise ValueError("fetch")
    integrity = run("fsck", "--strict", "--no-reflogs", "--no-dangling", env=env)
    if integrity.returncode:
        raise ValueError("object integrity")
    print("Public PR refs fetched and object integrity checked; no PR code executed.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError):
        raise SystemExit("Public PR ref fetch blocked; inspect privately without publishing raw diagnostics.") from None
