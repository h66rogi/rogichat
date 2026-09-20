"""Pure/local tests only: no Apple account, signing keychain, or network access."""
import copy
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import prod_signing as prod
import release_common


class FakeApple:
    def __init__(self, rows):
        self.bundles = rows
        self.caps = []
        self.writes = []

    def collection(self, resource, params=None):
        return self.bundles if resource == "bundleIds" else self.caps

    def request(self, resource, body=None, method=None):
        self.writes.append((resource, body))
        data = copy.deepcopy(body["data"])
        data["id"] = "test-resource"
        (self.bundles if resource == "bundleIds" else self.caps).append(data)
        return {"data": data}


class ProdPreparationTests(unittest.TestCase):
    def test_qa_prefix_is_never_selected_or_modified(self):
        qa = {"id": "qa", "attributes": {"identifier": prod.APP_ID + ".qa", "platform": "IOS"}}
        api = FakeApple([qa])
        with self.assertRaises(ValueError):
            prod.bundle(api)
        self.assertEqual(api.writes, [])
        result = prod.bundle(api, create=True)
        self.assertNotEqual(result["id"], "qa")
        self.assertEqual(qa["attributes"]["identifier"], prod.APP_ID + ".qa")
        prod.capabilities(api, result, create=True)
        for _, body in api.writes[1:]:
            self.assertEqual(body["data"]["relationships"]["bundleId"]["data"]["id"], result["id"])
        self.assertEqual(len(api.writes), 3)
        self.assertEqual(api.writes[-1][1]["data"]["attributes"]["settings"][0]["options"],
                         [{"key": "PRIMARY_APP_CONSENT", "enabled": True}])
        prod.bundle(api, create=True)
        prod.capabilities(api, result, create=True)
        self.assertEqual(len(api.writes), 3)

    def test_duplicate_or_wrong_platform_rejected(self):
        row = {"id": "prod", "attributes": {"identifier": prod.APP_ID, "platform": "IOS"}}
        with self.assertRaises(ValueError):
            prod.bundle(FakeApple([row, row]), create=True)
        row["attributes"]["platform"] = "MAC_OS"
        with self.assertRaises(ValueError):
            prod.bundle(FakeApple([row]), create=True)

    def test_apple_universal_identifier_supports_exact_ios_profile(self):
        row = {"id": "prod", "attributes": {"identifier": prod.APP_ID, "platform": "UNIVERSAL"}}
        self.assertEqual(prod.bundle(FakeApple([row])), row)

    def test_forged_capability_target_rejected(self):
        row = {"id": "prod", "attributes": {"identifier": prod.APP_ID, "platform": "IOS"}}
        api = FakeApple([row])
        with self.assertRaises(ValueError):
            prod.capabilities(api, {"id": "qa"}, create=True)
        self.assertEqual(api.writes, [])

    def test_profile_binding_mutations(self):
        now = datetime.now(timezone.utc)
        team = "TESTTEAM00"
        cfg = {"ios": {"team_id": team}}
        profile = {"Name": prod.PROFILE_NAME, "UUID": "00000000-0000-4000-8000-000000000001",
                   "ExpirationDate": now + timedelta(days=30), "TeamIdentifier": [team],
                   "ApplicationIdentifierPrefix": [team], "Platform": ["iOS"], "DeveloperCertificates": [b"test-cert"],
                   "Entitlements": {"application-identifier": team + "." + prod.APP_ID,
                                    "com.apple.developer.team-identifier": team, "get-task-allow": False,
                                    "com.apple.developer.associated-domains": "*", "com.apple.developer.applesignin": ["Default"]}}
        prod.valid_profile(profile, cfg, b"test-cert", now=now)
        profile["Platform"] = ["iOS", "xrOS", "visionOS"]
        prod.valid_profile(profile, cfg, b"test-cert", now=now)
        changes = [({"ProvisionedDevices": []}, {}), ({"ProvisionsAllDevices": True}, {}),
                   ({"DeveloperCertificates": [b"other"]}, {}), ({"TeamIdentifier": ["other"]}, {}),
                   ({"ExpirationDate": now}, {}), ({"Platform": ["OSX"]}, {}),
                   ({"Platform": ["iOS", "MacOS"]}, {}), ({"Platform": ["iOS", "iOS"]}, {}),
                   ({"UUID": "-" * 36}, {}), ({"UUID": "0" * 32}, {}),
                   ({}, {"application-identifier": team + "." + prod.APP_ID + ".qa"}),
                   ({}, {"application-identifier": team + ".*"}), ({}, {"get-task-allow": True}),
                   ({}, {"com.apple.developer.associated-domains": ["*"]}),
                   ({}, {"com.apple.developer.applesignin": []})]
        for root, entitlements in changes:
            with self.subTest(root=root, entitlements=entitlements):
                invalid = copy.deepcopy(profile); invalid.update(root); invalid["Entitlements"].update(entitlements)
                with self.assertRaises(ValueError):
                    prod.valid_profile(invalid, cfg, b"test-cert", now=now)

    def test_private_write_never_overwrites_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "signing"
            prod.exclusive_bytes(path, b"original")
            with self.assertRaises(ValueError):
                prod.exclusive_bytes(path, b"replacement")
            self.assertEqual(path.read_bytes(), b"original")
            self.assertEqual(path.stat().st_mode & 0o077, 0)
            prod.exclusive_bytes(path, b"original", same_ok=True)
            with self.assertRaises(ValueError):
                prod.exclusive_bytes(path, b"replacement", same_ok=True)

    def test_qa_configuration_rejected_before_api(self):
        with patch.object(prod, "config", return_value={"environment": "qa", "app_id": prod.APP_ID + ".qa"}):
            with self.assertRaises(ValueError):
                prod.prod_config("unused")

    def test_existing_qa_manifest_boundary_remains_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "release.json"
            manifest.write_text(json.dumps({"platform": "ios", "environment": "prod", "app_id": prod.APP_ID}))
            with self.assertRaises(ValueError):
                release_common.manifest(manifest, "ios", uploading=True)
        self.assertEqual(release_common.APP_ID, "chat.rogi.rogichat.qa")

    def test_lost_creation_response_is_reconciled_without_second_post(self):
        class LostResponse(FakeApple):
            def request(self, *args, **kwargs):
                super().request(*args, **kwargs)
                raise RuntimeError("response_lost")
        api = LostResponse([])
        with self.assertRaises(RuntimeError):
            prod.bundle(api, create=True)
        self.assertEqual(prod.bundle(api, create=True)["attributes"]["identifier"], prod.APP_ID)
        self.assertEqual(len(api.writes), 1)

    def test_android_qa_path_and_alias_rejected_without_command(self):
        for android in ({"key_alias": "qa"}, {"key_alias": "rogichat-prod-upload", "keystore": "/tmp/qa.p12", "password_file": "/tmp/password"}):
            with patch.object(prod, "capture") as capture:
                with self.assertRaises(ValueError):
                    prod.prepare_android({"android": android}, create=True)
                capture.assert_not_called()

    def test_android_certificate_only_entry_cannot_produce_positive_receipt(self):
        self.android_entry("trustedCertEntry", accepted=False)

    def test_android_private_key_entry_exports_certificate_and_receipt(self):
        self.android_entry("PrivateKeyEntry", accepted=True)

    def android_entry(self, entry, *, accepted):
        with tempfile.TemporaryDirectory() as directory, patch.object(Path, "home", return_value=Path(directory)):
            root = Path(directory) / ".config/rogichat/signing/prod"
            key = root / "upload.p12"; password = root / "upload-password"
            prod.exclusive_bytes(key, b"isolated-test-file"); prod.exclusive_bytes(password, b"test-only\n")
            artifacts = Path(directory) / "artifacts"
            cfg = {"artifact_root": str(artifacts), "android": {
                "keystore": str(key), "password_file": str(password), "key_alias": "rogichat-prod-upload"}}
            def capture(command):
                if "-list" in command:
                    return ("Entry type: " + entry).encode()
                self.assertIn("-exportcert", command)
                return b"isolated-public-certificate"
            with patch.object(prod, "capture", side_effect=capture) as run:
                if accepted:
                    result = prod.prepare_android(cfg)
                    self.assertTrue(result["dedicated_upload_key"])
                    self.assertEqual(run.call_count, 2)
                    receipt = json.loads((artifacts / "signing/android-preparation.json").read_text())
                    self.assertFalse(receipt["play_app_signing_verified"])
                else:
                    with self.assertRaises(ValueError):
                        prod.prepare_android(cfg)
                    self.assertEqual(run.call_count, 1)
                    self.assertFalse(artifacts.exists())

    def test_subprocess_timeout_does_not_leak_arguments(self):
        with patch.object(prod.subprocess, "run", side_effect=prod.subprocess.TimeoutExpired(["test", "sensitive"], 60)):
            with self.assertRaisesRegex(RuntimeError, "test timed out") as error:
                prod.capture(["test", "sensitive"])
            self.assertNotIn("sensitive", str(error.exception))


if __name__ == "__main__":
    unittest.main()
