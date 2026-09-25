"""Focused iOS feedback must leave the full CI invocation intact."""
from contextlib import redirect_stderr
import io
import sys
import unittest
from unittest.mock import patch

import check_ios_wireframe as checks


class FocusedChecksTest(unittest.TestCase):
    def tearDown(self):
        checks.SELECTED = None
        checks.SEEN.clear()

    def run_cli(self, *args):
        with patch.object(sys, "argv", ["check_ios_wireframe.py", *args]), \
             patch.object(checks, "inspect_ios_dependencies"), \
             patch.object(checks, "inspect_product_sources"), \
             patch.object(checks.subprocess, "check_output", return_value="/fixture/MacOSX.sdk"), \
             patch.object(checks.subprocess, "run") as run:
            checks.main()
            return [call.args[0] for call in run.call_args_list]

    def test_focused_navigation_check_does_not_compile_or_run_unrelated_suites(self):
        commands = self.run_cli("--only", "navigation-state-checks")
        self.assertEqual(len(commands), 2)
        self.assertIn("navigation-state-checks", commands[0][-1])
        self.assertTrue(str(commands[1][0]).endswith("navigation-state-checks"))

    def test_default_still_runs_compiled_checks_transport_package_and_recovery(self):
        commands = self.run_cli()
        self.assertGreater(len(commands), 30)
        self.assertTrue(any("run_transport_checks.py" in str(part) for cmd in commands for part in cmd))
        self.assertTrue(any(cmd[:3] == ["xcrun", "swift", "test"] for cmd in commands))
        self.assertTrue(any("check_ios_conversation_recovery.py" in str(part) for cmd in commands for part in cmd))

    def test_unknown_check_is_not_a_silent_success(self):
        with patch.object(sys, "argv", ["check_ios_wireframe.py", "--only", "missing-check"]), \
             patch.object(checks, "inspect_ios_dependencies"), \
             patch.object(checks, "inspect_product_sources"), \
             patch.object(checks.subprocess, "check_output", return_value="/fixture/MacOSX.sdk"), \
             patch.object(checks.subprocess, "run") as run:
            with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                checks.main()
            self.assertEqual(error.exception.code, 2)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
