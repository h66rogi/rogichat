"""Secret transport regression tests; opt-in macOS test uses a disposable keychain."""
import ctypes
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import keychain_unlock as target
from release_ios import unlock_signing


class PasswordTransportTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name).resolve()
        self.password = self.directory / "password.txt"
        self.password.write_bytes(b"  synthetic-test-value\r\n")
        self.password.chmod(0o600)

    def test_bytes_and_erasure_even_on_failure(self):
        for fail in (False, True):
            with self.subTest(failure=fail):
                try:
                    with target.password_buffer(self.password) as (pointer, length):
                        allocation = pointer._obj  # Retain the allocation to inspect after exit.
                        self.assertEqual(ctypes.string_at(pointer, length), b"synthetic-test-value")
                        if fail:
                            raise RuntimeError("simulated native failure")
                except RuntimeError:
                    pass
                self.assertFalse(any(allocation))

    def test_permissions_empty_large_and_nul_rejected(self):
        self.password.chmod(0o644)
        with self.assertRaisesRegex(ValueError, "mode 600"):
            with target.password_buffer(self.password):
                self.fail("Readable password was accepted")
        self.password.chmod(0o600)
        for content in (b"", b" \r\n", b"bad\0value", b"a" * (target.MAX_PASSWORD_BYTES + 1)):
            self.password.write_bytes(content)
            with self.assertRaises(ValueError):
                with target.password_buffer(self.password):
                    self.fail("Invalid password was accepted")

    def test_symlink_and_fifo_are_rejected_without_waiting(self):
        link = self.directory / "link"
        link.symlink_to(self.password)
        fifo = self.directory / "fifo"
        os.mkfifo(fifo, 0o600)
        for path in (link, fifo):
            with self.assertRaises((ValueError, RuntimeError)):
                with target.password_buffer(path):
                    self.fail("Nonregular source was accepted")

    def test_existing_optional_config_contract(self):
        with patch("release_ios.unlock") as native, patch("subprocess.run", side_effect=AssertionError("No child process")):
            unlock_signing({"ios": {}})
            native.assert_not_called()
            unlock_signing({"ios": {"keychain": "external-keychain", "keychain_password_file": "external-password"}})
            native.assert_called_once_with("external-keychain", "external-password")

    def test_error_does_not_include_native_password_or_path(self):
        with self.assertRaisesRegex(RuntimeError, r"^Signing keychain operation failed \(OSStatus -25293\)$"):
            target.checked(-25293)

    def test_missing_and_repository_keychain_fail_before_native_call(self):
        from release_common import ROOT
        with patch.object(target, "frameworks", side_effect=AssertionError("No native API")):
            for path in (self.directory / "absent.keychain-db", ROOT / "existing.keychain-db"):
                with self.assertRaises(ValueError):
                    target.unlock(path, self.password)


@unittest.skipUnless(sys.platform == "darwin" and os.environ.get("ROGICHAT_TEST_DISPOSABLE_KEYCHAIN") == "1",
                     "Opt in to creating and deleting an isolated synthetic macOS keychain")
class DisposableKeychainTests(unittest.TestCase):
    setUp = PasswordTransportTests.setUp

    def test_real_unlock_wrong_password_and_cleanup(self):
        security, core = target.frameworks()
        signatures = {
            "SecKeychainCreate": [ctypes.c_char_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_ubyte,
                                   ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)],
            "SecKeychainLock": [ctypes.c_void_p],
            "SecKeychainDelete": [ctypes.c_void_p],
            "SecKeychainCopySearchList": [ctypes.POINTER(ctypes.c_void_p)],
            "SecKeychainCopyDefault": [ctypes.POINTER(ctypes.c_void_p)],
        }
        for name, arguments in signatures.items():
            getattr(security, name).argtypes = arguments
            getattr(security, name).restype = ctypes.c_int32
        core.CFEqual.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        core.CFEqual.restype = ctypes.c_ubyte
        before_list, before_default = ctypes.c_void_p(), ctypes.c_void_p()
        target.checked(security.SecKeychainCopySearchList(ctypes.byref(before_list)))
        try:
            if security.SecKeychainCopyDefault(ctypes.byref(before_default)):
                self.skipTest("Require an existing default keychain to avoid establishing one")
            keychain = self.directory / "synthetic.keychain-db"
            reference = ctypes.c_void_p()
            try:
                with target.password_buffer(self.password) as (pointer, length):
                    target.checked(security.SecKeychainCreate(os.fsencode(keychain), length, pointer, 0, None,
                                                             ctypes.byref(reference)))
                self.assertTrue(reference.value)
                target.checked(security.SecKeychainLock(reference))
                with patch("subprocess.run", side_effect=AssertionError("No child process")):
                    target.unlock(keychain, self.password)
                    target.unlock(keychain, self.password)  # Already unlocked remains usable.
                    target.checked(security.SecKeychainLock(reference))
                    self.password.write_bytes(b"different-synthetic-value")
                    with self.assertRaises(RuntimeError):
                        target.unlock(keychain, self.password)
                state = ctypes.c_uint32()
                target.checked(security.SecKeychainGetStatus(reference, ctypes.byref(state)))
                self.assertFalse(state.value & 1)
                self.password.write_bytes(b"synthetic-test-value\n")
                target.unlock(keychain, self.password)  # A failed attempt does not poison later signing.
            finally:
                if reference.value:
                    try:
                        target.checked(security.SecKeychainDelete(reference))
                    finally:
                        core.CFRelease(reference)
            self.assertFalse(keychain.exists())
            after_list, after_default = ctypes.c_void_p(), ctypes.c_void_p()
            try:
                target.checked(security.SecKeychainCopySearchList(ctypes.byref(after_list)))
                target.checked(security.SecKeychainCopyDefault(ctypes.byref(after_default)))
                self.assertTrue(core.CFEqual(before_list, after_list), "Search list changed")
                self.assertTrue(core.CFEqual(before_default, after_default), "Default keychain changed")
            finally:
                if after_list.value:
                    core.CFRelease(after_list)
                if after_default.value:
                    core.CFRelease(after_default)
        finally:
            core.CFRelease(before_list)
            if before_default.value:
                core.CFRelease(before_default)


if __name__ == "__main__":
    unittest.main()
