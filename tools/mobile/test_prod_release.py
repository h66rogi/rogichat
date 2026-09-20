"""Pure Prod release boundary tests; no SDK, credentials, network or device access."""
import copy
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import prod_release as prod
import release_common

SHA = "a" * 40
CERT = b"unit-certificate"
NS = "http://schemas.android.com/apk/res/android"
XML = f'''<manifest xmlns:android="{NS}" package="{prod.APP_ID}" android:versionCode="1" android:versionName="0.1.0">
<application android:allowBackup="false" android:usesCleartextTraffic="false">
<meta-data android:name="chat.rogi.environment" android:value="prod"/>
<meta-data android:name="chat.rogi.apiBaseURL" android:value="{prod.API_URL}"/>
<activity android:name=".MainActivity" android:exported="true"><intent-filter android:autoVerify="true">
<action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/>
<category android:name="android.intent.category.BROWSABLE"/>
<data android:scheme="https" android:host="rogi.chat" android:path="/mobile/auth/complete"/>
</intent-filter></activity></application></manifest>'''


class ProdReleaseTests(unittest.TestCase):
    def config(self, root):
        return {"environment": "prod", "app_id": prod.APP_ID, "artifact_root": str(root), "ios": {
            "team_id": "TESTTEAM00", "signing_certificate": hashlib.sha1(CERT).hexdigest().upper(),
            "provisioning_profile": prod.PROFILE_NAME, "keychain": "unused", "keychain_password_file": "unused"}}

    def profile(self):
        team = "TESTTEAM00"
        return {"Name": prod.PROFILE_NAME, "UUID": "00000000-0000-4000-8000-000000000001",
                "ExpirationDate": datetime.now(timezone.utc) + timedelta(days=30), "TeamIdentifier": [team],
                "ApplicationIdentifierPrefix": [team], "Platform": ["iOS"], "DeveloperCertificates": [CERT],
                "Entitlements": {"application-identifier": team + "." + prod.APP_ID,
                                 "com.apple.developer.team-identifier": team, "get-task-allow": False,
                                 "com.apple.developer.associated-domains": "*", "com.apple.developer.applesignin": ["Default"], "aps-environment": "production"}}

    def entitlements(self):
        return {"application-identifier": "TESTTEAM00." + prod.APP_ID,
                "com.apple.developer.team-identifier": "TESTTEAM00", "get-task-allow": False,
                "com.apple.developer.associated-domains": sorted(prod.DOMAINS),
                "com.apple.developer.applesignin": ["Default"], "aps-environment": "production"}

    def test_exact_clean_commit_required_before_build(self):
        for outputs in (["b" * 40, ""], [SHA, " M apps/ios/source.swift"], [SHA, "?? unexpected"]):
            with patch.object(prod, "command", side_effect=outputs):
                with self.assertRaises(ValueError): prod.source(SHA)
        with patch.object(prod, "command", side_effect=[SHA, ""]): prod.source(SHA)
        with patch.object(prod, "command") as command:
            with self.assertRaises(ValueError): prod.source("HEAD")
            command.assert_not_called()

    def test_child_environment_cannot_inherit_qa_signing_or_preload(self):
        env = {"PATH": "/bin", "HOME": "/home/test", "DEVELOPER_DIR": "/xcode",
               "ROGICHAT_QA_STORE_PASSWORD": "not-real", "ROGICHAT_PROD_KEYSTORE": "untrusted",
               "NODE_OPTIONS": "--require=untrusted", "JAVA_TOOL_OPTIONS": "-javaagent:untrusted", "DEBUG": "*"}
        with patch.dict(prod.os.environ, env, clear=True):
            self.assertEqual(prod.environment(), {key: env[key] for key in ("PATH", "HOME", "DEVELOPER_DIR")})

    def test_archive_profile_is_scoped_to_app_without_disabling_bundle_signing(self):
        with tempfile.TemporaryDirectory() as root, patch.object(prod, "source"), \
                patch.object(prod, "inspect_product_sources"), patch.object(prod, "inspect_ios_dependencies"), \
                patch.object(prod, "unlock"), patch.object(prod, "output", return_value=Path(root)), \
                patch.object(prod, "command", return_value="Xcode 26.6\nBuild version 17F113"), \
                patch.object(prod, "run", side_effect=RuntimeError("stop before SDK")) as run:
            with self.assertRaisesRegex(RuntimeError, "stop before SDK"):
                prod.ios_archive(self.config(root), 15, "0.1.0", SHA)
        command = run.call_args.args[0]
        self.assertIn("ROGICHAT_PROVISIONING_PROFILE=" + prod.PROFILE_NAME, command)
        self.assertFalse(any(arg.startswith(("PROVISIONING_PROFILE=", "PROVISIONING_PROFILE_SPECIFIER=")) for arg in command))
        self.assertNotIn("CODE_SIGNING_ALLOWED=NO", command)
        self.assertIn("CODE_SIGN_STYLE=Manual", command)
        self.assertIn("CODE_SIGN_IDENTITY=" + self.config(root)["ios"]["signing_certificate"], command)
        self.assertIn("Release-Prod", command)
        for flag in prod.XCODE_RESOLVED_FLAGS:
            self.assertIn(flag, command)

    def test_qa_config_blocks_before_any_sdk_or_private_material_access(self):
        cfg = self.config("/tmp/test"); cfg["environment"] = "qa"
        with patch.object(prod, "command") as command, patch.object(prod, "android_certificate") as certificate:
            for operation in (lambda: prod.ios_archive(cfg, 1, "0.1.0", SHA),
                              lambda: prod.android_build(cfg, 1, "0.1.0", SHA),
                              lambda: prod.manifest(cfg, "/does-not-exist", "ios")):
                with self.assertRaises(ValueError): operation()
            command.assert_not_called(); certificate.assert_not_called()

    def test_apk_and_aab_signers_must_both_match_separate_prod_key(self):
        expected = hashlib.sha256(CERT).hexdigest()
        def commands(apk_cert, aab_cert):
            pem = "-----BEGIN CERTIFICATE-----\n" + base64.b64encode(aab_cert).decode() + "\n-----END CERTIFICATE-----"
            return [f"Number of signers: 1\nSigner #1 certificate SHA-256 digest: {apk_cert}\n",
                    f"package: name='{prod.APP_ID}' versionCode='1' versionName='0.1.0'\napplication-label:'로기챗'\n",
                    prod.xmltree(XML), "", XML, "jar verified.", pem]
        with patch.object(prod, "android_certificate", return_value=expected), patch.object(prod, "inspect_android_package"), \
                patch.object(prod.android_firebase, "load"), patch.object(prod.android_firebase, "inspect_apk"), \
                patch.object(prod.android_firebase, "inspect_aab"), \
                patch.object(prod, "sdk_tool", side_effect=lambda value: value), patch.object(prod, "bundletool", return_value=["bundletool"]):
            with patch.object(prod, "command", side_effect=commands(expected, CERT)) as command:
                prod.inspect_android(Path("app.apk"), Path("app.aab"), self.config("/tmp/test"), 1, "0.1.0")
                self.assertEqual(command.call_args_list[0].args[0], ["apksigner", "verify", "--verbose", "--print-certs", "app.apk"])
            for apk_cert, aab_cert in (("0" * 64, CERT), (expected, b"qa-certificate")):
                with patch.object(prod, "command", side_effect=commands(apk_cert, aab_cert)), self.assertRaises(ValueError):
                    prod.inspect_android(Path("app.apk"), Path("app.aab"), self.config("/tmp/test"), 1, "0.1.0")

    def test_apksigner_37_v2_and_legacy_single_signer_formats(self):
        expected = hashlib.sha256(CERT).hexdigest()
        for label in ("V2 Signer:", "Signer #1"):
            for digest in (expected, expected.upper()):
                with self.subTest(label=label, digest=digest):
                    prod.inspect_apk_signer(self.signer_output(label, digest), expected)

    def signer_output(self, label="V2 Signer:", digest=None):
        digest = digest or hashlib.sha256(CERT).hexdigest()
        return ("Verifies\nVerified using v1 scheme (JAR signing): false\n"
                "Verified using v2 scheme (APK Signature Scheme v2): true\n"
                "Verified using v3 scheme (APK Signature Scheme v3): false\n"
                "Number of signers: 1\n"
                f"{label} certificate DN: CN=unit\n"
                f"{label} certificate SHA-256 digest: {digest}\n"
                f"{label} public key SHA-256 digest: {'0' * 64}\n")

    def test_apk_signer_cardinality_and_ambiguous_labels_fail_closed(self):
        expected = hashlib.sha256(CERT).hexdigest()
        original = self.signer_output()
        digest_line = f"V2 Signer: certificate SHA-256 digest: {expected}\n"
        bad = [original.replace("Number of signers: 1\n", ""),
               original.replace("Number of signers: 1", "Number of signers: 0"),
               original.replace("Number of signers: 1", "Number of signers: 2"),
               original.replace("Number of signers: 1", "Number of signers: 01"),
               original + "Number of signers: 1\n", original + digest_line,
               original + f"Signer #2 certificate SHA-256 digest: {expected}\n",
               original + f"Signer #1 certificate SHA-256 digest: {expected}\n",
               self.signer_output("Signer #2"), self.signer_output("V3 Signer:"),
               original.replace(digest_line, ""), original.replace(digest_line, " " + digest_line),
               self.signer_output(digest="0" * 64), self.signer_output(digest="a" * 63),
               self.signer_output(digest="a" * 65), self.signer_output(digest="z" * 64),
               original.replace("scheme (APK Signature Scheme v2): true", "scheme (APK Signature Scheme v2): false"),
               original.replace("Verified using v2 scheme (APK Signature Scheme v2): true\n", ""),
               original + "Verified using v2 scheme (APK Signature Scheme v2): true\n"]
        for output in bad:
            with self.subTest(output=output), self.assertRaises(ValueError):
                prod.inspect_apk_signer(output, expected)
        for certificate in ("", "a" * 63, "a" * 65, "z" * 64):
            with self.subTest(certificate=certificate), self.assertRaises(ValueError):
                prod.inspect_apk_signer(original, certificate)

    def test_qa_or_wildcard_profile_signed_entitlements_are_rejected(self):
        cfg = self.config("/tmp/test"); ent = self.entitlements(); profile = self.profile()
        prod.verify_entitlements(ent, profile, cfg, CERT)
        for changes in ({"application-identifier": "TESTTEAM00." + prod.APP_ID + ".qa"},
                        {"com.apple.developer.team-identifier": "OTHERTEAM0"}, {"get-task-allow": True},
                        {"com.apple.developer.applesignin": []}, {"com.apple.developer.applesignin": ["PrimaryAppConsent"]},
                        {"aps-environment": "development"}, {"aps-environment": None},
                        {"com.apple.developer.associated-domains": ["applinks:qa.rogi.chat", "webcredentials:qa.rogi.chat"]},
                        {"com.apple.developer.associated-domains": ["applinks:rogi.chat"]}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                prod.verify_entitlements(dict(ent, **changes), profile, cfg, CERT)
        for field, value in (("Name", "Rogichat QA"), ("ProvisionedDevices", []), ("DeveloperCertificates", [b"other"])):
            with self.subTest(field=field), self.assertRaises(ValueError):
                prod.verify_entitlements(ent, dict(profile, **{field: value}), cfg, CERT)
        invalid = copy.deepcopy(profile); invalid["Entitlements"]["application-identifier"] = "TESTTEAM00.*"
        with self.assertRaises(ValueError): prod.verify_entitlements(ent, invalid, cfg, CERT)
        invalid = copy.deepcopy(profile); invalid["Entitlements"]["aps-environment"] = "development"
        with self.assertRaises(ValueError): prod.verify_entitlements(ent, invalid, cfg, CERT)
        cfg["ios"]["signing_certificate"] = "0" * 40
        with self.assertRaises(ValueError): prod.verify_entitlements(ent, profile, cfg, CERT)

    def test_prod_bundle_exact_identity_and_transport(self):
        info = {"CFBundleIdentifier": prod.APP_ID, "CFBundleVersion": "1", "CFBundleShortVersionString": "0.1.0",
                "CFBundleDisplayName": "로기챗", "CFBundleExecutable": "Rogichat", "RogichatEnvironment": "prod",
                "RogichatAPIBaseURL": prod.API_URL, "UIDeviceFamily": [1], "MinimumOSVersion": "18.0",
                "CFBundleSupportedPlatforms": ["iPhoneOS"], "ITSAppUsesNonExemptEncryption": False}
        prod.inspect_info(info, 1, "0.1.0")
        for field, value in (("CFBundleIdentifier", prod.APP_ID + ".qa"), ("RogichatEnvironment", "qa"),
                             ("RogichatAPIBaseURL", "https://api.qa.rogi.chat/v1/"), ("NSAppTransportSecurity", {}),
                             ("CFBundleVersion", "2"), ("CFBundleSupportedPlatforms", ["iPhoneSimulator"])):
            with self.subTest(field=field), self.assertRaises(ValueError): prod.inspect_info(dict(info, **{field: value}), 1, "0.1.0")

    def test_android_environment_owned_by_application_and_exact_callback(self):
        prod.android_manifest(prod.xmltree(XML))
        for old, new in (("api.rogi.chat", "api.qa.rogi.chat"), ('value="prod"', 'value="qa"'),
                         ('host="rogi.chat"', 'host="qa.rogi.chat"'), ('autoVerify="true"', 'autoVerify="false"'),
                         ('allowBackup="false"', 'allowBackup="true"'), ('usesCleartextTraffic="false"', 'usesCleartextTraffic="true"')):
            with self.subTest(old=old), self.assertRaises(ValueError): prod.android_manifest(prod.xmltree(XML.replace(old, new)))
        metadata = '<meta-data android:name="chat.rogi.environment" android:value="prod"/>'
        wrong_owner = XML.replace(metadata, "").replace('</activity>', metadata + '</activity>')
        with self.assertRaises(ValueError): prod.android_manifest(prod.xmltree(wrong_owner))
        with self.assertRaises(ValueError): prod.android_manifest(prod.xmltree(XML.replace(metadata, metadata * 2)))

    def make_receipt(self, directory, platform="android"):
        cfg = self.config(directory); root = Path(directory) / "prod" / platform / "1"; root.mkdir(parents=True)
        if platform == "android":
            artifacts = {kind: root / ("app." + kind) for kind in ("apk", "aab")}
            extra = {}
        else:
            archive = root / "Rogichat-Prod.xcarchive"
            artifacts = {"archive_info": archive / "Info.plist", "executable": archive / "Products/Applications/Rogichat.app/Rogichat"}
            extra = {"archive_path": str(archive)}
        for path in artifacts.values(): path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b"original")
        if platform == "ios": extra["archive_sha256"] = prod.tree_sha256(archive)
        with patch.object(prod, "source"):
            path = prod.save(root, platform, 1, "0.1.0", SHA, artifacts, **extra)
        return cfg, path

    def test_receipt_rejects_qa_dirty_wrong_source_and_hash_mutations(self):
        with tempfile.TemporaryDirectory() as root, patch.object(prod, "source"):
            cfg, path = self.make_receipt(root); original = json.loads(path.read_text())
            prod.manifest(cfg, path, "android")
            for field, value in (("app_id", prod.APP_ID + ".qa"), ("environment", "qa"), ("source_dirty", 0),
                                 ("source_dirty", True), ("store_uploaded", True), ("api_url", "https://api.qa.rogi.chat/v1/"),
                                 ("build_number", True), ("platform", "ios")):
                path.write_text(json.dumps(dict(original, **{field: value})))
                with self.subTest(field=field), self.assertRaises(ValueError): prod.manifest(cfg, path, "android")
            path.write_text(json.dumps(original)); Path(original["artifacts"]["apk"]["path"]).write_bytes(b"changed")
            with self.assertRaises(ValueError): prod.manifest(cfg, path, "android")

    def test_receipt_cannot_relocate_artifacts_or_drop_required_binary(self):
        with tempfile.TemporaryDirectory() as root, patch.object(prod, "source"):
            cfg, path = self.make_receipt(root); original = json.loads(path.read_text())
            forged = copy.deepcopy(original); outside = Path(root) / "other.apk"; outside.write_bytes(b"original")
            forged["artifacts"]["apk"]["path"] = str(outside)
            path.write_text(json.dumps(forged))
            with self.assertRaises(ValueError): prod.manifest(cfg, path, "android")
            forged = copy.deepcopy(original); del forged["artifacts"]["aab"]; path.write_text(json.dumps(forged))
            with self.assertRaises(ValueError): prod.manifest(cfg, path, "android")
            relocated = Path(root) / "release.json"; relocated.write_text(json.dumps(original))
            with self.assertRaises(ValueError): prod.manifest(cfg, relocated, "android")

    def test_source_edit_before_receipt_prevents_positive_receipt(self):
        with tempfile.TemporaryDirectory() as root, patch.object(prod, "source", side_effect=ValueError("dirty")):
            with self.assertRaises(ValueError): prod.save(Path(root), "android", 1, "0.1.0", SHA, {})
            self.assertFalse((Path(root) / "release.json").exists())

    def test_export_is_local_prod_only_and_never_internal_testflight_only(self):
        cfg = self.config("/tmp/test"); options = prod.export_options(cfg)
        self.assertEqual(options["destination"], "export")
        self.assertEqual(options["provisioningProfiles"], {prod.APP_ID: prod.PROFILE_NAME})
        self.assertFalse(options["testFlightInternalTestingOnly"])
        cfg["ios"]["provisioning_profile"] = "Rogichat QA"
        with self.assertRaises(ValueError): prod.export_options(cfg)

    def test_export_uses_independent_archive_and_preserves_canonical_hash(self):
        with tempfile.TemporaryDirectory() as root, patch.object(prod, "source"), patch.object(prod, "inspect_ios_dependencies"), \
                patch.object(prod, "inspect_product_sources"), patch.object(prod, "inspect_app"), \
                patch.object(prod, "inspect_ipa"), patch.object(prod, "unlock"):
            cfg, path = self.make_receipt(root, "ios"); original = json.loads(path.read_text()); seen = []
            def export(command, log, **kwargs):
                seen.append(command); working = Path(command[command.index("-archivePath") + 1])
                self.assertEqual(working.name, "ExportWorking.xcarchive")
                (working / "Info.plist").write_bytes(b"Xcode-added-export-metadata")
                target = path.parent / "export"; target.mkdir(); (target / "Rogichat.ipa").write_bytes(b"unit-ipa")
            with patch.object(prod, "run", side_effect=export): prod.ios_export(cfg, path)
            value = prod.manifest(cfg, path, "ios")
            self.assertEqual(value["archive_sha256"], original["archive_sha256"])
            self.assertFalse(value["apple_validated"]); self.assertFalse(value["store_uploaded"])
            self.assertEqual(len(seen), 1)
            with patch.object(prod, "run") as run:
                with self.assertRaises(ValueError): prod.ios_export(cfg, path)
                run.assert_not_called()

    def test_archive_checksum_mutation_blocks_export_before_unlock(self):
        with tempfile.TemporaryDirectory() as root, patch.object(prod, "source"), patch.object(prod, "unlock") as unlock:
            cfg, path = self.make_receipt(root, "ios"); value = json.loads(path.read_text())
            (Path(value["archive_path"]) / "injected").write_bytes(b"change")
            with self.assertRaises(ValueError): prod.ios_export(cfg, path)
            unlock.assert_not_called()

    def test_ipa_zip_traversal_and_duplicate_entries_rejected_before_signature(self):
        for names in (("../escape",), ("/absolute",), ("Payload/App.app/Info.plist",) * 2):
            with tempfile.TemporaryDirectory() as root, patch.object(prod, "inspect_app") as inspect:
                path = Path(root) / "app.ipa"
                import warnings
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    with zipfile.ZipFile(path, "w") as archive:
                        for name in names: archive.writestr(name, b"test")
                with self.assertRaises(ValueError): prod.inspect_ipa(path, self.config(root), 1, "0.1.0")
                inspect.assert_not_called()

    def test_existing_qa_boundary_is_unchanged(self):
        self.assertEqual(release_common.APP_ID, "chat.rogi.rogichat.qa")
        with tempfile.TemporaryDirectory() as root, patch.object(prod, "source"):
            _, path = self.make_receipt(root)
            with self.assertRaises(ValueError): release_common.manifest(path, "android", uploading=True)


if __name__ == "__main__": unittest.main()
