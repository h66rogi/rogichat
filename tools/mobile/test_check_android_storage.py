"""Owned emulator orchestration checks; no emulator, SDK process or device is used."""
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
import xml.etree.ElementTree as ET

import check_android_storage as storage


class AndroidStorageChecks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.sdk = self.root / "sdk"; self.sdk.mkdir()
        self.owned = self.root / "owned"; self.owned.mkdir()
        self.image = self.sdk / "system-images/android-36/google_apis/x86_64/package.xml"
        self.image.parent.mkdir(parents=True)
        self.image_xml = f'''<repository><localPackage path="{storage.IMAGE}"><type-details>
            <api-level>36</api-level><extension-level>17</extension-level><base-extension>true</base-extension>
            <tag><id>google_apis</id></tag><vendor><id>google</id></vendor><abi>x86_64</abi></type-details>
            <revision><major>7</major></revision></localPackage></repository>'''
        self.image.write_text(self.image_xml)
        self.env = {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted", "RUNNER_OS": "Linux",
                    "RUNNER_TEMP": str(self.owned), "ANDROID_HOME": str(self.sdk)}
        self.results = self.root / "results"; self.results.mkdir()

    def report(self):
        suite = ET.Element("testsuite", tests="3", failures="0", errors="0", skipped="0")
        for name in sorted(storage.REQUIRED_CLASSES):
            ET.SubElement(suite, "testcase", classname=name, name="storageRegression")
        return suite

    def save_report(self, suite):
        ET.ElementTree(suite).write(self.results / "TEST-storage.xml")

    def test_hosted_gate_rejects_local_self_hosted_and_relative_paths(self):
        with patch.object(storage.sys, "platform", "linux"):
            self.assertEqual(storage.hosted_paths(self.env), (self.owned, self.sdk))
            for key, value in (("GITHUB_ACTIONS", "false"), ("RUNNER_ENVIRONMENT", "self-hosted"),
                               ("RUNNER_OS", "macOS"), ("RUNNER_TEMP", "."), ("ANDROID_HOME", "")):
                with self.subTest(key=key), self.assertRaises(ValueError):
                    storage.hosted_paths({**self.env, key: value})
        with patch.object(storage.sys, "platform", "darwin"), self.assertRaises(ValueError):
            storage.hosted_paths(self.env)

    def test_image_revision_api_tag_and_abi_drift_fail_closed(self):
        storage.inspect_image(self.sdk)
        for original, changed in (("<major>7", "<major>8"), ("<api-level>36", "<api-level>35"),
                                  ("<extension-level>17", "<extension-level>18"), ("<base-extension>true", "<base-extension>false"),
                                  ("<id>google_apis", "<id>google_apis_playstore"), ("<abi>x86_64", "<abi>arm64-v8a"),
                                  ('path="system-images;', 'path="different;'), ("</revision>", "<preview>1</preview></revision>")):
            self.image.write_text(self.image_xml.replace(original, changed))
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                storage.inspect_image(self.sdk)
        self.image.unlink()
        with self.assertRaises(ValueError):
            storage.inspect_image(self.sdk)

    def test_image_duplicate_or_malformed_metadata_is_rejected(self):
        for value in ("not XML", "<repository/>", self.image_xml.replace("</repository>", self.image_xml + "</repository>")):
            self.image.write_text(value)
            with self.subTest(value=value[:40]), self.assertRaises(ValueError):
                storage.inspect_image(self.sdk)

    def test_all_required_real_storage_suites_must_pass_without_skips(self):
        self.save_report(self.report())
        self.assertEqual(storage.inspect_results(self.results), 3)

    def test_failures_skips_missing_suites_and_stale_duplicate_reports_are_rejected(self):
        with self.assertRaises(ValueError):
            storage.inspect_results(self.results)
        for attribute in ("failures", "errors", "skipped", "disabled"):
            suite = self.report(); suite.set(attribute, "1"); self.save_report(suite)
            with self.subTest(attribute=attribute), self.assertRaises(ValueError):
                storage.inspect_results(self.results)
        for child in ("failure", "error", "skipped"):
            suite = self.report(); ET.SubElement(suite[0], child); self.save_report(suite)
            with self.subTest(child=child), self.assertRaises(ValueError):
                storage.inspect_results(self.results)
        suite = self.report(); suite.remove(suite[-1]); suite.set("tests", "2"); self.save_report(suite)
        with self.assertRaisesRegex(ValueError, "every"):
            storage.inspect_results(self.results)
        self.save_report(self.report())
        (self.results / "TEST-duplicate.xml").write_bytes((self.results / "TEST-storage.xml").read_bytes())
        with self.assertRaises(ValueError):
            storage.inspect_results(self.results)

    def test_incomplete_malformed_or_empty_test_results_are_rejected(self):
        for count in ("0", "4", "-1", "bad"):
            suite = self.report(); suite.set("tests", count); self.save_report(suite)
            with self.subTest(count=count), self.assertRaises(ValueError):
                storage.inspect_results(self.results)
        for value in (b"not XML", b"<testsuites/>", b'<testsuite tests="0"/>'):
            (self.results / "TEST-storage.xml").write_bytes(value)
            with self.assertRaises(ValueError):
                storage.inspect_results(self.results)

    def test_device_inventory_requires_exact_unambiguous_adb_output(self):
        self.assertEqual(storage.devices("List of devices attached\n"), {})
        self.assertEqual(storage.devices("List of devices attached\nemulator-5554\tdevice\n"), {"emulator-5554": "device"})
        for value in ("", "error: no server", "List of devices attached\nphone\n", "List of devices attached\nx device\nx offline"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                storage.devices(value)

    def setup_orchestration(self, outputs, processes):
        self.enterContext(patch.object(storage, "ROOT", self.root / "repo"))
        self.enterContext(patch.object(storage.os, "access", return_value=True))
        self.enterContext(patch.object(storage, "emulator_port", return_value=5554))
        self.enterContext(patch.object(storage, "free_port", return_value=15555))
        self.enterContext(patch.object(storage.subprocess, "check_output", side_effect=outputs))
        self.run = self.enterContext(patch.object(storage.subprocess, "run"))
        self.popen = self.enterContext(patch.object(storage.subprocess, "Popen", side_effect=processes))
        self.kill = self.enterContext(patch.object(storage.os, "killpg"))

    def test_unexpected_existing_device_is_never_targeted(self):
        self.setup_orchestration(["List of devices attached\nexisting-phone\tdevice\n"], [])
        with self.assertRaisesRegex(ValueError, "pre-existing"):
            storage.run_instrumentation(self.sdk, self.owned)
        self.popen.assert_not_called(); self.kill.assert_not_called()
        self.assertEqual(self.run.call_args.args[0][-1], "kill-server")
        self.assertIn("15555", self.run.call_args.args[0])

    def test_boot_timeout_terminates_only_owned_emulator_and_private_adb(self):
        emulator = Mock(pid=42001); emulator.poll.return_value = None
        self.setup_orchestration(["List of devices attached\n", "List of devices attached\n"], [emulator])
        with patch.object(storage.time, "monotonic", side_effect=[0, storage.BOOT_TIMEOUT + 1]):
            with self.assertRaises(TimeoutError):
                storage.run_instrumentation(self.sdk, self.owned)
        self.kill.assert_called_once_with(emulator.pid, signal.SIGTERM)
        self.assertEqual(self.run.call_args.args[0][-1], "kill-server")

    def test_gradle_timeout_cleans_both_owned_processes_and_cannot_use_other_devices(self):
        emulator = Mock(pid=42001); emulator.poll.return_value = None
        gradle = Mock(pid=42002); gradle.wait.side_effect = [subprocess.TimeoutExpired("gradle", storage.TEST_TIMEOUT), 0]
        inventory = "List of devices attached\nemulator-5554\tdevice\n"
        self.setup_orchestration(["List of devices attached\n", inventory, "1", "36", inventory], [emulator, gradle])
        with self.assertRaises(subprocess.TimeoutExpired):
            storage.run_instrumentation(self.sdk, self.owned)
        self.assertEqual({call.args[0] for call in self.kill.call_args_list}, {42001, 42002})
        command, options = self.popen.call_args.args[0], self.popen.call_args.kwargs
        self.assertIn(":app:connectedQaDebugAndroidTest", command)
        self.assertIn("-DANDROID_ADB_SERVER_PORT=15555", command)
        self.assertEqual(options["env"]["ANDROID_SERIAL"], "emulator-5554")
        self.assertEqual(options["env"]["ADB_SERVER_SOCKET"], "tcp:127.0.0.1:15555")
        self.assertTrue(options["start_new_session"])

    def test_cleanup_still_stops_emulator_if_gradle_cleanup_fails(self):
        emulator = Mock(pid=42001); emulator.poll.return_value = None
        gradle = Mock(pid=42002); gradle.wait.side_effect = [subprocess.TimeoutExpired("gradle", 900), RuntimeError("cleanup failed")]
        inventory = "List of devices attached\nemulator-5554\tdevice\n"
        self.setup_orchestration(["List of devices attached\n", inventory, "1", "36", inventory], [emulator, gradle])
        with self.assertRaisesRegex(RuntimeError, "cleanup failed"):
            storage.run_instrumentation(self.sdk, self.owned)
        self.assertIn(emulator.pid, {call.args[0] for call in self.kill.call_args_list})
        self.assertEqual(self.run.call_args.args[0][-1], "kill-server")

    def test_success_requires_fresh_results_and_still_cleans_owned_processes(self):
        emulator = Mock(pid=42001); emulator.poll.return_value = None
        gradle = Mock(pid=42002)
        inventory = "List of devices attached\nemulator-5554\tdevice\n"
        self.setup_orchestration(["List of devices attached\n", inventory, "1", "36", inventory], [emulator, gradle])
        results = storage.ROOT / "apps/android/app/build/outputs/androidTest-results/connected"
        results.mkdir(parents=True)
        stale = results / "TEST-stale.xml"; stale.write_text("stale result")

        def finish(timeout):
            if timeout == storage.TEST_TIMEOUT:
                self.assertFalse(stale.exists())
                results.mkdir(parents=True)
                ET.ElementTree(self.report()).write(results / "TEST-owned.xml")
            return 0

        gradle.wait.side_effect = finish
        with patch("builtins.print"):
            storage.run_instrumentation(self.sdk, self.owned)
        self.assertEqual({call.args[0] for call in self.kill.call_args_list}, {42001, 42002})
        self.assertEqual(self.run.call_args.args[0][-1], "kill-server")

    def test_unresponsive_owned_process_is_killed_without_global_process_cleanup(self):
        process = Mock(pid=42001)
        process.wait.side_effect = [subprocess.TimeoutExpired("owned", 10), 0]
        with patch.object(storage.os, "killpg") as kill:
            storage.stop_owned(process)
        self.assertEqual([call.args for call in kill.call_args_list],
                         [(42001, signal.SIGTERM), (42001, signal.SIGKILL)])


if __name__ == "__main__":
    unittest.main()
