"""Bounded protocol and budget controls; child data is disposable synthetic input."""
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import check

OID = "a" * 40
HEADER = (OID + " blob ").encode()


class ObjectReaderTests(unittest.TestCase):
    def child(self, program):
        popen = subprocess.Popen

        def start(*args, **kwargs):
            return popen([sys.executable, "-c", program], **kwargs)

        return patch.object(check.subprocess, "Popen", side_effect=start)

    def response(self, data, tail="sys.stdin.buffer.read()"):
        return ("import os, sys, time\n"
                "sys.stdin.buffer.readline()\n"
                f"os.write(1, {data!r})\n" + tail)

    def reject(self, program, reason=None):
        started = time.monotonic()
        with self.child(program):
            with self.assertRaises(SystemExit) as error:
                with check.ObjectReader() as reader:
                    reader.timeout = 0.5
                    reader.read(OID, "blob", 8)
            self.assertTrue(str(error.exception).startswith("Security check blocked:"))
            self.assertNotIn("untrusted diagnostic", str(error.exception))
            if reason:
                self.assertIn(reason, str(error.exception))
            self.assertIsNotNone(reader.process.poll())
            self.assertTrue(all(pipe.closed for pipe in
                                (reader.process.stdin, reader.process.stdout, reader.process.stderr)))
        self.assertLess(time.monotonic() - started, 3)

    def test_invalid_headers_and_lengths(self):
        headers = [OID.encode() + b" missing\n", b"b" * 40 + b" blob 0\n",
                   OID.encode() + b" commit 0\n", HEADER + b"-1\n", HEADER + b"+1\n",
                   HEADER + b"01\n", HEADER + b"1.0\n", HEADER + b"9\n",
                   HEADER + b"9999999999999999999999999\n", b"x" * 128,
                   HEADER + b"0 extra\n", HEADER + b"0\r\n"]
        for data in headers:
            with self.subTest(header=data):
                self.reject(self.response(data))

    def test_eof_and_separator(self):
        for data in (b"", HEADER + b"3\nxy", HEADER + b"0\n", HEADER + b"1\nx!"):
            with self.subTest(data=data):
                self.reject(self.response(data, "sys.exit(0)"))

    def test_deadlines_cover_header_payload_and_shutdown(self):
        for data in (b"", HEADER + b"3\nx", HEADER + b"0\n\n"):
            with self.subTest(data=data):
                self.reject(self.response(data, "time.sleep(30)"), "deadline")

    def test_nonzero_exit_after_valid_response(self):
        self.reject(self.response(HEADER + b"0\n\n", "sys.stdin.buffer.read(); sys.exit(7)"))

    def test_stderr_is_bounded_and_sanitized(self):
        self.reject(self.response(b"", "while True: os.write(2, b'untrusted diagnostic' * 4096)"))

    def test_trailing_stdout_is_rejected(self):
        self.reject(self.response(HEADER + b"0\n\nextra"), "unsolicited")

    def test_fragmented_binary_payload_and_duplicate_requests(self):
        payload = b"a\0b\n\xff\n"
        response = HEADER + str(len(payload)).encode() + b"\n" + payload + b"\n"
        program = ("import os, sys\n"
                   "for line in sys.stdin.buffer:\n"
                   f" for byte in {response!r}: os.write(1, bytes([byte]))\n")
        with self.child(program), check.ObjectReader() as reader:
            reader.timeout = 2
            for _ in range(3):
                self.assertEqual(reader.read(OID, "blob", len(payload)), payload)
        self.assertEqual(reader.process.returncode, 0)

    def test_invalid_requests_never_reach_child(self):
        with self.child("import sys; sys.stdin.buffer.read()"):
            for oid, kind, limit in (("HEAD", "blob", 1), (OID + "\n", "blob", 1),
                                     (OID, "tree", 1), (OID, "blob", -1),
                                     (OID, "blob", check.MAX_BLOB + 1)):
                with self.subTest(oid=oid, kind=kind, limit=limit):
                    with self.assertRaises(SystemExit), check.ObjectReader() as reader:
                        reader.read(oid, kind, limit)

    def test_sha256_identity_and_large_payload(self):
        oid = "c" * 64
        payload = b"a\0\n" * 30000
        response = (oid + " blob " + str(len(payload)) + "\n").encode() + payload + b"\n"
        with self.child(self.response(response)), check.ObjectReader() as reader:
            self.assertEqual(reader.read(oid, "blob", len(payload)), payload)

    def test_startup_failure_is_sanitized(self):
        with patch.object(check.subprocess, "Popen", side_effect=OSError("untrusted diagnostic")):
            with self.assertRaises(SystemExit) as error, check.ObjectReader():
                self.fail("startup failure was accepted")
            self.assertNotIn("untrusted diagnostic", str(error.exception))

    def test_real_git_types_missing_oid_and_reaping_on_exception(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            subprocess.run(["git", "init", "-q", str(root)], check=True, capture_output=True)
            def put(kind, data):
                return subprocess.check_output(["git", "hash-object", "-w", "-t", kind, "--stdin"],
                                               cwd=root, input=data).decode().strip()
            blob = put("blob", b"\0line\n")
            tree = put("tree", b"")
            commit = put("commit", (f"tree {tree}\nauthor Test <test@example.invalid> 1 +0000\n"
                                    "committer Test <test@example.invalid> 1 +0000\n\nfixture\n").encode())
            tag = put("tag", (f"object {commit}\ntype commit\ntag fixture\n"
                              "tagger Test <test@example.invalid> 1 +0000\n\nfixture\n").encode())
            with patch.object(check, "ROOT", root):
                with check.ObjectReader() as reader:
                    self.assertEqual(reader.read(blob, "blob"), b"\0line\n")
                    self.assertTrue(reader.read(commit, "commit").startswith(b"tree "))
                    self.assertTrue(reader.read(tag, "tag").startswith(b"object "))
                self.assertEqual(reader.process.returncode, 0)
                with self.assertRaises(SystemExit), check.ObjectReader() as reader:
                    reader.read("0" * 40, "blob")
                with self.assertRaises(RuntimeError), check.ObjectReader() as reader:
                    raise RuntimeError("test interruption")
                self.assertIsNotNone(reader.process.poll())


class MaterializeBudgetTests(unittest.TestCase):
    def test_duplicate_oids_still_count_each_materialization(self):
        with tempfile.TemporaryDirectory() as temporary:
            reader = unittest.mock.Mock()
            reader.read.return_value = b"1234"
            cache, budget = {}, [0, 0]
            with patch.object(check, "MAX_TOTAL", 8), patch.object(check, "MAX_OBJECTS", 2):
                check.materialize({"one.txt": OID, "two.txt": OID}, Path(temporary), cache, budget, reader)
                self.assertEqual(budget, [8, 2])
                reader.read.assert_called_once_with(OID, "blob", 8)
                with self.assertRaises(SystemExit):
                    check.materialize({"three.txt": OID}, Path(temporary), cache, budget, reader)

    def test_cached_bytes_are_reinspected_at_each_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = {OID: b"ordinary source"}
            with self.assertRaises(SystemExit):
                check.materialize({check.WRAPPER: OID}, Path(temporary), cache, [0, 0], None)

    def test_materialized_byte_budget_with_cached_content(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(check, "MAX_TOTAL", 4):
            budget = [0, 0]
            cache = {OID: b"1234"}
            check.materialize({"one.txt": OID}, Path(temporary), cache, budget, None)
            with self.assertRaises(SystemExit):
                check.materialize({"two.txt": OID}, Path(temporary), cache, budget, None)

    def test_cache_remaining_limit_and_object_budget(self):
        with tempfile.TemporaryDirectory() as temporary:
            reader = unittest.mock.Mock()
            reader.read.return_value = b"5678"
            with patch.object(check, "MAX_TOTAL", 8):
                check.materialize({"two.txt": "b" * 40}, Path(temporary), {OID: b"1234"}, [0, 0], reader)
                reader.read.assert_called_once_with("b" * 40, "blob", 4)
            with patch.object(check, "MAX_OBJECTS", 1), self.assertRaises(SystemExit):
                check.materialize({"two.txt": "b" * 40}, Path(temporary), {OID: b"1234"}, [0, 0], reader)


if __name__ == "__main__":
    unittest.main()
