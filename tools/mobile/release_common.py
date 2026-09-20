"""QA-only release helpers. Credentials and artifacts stay outside repositories."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
APP_ID = "chat.rogi.rogichat.qa"
API_URL = "https://api.qa.rogi.chat/v1/"
DEFAULT_CONFIG = Path.home() / ".config/rogichat/mobile-qa.json"


def external(path):
    path = Path(path).expanduser().resolve()
    if path == ROOT or ROOT in path.parents or any((p / ".git").exists() for p in [path, *path.parents]):
        raise ValueError("Release credentials/artifacts must be outside all Git repositories")
    return path


def private_write(path, data):
    path = external(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as out:
        out.write(data)
    path.chmod(0o600)


def config(path):
    path = external(path)
    if path.stat().st_mode & 0o077:
        raise ValueError("Configuration must have mode 600")
    value = json.loads(path.read_text())
    external(value["artifact_root"])
    return value


def required(section, *names):
    for name in names:
        if not section.get(name):
            raise ValueError(f"Configure {name} in the external QA release configuration")


def run(command, log, *, cwd=ROOT, env=None):
    log = external(log)
    log.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with os.fdopen(os.open(log, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as output:
        result = subprocess.run(command, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}); inspect private log: {log}")


def capture(command, *, env=None, cwd=ROOT):
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"{Path(command[0]).name} failed; no credentials printed")
    return result.stdout


def sha256(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def tree_sha256(path):
    """Include all signed resources, profiles and archive metadata in the receipt."""
    root = external(path)
    digest = hashlib.sha256()
    for item in sorted(root.rglob("*")):
        relative = item.relative_to(root).as_posix()
        if item.is_symlink():
            external(item)
            payload = "link:" + os.readlink(item)
        elif item.is_file():
            payload = "file:" + sha256(item)
        else:
            continue
        digest.update((relative + "\0" + payload + "\0").encode())
    return digest.hexdigest()


def version_number(value):
    if not re.fullmatch(r"[1-9][0-9]{0,9}", str(value)) or int(value) > 2100000000:
        raise ValueError("Build number must be 1..2100000000")
    return int(value)


def version_name(value):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", value):
        raise ValueError("Version must have three numeric components")
    return value


def source_state():
    commit = capture(["git", "rev-parse", "HEAD"]).strip()
    dirty = capture(["git", "status", "--porcelain", "--", "apps/android", "apps/ios", "tools/mobile"])
    return {"commit": commit, "source_dirty": bool(dirty)}


def new_output(cfg, platform, number):
    directory = external(cfg["artifact_root"]) / platform / str(number)
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    return directory


def save_manifest(directory, platform, number, version, artifacts):
    value = {"platform": platform, "environment": "qa", "app_id": APP_ID,
             "build_number": number, "version": version, **source_state(),
             "artifacts": {kind: {"path": str(path), "sha256": sha256(path)} for kind, path in artifacts.items()}}
    path = directory / "release.json"
    private_write(path, json.dumps(value, indent=2) + "\n")
    return path


def manifest(path, platform, *, uploading=False):
    path = external(path)
    value = json.loads(path.read_text())
    if value.get("platform") != platform or value.get("environment") != "qa" or value.get("app_id") != APP_ID:
        raise ValueError("Only the Rogichat QA app can use this release tool")
    version_number(value["build_number"])
    version_name(value["version"])
    if uploading and value.get("source_dirty", True):
        raise ValueError("Upload requires an artifact built from committed mobile source")
    for artifact in value["artifacts"].values():
        if sha256(external(artifact["path"])) != artifact["sha256"]:
            raise ValueError("Artifact checksum changed; do not upload")
    if platform == "ios" and tree_sha256(value["archive_path"]) != value.get("archive_sha256"):
        raise ValueError("Archive contents changed; rebuild before export/upload")
    return value


class AppStoreConnect:
    def __init__(self, cfg):
        self.cfg = cfg["ios"]
        required(self.cfg, "team_id", "key_id", "issuer_id", "key_file")
        key = external(self.cfg["key_file"])
        if not key.is_file():
            raise ValueError("App Store Connect key file is missing")
        result = subprocess.run(["xcrun", "altool", "--generate-jwt", "--api-key", self.cfg["key_id"],
                                 "--api-issuer", self.cfg["issuer_id"], "--p8-file-path", str(key)],
                                capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError("App Store Connect JWT generation failed")
        # Xcode 26.6 prints the JWT on stderr; capture both without logging either.
        output = result.stdout + result.stderr
        tokens = re.findall(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", output)
        if len(tokens) != 1:
            raise RuntimeError("Could not obtain App Store Connect JWT from altool")
        self.token = tokens[0]

    def request(self, resource, params=None, body=None):
        url = "https://api.appstoreconnect.apple.com/v1/" + resource
        if params:
            url += "?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers={"Authorization": "Bearer " + self.token,
                                                       "Content-Type": "application/json"},
                                         data=json.dumps(body).encode() if body else None)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"App Store Connect {resource}: HTTP {error.code}; inspect account/app permissions") from None

    def app(self):
        # Apple filters may include prefix matches; never infer the target from
        # result count alone, even though this command accepts QA only.
        apps = [app for app in self.request("apps", {"filter[bundleId]": APP_ID})["data"]
                if app.get("attributes", {}).get("bundleId") == APP_ID]
        if len(apps) != 1:
            raise ValueError("Create the Rogichat QA app record in App Store Connect first (bundle ID: " + APP_ID + ")")
        return apps[0]["id"]

    def bundle(self):
        bundles = [bundle for bundle in self.request("bundleIds", {"filter[identifier]": APP_ID})["data"]
                   if bundle.get("attributes", {}).get("identifier") == APP_ID]
        if len(bundles) != 1:
            raise ValueError("Register the Rogichat QA bundle identifier first")
        return bundles[0]["id"]

    def builds(self, number=None):
        params = {"filter[app]": self.app(), "sort": "-uploadedDate", "limit": "200"}
        if number is not None:
            params["filter[version]"] = str(number)
        return self.request("builds", params)["data"]

    def signing_args(self):
        return ["-allowProvisioningUpdates", "-authenticationKeyPath", str(external(self.cfg["key_file"])),
                "-authenticationKeyID", self.cfg["key_id"], "-authenticationKeyIssuerID", self.cfg["issuer_id"]]
