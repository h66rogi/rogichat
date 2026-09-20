"""Regression mutations must fail even when no fixture room text is present."""
from pathlib import Path
from copy import deepcopy
import plistlib
import tempfile
import unittest
import zipfile

from product_guards import (EXPECTED_IOS_PRIVACY, RETIRED_MARKERS, inspect_android_package,
                            inspect_ios_app, inspect_ios_package, inspect_ios_privacy,
                            inspect_product_data, inspect_product_sources)
from ios_dependencies import GRDB_LICENSE_PATH, GRDB_PRIVACY_PATH, GRDB_PRIVACY


def sdk_resources():
    return {GRDB_PRIVACY_PATH: plistlib.dumps(GRDB_PRIVACY),
            GRDB_LICENSE_PATH: (Path(__file__).resolve().parents[2] / "apps/ios/Resources" / GRDB_LICENSE_PATH).read_bytes()}


class ProductGuardsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.android_entry = self.write("apps/android/app/src/main/java/chat/rogi/rogichat/AppEntry.kt",
                                        "fun AppEntry() { ProductRoot() }")
        self.ios_entry = self.write("apps/ios/Sources/RogichatApp.swift", "struct RogichatApp { ProductRootView() }")

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def package(self, name, entries):
        path = self.root / name
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for key, value in entries.items():
                archive.writestr(key, value)
        return path

    def test_development_fixtures_outside_product_sources_are_allowed(self):
        self.write("apps/android/app/src/testQa/java/Fixture.kt", "WireframeFixtures sample-room-a")
        self.write("apps/android/app/src/androidTest/java/Fixture.kt", "PreviewRole")
        self.write("apps/ios/Tests/Fixtures/WireframeState.swift", "WireframeFixtures sample-room-a")
        self.write("apps/ios/Packages/Rooms/Tests/RoomsTests/Scenario.swift", "WireframeFixtures sample-room-a")
        inspect_product_sources(self.root)

    def test_all_retired_markers_fail_individually(self):
        for marker in RETIRED_MARKERS:
            for encoding in ("utf-8", "utf-16le", "utf-16be"):
                with self.subTest(marker=marker, encoding=encoding):
                    with self.assertRaisesRegex(ValueError, "retired demo content"):
                        inspect_product_data(marker.encode(encoding), "fixture")

    def test_platform_preview_and_real_message_preview_are_allowed(self):
        inspect_product_data(b"androidx.compose.ui.tooling.preview.Preview messagePreview #Preview", "framework")

    def test_alternate_android_entry_is_rejected_in_every_variant(self):
        for variant in ("qa", "prod", "debug", "release"):
            path = self.write(f"apps/android/app/src/{variant}/java/chat/rogi/rogichat/AppEntry.kt", "fun AppEntry() {}")
            with self.subTest(variant=variant), self.assertRaisesRegex(ValueError, "replace the shared product"):
                inspect_product_sources(self.root)
            path.unlink()

    def test_missing_common_entry_is_rejected(self):
        self.android_entry.unlink()
        with self.assertRaisesRegex(ValueError, "shared main"):
            inspect_product_sources(self.root)

    def test_demo_source_is_rejected_in_all_android_product_variants(self):
        for variant in ("main", "qa", "prod", "debug", "release"):
            path = self.write(f"apps/android/app/src/{variant}/java/Injected.kt", "enum class PreviewRole { FAN }")
            with self.subTest(variant=variant), self.assertRaisesRegex(ValueError, "retired demo content"):
                inspect_product_sources(self.root)
            path.unlink()

    def test_demo_ios_sources_and_resources_are_rejected(self):
        for relative in ("Sources/QA/Reintroduced.swift", "Resources/fixtures.json"):
            path = self.write("apps/ios/" + relative, "sample-room-b")
            with self.subTest(path=relative), self.assertRaisesRegex(ValueError, "retired demo content"):
                inspect_product_sources(self.root)
            path.unlink()

    def test_ios_qa_conditional_composition_is_rejected(self):
        for condition in ("#if ROGICHAT_QA", "#if !ROGICHAT_QA", "#elseif ROGICHAT_QA"):
            self.ios_entry.write_text(condition + "\nProductRootView()\n#endif")
            with self.subTest(condition=condition), self.assertRaisesRegex(ValueError, "same product composition"):
                inspect_product_sources(self.root)

    def test_local_swift_package_product_sources_and_resources_are_checked(self):
        for relative in ("Rooms.swift", "Resources/scenario.json"):
            path = self.write("apps/ios/Packages/Rooms/Sources/Rooms/" + relative, "sample-room-b")
            with self.subTest(path=relative), self.assertRaisesRegex(ValueError, "retired demo content"):
                inspect_product_sources(self.root)
            path.unlink()

    def test_apk_and_aab_check_every_dex_and_resource(self):
        for kind, primary in (("apk", "classes.dex"), ("aab", "base/dex/classes.dex")):
            clean = self.package("clean." + kind, {primary: b"real code"})
            inspect_android_package(clean)
            for injected in ("classes2.dex", "assets/scenario.json", "base/assets/scenario.json"):
                path = self.package("mutated." + kind, {primary: b"real code", injected: b"sample-room-a"})
                with self.subTest(kind=kind, path=injected), self.assertRaisesRegex(ValueError, "retired demo content"):
                    inspect_android_package(path)

    def test_empty_android_package_fails_closed(self):
        path = self.package("empty.apk", {"AndroidManifest.xml": b"manifest"})
        with self.assertRaisesRegex(ValueError, "no executable code"):
            inspect_android_package(path)

    def test_ios_archive_checks_debug_dylib_and_resources(self):
        app = self.root / "Rogichat.app"
        self.write("Rogichat.app/Rogichat", "real code")
        self.write("Rogichat.app/PrivacyInfo.xcprivacy", plistlib.dumps(EXPECTED_IOS_PRIVACY).decode())
        for name, data in sdk_resources().items():
            self.write("Rogichat.app/" + name, data.decode())
        inspect_ios_app(app, "Rogichat")
        for name in ("Rogichat.debug.dylib", "Fixtures.json", "Frameworks/Feature.framework/Feature"):
            path = self.write("Rogichat.app/" + name, "PreviewRole")
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "retired demo content"):
                inspect_ios_app(app, "Rogichat")
            path.unlink()

    def test_ios_ipa_checks_code_and_resources(self):
        prefix = "Payload/Rogichat.app/"
        for name in ("Rogichat", "Rogichat.debug.dylib", "Fixtures.json"):
            path = self.package("mutated.ipa", {prefix + "Rogichat": b"real code", prefix + name: b"WireframeHost",
                                               prefix + "PrivacyInfo.xcprivacy": plistlib.dumps(EXPECTED_IOS_PRIVACY)})
            with zipfile.ZipFile(path) as package, self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, "retired demo content"):
                    inspect_ios_package(package, prefix, "Rogichat")

    def test_missing_privacy_manifest_blocks_built_app_and_ipa(self):
        self.write("Rogichat.app/Rogichat", "real code")
        with self.assertRaisesRegex(ValueError, "missing PrivacyInfo"):
            inspect_ios_app(self.root / "Rogichat.app", "Rogichat")
        path = self.package("missing.ipa", {"Payload/Rogichat.app/Rogichat": b"real code"})
        with zipfile.ZipFile(path) as package, self.assertRaisesRegex(ValueError, "exactly one app PrivacyInfo"):
            inspect_ios_package(package, "Payload/Rogichat.app/", "Rogichat")

    def test_current_privacy_declaration_accepts_xml_and_binary_plists(self):
        for format in (plistlib.FMT_XML, plistlib.FMT_BINARY):
            inspect_ios_privacy(plistlib.dumps(EXPECTED_IOS_PRIVACY, fmt=format), "fixture")

    def test_pre_conversation_declaration_cannot_ship_in_app_or_ipa(self):
        declaration = deepcopy(EXPECTED_IOS_PRIVACY)
        declaration["NSPrivacyCollectedDataTypes"] = [
            item for item in declaration["NSPrivacyCollectedDataTypes"]
            if item["NSPrivacyCollectedDataType"] != "NSPrivacyCollectedDataTypeEmailsOrTextMessages"
        ]
        entries = {"Rogichat": b"real code", "PrivacyInfo.xcprivacy": plistlib.dumps(declaration), **sdk_resources()}
        for name, data in entries.items():
            self.write("Rogichat.app/" + name, data.decode())
        with self.assertRaisesRegex(ValueError, "privacy manifest"):
            inspect_ios_app(self.root / "Rogichat.app", "Rogichat")
        prefix = "Payload/Rogichat.app/"
        archive = self.package("old-privacy.ipa", {prefix + name: data for name, data in entries.items()})
        with zipfile.ZipFile(archive) as package, self.assertRaisesRegex(ValueError, "privacy manifest"):
            inspect_ios_package(package, prefix, "Rogichat")

    def test_wrong_reason_category_collection_and_tracking_fail_closed(self):
        mutations = []
        for key, value in (("NSPrivacyTracking", True), ("NSPrivacyTracking", 0),
                           ("NSPrivacyTrackingDomains", ["tracking.example.invalid"]),
                           ("NSPrivacyCollectedDataTypes", []),
                           ("NSPrivacyCollectedDataTypes", [{"NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeEmailAddress"}]),
                           ("NSPrivacyAccessedAPITypes", [])):
            declaration = deepcopy(EXPECTED_IOS_PRIVACY)
            declaration[key] = value
            mutations.append(declaration)
        for key, value in (("NSPrivacyAccessedAPIType", "NSPrivacyAccessedAPICategoryFileTimestamp"),
                           ("NSPrivacyAccessedAPITypeReasons", ["1C8F.1"])):
            declaration = deepcopy(EXPECTED_IOS_PRIVACY)
            declaration["NSPrivacyAccessedAPITypes"][0][key] = value
            mutations.append(declaration)
        for index in range(len(EXPECTED_IOS_PRIVACY["NSPrivacyCollectedDataTypes"])):
            for key, value in (("NSPrivacyCollectedDataTypeLinked", False),
                               ("NSPrivacyCollectedDataTypeLinked", 1),
                               ("NSPrivacyCollectedDataTypeTracking", True),
                               ("NSPrivacyCollectedDataTypeTracking", 0),
                               ("NSPrivacyCollectedDataTypePurposes", ["NSPrivacyCollectedDataTypePurposeAnalytics"])):
                declaration = deepcopy(EXPECTED_IOS_PRIVACY)
                declaration["NSPrivacyCollectedDataTypes"][index][key] = value
                mutations.append(declaration)
        for key in EXPECTED_IOS_PRIVACY:
            declaration = deepcopy(EXPECTED_IOS_PRIVACY)
            declaration.pop(key)
            mutations.append(declaration)
        for declaration in mutations:
            with self.subTest(declaration=declaration), self.assertRaisesRegex(ValueError, "privacy manifest"):
                inspect_ios_privacy(plistlib.dumps(declaration), "fixture")

    def test_wrong_packaged_privacy_manifest_blocks_app_and_ipa(self):
        self.write("Rogichat.app/Rogichat", "real code")
        self.write("Rogichat.app/PrivacyInfo.xcprivacy", plistlib.dumps({}).decode())
        with self.assertRaisesRegex(ValueError, "privacy manifest"):
            inspect_ios_app(self.root / "Rogichat.app", "Rogichat")
        path = self.package("wrong.ipa", {"Payload/Rogichat.app/Rogichat": b"real code",
                                          "Payload/Rogichat.app/PrivacyInfo.xcprivacy": plistlib.dumps({})})
        with zipfile.ZipFile(path) as package, self.assertRaisesRegex(ValueError, "privacy manifest"):
            inspect_ios_package(package, "Payload/Rogichat.app/", "Rogichat")

    def test_malformed_privacy_manifest_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "invalid iOS privacy manifest"):
            inspect_ios_privacy(b"not a property list", "fixture")

    def test_ios_ipa_requires_executable_not_just_plist(self):
        path = self.package("empty.ipa", {"Payload/Rogichat.app/Info.plist": b"plist"})
        with zipfile.ZipFile(path) as package, self.assertRaisesRegex(ValueError, "no executable code"):
            inspect_ios_package(package, "Payload/Rogichat.app/", "Rogichat")

    def test_packaged_sdk_resources_cannot_be_removed_or_changed(self):
        entries = {"Rogichat": b"real code", "PrivacyInfo.xcprivacy": plistlib.dumps(EXPECTED_IOS_PRIVACY), **sdk_resources()}
        prefix = "Payload/Rogichat.app/"
        clean = self.package("sdk-clean.ipa", {prefix + key: value for key, value in entries.items()})
        with zipfile.ZipFile(clean) as package:
            inspect_ios_package(package, prefix, "Rogichat")
        for target in (GRDB_PRIVACY_PATH, GRDB_LICENSE_PATH):
            for replacement in (None, b"changed resource"):
                mutated = dict(entries)
                if replacement is None:
                    mutated.pop(target)
                else:
                    mutated[target] = replacement
                archive = self.package("sdk-mutated.ipa", {prefix + key: value for key, value in mutated.items()})
                with self.subTest(target=target, removed=replacement is None), zipfile.ZipFile(archive) as package:
                    with self.assertRaisesRegex(ValueError, "GRDB"):
                        inspect_ios_package(package, prefix, "Rogichat")


if __name__ == "__main__":
    unittest.main()
