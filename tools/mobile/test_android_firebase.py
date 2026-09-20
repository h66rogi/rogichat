"""Pure signed Firebase admission/resource mutations. No cloud, SDK or signing access."""
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import android_firebase as firebase
import prod_release
import release_android

INIT_XML = '''<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application>
<meta-data android:name="firebase_messaging_auto_init_enabled" android:value="false"/>
<meta-data android:name="firebase_analytics_collection_enabled" android:value="false"/>
</application></manifest>'''


class AndroidFirebaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = self.enterContext(tempfile.TemporaryDirectory())
        self.root = Path(self.tmp).resolve()
        self.path = self.root / "sdk.json"
        self.value = {"environment": "qa", "packageName": firebase.PACKAGES["qa"],
                      "applicationId": "1:123:android:abcdef", "apiKey": "unit_only_value_not_a_real_key",
                      "projectId": "unit-project", "gcmSenderId": "123"}
        self.cfg = {"firebase": {"app_id": self.value["applicationId"], "project_id": self.value["projectId"],
                                  "config_file": str(self.path)}}
        self.write()

    def write(self, value=None):
        self.path.write_text(json.dumps(value or self.value)); self.path.chmod(0o600)

    def load(self):
        return firebase.load(self.cfg, "qa", environ={})

    def test_exact_input_and_both_consistent_path_sources_are_accepted_without_cloud(self):
        result = self.load()
        self.assertEqual(result.path, self.path)
        self.assertEqual(result.values, self.value)
        self.assertNotIn(self.value["apiKey"], repr(result))
        firebase.load(self.cfg, "qa", environ={"ROGICHAT_QA_FIREBASE_CONFIG_FILE": str(self.path)})
        target = deepcopy(self.cfg); del target["firebase"]["config_file"]
        firebase.load(target, "qa", environ={"ROGICHAT_QA_FIREBASE_CONFIG_FILE": str(self.path)})
        value = dict(self.value, environment="prod", packageName=firebase.PACKAGES["prod"])
        self.write(value); firebase.load(self.cfg, "prod", environ={})

    def test_missing_partial_unknown_wrong_type_and_duplicate_json_are_rejected(self):
        mutations = [{key: item for key, item in self.value.items() if key != field} for field in self.value]
        mutations += [dict(self.value, extra="forbidden"), dict(self.value, gcmSenderId=123),
                      dict(self.value, apiKey=None), [self.value]]
        for value in mutations:
            with self.subTest(kind=type(value).__name__):
                self.path.write_text(json.dumps(value))
                with self.assertRaises(ValueError): self.load()
        self.path.write_text(json.dumps(self.value)[:-1] + ',"environment":"qa"}')
        with self.assertRaisesRegex(ValueError, "Duplicate"): self.load()

    def test_target_environment_and_all_identity_fields_are_exact(self):
        for changes in ({"environment": "prod"}, {"packageName": "chat.rogi.rogichat"},
                        {"applicationId": "1:999:android:abcdef"}, {"gcmSenderId": "124"},
                        {"applicationId": "1:123:ios:abcdef"}, {"applicationId": "1:123:android:ABCDEF"},
                        {"projectId": "other-project"}, {"projectId": "UPPER-project"},
                        {"projectId": "unit-project\n"}, {"apiKey": "x"}, {"apiKey": "x" * 257},
                        {"apiKey": "x" * 20 + "\n"}):
            self.write(dict(self.value, **changes))
            with self.subTest(fields=list(changes)), self.assertRaises(ValueError): self.load()
        self.write()
        for cfg in (dict(self.cfg, environment="prod"), dict(self.cfg, app_id="other.package")):
            with self.assertRaises(ValueError): firebase.load(cfg, "qa", environ={})

    def test_only_complete_sdk_path_absence_is_unavailable(self):
        for cfg in ({}, {"firebase": {}}, {"firebase": {"app_id": self.value["applicationId"]}},
                    {"firebase": {key: value for key, value in self.cfg["firebase"].items() if key != "config_file"}}):
            for environment in ("qa", "prod"):
                self.assertIsNone(firebase.load(cfg, environment, environ={}))
        for value in (None, "", 0):
            cfg = deepcopy(self.cfg); cfg["firebase"]["config_file"] = value
            with self.assertRaises(ValueError): firebase.load(cfg, "qa", environ={})
            with self.assertRaises(ValueError): firebase.load({}, "qa", environ={"ROGICHAT_QA_FIREBASE_CONFIG_FILE": value})
        for target in ({}, {"app_id": self.value["applicationId"]}, {"project_id": self.value["projectId"]}):
            with self.assertRaisesRegex(ValueError, "approved Firebase"):
                firebase.load({"firebase": target}, "qa", environ={"ROGICHAT_QA_FIREBASE_CONFIG_FILE": str(self.path)})

    def test_gradle_utf8_unescaped_flat_format_and_single_link_match_preflight(self):
        linked = self.root / "hardlink.json"; os.link(self.path, linked)
        with self.assertRaises(ValueError): self.load()
        linked.unlink()
        original = json.dumps(self.value)
        for encoding in ("utf-16", "utf-32"):
            self.path.write_bytes(original.encode(encoding))
            with self.subTest(encoding=encoding), self.assertRaises(ValueError): self.load()
        for text in (original.replace("environment", r"environm\u0065nt"),
                     original.replace('"qa"', r'"\u0071a"'),
                     original.replace("unit-project", r"unit\u002dproject")):
            self.path.write_text(text)
            with self.assertRaisesRegex(ValueError, "unescaped"): self.load()

    def test_private_file_bounds_permissions_canonical_path_and_ambiguity(self):
        for mode in (0o644, 0o400, 0o700, 0o1600):
            self.path.chmod(mode)
            with self.subTest(mode=mode), self.assertRaises(ValueError): self.load()
        self.path.chmod(0o600)
        for raw in (b"", b"x" * 16385, b"\xff", b"not-json"):
            self.path.write_bytes(raw)
            with self.assertRaises(ValueError): self.load()
        self.write(); other = self.root / "other.json"; other.write_text(self.path.read_text()); other.chmod(0o600)
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            firebase.load(self.cfg, "qa", environ={"ROGICHAT_QA_FIREBASE_CONFIG_FILE": str(other)})
        for path in ("", "sdk.json", str(self.root / "none.json"), str(self.root), str(self.root) + "/./sdk.json"):
            cfg = deepcopy(self.cfg); cfg["firebase"]["config_file"] = path
            with self.subTest(path_kind=bool(path)), self.assertRaises(ValueError): firebase.load(cfg, "qa", environ={})
        linked = self.root / "link.json"; linked.symlink_to(self.path)
        cfg = deepcopy(self.cfg); cfg["firebase"]["config_file"] = str(linked)
        with self.assertRaises(ValueError): firebase.load(cfg, "qa", environ={})
        self.path.unlink(); os.mkfifo(self.path, 0o600)
        with self.assertRaises(ValueError): self.load()

    def test_invalid_signed_build_stops_before_source_signing_output_or_command(self):
        invalid = {"firebase": {"config_file": ""}}
        for module, operation in ((release_android, lambda: release_android.build(invalid, 1, "0.1.0")),
                                  (prod_release, lambda: prod_release.android_build(dict(invalid, environment="prod", app_id=firebase.PACKAGES["prod"]), 1, "0.1.0", "a" * 40))):
            with patch.object(module, "inspect_product_sources") as source, patch.object(module, "run") as run, \
                    patch.object(module, "external") as material, patch.object(module, "new_output" if module == release_android else "output") as output:
                with self.assertRaisesRegex(ValueError, "approved Firebase"): operation()
                source.assert_not_called(); run.assert_not_called(); material.assert_not_called(); output.assert_not_called()

    def test_qa_build_passes_only_verified_path_and_signing_environment(self):
        key = self.root / "upload.keystore"; key.write_bytes(b"unit-key"); key.chmod(0o600)
        password = self.root / "password"; password.write_text("unit-password"); password.chmod(0o600)
        cfg = dict(self.cfg, android={"keystore": str(key), "password_file": str(password), "key_alias": "unit"})
        class BeforeSDK(Exception): pass
        with patch.object(release_android, "inspect_product_sources"), patch.object(release_android, "new_output", return_value=self.root), \
                patch.object(release_android, "run", side_effect=BeforeSDK) as run, \
                patch.dict(os.environ, {"ROGICHAT_PROD_FIREBASE_CONFIG_FILE": "untrusted", "NODE_OPTIONS": "untrusted", "JAVA_TOOL_OPTIONS": "untrusted"}):
            with self.assertRaises(BeforeSDK): release_android.build(cfg, 1, "0.1.0")
        env = run.call_args.kwargs["env"]
        self.assertEqual(env["ROGICHAT_QA_FIREBASE_CONFIG_FILE"], str(self.path))
        for key in ("ROGICHAT_PROD_FIREBASE_CONFIG_FILE", "NODE_OPTIONS", "JAVA_TOOL_OPTIONS"): self.assertNotIn(key, env)
        self.assertNotIn(self.value["apiKey"], str(run.call_args))

    def test_prod_build_passes_selected_firebase_path_without_qa_fallback(self):
        self.write(dict(self.value, environment="prod", packageName=firebase.PACKAGES["prod"]))
        password = self.root / "password"; password.write_text("unit-password"); password.chmod(0o600)
        cfg = dict(self.cfg, environment="prod", app_id=firebase.PACKAGES["prod"],
                   android={"keystore": str(self.root / "unit.keystore"), "password_file": str(password), "key_alias": "unit"})
        class BeforeSDK(Exception): pass
        with patch.object(prod_release, "source"), patch.object(prod_release, "inspect_product_sources"), \
                patch.object(prod_release, "android_certificate"), patch.object(prod_release, "output", return_value=self.root), \
                patch.object(prod_release, "run", side_effect=BeforeSDK) as run, \
                patch.dict(os.environ, {"ROGICHAT_QA_FIREBASE_CONFIG_FILE": "untrusted"}):
            with self.assertRaises(BeforeSDK): prod_release.android_build(cfg, 1, "0.1.0", "a" * 40)
        env = run.call_args.kwargs["env"]
        self.assertEqual(env["ROGICHAT_PROD_FIREBASE_CONFIG_FILE"], str(self.path))
        self.assertNotIn("ROGICHAT_QA_FIREBASE_CONFIG_FILE", env)
        self.assertNotIn(self.value["apiKey"], str(run.call_args))

    def test_prod_cli_invalid_input_does_not_create_output_root_or_lock(self):
        cfg = {"environment": "prod", "app_id": firebase.PACKAGES["prod"], "artifact_root": str(self.root / "absent"),
               "firebase": {"config_file": ""}}
        with patch("sys.argv", ["prod_release.py", "android-build", "--source-sha", "a" * 40, "--build-number", "1", "--version", "0.1.0"]), \
                patch.object(prod_release, "prod_config", return_value=cfg), patch.object(prod_release, "android_build") as build:
            with self.assertRaisesRegex(ValueError, "approved Firebase"): prod_release.main()
            build.assert_not_called()
        self.assertFalse((self.root / "absent").exists())

    def test_absent_sdk_input_allows_both_signed_build_commands_without_firebase_env(self):
        key = self.root / "upload.keystore"; key.write_bytes(b"unit-key"); key.chmod(0o600)
        password = self.root / "password"; password.write_text("unit-password"); password.chmod(0o600)
        cfg = {"android": {"keystore": str(key), "password_file": str(password), "key_alias": "unit"}}
        class BeforeSDK(Exception): pass
        for environment, module in (("qa", release_android), ("prod", prod_release)):
            candidate = dict(cfg, environment=environment, app_id=firebase.PACKAGES[environment])
            with patch.object(module, "inspect_product_sources"), \
                    patch.object(module, "new_output" if environment == "qa" else "output", return_value=self.root), \
                    patch.object(module, "run", side_effect=BeforeSDK) as run, patch.dict(os.environ, {}, clear=True), \
                    patch.object(prod_release, "source"), patch.object(prod_release, "android_certificate"):
                with self.assertRaises(BeforeSDK):
                    if environment == "qa": module.build(candidate, 1, "0.1.0")
                    else: module.android_build(candidate, 1, "0.1.0", "a" * 40)
            self.assertFalse(any(name.endswith("FIREBASE_CONFIG_FILE") for name in run.call_args.kwargs["env"]))

    def apk_dump(self):
        lines = ["Package name=" + self.value["packageName"] + " id=7f"]
        for index, (name, field) in enumerate(firebase.RESOURCES.items()):
            lines += [f"    resource 0x7f01000{index} string/{name}", f'      () "{self.value[field]}"']
        return "\n".join(lines)

    def aab_dump(self, name):
        return "Package '" + self.value["packageName"] + "':\n0x7f010001 - string/" + name + '\n\t(default) - [STR] "' + self.value[firebase.RESOURCES[name]] + '"\n\n'

    def test_apk_resource_exact_owner_single_default_and_no_empty_or_alternate_value(self):
        settings = self.load(); original = self.apk_dump()
        firebase.verify_apk_dump(original, settings)
        for altered in (original.replace(self.value["packageName"], "wrong.package"),
                        original.replace('() "' + self.value["apiKey"] + '"', '() ""'),
                        original.replace('() "' + self.value["apiKey"] + '"', '(ko) "' + self.value["apiKey"] + '"'),
                        original + '\n      (ko) "alternate"', original + "\n" + original,
                        original.replace("string/rogi_firebase_sender_id", "string/other"),
                        original.replace(self.value["projectId"], "other-project")):
            with self.assertRaises(ValueError): firebase.verify_apk_dump(altered, settings)

    def test_aab_resource_exact_package_type_and_single_default(self):
        settings = self.load(); name = "rogi_firebase_api_key"; original = self.aab_dump(name)
        firebase.verify_aab_dump(original, settings, name)
        for altered in (original.replace(self.value["packageName"], "other.package"),
                        original.replace("[STR]", "[REF]"), original.replace("(default)", "locale: ko"),
                        original.replace(self.value["apiKey"], ""), original + original,
                        original.replace(name, "another_resource")):
            with self.assertRaises(ValueError): firebase.verify_aab_dump(altered, settings, name)

    def test_resource_inspection_captures_values_never_logs_or_passes_them_in_arguments(self):
        settings = self.load(); capture = Mock(side_effect=[self.aab_dump(name) for name in firebase.RESOURCES] + [INIT_XML])
        with patch("sys.stdout", new_callable=io.StringIO) as stdout:
            firebase.inspect_aab(Path("unit.aab"), settings, ["bundletool"], capture)
        self.assertEqual(capture.call_count, 5); self.assertEqual(stdout.getvalue(), "")
        self.assertNotIn(self.value["apiKey"], str(capture.call_args_list))
        with self.assertRaises(ValueError) as error:
            firebase.verify_apk_dump(self.apk_dump().replace(self.value["apiKey"], "sensitive-mismatch"), settings)
        self.assertNotIn("sensitive-mismatch", str(error.exception))

    def test_unavailable_requires_four_present_empty_resources_in_exact_environment(self):
        for environment in ("qa", "prod"):
            self.value.update(environment=environment, packageName=firebase.PACKAGES[environment])
            self.value.update({key: "" for key in firebase.RESOURCES.values()})
            firebase.verify_apk_dump(self.apk_dump(), None, environment=environment)
            for name in firebase.RESOURCES:
                firebase.verify_aab_dump(self.aab_dump(name), None, name, environment=environment)
            with self.assertRaises(ValueError): firebase.verify_apk_dump("", None, environment=environment)
            for field in firebase.RESOURCES.values():
                self.value[field] = "unexpected-config"
                with self.assertRaises(ValueError): firebase.verify_apk_dump(self.apk_dump(), None, environment=environment)
                name = next(key for key, value in firebase.RESOURCES.items() if value == field)
                with self.assertRaises(ValueError): firebase.verify_aab_dump(self.aab_dump(name), None, name, environment=environment)
                self.value[field] = ""
        with self.assertRaises(ValueError): firebase.verify_apk_dump(self.apk_dump(), None)
        self.assertEqual(firebase.state(None), "unavailable")

    def test_initialization_requires_provider_absence_and_application_owned_false_flags(self):
        firebase.verify_aab_initialization(INIT_XML)
        firebase.verify_apk_initialization(prod_release.xmltree(INIT_XML))
        metadata = '<meta-data android:name="firebase_messaging_auto_init_enabled" android:value="false"/>'
        provider = '<provider android:name="com.google.firebase.provider.FirebaseInitProvider"/>'
        for xml in (INIT_XML.replace('value="false"', 'value="true"', 1),
                    INIT_XML.replace(metadata, ""), INIT_XML.replace(metadata, metadata * 2),
                    INIT_XML.replace(metadata, "<activity>" + metadata + "</activity>"),
                    INIT_XML.replace("</application>", provider + "</application>"),
                    INIT_XML.replace("</application>", "</application><application/>")):
            with self.assertRaises(ValueError): firebase.verify_aab_initialization(xml)
            with self.assertRaises(ValueError): firebase.verify_apk_initialization(prod_release.xmltree(xml))

    def test_unavailable_inspection_checks_real_manifest_after_empty_resource_dump(self):
        self.value.update({key: "" for key in firebase.RESOURCES.values()})
        capture = Mock(side_effect=[self.apk_dump(), prod_release.xmltree(INIT_XML)])
        firebase.inspect_apk(Path("unit.apk"), None, "aapt2", capture, environment="qa")
        self.assertEqual(capture.call_count, 2)
        capture = Mock(side_effect=[self.aab_dump(name) for name in firebase.RESOURCES] + [INIT_XML])
        firebase.inspect_aab(Path("unit.aab"), None, ["bundletool"], capture, environment="qa")
        self.assertEqual(capture.call_count, 5)


if __name__ == "__main__": unittest.main()
