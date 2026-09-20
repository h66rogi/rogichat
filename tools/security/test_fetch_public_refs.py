"""No network is used by these public-ref acquisition tests."""
import os
import subprocess
import unittest
from unittest.mock import patch

import fetch_public_refs as fetch


class FetchPublicRefsTests(unittest.TestCase):
    def setUp(self):
        netrc = patch.object(fetch, "has_netrc", return_value=False)
        netrc.start()
        self.addCleanup(netrc.stop)

    def result(self, stdout="", code=0):
        return subprocess.CompletedProcess([], code, stdout, "private diagnostic must not be exposed")

    @patch.dict(os.environ, {"GITHUB_REPOSITORY": fetch.REPOSITORY}, clear=True)
    def test_fixed_anonymous_source_and_integrity(self):
        responses = [self.result(fetch.SOURCE + "\n"), self.result(), self.result(), self.result()]
        with patch.object(subprocess, "run", side_effect=responses) as run:
            fetch.main()
        command = run.call_args_list[2].args[0]
        self.assertIn(fetch.SOURCE, command)
        self.assertIn("+refs/pull/*:refs/remotes/security-pull/*", command)
        self.assertIn("credential.helper=", command)
        self.assertIn("http.extraHeader=", command)
        self.assertIn("protocol.allow=never", command)
        self.assertEqual(run.call_args_list[2].kwargs["env"]["GIT_TERMINAL_PROMPT"], "0")
        self.assertIn("fsck", run.call_args_list[3].args[0])

    @patch.dict(os.environ, {"GITHUB_REPOSITORY": "example/fork"}, clear=True)
    def test_other_repository_context_is_blocked(self):
        with patch.object(subprocess, "run") as run, self.assertRaises(ValueError):
            fetch.main()
        run.assert_not_called()

    @patch.dict(os.environ, {}, clear=True)
    def test_unexpected_origin_is_blocked(self):
        with patch.object(subprocess, "run", return_value=self.result("https://example.invalid/repo.git")) as run:
            with self.assertRaises(ValueError):
                fetch.main()
        self.assertEqual(run.call_count, 1)

    @patch.dict(os.environ, {}, clear=True)
    def test_local_http_headers_or_url_rewrites_are_blocked(self):
        for option in ["http.extraheader", "url.placeholder.insteadof", "HTTP.https://github.com/.ExtraHeader", "credential.https://github.com.helper"]:
            with self.subTest(option=option):
                with patch.object(subprocess, "run", side_effect=[self.result(fetch.SOURCE), self.result(option)]) as run:
                    with self.assertRaises(ValueError):
                        fetch.main()
                self.assertEqual(run.call_count, 2)

    @patch.dict(os.environ, {}, clear=True)
    def test_fetch_failure_and_timeout_fail_closed(self):
        for failure in [self.result(code=128), subprocess.TimeoutExpired("git", 120)]:
            with patch.object(subprocess, "run", side_effect=[self.result(fetch.SOURCE), self.result(), failure]):
                with self.assertRaises((ValueError, subprocess.TimeoutExpired)):
                    fetch.main()

    @patch.dict(os.environ, {}, clear=True)
    def test_integrity_failure_is_blocked(self):
        with patch.object(subprocess, "run", side_effect=[self.result(fetch.SOURCE), self.result(), self.result(), self.result(code=1)]):
            with self.assertRaises(ValueError):
                fetch.main()

    @patch.dict(os.environ, {}, clear=True)
    def test_home_netrc_presence_blocks_without_fetch(self):
        with patch.object(fetch, "has_netrc", return_value=True), patch.object(subprocess, "run") as run:
            with self.assertRaises(ValueError):
                fetch.main()
        run.assert_not_called()

    @patch.dict(os.environ, {"NETRC": "/synthetic/location", "SSLKEYLOGFILE": "/synthetic/output", "CURL_CA_BUNDLE": "/synthetic/cert", "HTTPS_PROXY": "https://example.invalid", "https_proxy": "https://example.invalid", "GITHUB_TOKEN": "synthetic", "HOME": "/unchanged-home", "PATH": "/usr/bin"}, clear=True)
    def test_only_process_basics_forwarded_and_home_unchanged(self):
        with patch.object(subprocess, "run", side_effect=[self.result(fetch.SOURCE), self.result(), self.result(), self.result()]) as run:
            fetch.main()
        env = run.call_args_list[2].kwargs["env"]
        for name in ["NETRC", "SSLKEYLOGFILE", "CURL_CA_BUNDLE", "HTTPS_PROXY", "https_proxy", "GITHUB_TOKEN"]:
            self.assertNotIn(name, env)
        self.assertEqual(env["HOME"], "/unchanged-home")

    @patch.dict(os.environ, {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "credential.helper", "GIT_CONFIG_VALUE_0": "bad", "GIT_TRACE": "1"}, clear=True)
    def test_git_environment_overrides_removed(self):
        with patch.object(subprocess, "run", side_effect=[self.result(fetch.SOURCE), self.result(), self.result(), self.result()]) as run:
            fetch.main()
        env = run.call_args_list[2].kwargs["env"]
        for name in ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_TRACE"]:
            self.assertNotIn(name, env)


if __name__ == "__main__":
    unittest.main()
