"""Test-only synthetic signing metadata; no signing material or API access."""
from copy import deepcopy
from datetime import datetime, timezone
import unittest

from ios_associations import DOMAIN_KEY, QA_DOMAINS, verify_binding
from release_common import APP_ID


class CallbackSigningTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 20, tzinfo=timezone.utc)
        self.signed = {
            DOMAIN_KEY: sorted(QA_DOMAINS),
            "application-identifier": "testprefix." + APP_ID,
            "com.apple.developer.team-identifier": "testteam",
            "get-task-allow": False,
        }
        self.profile = {
            "TeamIdentifier": ["testteam"], "ApplicationIdentifierPrefix": ["testprefix"],
            "ExpirationDate": datetime(2027, 9, 19),
            "Entitlements": {**self.signed, DOMAIN_KEY: "*"},
        }

    def check(self, *, distribution=True):
        verify_binding(self.signed, self.profile, distribution=distribution, now=self.now)

    def test_actual_profile_wildcard_representations_and_exact_domains(self):
        for permitted in ("*", ["*"], sorted(QA_DOMAINS)):
            with self.subTest(permitted=permitted):
                self.profile["Entitlements"][DOMAIN_KEY] = permitted
                self.check()

    def test_prod_broad_developer_mode_missing_duplicate_domains_rejected(self):
        for domains in (None, "*", ["*"], ["applinks:rogi.chat", "webcredentials:rogi.chat"],
                        ["applinks:qa.rogi.chat"], ["applinks:qa.rogi.chat"] * 2,
                        ["applinks:qa.rogi.chat?mode=developer", "webcredentials:qa.rogi.chat"],
                        [[], "webcredentials:qa.rogi.chat"]):
            with self.subTest(domains=domains):
                self.signed[DOMAIN_KEY] = domains
                with self.assertRaises(ValueError):
                    self.check()

    def test_profile_identity_team_and_domain_must_match_signed_app(self):
        original = deepcopy(self.profile)
        for key, value in (("application-identifier", "testprefix.chat.rogi.rogichat"),
                           ("com.apple.developer.team-identifier", "otherteam"),
                           (DOMAIN_KEY, ["applinks:qa.rogi.chat"]), (DOMAIN_KEY, None)):
            with self.subTest(key=key, value=value):
                self.profile = deepcopy(original)
                self.profile["Entitlements"][key] = value
                with self.assertRaises(ValueError):
                    self.check()

    def test_development_archive_profile_cannot_be_exported_as_testflight(self):
        self.signed["get-task-allow"] = True
        self.profile["Entitlements"].update({"application-identifier": "testprefix.*", "get-task-allow": True})
        self.check(distribution=False)
        with self.assertRaises(ValueError):
            self.check()

    def test_ad_hoc_enterprise_expired_or_ambiguous_profile_rejected(self):
        original = deepcopy(self.profile)
        for key, value in (("ProvisionedDevices", ["test-device"]), ("ProvisionsAllDevices", True),
                           ("ExpirationDate", self.now), ("ExpirationDate", None),
                           ("TeamIdentifier", ["testteam", "other"]), ("ApplicationIdentifierPrefix", [])):
            with self.subTest(key=key):
                self.profile = deepcopy(original)
                self.profile[key] = value
                with self.assertRaises(ValueError):
                    self.check()


if __name__ == "__main__":
    unittest.main()
