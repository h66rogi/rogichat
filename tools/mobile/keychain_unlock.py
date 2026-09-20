"""Unlock an explicitly configured macOS signing keychain without a subprocess."""
import ctypes
from contextlib import contextmanager
import os
import stat
import sys

from release_common import external

MAX_PASSWORD_BYTES = 4096


def frameworks():
    if sys.platform != "darwin":
        raise RuntimeError("Dedicated signing keychain unlock requires macOS")
    try:
        security = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
        core = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
        signatures = {
            "SecKeychainOpen": [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)],
            "SecKeychainUnlock": [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_ubyte],
            "SecKeychainGetStatus": [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)],
            "SecKeychainGetUserInteractionAllowed": [ctypes.POINTER(ctypes.c_ubyte)],
            "SecKeychainSetUserInteractionAllowed": [ctypes.c_ubyte],
        }
        for name, arguments in signatures.items():
            function = getattr(security, name)
            function.argtypes = arguments
            function.restype = ctypes.c_int32  # OSStatus; Boolean is an unsigned byte.
        core.CFRelease.argtypes = [ctypes.c_void_p]
        core.CFRelease.restype = None
        return security, core
    except (OSError, AttributeError):
        raise RuntimeError("macOS signing keychain API is unavailable") from None


def checked(status):
    if status:
        # No password, path, native diagnostic or captured command in errors.
        raise RuntimeError(f"Signing keychain operation failed (OSStatus {int(status)})")


@contextmanager
def password_buffer(path):
    """Read once into bounded mutable storage; never make a Python password string."""
    storage = bytearray(MAX_PASSWORD_BYTES + 1)
    view = (ctypes.c_ubyte * len(storage)).from_buffer(storage)
    try:
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb", buffering=0) as source:
                metadata = os.fstat(source.fileno())
                if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid()
                        or stat.S_IMODE(metadata.st_mode) != 0o600):
                    raise ValueError("Keychain password must be a current-user-owned regular file with mode 600")
                length = source.readinto(storage)
        except OSError:
            raise RuntimeError("Cannot read the configured keychain password file") from None
        if not length or length > MAX_PASSWORD_BYTES:
            raise ValueError("Keychain password file is empty or exceeds the size limit")
        # Preserve the existing release file convention: trim surrounding ASCII whitespace.
        start, end = 0, length
        while start < end and storage[start] in b" \t\n\r\v\f":
            start += 1
        while end > start and storage[end - 1] in b" \t\n\r\v\f":
            end -= 1
        if start == end or 0 in memoryview(storage)[start:end]:
            raise ValueError("Keychain password file contains an empty password or NUL")
        yield ctypes.byref(view, start), end - start
    finally:
        # Best effort erasure of our entire allocation on both success and failure.
        ctypes.memset(ctypes.addressof(view), 0, len(storage))


def unlock(keychain_path, password_path):
    keychain_path, password_path = external(keychain_path), external(password_path)
    if not keychain_path.is_file():
        raise ValueError("Configured signing keychain is not an existing file")
    security, core = frameworks()
    reference = ctypes.c_void_p()
    previous_interaction = ctypes.c_ubyte()
    checked(security.SecKeychainGetUserInteractionAllowed(ctypes.byref(previous_interaction)))
    checked(security.SecKeychainSetUserInteractionAllowed(0))
    try:
        checked(security.SecKeychainOpen(os.fsencode(keychain_path), ctypes.byref(reference)))
        if not reference.value:
            raise RuntimeError("Signing keychain API returned no explicit keychain")
        with password_buffer(password_path) as (password, length):
            checked(security.SecKeychainUnlock(reference, length, password, 1))
        status = ctypes.c_uint32()
        checked(security.SecKeychainGetStatus(reference, ctypes.byref(status)))
        if not status.value & 1:  # kSecUnlockStateStatus
            raise RuntimeError("Configured signing keychain remains locked")
    finally:
        if reference.value:
            core.CFRelease(reference)
        checked(security.SecKeychainSetUserInteractionAllowed(previous_interaction.value))
