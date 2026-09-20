"""Prepare allowlisted QA/Prod Apple+push profiles without replacing old profiles."""
import argparse
import base64
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import tempfile
import uuid

from prod_signing import capture, exact, exclusive_bytes, signing_certificate
from release_common import AppStoreConnect, config, external, private_write

TARGETS = {
    "qa": ("chat.rogi.rogichat.qa", "Rogichat QA App Store Capabilities v2"),
    "prod": ("chat.rogi.rogichat", "Rogichat Prod App Store Capabilities v2"),
}
CAPABILITIES = ("ASSOCIATED_DOMAINS", "APPLE_ID_AUTH", "PUSH_NOTIFICATIONS")


def validate(profile, environment, cfg, certificate, *, now=None):
    app, name = TARGETS[environment]; team = cfg["ios"]["team_id"]
    ent = profile.get("Entitlements", {}); expiry = profile.get("ExpirationDate")
    platforms = profile.get("Platform")
    if (profile.get("Name") != name or profile.get("TeamIdentifier") != [team]
            or profile.get("ApplicationIdentifierPrefix") != [team]
            or not isinstance(platforms, list) or "iOS" not in platforms
            or any(not isinstance(value, str) for value in platforms) or len(set(platforms)) != len(platforms)
            or not set(platforms) <= {"iOS", "xrOS", "visionOS"}
            or ent.get("application-identifier") != team + "." + app
            or ent.get("com.apple.developer.team-identifier") != team
            or ent.get("get-task-allow") is not False or "ProvisionedDevices" in profile or profile.get("ProvisionsAllDevices")
            or ent.get("com.apple.developer.associated-domains") != "*"
            or ent.get("com.apple.developer.applesignin") != ["Default"] or ent.get("aps-environment") != "production"
            or profile.get("DeveloperCertificates") != [certificate]):
        raise ValueError("Exact capability profile binding is invalid")
    if not isinstance(expiry, datetime) or expiry.replace(tzinfo=timezone.utc) <= (now or datetime.now(timezone.utc)):
        raise ValueError("Capability profile expired")
    identifier = profile.get("UUID", "")
    if not isinstance(identifier, str) or len(identifier) != 36 or str(uuid.UUID(identifier)) != identifier.lower():
        raise ValueError("Invalid profile UUID")


def check_config(cfg, environment):
    app, _ = TARGETS[environment]
    # Historical QA configuration predates the explicit environment/app fields.
    if cfg.get("environment", environment) != environment or cfg.get("app_id", app) != app:
        raise ValueError("Configuration does not match its exact capability target")
    if environment == "prod" and (cfg.get("environment") != "prod" or cfg.get("app_id") != app):
        raise ValueError("Explicit Prod identity is required")


def prepare(cfg, environment, asc, *, create=False):
    check_config(cfg, environment)
    app, name = TARGETS[environment]
    target = exact(asc.collection("bundleIds", {"filter[identifier]": app}), "identifier", app)
    if target["attributes"].get("platform") not in ("IOS", "UNIVERSAL"):
        raise ValueError("Exact iOS bundle is missing")
    resource = "bundleIds/" + target["id"] + "/bundleIdCapabilities"
    for kind in CAPABILITIES:
        existing = exact(asc.collection(resource), "capabilityType", kind, optional=True)
        if existing is None and create:
            attributes = {"capabilityType": kind}
            if kind == "APPLE_ID_AUTH":
                attributes["settings"] = [{"key": "APPLE_ID_AUTH_APP_CONSENT", "options": [{"key": "PRIMARY_APP_CONSENT", "enabled": True}]}]
            asc.request("bundleIdCapabilities", body={"data": {"type": "bundleIdCapabilities", "attributes": attributes,
                        "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": target["id"]}}}}}, method="POST")
        if exact(asc.collection(resource), "capabilityType", kind, optional=True) is None:
            raise ValueError("Required native capability is missing")
    certificate_id, certificate = signing_certificate(asc, cfg)
    def current():
        return exact(asc.collection("profiles", {"filter[name]": name}), "name", name, optional=True)
    row = current()
    if row is None and create:
        asc.request("profiles", body={"data": {"type": "profiles", "attributes": {"name": name, "profileType": "IOS_APP_STORE"},
                    "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": target["id"]}},
                                      "certificates": {"data": [{"type": "certificates", "id": certificate_id}]}}}}, method="POST")
        row = current()
    if row is None or row["attributes"].get("profileType") != "IOS_APP_STORE" or row["attributes"].get("profileState") != "ACTIVE":
        raise ValueError("Exact active capability profile is missing")
    related = asc.request("profiles/" + row["id"] + "/bundleId")["data"]
    if related.get("id") != target["id"] or related.get("attributes", {}).get("identifier") != app:
        raise ValueError("Capability profile belongs to another bundle")
    raw = base64.b64decode(row["attributes"]["profileContent"], validate=True)
    with tempfile.NamedTemporaryFile() as temporary:
        temporary.write(raw); temporary.flush()
        profile = plistlib.loads(capture(["security", "cms", "-D", "-i", temporary.name]))
    validate(profile, environment, cfg, certificate)
    output = external(cfg["artifact_root"]) / "signing/capabilities-v2"
    exclusive_bytes(output / ("Rogichat-" + environment + "-Capabilities-v2.mobileprovision"), raw, same_ok=True)
    installed = Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles" / (profile["UUID"] + ".mobileprovision")
    exclusive_bytes(installed, raw, same_ok=True)
    private_write(output / "readback.json", json.dumps({"environment": environment, "app_id": app,
        "profile_name": name, "profile_uuid": profile["UUID"], "certificate_sha256": hashlib.sha256(certificate).hexdigest(),
        "apple_default": True, "aps_production": True, "apns_provider_verified": False}, indent=2) + "\n")
    return name


def update_config(path, cfg, environment, profile_name):
    if profile_name != TARGETS[environment][1]:
        raise ValueError("Unexpected capability profile")
    path = external(path)
    if json.loads(path.read_text()) != cfg:
        raise ValueError("Configuration changed during preparation")
    backup = external(cfg["artifact_root"]) / "signing/capabilities-v2/config-before.json"
    if not backup.exists(): exclusive_bytes(backup, path.read_bytes())
    updated = dict(cfg, ios=dict(cfg["ios"], provisioning_profile=profile_name))
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".capability-config-", delete=False) as temporary:
        candidate = Path(temporary.name)
        try:
            temporary.write((json.dumps(updated, indent=2) + "\n").encode()); temporary.flush(); os.fsync(temporary.fileno())
            os.replace(candidate, path)
            descriptor = os.open(path.parent, os.O_RDONLY)
            try: os.fsync(descriptor)
            finally: os.close(descriptor)
        finally:
            candidate.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment", choices=tuple(TARGETS)); parser.add_argument("--create-missing", action="store_true")
    parser.add_argument("--config", type=Path); parser.add_argument("--update-config", action="store_true")
    args = parser.parse_args(); os.umask(0o077)
    path = args.config or Path.home() / (".config/rogichat/mobile-" + args.environment + ".json")
    cfg = config(path); check_config(cfg, args.environment)
    directory = external(cfg["artifact_root"]); directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / "capability-preparation.lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        name = prepare(cfg, args.environment, AppStoreConnect(cfg), create=args.create_missing)
        if args.update_config: update_config(path, cfg, args.environment, name)
    print(json.dumps({"environment": args.environment, "exact_profile": True, "apple_default": True,
                      "aps_production": True, "config_updated": args.update_config, "apns_provider_verified": False}))


if __name__ == "__main__":
    try: main()
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print("Capability preparation stopped:", type(error).__name__)
        raise SystemExit(1)
