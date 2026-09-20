"""Capability profile preparation uses mocked Apple responses; no live credentials."""
import base64
import copy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch

import prod_capabilities as caps

CERT = b"isolated-test-certificate"


def profile(environment):
    app, name = caps.TARGETS[environment]; team = "TESTTEAM00"
    return {"Name": name, "UUID": "00000000-0000-4000-8000-000000000001", "ExpirationDate": datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30),
            "TeamIdentifier": [team], "ApplicationIdentifierPrefix": [team], "Platform": ["iOS"], "DeveloperCertificates": [CERT],
            "Entitlements": {"application-identifier": team + "." + app, "com.apple.developer.team-identifier": team,
                             "get-task-allow": False, "com.apple.developer.associated-domains": "*",
                             "com.apple.developer.applesignin": ["Default"], "aps-environment": "production"}}


class Apple:
    def __init__(self, environment):
        self.environment = environment; app, name = caps.TARGETS[environment]
        self.bundle = {"id": "unit-bundle", "attributes": {"identifier": app, "platform": "IOS"}}
        self.caps = [{"id": "unit-domain", "attributes": {"capabilityType": "ASSOCIATED_DOMAINS"}}]
        self.profiles = []; self.writes = []
    def collection(self, path, params=None):
        if path == "bundleIds": return [self.bundle]
        if path == "profiles": return self.profiles
        return self.caps
    def request(self, path, body=None, method=None):
        if method is None: return {"data": self.bundle}
        self.writes.append((path, body))
        value = copy.deepcopy(body["data"]); value["id"] = "unit-new"
        if path == "profiles":
            value["attributes"].update(profileState="ACTIVE", profileContent=base64.b64encode(b"unit-cms").decode())
            self.profiles.append(value)
        else: self.caps.append(value)
        return {"data": value}


class CapabilityTests(unittest.TestCase):
    def test_profile_env_push_apple_and_original_certificate_must_all_match(self):
        cfg = {"ios": {"team_id": "TESTTEAM00"}}
        for environment in caps.TARGETS:
            original = profile(environment); caps.validate(original, environment, cfg, CERT)
            for key, value in (("aps-environment", "development"), ("aps-environment", None),
                               ("com.apple.developer.applesignin", []), ("application-identifier", "TESTTEAM00.*")):
                invalid = copy.deepcopy(original); invalid["Entitlements"][key] = value
                with self.subTest(environment=environment, key=key), self.assertRaises(ValueError): caps.validate(invalid, environment, cfg, CERT)
            other = "qa" if environment == "prod" else "prod"
            with self.assertRaises(ValueError): caps.validate(original, other, cfg, CERT)
            with self.assertRaises(ValueError): caps.validate(original, environment, cfg, b"wrong-cert")

    def test_only_missing_capabilities_new_named_profile_and_retry_readback(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(Path, "home", return_value=Path(directory)):
            cfg = {"environment": "prod", "app_id": caps.TARGETS["prod"][0], "artifact_root": str(Path(directory) / "artifacts"), "ios": {"team_id": "TESTTEAM00"}}
            api = Apple("prod")
            with patch.object(caps, "signing_certificate", return_value=("unit-cert", CERT)), patch.object(caps, "capture", return_value=plistlib.dumps(profile("prod"))):
                self.assertEqual(caps.prepare(cfg, "prod", api, create=True), caps.TARGETS["prod"][1])
                self.assertEqual(len(api.writes), 3)
                self.assertEqual([row[1]["data"]["attributes"].get("capabilityType") for row in api.writes[:2]], ["APPLE_ID_AUTH", "PUSH_NOTIFICATIONS"])
                self.assertEqual(api.writes[-1][1]["data"]["attributes"]["name"], caps.TARGETS["prod"][1])
                caps.prepare(cfg, "prod", api, create=True)
                self.assertEqual(len(api.writes), 3)
                for _, body in api.writes:
                    self.assertEqual(body["data"]["relationships"]["bundleId"]["data"]["id"], "unit-bundle")

    def test_wrong_target_config_rejected_before_api(self):
        api = Apple("qa")
        cfg = {"environment": "prod", "app_id": caps.TARGETS["prod"][0]}
        with self.assertRaises(ValueError): caps.prepare(cfg, "qa", api, create=True)
        self.assertEqual(api.writes, [])

    def test_private_config_original_preserved_and_only_profile_reference_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = {"environment": "prod", "app_id": caps.TARGETS["prod"][0], "artifact_root": str(Path(directory) / "artifacts"),
                   "ios": {"provisioning_profile": "old-profile", "team_id": "TESTTEAM00"}, "android": {"unchanged": True}}
            path = Path(directory) / "config.json"; path.write_text(json.dumps(cfg)); path.chmod(0o600)
            original = path.read_bytes()
            caps.update_config(path, cfg, "prod", caps.TARGETS["prod"][1])
            result = json.loads(path.read_text())
            self.assertEqual(result["ios"]["provisioning_profile"], caps.TARGETS["prod"][1])
            result["ios"]["provisioning_profile"] = "old-profile"; self.assertEqual(result, cfg)
            self.assertEqual((Path(cfg["artifact_root"]) / "signing/capabilities-v2/config-before.json").read_bytes(), original)
            self.assertEqual(path.stat().st_mode & 0o077, 0)
            with self.assertRaises(ValueError): caps.update_config(path, cfg, "prod", caps.TARGETS["prod"][1])


if __name__ == "__main__": unittest.main()
