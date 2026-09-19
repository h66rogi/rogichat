"""Release safety checks without account credentials or network requests."""
import json
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from release_common import APP_ID, API_URL, ROOT, external, manifest, private_write, sha256, tree_sha256, version_number
from release_ios import export_options, inspect_ipa
import release_android


class ReleaseGuards(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.artifact = self.root / "test.apk"
        self.artifact.write_bytes(b"fixture")
        self.path = self.root / "release.json"
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

    def test_firebase_target_is_checked_before_upload(self):
        self.write()
        cfg = {"firebase": {"project_id": "fixture", "app_id": "fixture"}}
        with patch.object(release_android, "firebase_json", return_value=[{"appId": "fixture", "packageName": "wrong.app"}]) as cli:
            with self.assertRaisesRegex(ValueError, "Firebase target"):
                release_android.upload(cfg, self.path, self.root / "notes.txt")
            self.assertEqual(cli.call_count, 1)
            self.assertEqual(cli.call_args.args[0][0], "apps:list")

    def test_ipa_identity_and_version_are_checked(self):
        ipa = self.root / "App.ipa"
        info = {"CFBundleIdentifier": APP_ID, "CFBundleVersion": "7", "CFBundleShortVersionString": "0.1.0",
                "RogichatEnvironment": "qa", "RogichatAPIBaseURL": API_URL, "UIDeviceFamily": [1]}
        with zipfile.ZipFile(ipa, "w") as archive:
            archive.writestr("Payload/App.app/Info.plist", plistlib.dumps(info))
        inspect_ipa(ipa, 7, "0.1.0")
        with self.assertRaisesRegex(ValueError, "CFBundleVersion"):
            inspect_ipa(ipa, 8, "0.1.0")

    def test_testflight_keeps_build_number_and_internal_scope(self):
        options = export_options("fixture", "upload")
        self.assertFalse(options["manageAppVersionAndBuildNumber"])
        self.assertTrue(options["testFlightInternalTestingOnly"])
        for value in (0, -1, 2100000001, "01", "1.2"):
            with self.assertRaises(ValueError):
                version_number(value)


if __name__ == "__main__":
    unittest.main()
