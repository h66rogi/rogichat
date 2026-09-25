"""Release safety checks without account credentials or network requests."""
import json
import os
from pathlib import Path
import plistlib
import shutil
import tempfile
import subprocess
import unittest
from unittest.mock import patch
import zipfile

from release_common import APP_ID, API_URL, ROOT, AppStoreConnect, external, manifest, private_write, sha256, tree_sha256, version_number
from release_ios import export_options, inspect_ipa
import release_android
import release_ios
from ios_associations import QA_PROFILE
from product_guards import EXPECTED_IOS_PRIVACY
from test_product_guards import sdk_resources


class AppStoreTargetGuards(unittest.TestCase):
    def test_prefix_only_missing_and_duplicate_targets_are_rejected(self):
        # Filtering is pure; no credentials or Apple request is made by these tests.
        api = object.__new__(AppStoreConnect)
        for method, attribute in ((api.app, "bundleId"), (api.bundle, "identifier")):
            exact = {"id": "exact", "attributes": {attribute: APP_ID}}
            for records in ([], [{"id": "prefix", "attributes": {attribute: APP_ID + ".other"}}],
                            [{"id": "prod", "attributes": {attribute: "chat.rogi.rogichat"}}],
                            [{"id": "missing", "attributes": {}}], [exact, exact]):
                with self.subTest(method=method.__name__, records=records):
                    with patch.object(api, "request", return_value={"data": records}):
                        with self.assertRaises(ValueError):
                            method()

    def test_exact_qa_match_is_selected_among_prefix_matches(self):
        api = object.__new__(AppStoreConnect)
        for method, resource, attribute in ((api.app, "apps", "bundleId"), (api.bundle, "bundleIds", "identifier")):
            records = [{"id": "prefix", "attributes": {attribute: APP_ID + ".other"}},
                       {"id": "qa", "attributes": {attribute: APP_ID}}]
            with self.subTest(method=method.__name__):
                with patch.object(api, "request", return_value={"data": records}) as request:
                    self.assertEqual(method(), "qa")
                    request.assert_called_once_with(resource, {f"filter[{attribute}]": APP_ID})


class ReleaseGuards(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.artifact = self.root / "test.apk"
        self.artifact.write_bytes(b"fixture")
        self.path = self.root / "release.json"
        self.cfg = {"ios": {"team_id": "TESTTEAM00", "provisioning_profile": QA_PROFILE,
                            "signing_certificate": "A" * 40}}
        self.value = {"platform": "android", "environment": "qa", "app_id": APP_ID,
                      "build_number": 7, "version": "0.1.0", "source_dirty": False,
                      "artifacts": {"apk": {"path": str(self.artifact), "sha256": sha256(self.artifact)}}}

    def write(self):
        private_write(self.path, json.dumps(self.value))

    def test_artifact_tampering_blocks_upload(self):
        self.write()
        manifest(self.path, "android", uploading=True)
        self.artifact.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "checksum"):
            manifest(self.path, "android", uploading=True)

    def test_production_and_uncommitted_source_are_rejected(self):
        for key, value in (("environment", "prod"), ("app_id", "chat.rogi.rogichat"), ("source_dirty", True)):
            with self.subTest(key=key):
                original = self.value[key]
                self.value[key] = value
                self.write()
                with self.assertRaises(ValueError):
                    manifest(self.path, "android", uploading=True)
                self.value[key] = original

    def test_repository_and_symlink_paths_are_rejected(self):
        with self.assertRaises(ValueError):
            external(ROOT / "private-output")
        link = self.root / "indirect"
        link.symlink_to(ROOT, target_is_directory=True)
        with self.assertRaises(ValueError):
            external(link / "output.apk")

    def test_signed_resource_change_invalidates_archive(self):
        archive = self.root / "App.xcarchive"
        archive.mkdir()
        resource = archive / "Assets.car"
        resource.write_bytes(b"original")
        self.value.update(platform="ios", archive_path=str(archive), archive_sha256=tree_sha256(archive))
        self.write()
        manifest(self.path, "ios")
        resource.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "Archive contents"):
            manifest(self.path, "ios")

    def test_xcode_upload_metadata_changes_only_independent_working_archive(self):
        archive = self.root / "App.xcarchive"
        archive.mkdir()
        info = archive / "Info.plist"
        info.write_bytes(plistlib.dumps({"ApplicationProperties": {"ApplicationPath": "Applications/App.app"}}))
        ipa = self.root / "App.ipa"
        ipa.write_bytes(b"validated IPA")
        self.value.update(platform="ios", commit="a" * 40, archive_path=str(archive), archive_sha256=tree_sha256(archive), apple_validated=True,
                          artifacts={"archive_info": {"path": str(info), "sha256": sha256(info)}, "ipa": {"path": str(ipa), "sha256": sha256(ipa)}})
        self.write()
        manifest_hash = sha256(self.path)

        def xcode_upload(command, log, *, env):
            self.assertEqual(Path(env["TMPDIR"]), self.root / ".qa-temp")
            working = Path(command[command.index("-archivePath") + 1])
            self.assertNotEqual(working, archive)
            self.assertEqual(tree_sha256(working), self.value["archive_sha256"])
            metadata = plistlib.loads((working / "Info.plist").read_bytes())
            metadata["Distributions"] = [{"destination": "upload"}]
            (working / "Info.plist").write_bytes(plistlib.dumps(metadata))

        with patch.object(release_ios, "AppStoreConnect") as apple, patch.object(release_ios, "unlock_signing"), \
                patch.object(release_ios, "inspect_archive"), patch.object(release_ios, "inspect_ipa"), \
                patch.object(release_ios, "run", side_effect=xcode_upload), patch("builtins.print"):
            apple.return_value.builds.return_value = []
            apple.return_value.signing_args.return_value = []
            release_ios.upload(self.cfg, self.path)
        self.assertEqual(sha256(self.path), manifest_hash)
        self.assertEqual(tree_sha256(archive), self.value["archive_sha256"])
        self.assertNotIn("Distributions", plistlib.loads(info.read_bytes()))
        self.assertIn("Distributions", plistlib.loads((self.root / "UploadWorking.xcarchive/Info.plist").read_bytes()))
        manifest(self.path, "ios", uploading=True)
        receipt = json.loads((self.root / "testflight-upload-attempt.json").read_text())
        self.assertEqual(receipt["state"], "transport_completed")
        self.assertEqual(receipt["archive_sha256"], self.value["archive_sha256"])

    def test_corrupted_upload_copy_is_rejected_before_external_upload(self):
        archive = self.root / "App.xcarchive"
        archive.mkdir()
        (archive / "Info.plist").write_bytes(b"canonical metadata")
        expected = tree_sha256(archive)
        copytree = shutil.copytree

        def damaged_copy(source, target, **options):
            copytree(source, target, **options)
            (target / "Info.plist").write_bytes(b"damaged copy")

        with patch.object(release_ios.shutil, "copytree", side_effect=damaged_copy):
            with self.assertRaisesRegex(ValueError, "working archive differs"):
                release_ios.upload_working_archive(archive, self.root, expected)
        self.assertEqual(tree_sha256(archive), expected)

    def test_xcode_export_uses_separate_non_overwriting_archive(self):
        archive = self.root / "App.xcarchive"; archive.mkdir()
        info = archive / "Info.plist"; info.write_bytes(plistlib.dumps({"original": True}))
        self.value.update(platform="ios", archive_path=str(archive), archive_sha256=tree_sha256(archive),
                          artifacts={"archive_info": {"path": str(info), "sha256": sha256(info)}})
        self.write(); original_hash = tree_sha256(archive)
        cfg = {"ios": {**self.cfg["ios"], "key_id": "unit", "issuer_id": "unit", "key_file": str(self.root / "unit-key.p8")}}
        calls = []
        def xcode_export(command, log, *, env):
            self.assertEqual(Path(env["TMPDIR"]), self.root / ".qa-temp")
            calls.append(command)
            if command[0] != "xcodebuild": return
            working = Path(command[command.index("-archivePath") + 1])
            self.assertEqual(working, self.root / "ExportWorking.xcarchive")
            self.assertEqual(tree_sha256(working), original_hash)
            (working / "Info.plist").write_bytes(plistlib.dumps({"Distributions": ["local-export"]}))
            directory = self.root / "export"; directory.mkdir(); (directory / "App.ipa").write_bytes(b"unit exported ipa")
        with patch.object(release_ios, "AppStoreConnect") as apple, patch.object(release_ios, "unlock_signing"), \
                patch.object(release_ios, "inspect_archive"), patch.object(release_ios, "inspect_ipa") as ipa, \
                patch.object(release_ios, "run", side_effect=xcode_export), patch("builtins.print"):
            apple.return_value.signing_args.return_value = []
            release_ios.export(cfg, self.path)
            ipa.assert_called_once_with(self.root / "export/App.ipa", 7, "0.1.0", cfg)
            self.assertEqual(len(calls), 2)
            self.assertEqual(tree_sha256(archive), original_hash)
            self.assertFalse((self.root / "UploadWorking.xcarchive").exists())
            with self.assertRaisesRegex(ValueError, "already exists"):
                release_ios.export(cfg, self.path)
            self.assertEqual(len(calls), 2)
        value = manifest(self.path, "ios")
        self.assertTrue(value["apple_validated"])
        with self.assertRaises(FileExistsError):
            release_ios._working_archive(archive, self.root, original_hash, "Export")

    def test_export_detects_canonical_archive_mutation_before_apple_validation(self):
        archive = self.root / "App.xcarchive"; archive.mkdir()
        info = archive / "Info.plist"; info.write_bytes(b"original")
        self.value.update(platform="ios", archive_path=str(archive), archive_sha256=tree_sha256(archive),
                          artifacts={"archive_info": {"path": str(info), "sha256": sha256(info)}})
        self.write(); before = self.path.read_bytes()
        def corrupt_canonical(command, log, *, env):
            self.assertEqual(Path(env["TMPDIR"]), self.root / ".qa-temp")
            info.write_bytes(b"must not be trusted")
        with patch.object(release_ios, "AppStoreConnect") as apple, patch.object(release_ios, "unlock_signing"), \
                patch.object(release_ios, "inspect_archive"), patch.object(release_ios, "inspect_ipa") as ipa, \
                patch.object(release_ios, "run", side_effect=corrupt_canonical) as run:
            apple.return_value.signing_args.return_value = []
            with self.assertRaisesRegex(ValueError, "checksum"):
                release_ios.export(self.cfg, self.path)
            self.assertEqual(run.call_count, 1)
            ipa.assert_not_called()
        self.assertEqual(self.path.read_bytes(), before)

    def test_upload_copy_rejects_links_back_to_canonical_or_external_resources(self):
        archive = self.root / "App.xcarchive"
        archive.mkdir()
        metadata = archive / "Info.plist"
        metadata.write_bytes(b"canonical metadata")
        (archive / "alias").symlink_to(metadata)
        with self.assertRaisesRegex(ValueError, "independent working copy"):
            release_ios.upload_working_archive(archive, self.root, tree_sha256(archive))
        self.assertEqual(metadata.read_bytes(), b"canonical metadata")

    def test_firebase_target_is_checked_before_upload(self):
        self.write()
        cfg = {"firebase": {"project_id": "fixture", "app_id": "fixture"}}
        with patch.object(release_android, "verify_firebase_apk"), \
                patch.object(release_android, "firebase_json", return_value=[{"appId": "fixture", "packageName": "wrong.app"}]) as cli:
            with self.assertRaisesRegex(ValueError, "Firebase target"):
                release_android.upload(cfg, self.path, self.root / "notes.txt")
            self.assertEqual(cli.call_count, 1)
            self.assertEqual(cli.call_args.args[0][0], "apps:list")

    def test_firebase_packaged_config_rejection_blocks_upload_before_remote_requests(self):
        self.write()
        with patch.object(release_android, "verify_firebase_apk", side_effect=ValueError("resource mismatch")), \
                patch.object(release_android, "firebase_json") as cli:
            with self.assertRaisesRegex(ValueError, "resource mismatch"):
                release_android.upload({}, self.path, self.root / "notes.txt")
            cli.assert_not_called()

    def test_firebase_upload_success_can_omit_result(self):
        response = subprocess.CompletedProcess([], 0, '{"status":"success"}', 'upload succeeded')
        with patch.object(release_android.subprocess, "run", return_value=response):
            result = release_android.firebase_json(["appdistribution:distribute", "fixture.apk"], self.root)
        self.assertEqual(result["status"], "success")
        self.assertTrue((self.root / "firebase-appdistribution-distribute.log").is_file())

    def test_manual_export_is_scoped_to_qa(self):
        options = export_options("TESTTEAM00", "export", self.cfg["ios"])
        self.assertEqual(options["signingStyle"], "manual")
        self.assertEqual(options["provisioningProfiles"], {APP_ID: QA_PROFILE})

    def test_export_has_no_automatic_or_legacy_profile_fallback(self):
        for ios in (None, {}, {**self.cfg["ios"], "provisioning_profile": "Rogichat QA App Store"},
                    {**self.cfg["ios"], "signing_certificate": "Apple Development"}):
            with self.subTest(ios=ios), self.assertRaises(ValueError):
                export_options("TESTTEAM00", "export", ios)

    def test_upload_rejects_invalid_ipa_before_attempt_marker_or_transport(self):
        archive = self.root / "App.xcarchive"; archive.mkdir()
        info = archive / "Info.plist"; info.write_bytes(b"archive metadata")
        ipa = self.root / "App.ipa"; ipa.write_bytes(b"unacceptable signed capabilities")
        self.value.update(platform="ios", commit="a" * 40, archive_path=str(archive), archive_sha256=tree_sha256(archive),
                          apple_validated=True, artifacts={"archive_info": {"path": str(info), "sha256": sha256(info)},
                                                          "ipa": {"path": str(ipa), "sha256": sha256(ipa)}})
        self.write()
        with patch.object(release_ios, "AppStoreConnect") as apple, patch.object(release_ios, "unlock_signing"), \
                patch.object(release_ios, "inspect_archive"), patch.object(release_ios, "inspect_ipa", side_effect=ValueError("missing actual aps")) as guard, \
                patch.object(release_ios, "run") as transport:
            apple.return_value.builds.return_value = []
            with self.assertRaisesRegex(ValueError, "actual aps"):
                release_ios.upload(self.cfg, self.path)
            guard.assert_called_once_with(ipa, 7, "0.1.0", self.cfg)
            transport.assert_not_called()
        self.assertFalse((self.root / "testflight-upload-attempt.json").exists())
        self.assertFalse((self.root / "UploadWorking.xcarchive").exists())

    def test_ipa_identity_and_version_are_checked(self):
        ipa = self.root / "App.ipa"
        info = {"CFBundleIdentifier": APP_ID, "CFBundleVersion": "7", "CFBundleShortVersionString": "0.1.0",
                "RogichatEnvironment": "qa", "RogichatAPIBaseURL": API_URL, "UIDeviceFamily": [1],
                "CFBundleExecutable": "App"}
        with zipfile.ZipFile(ipa, "w") as archive:
            archive.writestr("Payload/App.app/Info.plist", plistlib.dumps(info))
            archive.writestr("Payload/App.app/App", b"real app code")
            archive.writestr("Payload/App.app/PrivacyInfo.xcprivacy", plistlib.dumps(EXPECTED_IOS_PRIVACY))
            archive.writestr("Payload/App.app/embedded.mobileprovision", b"test-only profile")
            for name, data in sdk_resources().items():
                archive.writestr("Payload/App.app/" + name, data)
        with patch.object(release_ios, "inspect_signed_callback") as callback, patch.object(release_ios, "capture") as signature:
            inspect_ipa(ipa, 7, "0.1.0", self.cfg)
            callback.assert_called_once()
            self.assertEqual(callback.call_args.args[1], b"test-only profile")
            self.assertEqual(callback.call_args.args[2], self.cfg)
            temporary = self.root / ".qa-temp"
            self.assertEqual(callback.call_args.kwargs["temporary_root"], temporary)
            self.assertEqual(Path(signature.call_args.kwargs["env"]["TMPDIR"]), temporary)
            self.assertEqual(temporary.stat().st_mode & 0o777, 0o700)
            self.assertEqual(temporary.stat().st_uid, os.getuid())
            self.assertEqual(list(temporary.iterdir()), [])
            self.assertEqual(signature.call_args.args[0][:4], ["codesign", "--verify", "--deep", "--strict"])
        with self.assertRaisesRegex(ValueError, "CFBundleVersion"):
            inspect_ipa(ipa, 8, "0.1.0", self.cfg)

    def test_reintroduced_demo_ipa_is_rejected_before_upload(self):
        ipa = self.root / "App.ipa"
        info = {"CFBundleIdentifier": APP_ID, "CFBundleVersion": "7", "CFBundleShortVersionString": "0.1.0",
                "RogichatEnvironment": "qa", "RogichatAPIBaseURL": API_URL, "UIDeviceFamily": [1],
                "CFBundleExecutable": "App"}
        with zipfile.ZipFile(ipa, "w") as archive:
            archive.writestr("Payload/App.app/Info.plist", plistlib.dumps(info))
            archive.writestr("Payload/App.app/App", b"WireframeHost")
            archive.writestr("Payload/App.app/PrivacyInfo.xcprivacy", plistlib.dumps(EXPECTED_IOS_PRIVACY))
        with self.assertRaisesRegex(ValueError, "retired demo content"):
            inspect_ipa(ipa, 7, "0.1.0", self.cfg)

    def test_qa_temp_rejects_symlink_and_permissive_directory(self):
        target = self.root / "outside"
        target.mkdir()
        temporary = self.root / ".qa-temp"
        temporary.symlink_to(target, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "private directory"):
            release_ios._temporary_root(self.root)
        temporary.unlink()
        temporary.mkdir(mode=0o755)
        temporary.chmod(0o755)  # A restrictive CI umask can otherwise create mode 700.
        with self.assertRaisesRegex(ValueError, "mode 700"):
            release_ios._temporary_root(self.root)

    def test_reintroduced_demo_apk_is_rejected_before_signing_checks(self):
        with zipfile.ZipFile(self.artifact, "w") as archive:
            archive.writestr("classes.dex", b"PreviewRole")
        with patch.object(release_android, "capture") as tool:
            with self.assertRaisesRegex(ValueError, "retired demo content"):
                release_android.verify_apk(self.artifact, 7, "0.1.0")
            tool.assert_not_called()

    def test_testflight_keeps_build_number_and_internal_scope(self):
        options = export_options("TESTTEAM00", "upload", self.cfg["ios"])
        self.assertFalse(options["manageAppVersionAndBuildNumber"])
        self.assertTrue(options["testFlightInternalTestingOnly"])
        for value in (0, -1, 2100000001, "01", "1.2"):
            with self.assertRaises(ValueError):
                version_number(value)


if __name__ == "__main__":
    unittest.main()
