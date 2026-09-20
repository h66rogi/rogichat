"""Prepare exact Prod signing resources. Never build, upload, or release an app."""
import argparse
import base64
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import subprocess
import tempfile
import uuid

from release_common import AppStoreConnect, config, external, private_write

APP_ID = "chat.rogi.rogichat"
PROFILE_NAME = "Rogichat Prod App Store"
CAPABILITIES = ("ASSOCIATED_DOMAINS", "APPLE_ID_AUTH")
DEFAULT_CONFIG = Path.home() / ".config/rogichat/mobile-prod.json"


def prod_config(path):
    value = config(path)
    if value.get("environment") != "prod" or value.get("app_id") != APP_ID:
        raise ValueError("This preparation tool requires the exact Prod identity")
    return value


def exact(rows, field, value, *, optional=False):
    matches = [row for row in rows if row.get("attributes", {}).get(field) == value]
    if len(matches) > 1 or (not matches and not optional):
        raise ValueError("Missing or ambiguous exact Prod resource")
    return matches[0] if matches else None


def bundle(asc, *, create=False):
    def read():
        return exact(asc.collection("bundleIds", {"filter[identifier]": APP_ID}), "identifier", APP_ID, optional=True)
    value = read()
    if value is None and create:
        asc.request("bundleIds", body={"data": {"type": "bundleIds", "attributes": {
            "identifier": APP_ID, "name": "Rogichat", "platform": "IOS"}}}, method="POST")
        value = read()
    # Apple normalizes newly registered explicit iOS identifiers to UNIVERSAL.
    # The downloadable profile below must still be IOS_APP_STORE / Platform iOS.
    if value is None or value["attributes"].get("platform") not in ("IOS", "UNIVERSAL"):
        raise ValueError("Exact iOS Prod bundle is not registered")
    return value


def capabilities(asc, target, *, create=False):
    # Resolve the bundle again before writing; callers cannot pass a QA/prefix ID.
    if bundle(asc)["id"] != target["id"]:
        raise ValueError("Prod bundle changed before capability admission")
    resource = "bundleIds/" + target["id"] + "/bundleIdCapabilities"
    for kind in CAPABILITIES:
        current = exact(asc.collection(resource), "capabilityType", kind, optional=True)
        if current is None and create:
            attributes = {"capabilityType": kind}
            if kind == "APPLE_ID_AUTH":
                attributes["settings"] = [{"key": "APPLE_ID_AUTH_APP_CONSENT", "options": [
                    {"key": "PRIMARY_APP_CONSENT", "enabled": True}]}]
            asc.request("bundleIdCapabilities", body={"data": {"type": "bundleIdCapabilities",
                "attributes": attributes, "relationships": {
                    "bundleId": {"data": {"type": "bundleIds", "id": target["id"]}}}}}, method="POST")
        if exact(asc.collection(resource), "capabilityType", kind, optional=True) is None:
            raise ValueError("Required Prod capability is missing")


def valid_profile(profile, cfg, certificate, *, now=None):
    now = now or datetime.now(timezone.utc)
    expiry = profile.get("ExpirationDate")
    if not isinstance(expiry, datetime):
        raise ValueError("Profile has no expiry")
    if expiry.replace(tzinfo=timezone.utc) <= now:
        raise ValueError("Prod profile expired")
    team = cfg["ios"]["team_id"]
    ent = profile.get("Entitlements", {})
    platforms = profile.get("Platform")
    # Current Apple IOS_APP_STORE profiles also enumerate visionOS/xrOS.
    ios_profile = (isinstance(platforms, list) and "iOS" in platforms
                   and all(isinstance(item, str) for item in platforms)
                   and len(set(platforms)) == len(platforms)
                   and set(platforms) <= {"iOS", "xrOS", "visionOS"})
    if (profile.get("Name") != PROFILE_NAME or profile.get("TeamIdentifier") != [team]
            or profile.get("ApplicationIdentifierPrefix") != [team]
            or ent.get("application-identifier") != team + "." + APP_ID
            or ent.get("com.apple.developer.team-identifier") != team
            or ent.get("get-task-allow") is not False
            or profile.get("ProvisionsAllDevices") or "ProvisionedDevices" in profile
            or not ios_profile):
        raise ValueError("Profile is not exact Prod App Store distribution")
    # Apple profile permission is the string '*'; signed app domains remain an
    # exact applinks/webcredentials:rogi.chat artifact gate at build/export time.
    if ent.get("com.apple.developer.associated-domains") != "*":
        raise ValueError("Prod associated-domains permission is missing")
    if ent.get("com.apple.developer.applesignin") != ["Default"]:
        raise ValueError("Prod Sign in with Apple permission is missing")
    if profile.get("DeveloperCertificates") != [certificate]:
        raise ValueError("Profile uses an unexpected signing certificate")
    identifier = profile.get("UUID", "")
    if not isinstance(identifier, str) or len(identifier) != 36 or str(uuid.UUID(identifier)) != identifier.lower():
        raise ValueError("Invalid profile UUID")


def capture(command):
    env = {k: v for k, v in os.environ.items() if k not in
           ("JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "NODE_OPTIONS", "NODE_PATH", "PYTHONPATH", "DEBUG")}
    try:
        result = subprocess.run(command, capture_output=True, env=env, timeout=60)
    except subprocess.TimeoutExpired:
        raise RuntimeError(Path(command[0]).name + " timed out; inspect existing material before retry") from None
    if result.returncode:
        raise RuntimeError(Path(command[0]).name + " failed; sensitive output suppressed")
    return result.stdout


def signing_certificate(asc, cfg):
    configured = cfg["ios"]["signing_certificate"].upper()
    if not re.fullmatch(r"[0-9A-F]{40}", configured):
        raise ValueError("Pin the existing distribution certificate SHA-1")
    candidates = []
    for row in asc.collection("certificates", {"filter[certificateType]": "DISTRIBUTION"}):
        attrs = row["attributes"]
        der = base64.b64decode(attrs["certificateContent"], validate=True)
        if hashlib.sha1(der).hexdigest().upper() == configured:
            if attrs.get("certificateType") != "DISTRIBUTION" or datetime.fromisoformat(attrs["expirationDate"]) <= datetime.now(timezone.utc):
                raise ValueError("Selected distribution certificate expired")
            candidates.append((row["id"], der))
    if len(candidates) != 1:
        raise ValueError("Pinned distribution certificate not uniquely available")
    identities = capture(["security", "find-identity", "-v", "-p", "codesigning", str(external(cfg["ios"]["keychain"]))]).decode()
    if not re.search(r"\b" + configured + r"\b", identities):
        raise ValueError("Pinned distribution private-key identity unavailable")
    return candidates[0]


def prepare_ios(cfg, asc, *, create=False):
    target = bundle(asc, create=create)
    capabilities(asc, target, create=create)
    cert_id, certificate = signing_certificate(asc, cfg)
    def read_profile():
        return exact(asc.collection("profiles", {"filter[name]": PROFILE_NAME}), "name", PROFILE_NAME, optional=True)
    row = read_profile()
    if row is None and create:
        asc.request("profiles", body={"data": {"type": "profiles", "attributes": {
            "name": PROFILE_NAME, "profileType": "IOS_APP_STORE"}, "relationships": {
                "bundleId": {"data": {"type": "bundleIds", "id": target["id"]}},
                "certificates": {"data": [{"type": "certificates", "id": cert_id}]}}}}, method="POST")
        row = read_profile()
    if row is None or row["attributes"].get("profileType") != "IOS_APP_STORE" or row["attributes"].get("profileState") != "ACTIVE":
        raise ValueError("Active exact Prod distribution profile is missing")
    bound = asc.request("profiles/" + row["id"] + "/bundleId")["data"]
    if bound.get("id") != target["id"] or bound.get("attributes", {}).get("identifier") != APP_ID:
        raise ValueError("Prod profile is bound to another app")
    raw = base64.b64decode(row["attributes"]["profileContent"], validate=True)
    output = external(cfg["artifact_root"]) / "signing"
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(dir=output, suffix=".mobileprovision") as tmp:
        tmp.write(raw); tmp.flush()
        profile = plistlib.loads(capture(["security", "cms", "-D", "-i", tmp.name]))
    valid_profile(profile, cfg, certificate)
    destination = output / "Rogichat-Prod.mobileprovision"
    if destination.exists() and destination.read_bytes() != raw:
        raise ValueError("A different local Prod profile already exists; do not overwrite")
    exclusive_bytes(destination, raw, same_ok=True)
    installed = Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles" / (profile["UUID"] + ".mobileprovision")
    exclusive_bytes(installed, raw, same_ok=True)
    app = exact(asc.collection("apps", {"filter[bundleId]": APP_ID}), "bundleId", APP_ID, optional=True)
    private_write(output / "apple-preparation.json", json.dumps({"app_id": APP_ID, "bundle_resource": target["id"],
        "profile_resource": row["id"], "profile_uuid": profile["UUID"], "profile_name": PROFILE_NAME,
        "certificate_sha256": hashlib.sha256(certificate).hexdigest(), "app_record": app["id"] if app else None,
        "checked_at": datetime.now(timezone.utc).isoformat()}, indent=2) + "\n")
    return {"bundle": True, "capabilities": list(CAPABILITIES), "distribution_profile": True, "app_record": app is not None}


def exclusive_bytes(path, data, *, same_ok=False):
    path = external(path)
    if path.exists():
        if same_ok and path.read_bytes() == data and not path.stat().st_mode & 0o077:
            return
        raise ValueError("Refusing to overwrite existing signing material")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
        out.write(data); out.flush(); os.fsync(out.fileno())


def prepare_android(cfg, *, create=False):
    android = cfg["android"]
    if android["key_alias"] != "rogichat-prod-upload":
        raise ValueError("Expected the dedicated Prod upload alias")
    root = external(Path.home() / ".config/rogichat/signing/prod")
    key = external(android["keystore"]); password = external(android["password_file"])
    if key != root / "upload.p12" or password != root / "upload-password":
        raise ValueError("Expected dedicated Prod signing paths")
    if not key.exists():
        if not create:
            raise ValueError("Prod upload key is missing")
        exclusive_bytes(password, (secrets.token_urlsafe(48) + "\n").encode())
        capture(["keytool", "-genkeypair", "-keystore", str(key), "-storetype", "PKCS12",
                 "-storepass:file", str(password), "-keypass:file", str(password),
                 "-alias", android["key_alias"], "-keyalg", "RSA", "-keysize", "3072",
                 "-validity", "10000", "-dname", "CN=Rogichat Prod Upload", "-noprompt"])
        key.chmod(0o600)
    for item in (key, password):
        if not item.is_file() or item.stat().st_mode & 0o077:
            raise ValueError("Prod signing files must have mode 600")
    description = capture(["keytool", "-J-Duser.language=en", "-J-Duser.country=US", "-list", "-v",
                           "-keystore", str(key), "-storetype", "PKCS12", "-storepass:file", str(password),
                           "-alias", android["key_alias"]]).decode()
    if "Entry type: PrivateKeyEntry" not in description:
        raise ValueError("Prod upload alias does not contain a private key")
    certificate = capture(["keytool", "-exportcert", "-keystore", str(key), "-storetype", "PKCS12",
                           "-storepass:file", str(password), "-alias", android["key_alias"]])
    output = external(cfg["artifact_root"]) / "signing"
    exclusive_bytes(output / "android-prod-upload.der", certificate, same_ok=True)
    private_write(output / "android-preparation.json", json.dumps({"app_id": APP_ID,
        "upload_certificate_sha256": hashlib.sha256(certificate).hexdigest(),
        "play_app_signing_verified": False, "play_registration_verified": False}, indent=2) + "\n")
    return {"dedicated_upload_key": True, "play_registration_verified": False, "play_app_signing_verified": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("platform", choices=("ios", "android"))
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--create-missing", action="store_true")
    args = parser.parse_args(); os.umask(0o077)
    cfg = prod_config(args.config)
    directory = external(cfg["artifact_root"]); directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / "signing-preparation.lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = prepare_ios(cfg, AppStoreConnect(cfg), create=args.create_missing) if args.platform == "ios" else prepare_android(cfg, create=args.create_missing)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        # No Apple response bodies, private IDs, key paths, passwords or tokens.
        print("Prod signing preparation stopped:", type(error).__name__)
        raise SystemExit(1)
