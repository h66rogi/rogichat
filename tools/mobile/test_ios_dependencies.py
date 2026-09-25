"""Dependency mutations and real command construction, without SDK or Apple access."""
from copy import deepcopy
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

import build_ios
import release_ios
from ios_dependencies import (EXPECTED_PIN, EXPECTED_PINS_BY_PATH, RESOLVED_PATHS,
                              XCODE_RESOLVED_FLAGS, inspect_ios_dependencies)


class StopBeforeSDK(Exception):
    pass


class IOSDependenciesTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.values = {path: {"originHash": "a" * 64, "pins": deepcopy(pins), "version": 3}
                       for path, pins in EXPECTED_PINS_BY_PATH.items()}
        self.value = self.values[RESOLVED_PATHS[0]]
        for path in RESOLVED_PATHS:
            self.write(path, self.values[path])

    def write(self, relative, value):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))
        return path

    def test_each_resolver_accepts_its_exact_reviewed_pin_set(self):
        inspect_ios_dependencies(self.root)
        # Different supported lock schemas/origin hashes do not change the pin.
        self.write(RESOLVED_PATHS[0], {"pins": [EXPECTED_PIN], "version": 2})
        inspect_ios_dependencies(self.root)

    def test_each_missing_lock_blocks_even_when_the_other_is_valid(self):
        for relative in RESOLVED_PATHS:
            with self.subTest(path=relative):
                (self.root / relative).unlink()
                with self.assertRaises(ValueError):
                    inspect_ios_dependencies(self.root)
                self.write(relative, self.values[relative])

    def test_each_resolver_rejects_changed_source_version_revision_or_branch(self):
        for relative in RESOLVED_PATHS:
            original = self.values[relative]
            for index, original_pin in enumerate(original["pins"]):
                mutations = []
                for key, value in (("identity", "another"), ("kind", "localSourceControl"),
                                   ("location", "https://example.invalid/dependency.git"),
                                   ("location", original_pin["location"] + "/")):
                    pin = deepcopy(original_pin); pin[key] = value; mutations.append(pin)
                for key, value in (("version", "999.0.0"), ("revision", "0" * 40), ("branch", "main")):
                    pin = deepcopy(original_pin); pin["state"][key] = value; mutations.append(pin)
                for pin in mutations:
                    with self.subTest(path=relative, index=index, pin=pin):
                        changed = deepcopy(original)
                        changed["pins"][index] = pin
                        self.write(relative, changed)
                        with self.assertRaises(ValueError):
                            inspect_ios_dependencies(self.root)
            self.write(relative, original)

    def test_missing_duplicate_or_extra_dependencies_are_rejected(self):
        for relative in RESOLVED_PATHS:
            original = self.values[relative]
            pins = original["pins"]
            mutations = [[], {}, None, pins + [pins[0]], pins + [{"identity": "extra"}]]
            mutations.extend(pins[:index] + pins[index + 1:] for index in range(len(pins)))
            for changed in mutations:
                with self.subTest(path=relative, pins=changed):
                    self.write(relative, {**original, "pins": changed})
                    with self.assertRaises(ValueError):
                        inspect_ios_dependencies(self.root)
            self.write(relative, original)

    def test_app_and_host_lock_sets_cannot_be_swapped(self):
        for relative, other in (RESOLVED_PATHS, RESOLVED_PATHS[::-1]):
            with self.subTest(path=relative):
                self.write(relative, self.values[other])
                with self.assertRaises(ValueError):
                    inspect_ios_dependencies(self.root)
                self.write(relative, self.values[relative])

    def test_lock_schema_and_origin_types_fail_closed(self):
        mutations = [[], {}, {**self.value, "version": True}, {**self.value, "version": 1},
                     {**self.value, "version": 4}, {**self.value, "originHash": 1},
                     {**self.value, "originHash": ""}, {**self.value, "unknown": True}]
        for key in self.value:
            value = deepcopy(self.value); del value[key]; mutations.append(value)
        for value in mutations:
            with self.subTest(value=value):
                self.write(RESOLVED_PATHS[0], value)
                with self.assertRaises(ValueError):
                    inspect_ios_dependencies(self.root)

    def test_duplicate_json_keys_and_invalid_content_are_rejected(self):
        valid = json.dumps(self.value)
        duplicate_top = valid[:-1] + ', "pins": []}'
        duplicate_nested = valid.replace('"version": "7.11.1"', '"version": "other", "version": "7.11.1"')
        for content in (b"not JSON", b"\xff", b" " * 65537, duplicate_top.encode(), duplicate_nested.encode()):
            with self.subTest(content=content[:80]):
                (self.root / RESOLVED_PATHS[0]).write_bytes(content)
                with self.assertRaises(ValueError):
                    inspect_ios_dependencies(self.root)

    def test_unsigned_build_blocks_bad_lock_before_invoking_sdk(self):
        (self.root / RESOLVED_PATHS[1]).unlink()
        with patch.object(build_ios, "ROOT", self.root), patch.object(build_ios, "inspect_product_sources"), \
                patch.object(build_ios.subprocess, "run") as run, patch.object(build_ios.subprocess, "check_output") as output:
            with self.assertRaises(ValueError):
                build_ios.main()
            run.assert_not_called(); output.assert_not_called()

    def test_archive_blocks_bad_lock_before_signing_or_apple_access(self):
        (self.root / RESOLVED_PATHS[0]).unlink()
        with patch.object(release_ios, "ROOT", self.root), patch.object(release_ios, "inspect_product_sources"), \
                patch.object(release_ios, "unlock_signing") as unlock, patch.object(release_ios, "AppStoreConnect") as apple, \
                patch.object(release_ios, "new_output") as directory, patch.object(release_ios, "run") as run:
            with self.assertRaises(ValueError):
                release_ios.archive({}, 1, "0.1.0")
            unlock.assert_not_called(); apple.assert_not_called(); directory.assert_not_called(); run.assert_not_called()

    def test_unsigned_build_command_disallows_automatic_resolution(self):
        scheme = self.root / "apps/ios/Rogichat.xcodeproj/xcshareddata/xcschemes/Rogichat-QA.xcscheme"
        scheme.parent.mkdir(parents=True)
        scheme.write_text('<Scheme>' + ''.join(f'<{name} buildConfiguration="{mode}-QA"/>' for name, mode in (
            ("LaunchAction", "Debug"), ("TestAction", "Debug"), ("AnalyzeAction", "Debug"),
            ("ProfileAction", "Release"), ("ArchiveAction", "Release"))) + '</Scheme>')
        commands = []

        def run(command, **kwargs):
            if command[-1] == "build":
                commands.append(command)
                raise StopBeforeSDK()

        with patch.object(build_ios, "ROOT", self.root), patch.object(build_ios, "inspect_product_sources"), \
                patch.object(build_ios.subprocess, "check_output", return_value="Xcode 26.6\nBuild version 17F113\n"), \
                patch.object(build_ios.subprocess, "run", side_effect=run), patch("sys.argv", ["build_ios.py"]):
            with self.assertRaises(StopBeforeSDK):
                build_ios.main()
        self.assertEqual(len(commands), 1)
        for flag in XCODE_RESOLVED_FLAGS:
            self.assertIn(flag, commands[0])
        self.assertIn("CODE_SIGNING_ALLOWED=NO", commands[0])

    def test_signed_archive_command_keeps_existing_signing_and_resolution_guards(self):
        from ios_associations import QA_PROFILE
        cfg = {"ios": {"team_id": "TESTTEAM00", "provisioning_profile": QA_PROFILE, "signing_certificate": "A" * 40}}
        with patch.object(release_ios, "ROOT", self.root), patch.object(release_ios, "inspect_product_sources"), \
                patch.object(release_ios, "unlock_signing"), patch.object(release_ios, "AppStoreConnect") as apple, \
                patch.object(release_ios, "new_output", return_value=self.root / "output"), \
                patch.object(release_ios, "run", side_effect=StopBeforeSDK()) as run:
            apple.return_value.signing_args.return_value = ["-allowProvisioningUpdates"]
            (self.root / "output").mkdir()
            with self.assertRaises(StopBeforeSDK):
                release_ios.archive(cfg, 12, "0.1.0")
            apple.return_value.bundle.assert_called_once_with()
        command = run.call_args.args[0]
        for flag in XCODE_RESOLVED_FLAGS:
            self.assertIn(flag, command)
        self.assertIn("Rogichat-QA", command)
        self.assertIn("Release-QA", command)
        self.assertIn("DEVELOPMENT_TEAM=TESTTEAM00", command)
        self.assertIn("CODE_SIGN_STYLE=Manual", command)
        self.assertIn("CODE_SIGN_IDENTITY=" + "A" * 40, command)
        self.assertIn("ROGICHAT_PROVISIONING_PROFILE=" + QA_PROFILE, command)
        self.assertFalse(any(arg.startswith(("PROVISIONING_PROFILE=", "PROVISIONING_PROFILE_SPECIFIER=")) for arg in command))
        self.assertNotIn("CODE_SIGNING_ALLOWED=NO", command)
        self.assertNotIn("-allowProvisioningUpdates", command)
        self.assertEqual(command[-1], "archive")
        self.assertEqual(Path(run.call_args.kwargs["env"]["TMPDIR"]), (self.root / "output/.qa-temp").resolve())

    def test_generated_profile_mapping_is_owned_only_by_application_configurations(self):
        root = Path(__file__).resolve().parents[2]
        project = (root / "apps/ios/Rogichat.xcodeproj/project.pbxproj").read_text()
        # Follow the generated target's configuration-list IDs, rather than
        # accepting four profile assignments anywhere in the project.
        target = re.search(r"(?ms)^\t\t[0-9A-F]{24} /\* Rogichat \*/ = \{\n\t\t\tisa = PBXNativeTarget;.*?^\t\t\};", project).group()
        self.assertIn('productType = "com.apple.product-type.application";', target)
        config_list = re.search(r"buildConfigurationList = ([0-9A-F]{24})", target)[1]
        listing = re.search(r"(?ms)^\t\t" + config_list + r" /\*.*?^\t\t\};", project).group()
        config_ids = set(re.findall(r"^\t\t\t\t([0-9A-F]{24}) /\*", listing, re.M))
        self.assertEqual(len(config_ids), 4)
        assigned_ids = set()
        for match in re.finditer(r"(?ms)^\t\t([0-9A-F]{24}) /\*[^\n]*\*/ = \{\n\t\t\tisa = XCBuildConfiguration;.*?^\t\t\};", project):
            if "PROVISIONING_PROFILE_SPECIFIER" in match[0]:
                self.assertIn('PROVISIONING_PROFILE_SPECIFIER = "$(ROGICHAT_PROVISIONING_PROFILE)";', match[0])
                assigned_ids.add(match[1])
        self.assertEqual(assigned_ids, config_ids)
        self.assertEqual(project.count("PROVISIONING_PROFILE_SPECIFIER"), 4)


if __name__ == "__main__":
    unittest.main()
