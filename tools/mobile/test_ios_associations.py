"""Test-only metadata and mocked inspectors; no real profile, Keychain or SDK use."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import ios_associations as guard
from release_common import APP_ID


class CallbackSigningTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 20, tzinfo=timezone.utc)
        self.certificate = b"test-only-distribution-certificate"
        self.cfg = {"ios": {"team_id": "TESTTEAM00", "provisioning_profile": guard.QA_PROFILE,
                            "signing_certificate": hashlib.sha1(self.certificate).hexdigest().upper()}}
        self.signed = {guard.DOMAIN_KEY: sorted(guard.QA_DOMAINS), "application-identifier": "TESTTEAM00." + APP_ID,
                       "com.apple.developer.team-identifier": "TESTTEAM00", "get-task-allow": False,
                       "com.apple.developer.applesignin": ["Default"], "aps-environment": "production"}
        self.profile = {"Name": guard.QA_PROFILE, "UUID": "00000000-0000-4000-8000-000000000001",
                        "Platform": ["iOS"], "DeveloperCertificates": [self.certificate],
                        "TeamIdentifier": ["TESTTEAM00"], "ApplicationIdentifierPrefix": ["TESTTEAM00"],
                        "ExpirationDate": datetime(2027, 9, 19), "Entitlements": {**self.signed, guard.DOMAIN_KEY: "*"}}

    def check(self):
        guard.verify_binding(self.signed, self.profile, self.cfg, self.certificate, now=self.now)

    def test_exact_qa_v2_distribution_permissions_are_accepted(self):
        self.check()

    def test_prod_broad_developer_mode_missing_duplicate_domains_rejected(self):
        for domains in (None, "*", ["*"], ["applinks:rogi.chat", "webcredentials:rogi.chat"],
                        ["applinks:qa.rogi.chat"], ["applinks:qa.rogi.chat"] * 2,
                        ["applinks:qa.rogi.chat?mode=developer", "webcredentials:qa.rogi.chat"], [[], "webcredentials:qa.rogi.chat"]):
            with self.subTest(domains=domains):
                self.signed[guard.DOMAIN_KEY] = domains
                with self.assertRaises(ValueError): self.check()

    def test_actual_signed_apple_and_aps_required_even_when_profile_permits_them(self):
        original = deepcopy(self.signed)
        for key, value in (("com.apple.developer.applesignin", None), ("com.apple.developer.applesignin", []),
                           ("com.apple.developer.applesignin", ["Default", "unexpected"]),
                           ("aps-environment", None), ("aps-environment", "development")):
            self.signed = deepcopy(original)
            if value is None: del self.signed[key]
            else: self.signed[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError): self.check()

    def test_profile_apple_and_push_permission_are_independently_required(self):
        original = deepcopy(self.profile)
        for key, value in (("aps-environment", "development"), ("aps-environment", None),
                           ("com.apple.developer.applesignin", []), (guard.DOMAIN_KEY, ["*"])):
            self.profile = deepcopy(original); self.profile["Entitlements"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.check()

    def test_profile_identity_team_and_certificate_must_match_actual_signer(self):
        original = deepcopy(self.profile)
        for key, value in (("application-identifier", "TESTTEAM00.chat.rogi.rogichat"),
                           ("com.apple.developer.team-identifier", "OTHERTEAM0"), ("application-identifier", "TESTTEAM00.*")):
            self.profile = deepcopy(original); self.profile["Entitlements"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.check()
        self.profile = original; self.cfg["ios"]["signing_certificate"] = "0" * 40
        with self.assertRaises(ValueError): self.check()

    def test_development_archive_and_old_profile_are_rejected_without_fallback(self):
        self.profile["Name"] = "Rogichat QA App Store"
        with self.assertRaises(ValueError): self.check()
        self.profile["Name"] = guard.QA_PROFILE
        self.signed["get-task-allow"] = True
        self.profile["Entitlements"].update({"application-identifier": "TESTTEAM00.*", "get-task-allow": True})
        with self.assertRaises(ValueError): self.check()

    def test_ad_hoc_enterprise_expired_ambiguous_and_foreign_cert_profiles_rejected(self):
        original = deepcopy(self.profile)
        for key, value in (("ProvisionedDevices", []), ("ProvisionsAllDevices", True), ("ExpirationDate", self.now),
                           ("ExpirationDate", None), ("TeamIdentifier", ["TESTTEAM00", "OTHERTEAM0"]),
                           ("ApplicationIdentifierPrefix", []), ("DeveloperCertificates", [b"different-cert"])):
            self.profile = deepcopy(original); self.profile[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.check()

    def test_missing_config_and_prod_config_fail_before_any_inspection(self):
        for cfg in ({}, {"ios": {}}, {"environment": "prod", **self.cfg},
                    {"ios": {**self.cfg["ios"], "provisioning_profile": "Rogichat Prod App Store Capabilities v2"}}):
            with patch.object(guard, "_run") as run, self.assertRaises((ValueError, KeyError)):
                guard.inspect_signed_callback("unused", b"profile", cfg)
            run.assert_not_called()

    def test_actual_extracted_certificate_is_bound_and_temporary_files_are_removed(self):
        captured = []
        def run(command, **kwargs):
            captured.append((command, kwargs))
            # codesign takes an optional value only with '='; a separate value
            # is interpreted as another input path, not an output prefix.
            self.assertNotIn("--extract-certificates", command)
            extracts = [arg for arg in command if arg.startswith("--extract-certificates=")]
            if extracts:
                self.assertEqual(len(command), 4)
                self.assertEqual(command[-1], "unit-app")
                Path(extracts[0].split("=", 1)[1] + "0").write_bytes(self.certificate)
            return b""
        with tempfile.TemporaryDirectory() as directory:
            temporary_root = Path(directory)
            with patch.object(guard, "_run", side_effect=run), patch.object(guard, "_plist", side_effect=[self.signed, self.profile]) as plist:
                guard.inspect_signed_callback("unit-app", b"unit-profile", self.cfg, temporary_root=temporary_root)
            self.assertEqual(captured[0][0], ["codesign", "--verify", "--strict", "unit-app"])
            self.assertTrue(all(kwargs["temporary_root"] == temporary_root for _, kwargs in captured))
            self.assertTrue(all(call.kwargs["temporary_root"] == temporary_root for call in plist.call_args_list))
            prefix = next(arg.split("=", 1)[1] for arg in captured[-1][0] if arg.startswith("--extract-certificates="))
            self.assertEqual(Path(prefix).parent.parent, temporary_root)
            self.assertFalse(Path(prefix).parent.exists())

    def test_signed_inspection_child_inherits_external_temp_path(self):
        original_temp = os.environ.get("TMPDIR")
        with tempfile.TemporaryDirectory() as directory, patch.object(guard.subprocess, "run") as child:
            child.return_value = subprocess.CompletedProcess(["codesign"], 0, b"verified", b"")
            self.assertEqual(guard._run(["codesign", "--verify"], temporary_root=Path(directory)), b"verified")
            self.assertEqual(child.call_args.kwargs["env"]["TMPDIR"], directory)
        self.assertEqual(os.environ.get("TMPDIR"), original_temp)

    def test_inspector_timeout_suppresses_command_details(self):
        with patch.object(guard.subprocess, "run", side_effect=subprocess.TimeoutExpired(["not-public"], 60)):
            with self.assertRaisesRegex(ValueError, "inspection timed out"):
                guard._run(["codesign", "not-public"])


if __name__ == "__main__": unittest.main()
