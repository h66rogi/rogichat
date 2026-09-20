import copy
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch


def load(name):
    path = Path(__file__).resolve().parents[2] / "infrastructure/atlantis/worker" / (name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


canary, reaper = load("canary"), load("reaper")


class WorkerCanaryTests(unittest.TestCase):
    def test_network_or_tool_errors_are_not_authorization_denials(self):
        for error in [b"Connect timeout", b"NoSuchKey", b"command not found", b""]:
            self.assertFalse(canary.is_access_denied(subprocess.CompletedProcess([], 1, stderr=error)))
        self.assertTrue(canary.is_access_denied(subprocess.CompletedProcess([], 254, stderr=b"An error occurred (AccessDenied)")))

    def test_reachable_metadata_even_without_valid_credentials_is_failure(self):
        with patch.object(canary.socket, "create_connection") as connect:
            self.assertFalse(canary.blocked_tcp("169.254.169.254", 80))
        with patch.object(canary.socket, "create_connection", side_effect=TimeoutError):
            self.assertTrue(canary.blocked_tcp("169.254.169.254", 80))

    def test_read_denial_requires_successfully_created_object(self):
        ok = subprocess.CompletedProcess([],0,stderr=b"")
        denied = subprocess.CompletedProcess([],254,stderr=b"(AccessDenied)")
        with patch.object(canary, "aws", side_effect=[ok, denied]) as call:
            self.assertTrue(canary.existing_artifact_read_denied("fixture", "i-fixture", Path("empty")))
            self.assertEqual(call.call_args_list[0].args[1], "put-object")
            self.assertEqual(call.call_args_list[1].args[1], "get-object")
            self.assertEqual(call.call_args_list[0].args[5], call.call_args_list[1].args[5])
        with patch.object(canary, "aws", return_value=denied) as call:
            self.assertFalse(canary.existing_artifact_read_denied("fixture", "i-fixture", Path("empty")))
            self.assertEqual(call.call_count, 1)
        with patch.object(canary, "aws", side_effect=[ok, ok]):
            self.assertFalse(canary.existing_artifact_read_denied("fixture", "i-fixture", Path("empty")))

    def test_reaper_excludes_unrelated_young_and_malformed_instances(self):
        now = datetime.now(timezone.utc)
        tags = {**reaper.TAGS, "aws:ec2launchtemplate:id":"lt-test", "aws:ec2launchtemplate:version":"1"}
        item = dict(Tags=[dict(Key=k, Value=v) for k,v in tags.items()],
            LaunchTime=now-timedelta(minutes=20),
            State=dict(Name="running"))
        self.assertTrue(reaper.expired(item, "lt-test", now))
        for field, value in [("Tags", []), ("Tags", [dict(Key=k,Value=v) for k,v in reaper.TAGS.items()]),
                ("LaunchTime", now-timedelta(minutes=19)), ("LaunchTime", now.replace(tzinfo=None)),
                ("State", {"Name":"terminated"})]:
            changed = copy.deepcopy(item)
            changed[field] = value
            with self.subTest(field=field):
                self.assertFalse(reaper.expired(changed, "lt-test", now))

    def test_sandbox_unknown_or_nonboolean_output_is_rejected(self):
        for output in [b'{}', b'{"non_root": "true"}', b'not-json']:
            with patch.object(canary.subprocess, "run", return_value=subprocess.CompletedProcess([],0,stdout=output)):
                with self.assertRaises((RuntimeError, ValueError)):
                    canary.sandbox_probe()


if __name__ == "__main__": unittest.main()
