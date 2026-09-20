"""Crash/re-entry, exact target, mutation and readback regressions without cloud access."""
from contextlib import ExitStack
from copy import deepcopy
import json
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from release_common import APP_ID, AppStoreConnect, NoRedirect, sha256, tree_sha256
from release_android import firebase_json
from release_finalize import Pending, android, approved_testers, ios
from release_firebase import BinaryRedirect, Firebase, download_url
from release_journal import atomic_json, finalization_lock


class FirebaseFake:
    project = "projects/123"
    app = project + "/apps/1:123:android:abc"

    def __init__(self, sha):
        self.sha = sha
        self.releases = [{"name": self.app + "/releases/release-1", "buildVersion": "8", "displayVersion": "0.1.0-qa", "binaryDownloadUri": "signed-url"}]
        self.testers = [{"name": self.project + "/testers/approved%40example.invalid"}]
        self.posts = []
        self.post_failure = False
        self.read_failure = False

    def collection(self, resource, key):
        if key == "releases":
            return self.releases
        if self.read_failure:
            raise RuntimeError("readback interrupted")
        return self.testers

    def binary_sha256(self, url, size):
        return self.sha

    def request(self, resource, params=None, body=None):
        self.posts.append((resource, body))
        if self.post_failure:
            raise RuntimeError("response lost")
        return {}


class AppleFake:
    def __init__(self):
        self.build = {"id": "build-8", "attributes": {"version": "8", "processingState": "VALID", "expired": False}}
        self.version = {"version": "0.1.0", "platform": "IOS"}
        self.group = {"id": "approved-group", "attributes": {"isInternalGroup": True}}
        self.group_app = "qa-app"
        self.build_app = "qa-app"
        self.testers = [{"id": "existing-tester"}]
        self.notes = []
        self.group_builds = []
        self.internal_state = "IN_BETA_TESTING"
        self.mutations = []
        self.lose_notes_response = False
        self.reject_notes = False

    def app(self):
        return "qa-app"

    def collection(self, resource, params=None):
        if resource == "builds":
            return [deepcopy(self.build)] if self.build else []
        if resource.endswith("/betaTesters"):
            return self.testers
        if resource.endswith("/betaBuildLocalizations"):
            return deepcopy(self.notes)
        if resource.endswith("/builds"):
            return self.group_builds
        raise AssertionError(resource)

    def request(self, resource, params=None, body=None, *, method=None):
        if method:
            self.mutations.append((resource, method, body))
            if resource.startswith("betaBuildLocalizations"):
                if self.reject_notes:
                    raise RuntimeError("notes rejected")
                self.notes = [{"id": "notes-ko", "attributes": {"locale": "ko", "whatsNew": body["data"]["attributes"]["whatsNew"]}}]
                if self.lose_notes_response:
                    raise RuntimeError("notes response lost after commit")
            else:
                self.group_builds = [{"id": "build-8"}]
            return {}  # Apple relationship mutations can return 204.
        if resource == "builds/build-8/app":
            data = {"id": self.build_app}
        elif resource.endswith("/preReleaseVersion"):
            data = {"attributes": self.version}
        elif resource == "betaGroups/approved-group":
            data = self.group
        elif resource == "betaGroups/approved-group/app":
            data = {"id": self.group_app}
        elif resource.endswith("/buildBetaDetail"):
            data = {"attributes": {"internalBuildState": self.internal_state}}
        else:
            raise AssertionError(resource)
        return {"data": deepcopy(data)}


class FinalizationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.cfg = {"artifact_root": str(self.root), "firebase": {"app_id": "1:123:android:abc", "project_id": "unit-project"},
                    "ios": {"testflight_group_id": "approved-group"}}
        self.testers_file = self.write("testers.txt", "Approved@example.invalid, approved@example.invalid\n")
        self.notes_file = self.write("notes.txt", "현재 버전의 테스트 항목")
        self.stack = self.enterContext(ExitStack())
        self.stack.enter_context(patch("builtins.print"))
        self.stack.enter_context(patch("release_finalize.verify_apk"))
        self.stack.enter_context(patch("release_finalize.verify_firebase_apk"))
        self.stack.enter_context(patch("release_finalize.inspect_archive"))
        self.stack.enter_context(patch("release_finalize.inspect_ipa"))

    def write(self, relative, data):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.write_text(data)
        path.chmod(0o600)
        return path

    def release(self, platform):
        artifact = self.write(platform + "/8/app." + ("apk" if platform == "android" else "ipa"), "verified application")
        kind = "apk" if platform == "android" else "ipa"
        value = {"platform": platform, "environment": "qa", "app_id": APP_ID, "build_number": 8,
                 "version": "0.1.0", "commit": "a" * 40, "source_dirty": False,
                 "artifacts": {kind: {"path": str(artifact), "sha256": sha256(artifact)}}}
        if platform == "ios":
            self.write("ios/8/archive/Info.plist", "signed archive")
            value.update(archive_path=str(self.root / "ios/8/archive"), archive_sha256=tree_sha256(self.root / "ios/8/archive"), apple_validated=True)
            self.write("ios/8/testflight-upload-attempt.json", json.dumps({"build_number": 8, "state": "transport_completed"}))
        path = self.write(platform + "/8/release.json", json.dumps(value))
        return path, value

    def journal(self, platform):
        return json.loads((self.root / platform / "8/finalization.json").read_text())

    def test_android_completed_reentry_never_redistributes(self):
        path, value = self.release("android")
        api = FirebaseFake(value["artifacts"]["apk"]["sha256"])
        android(self.cfg, path, self.testers_file, client=api)
        android(self.cfg, path, self.testers_file, client=api)
        self.assertEqual(len(api.posts), 1)
        self.assertEqual(api.posts[0][1], {"testerEmails": ["approved@example.invalid"]})
        self.assertEqual(self.journal("android")["steps"]["verification"]["state"], "verified")

    def test_android_config_resource_rejection_blocks_distribution(self):
        path, value = self.release("android")
        api = FirebaseFake(value["artifacts"]["apk"]["sha256"])
        with patch("release_finalize.verify_firebase_apk", side_effect=ValueError("resource mismatch")) as guard:
            with self.assertRaisesRegex(ValueError, "resource mismatch"):
                android(self.cfg, path, self.testers_file, client=api)
            guard.assert_called_once_with(Path(value["artifacts"]["apk"]["path"]), self.cfg)
        self.assertEqual(api.posts, [])
        self.assertNotEqual(self.journal("android")["steps"]["verification"]["state"], "verified")
        self.assertEqual((path.parent / "finalization.json").stat().st_mode & 0o777, 0o600)

    def test_android_unknown_post_response_blocks_all_retries(self):
        path, value = self.release("android")
        api = FirebaseFake(value["artifacts"]["apk"]["sha256"])
        api.post_failure = True
        with self.assertRaisesRegex(RuntimeError, "response lost"):
            android(self.cfg, path, self.testers_file, client=api)
        api.post_failure = False
        with self.assertRaisesRegex(RuntimeError, "uncertain"):
            android(self.cfg, path, self.testers_file, client=api)
        self.assertEqual(len(api.posts), 1)

    def test_android_readback_failure_after_acknowledgement_resumes_without_post(self):
        path, value = self.release("android")
        api = FirebaseFake(value["artifacts"]["apk"]["sha256"])
        api.read_failure = True
        with self.assertRaisesRegex(RuntimeError, "readback interrupted"):
            android(self.cfg, path, self.testers_file, client=api)
        self.assertEqual(self.journal("android")["steps"]["distribution"]["state"], "accepted")
        api.read_failure = False
        android(self.cfg, path, self.testers_file, client=api)
        self.assertEqual(len(api.posts), 1)

    def test_android_remote_hash_or_ambiguous_version_blocks_mutation(self):
        path, value = self.release("android")
        api = FirebaseFake("b" * 64)
        with self.assertRaisesRegex(ValueError, "checksum"):
            android(self.cfg, path, self.testers_file, client=api)
        api.sha = value["artifacts"]["apk"]["sha256"]
        api.releases *= 2
        with self.assertRaisesRegex(ValueError, "one exact"):
            android(self.cfg, path, self.testers_file, client=api)
        self.assertEqual(api.posts, [])

    def test_android_completed_receipt_does_not_mask_revoked_registration(self):
        path, value = self.release("android")
        api = FirebaseFake(value["artifacts"]["apk"]["sha256"])
        android(self.cfg, path, self.testers_file, client=api)
        api.testers = []
        with self.assertRaises(Pending):
            android(self.cfg, path, self.testers_file, client=api)
        self.assertEqual(self.journal("android")["steps"]["verification"]["state"], "checking")
        self.assertEqual(len(api.posts), 1)

    def test_changed_recipients_and_remote_release_identity_fail_closed(self):
        path, value = self.release("android")
        api = FirebaseFake(value["artifacts"]["apk"]["sha256"])
        android(self.cfg, path, self.testers_file, client=api)
        self.testers_file.write_text("different@example.invalid")
        with self.assertRaisesRegex(ValueError, "intent changed"):
            android(self.cfg, path, self.testers_file, client=api)
        self.testers_file.write_text("approved@example.invalid")
        api.releases[0]["name"] = api.app + "/releases/replaced"
        with self.assertRaisesRegex(ValueError, "identity changed"):
            android(self.cfg, path, self.testers_file, client=api)
        self.assertEqual(len(api.posts), 1)

    def test_ios_notes_group_and_204_completion_are_idempotent(self):
        path, _ = self.release("ios")
        api = AppleFake()
        ios(self.cfg, path, self.notes_file, client=api)
        ios(self.cfg, path, self.notes_file, client=api)
        self.assertEqual(len(api.mutations), 2)
        self.assertEqual(self.journal("ios")["steps"]["verification"]["state"], "verified")

    def test_ios_signed_capability_rejection_blocks_remote_notes_and_group_mutations(self):
        path, value = self.release("ios")
        api = AppleFake()
        with patch("release_finalize.inspect_archive") as archive, \
                patch("release_finalize.inspect_ipa", side_effect=ValueError("missing actual Apple permission")) as ipa:
            with self.assertRaisesRegex(ValueError, "actual Apple"):
                ios(self.cfg, path, self.notes_file, client=api)
            archive.assert_called_once_with(Path(value["archive_path"]), 8, "0.1.0", self.cfg)
            ipa.assert_called_once_with(Path(value["artifacts"]["ipa"]["path"]), 8, "0.1.0", self.cfg)
        self.assertEqual(api.mutations, [])
        self.assertNotEqual(self.journal("ios")["steps"]["verification"]["state"], "verified")

    def test_ios_absent_uncertain_or_wrong_upload_receipt_blocks_all_writes(self):
        path, value = self.release("ios")
        receipt = path.parent / "testflight-upload-attempt.json"
        api = AppleFake()
        receipt.unlink()
        with self.assertRaises(ValueError):
            ios(self.cfg, path, self.notes_file, client=api)
        for upload in ({"build_number": 8, "state": "attempted"}, {"build_number": 9, "state": "transport_completed"},
                       {"build_number": "8", "state": "transport_completed"},
                       {"build_number": 8, "state": "transport_completed", "commit": "b" * 40}):
            self.write("ios/8/testflight-upload-attempt.json", json.dumps(upload))
            with self.subTest(upload=upload), self.assertRaises(ValueError):
                ios(self.cfg, path, self.notes_file, client=api)
        self.assertEqual(api.mutations, [])
        self.write("ios/8/testflight-upload-attempt.json", json.dumps({"build_number": 8, "state": "transport_completed",
                   "commit": value["commit"], "archive_sha256": value["archive_sha256"], "ipa_sha256": value["artifacts"]["ipa"]["sha256"]}))
        ios(self.cfg, path, self.notes_file, client=api)
        self.assertEqual(len(api.mutations), 2)

    def test_ios_lost_note_response_reconciles_from_readback(self):
        path, _ = self.release("ios")
        api = AppleFake()
        api.lose_notes_response = True
        with self.assertRaisesRegex(RuntimeError, "response lost"):
            ios(self.cfg, path, self.notes_file, client=api)
        ios(self.cfg, path, self.notes_file, client=api)
        self.assertEqual(len([entry for entry in api.mutations if entry[0] == "betaBuildLocalizations"]), 1)

    def test_ios_unobserved_note_attempt_is_never_blindly_repeated(self):
        path, _ = self.release("ios")
        api = AppleFake()
        api.reject_notes = True
        with self.assertRaisesRegex(RuntimeError, "notes rejected"):
            ios(self.cfg, path, self.notes_file, client=api)
        api.reject_notes = False
        with self.assertRaises(Pending):
            ios(self.cfg, path, self.notes_file, client=api)
        self.assertEqual(len(api.mutations), 1)

    def test_ios_pending_availability_resumes_without_repeating_writes(self):
        path, _ = self.release("ios")
        api = AppleFake()
        api.internal_state = "READY_FOR_BETA_TESTING"
        with self.assertRaises(Pending):
            ios(self.cfg, path, self.notes_file, client=api)
        api.internal_state = "IN_BETA_TESTING"
        ios(self.cfg, path, self.notes_file, client=api)
        self.assertEqual(len(api.mutations), 2)

    def test_ios_completed_reentry_checks_live_group_membership(self):
        path, _ = self.release("ios")
        api = AppleFake()
        ios(self.cfg, path, self.notes_file, client=api)
        api.group_builds = []
        with self.assertRaises(Pending):
            ios(self.cfg, path, self.notes_file, client=api)
        self.assertEqual(len(api.mutations), 2)
        self.assertEqual(self.journal("ios")["steps"]["verification"]["state"], "checking")

    def test_ios_wrong_identity_expiry_or_empty_group_blocks_all_writes(self):
        path, _ = self.release("ios")
        variants = [lambda api: api.version.update(version="0.2.0"), lambda api: api.version.update(platform="MAC_OS"),
                    lambda api: api.build["attributes"].update(expired=True), lambda api: api.build["attributes"].update(processingState="INVALID"),
                    lambda api: setattr(api, "group_app", "other-app"), lambda api: setattr(api, "build_app", "other-app"),
                    lambda api: api.group["attributes"].update(isInternalGroup=False), lambda api: setattr(api, "testers", [])]
        for mutate in variants:
            api = AppleFake()
            mutate(api)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                ios(self.cfg, path, self.notes_file, client=api)
            self.assertEqual(api.mutations, [])

    def test_ios_bounded_wait_observes_processing_without_upload(self):
        path, _ = self.release("ios")
        api = AppleFake()
        api.build["attributes"]["processingState"] = "PROCESSING"
        def advance(seconds):
            self.assertLessEqual(seconds, 15)
            api.build["attributes"]["processingState"] = "VALID"
        ios(self.cfg, path, self.notes_file, 60, client=api, clock=lambda: 0, sleep=advance)
        self.assertEqual(len(api.mutations), 2)

    def test_ios_exact_korean_locale_and_changed_notes_intent(self):
        path, _ = self.release("ios")
        api = AppleFake()
        api.notes = [{"id": "notes-other", "attributes": {"locale": "ko-KR", "whatsNew": self.notes_file.read_text()}}]
        ios(self.cfg, path, self.notes_file, client=api)
        self.assertEqual(api.mutations[0][2]["data"]["attributes"]["locale"], "ko")
        self.notes_file.write_text("다른 테스트 항목")
        with self.assertRaisesRegex(ValueError, "intent changed"):
            ios(self.cfg, path, self.notes_file, client=api)

    def test_manifest_source_and_local_artifact_mutations_are_rejected(self):
        path, value = self.release("android")
        api = FirebaseFake(value["artifacts"]["apk"]["sha256"])
        for changed in ({"source_dirty": None}, {"commit": "invalid"}, {"app_id": "chat.rogi.rogichat"}, {"environment": "prod"}):
            path.write_text(json.dumps({**value, **changed}))
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                android(self.cfg, path, self.testers_file, client=api)
        path.write_text(json.dumps(value))
        Path(value["artifacts"]["apk"]["path"]).write_text("tampered")
        with self.assertRaisesRegex(ValueError, "checksum"):
            android(self.cfg, path, self.testers_file, client=api)
        self.assertEqual(api.posts, [])

    def test_private_inputs_email_validation_and_noncanonical_manifest(self):
        path, value = self.release("android")
        self.testers_file.chmod(0o644)
        with self.assertRaisesRegex(ValueError, "private file"):
            approved_testers(self.testers_file)
        self.testers_file.chmod(0o600)
        for content in ("", "not-an-email", "a@example.invalid\nwrong"):
            self.testers_file.write_text(content)
            with self.assertRaises(ValueError):
                approved_testers(self.testers_file)
        alternate = self.write("alternate.json", path.read_text())
        with self.assertRaisesRegex(ValueError, "canonical"):
            with finalization_lock(self.cfg, alternate, value, {}):
                self.fail("alternate lock accepted")

    def test_exclusive_lock_releases_after_failure(self):
        path, value = self.release("android")
        with finalization_lock(self.cfg, path, value, {}):
            with self.assertRaisesRegex(RuntimeError, "already being finalized"):
                with finalization_lock(self.cfg, path, value, {}):
                    self.fail("concurrent operator admitted")
        with finalization_lock(self.cfg, path, value, {}) as journal:
            self.assertEqual(journal.value["intent"]["commit"], value["commit"])

    def test_atomic_write_failure_keeps_previous_receipt(self):
        path = self.write("receipt.json", '{"previous":true}')
        with patch("release_journal.os.replace", side_effect=OSError("interrupted")), self.assertRaises(OSError):
            atomic_json(path, {"next": True})
        self.assertEqual(json.loads(path.read_text()), {"previous": True})
        self.assertEqual(list(self.root.glob(".finalization-*")), [])

    def test_journal_rejects_malformed_schema_and_steps_before_reentry(self):
        path, value = self.release("android")
        with finalization_lock(self.cfg, path, value, {}) as journal:
            original = deepcopy(journal.value)
        for mutation in ({"schema": True}, {"steps": {"distribution": "accepted"}}, {"target": "other"}):
            atomic_json(path.parent / "finalization.json", {**original, **mutation})
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                with finalization_lock(self.cfg, path, value, {}):
                    self.fail("malformed journal admitted")


class APIBoundaries(unittest.TestCase):
    def test_authenticated_apple_204_and_firebase_distribution_acknowledgement(self):
        api = object.__new__(AppStoreConnect)
        api.token = "fixture-access"
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b""
        opener = Mock()
        opener.open.return_value = response
        with patch("urllib.request.build_opener", return_value=opener):
            self.assertEqual(api.request("betaGroups/group/relationships/builds", body={"data": []}, method="POST"), {})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("Authorization"), "Bearer fixture-access")
        firebase = object.__new__(Firebase)
        firebase.project, firebase.token = "projects/123", "fixture-access"
        response.read.side_effect = AssertionError("distribution acknowledgement must not depend on body parsing")
        with patch("urllib.request.build_opener", return_value=opener):
            self.assertEqual(firebase.request("projects/123/apps/app/releases/release:distribute", body={"testerEmails": []}), {})
        with self.assertRaisesRegex(RuntimeError, "redirects"):
            NoRedirect().redirect_request(request, None, 302, "redirect", {}, "https://other.invalid")

    def test_binary_stream_is_size_bounded_and_sends_no_bearer(self):
        api = object.__new__(Firebase)
        api.token = "fixture-access"
        url = "https://firebaseappdistribution.googleapis.com/file"
        opener = Mock()
        opener.open.return_value = io.BytesIO(b"verified")
        with patch("urllib.request.build_opener", return_value=opener):
            self.assertEqual(api.binary_sha256(url, 8), "1c34f88707b55e6104c4eb20e71ffa3d33e414b71ef689a15fad0640d0ac58cb")
        self.assertEqual(opener.open.call_args.args, (url,))
        for payload, size in ((b"oversize", 1), (b"short", 10)):
            opener.open.return_value = io.BytesIO(payload)
            with patch("urllib.request.build_opener", return_value=opener), self.assertRaisesRegex(ValueError, "size"):
                api.binary_sha256(url, size)
        with self.assertRaises(ValueError):
            BinaryRedirect().redirect_request(None, None, 302, "redirect", {}, "http://firebaseappdistribution.googleapis.com/file")

    def test_firebase_cli_drops_ambient_code_hooks_and_debug_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"NODE_OPTIONS": "--require malicious", "NODE_PATH": "/untrusted", "PYTHONPATH": "/untrusted", "DEBUG": "*", "FIREBASE_DEBUG": "true"}):
                with patch("release_android.subprocess.run", return_value=subprocess.CompletedProcess([], 0, '{"status":"success","result":[]}', "")) as run:
                    self.assertEqual(firebase_json(["apps:list"], directory), [])
            environment = run.call_args.kwargs["env"]
            for key in ("NODE_OPTIONS", "NODE_PATH", "PYTHONPATH", "DEBUG", "FIREBASE_DEBUG"):
                self.assertNotIn(key, environment)
            self.assertEqual(environment.get("HOME"), os.environ.get("HOME"))

    def test_apple_pagination_selects_later_exact_app(self):
        api = object.__new__(AppStoreConnect)
        pages = [{"data": [{"id": "prefix", "attributes": {"bundleId": APP_ID + ".other"}}], "links": {"next": "https://api.appstoreconnect.apple.com/v1/apps?cursor=2"}},
                 {"data": [{"id": "exact", "attributes": {"bundleId": APP_ID}}]}]
        with patch.object(api, "request", side_effect=pages) as request:
            self.assertEqual(api.app(), "exact")
            self.assertEqual(request.call_count, 2)

    def test_apple_pagination_rejects_host_scheme_resource_and_cycles(self):
        api = object.__new__(AppStoreConnect)
        for url in ("https://other.invalid/v1/apps", "http://api.appstoreconnect.apple.com/v1/apps", "https://user@api.appstoreconnect.apple.com/v1/apps", "https://api.appstoreconnect.apple.com/v1/builds", "https://api.appstoreconnect.apple.com/v1/apps?cursor=loop"):
            with self.subTest(url=url), patch.object(api, "request", return_value={"data": [], "links": {"next": url}}):
                with self.assertRaisesRegex(ValueError, "pagination"):
                    api.collection("apps")

    def test_firebase_pagination_and_cycle_rejection(self):
        api = object.__new__(Firebase)
        with patch.object(api, "request", side_effect=[{"testers": [1], "nextPageToken": "next"}, {"testers": [2]}]):
            self.assertEqual(api.collection("testers", "testers"), [1, 2])
        with patch.object(api, "request", return_value={"nextPageToken": "cycle"}), self.assertRaisesRegex(ValueError, "Repeated"):
            api.collection("testers", "testers")

    def test_signed_binary_url_rejects_insecure_or_foreign_destination(self):
        for url in ("http://firebaseappdistribution.googleapis.com/file", "https://attacker.invalid/file", "https://user@firebaseappdistribution.googleapis.com/file"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                download_url(url)
        self.assertEqual(download_url("https://firebaseappdistribution.googleapis.com/file?signature=opaque"), "https://firebaseappdistribution.googleapis.com/file?signature=opaque")

    def test_firebase_adapter_rejects_refresh_token_fallback_without_logging_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "lib/bin").mkdir(parents=True)
            (root / "package.json").write_text('{"name":"firebase-tools"}')
            binary = root / "lib/bin/firebase.js"
            binary.write_text("// test installation")
            (root / "lib/auth.js").write_text("exports.getGlobalDefaultAccount=()=>({tokens:{refresh_token:'private-fixture'}}); exports.getAccessToken=async()=>({access_token:'private-fixture'});")
            helper = Path(__file__).with_name("firebase_session.cjs")
            env = {key: value for key, value in os.environ.items() if key not in ("NODE_OPTIONS", "NODE_PATH")}
            result = subprocess.run(["node", str(helper), str(binary)], capture_output=True, text=True, env=env)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("private-fixture", result.stdout + result.stderr)
            self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
