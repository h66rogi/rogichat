#!/usr/bin/env python3
"""Run platform storage regressions only on an owned ephemeral hosted-runner emulator."""
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
# Official stable catalog, verified 2026-09-20. A newer image needs an explicit review.
# https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml
IMAGE = "system-images;android-36;google_apis;x86_64"
IMAGE_REVISION = 7
BOOT_TIMEOUT = 240
TEST_TIMEOUT = 900
REQUIRED_CLASSES = {
    "chat.rogi.rogichat.core.session.AndroidCredentialStoreTest",
    "chat.rogi.rogichat.core.session.AndroidPendingAuthStoreTest",
    "chat.rogi.rogichat.core.rooms.AndroidRoomsStoreTest",
}


def hosted_paths(environment):
    if (environment.get("GITHUB_ACTIONS") != "true" or environment.get("RUNNER_ENVIRONMENT") != "github-hosted"
            or environment.get("RUNNER_OS") != "Linux" or sys.platform != "linux"):
        raise ValueError("Storage instrumentation requires an ephemeral GitHub-hosted Linux runner")
    paths = []
    for key in ("RUNNER_TEMP", "ANDROID_HOME"):
        value = environment.get(key)
        if not value or not Path(value).is_absolute() or not Path(value).is_dir():
            raise ValueError(f"Hosted runner requires an existing absolute {key}")
        path = Path(value).resolve()
        if path == ROOT or ROOT in path.parents:
            raise ValueError("Runner state and SDK must be outside the repository")
        paths.append(path)
    return tuple(paths)


def inspect_image(sdk):
    path = sdk / "system-images/android-36/google_apis/x86_64/package.xml"
    try:
        root = ET.parse(path).getroot()
        # Android SDK XML namespaces vary; the local package's fields do not.
        for node in root.iter():
            node.tag = node.tag.rsplit("}", 1)[-1]
        packages = list(root.iter("localPackage"))
        if len(packages) != 1 or packages[0].get("path") != IMAGE:
            raise ValueError("Wrong system image")
        package = packages[0]
        fields = {"type-details/api-level": "36", "type-details/extension-level": "17",
                  "type-details/base-extension": "true", "type-details/tag/id": "google_apis",
                  "type-details/vendor/id": "google",
                  "type-details/abi": "x86_64", "revision/major": str(IMAGE_REVISION)}
        if any(len(package.findall(key)) != 1 or package.findtext(key) != value for key, value in fields.items()):
            raise ValueError("System image revision or architecture drift")
        if any(len(package.findall("revision/" + key)) > 1 or package.findtext("revision/" + key, "0") != "0"
               for key in ("minor", "micro", "preview")):
            raise ValueError("Unexpected system image revision")
    except (OSError, ET.ParseError, ValueError) as error:
        raise ValueError("Install only reviewed API 36 Google APIs x86_64 image revision 7") from error


def inspect_results(directory):
    reports = sorted(directory.rglob("TEST-*.xml"))
    if not reports:
        raise ValueError("Storage instrumentation produced no JUnit results")
    seen = set()
    for report in reports:
        try:
            root = ET.parse(report).getroot()
            suites = [root] if root.tag == "testsuite" else list(root) if root.tag == "testsuites" else []
            if not suites:
                raise ValueError("Missing test suite")
            for suite in suites:
                cases = suite.findall("testcase")
                if suite.tag != "testsuite" or not cases or int(suite.get("tests", "-1")) != len(cases):
                    raise ValueError("Incomplete test suite")
                if any(int(suite.get(key, "0")) != 0 for key in ("failures", "errors", "skipped", "disabled")):
                    raise ValueError("Instrumentation failure or skip")
                for case in cases:
                    identity = (case.get("classname"), case.get("name"))
                    if (not all(identity) or identity in seen or case.find("failure") is not None
                            or case.find("error") is not None or case.find("skipped") is not None
                            or case.get("status") in ("notrun", "disabled", "skipped")):
                        raise ValueError("Invalid, duplicate, failed or skipped test")
                    seen.add(identity)
        except (OSError, ET.ParseError, ValueError) as error:
            raise ValueError("Storage instrumentation requires complete passing results with zero skips") from error
    if not REQUIRED_CLASSES.issubset({name for name, _ in seen}):
        raise ValueError("Storage instrumentation did not run every Keystore, pending-auth and Room suite")
    return len(seen)


def devices(output):
    lines = output.strip().splitlines()
    if not lines or lines[0].strip() != "List of devices attached":
        raise ValueError("Cannot establish isolated adb device inventory")
    result = {}
    for line in lines[1:]:
        parts = line.split()
        if not parts:
            continue
        if len(parts) < 2 or parts[0] in result:
            raise ValueError("Ambiguous adb device inventory")
        result[parts[0]] = parts[1]
    return result


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def emulator_port():
    for port in range(5554, 5682, 2):
        try:
            with socket.socket() as console, socket.socket() as transport:
                console.bind(("127.0.0.1", port)); transport.bind(("127.0.0.1", port + 1))
                return port
        except OSError:
            continue
    raise ValueError("No unused emulator console/adb port pair")


def stop_owned(process):
    # Each owned process starts a new session; no killall or unrelated adb server.
    if process is None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=10)


def run_instrumentation(sdk, owned):
    inspect_image(sdk)
    if not os.access("/dev/kvm", os.R_OK | os.W_OK):
        raise ValueError("The owned hosted emulator requires KVM")
    env = dict(os.environ)
    port, adb_port = emulator_port(), free_port()
    serial = f"emulator-{port}"
    env.update(ANDROID_AVD_HOME=str(owned / "avd"), ANDROID_USER_HOME=str(owned / "android"),
               ANDROID_EMULATOR_HOME=str(owned / "emulator"), ANDROID_ADB_SERVER_PORT=str(adb_port),
               ADB_SERVER_SOCKET=f"tcp:127.0.0.1:{adb_port}", ANDROID_SERIAL=serial)
    for key in ("ANDROID_AVD_HOME", "ANDROID_USER_HOME", "ANDROID_EMULATOR_HOME"):
        Path(env[key]).mkdir(mode=0o700)
    adb = str(sdk / "platform-tools/adb")
    adb_command = [adb, "-P", str(adb_port)]

    def query(*args):
        return subprocess.check_output([*adb_command, *args], env=env, text=True, timeout=15).strip()

    emulator = gradle = None
    server_started = False
    with (owned / "emulator.log").open("w") as log:
        try:
            server_started = True
            subprocess.run([*adb_command, "start-server"], env=env, check=True, timeout=30)
            if devices(query("devices")):
                raise ValueError("Private adb server must have no pre-existing device")
            subprocess.run([str(sdk / "cmdline-tools/latest/bin/avdmanager"), "create", "avd", "--name", "rogichat-storage",
                            "--package", IMAGE, "--path", str(owned / "device.avd")],
                           input="no\n", text=True, env=env, check=True, timeout=60)
            emulator = subprocess.Popen([str(sdk / "emulator/emulator"), "-avd", "rogichat-storage", "-port", str(port),
                                         "-no-window", "-no-audio", "-no-boot-anim", "-no-snapshot", "-wipe-data", "-accel", "on",
                                         "-gpu", "software", "-cores", "2", "-memory", "2048"],
                                        env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            deadline = time.monotonic() + BOOT_TIMEOUT
            while True:
                if emulator.poll() is not None:
                    raise RuntimeError("Owned emulator exited before boot")
                inventory = devices(query("devices"))
                if set(inventory) - {serial}:
                    raise ValueError("Unexpected device on private adb server")
                if inventory.get(serial) == "device" and query("-s", serial, "shell", "getprop", "sys.boot_completed") == "1":
                    break
                if time.monotonic() >= deadline:
                    raise TimeoutError("Owned emulator boot timed out")
                time.sleep(2)
            if query("-s", serial, "shell", "getprop", "ro.build.version.sdk") != "36":
                raise ValueError("Owned emulator API does not match its reviewed image")
            if devices(query("devices")) != {serial: "device"}:
                raise ValueError("Exactly the owned emulator must be available")
            results = ROOT / "apps/android/app/build/outputs/androidTest-results/connected"
            if results.exists():
                shutil.rmtree(results)  # Fixed generated result directory, never product data.
            gradle = subprocess.Popen([str(ROOT / "apps/android/gradlew"), ":app:connectedQaDebugAndroidTest", "--no-daemon",
                                       "--max-workers=2", f"-DANDROID_ADB_SERVER_PORT={adb_port}"],
                                      cwd=ROOT / "apps/android", env=env, start_new_session=True)
            code = gradle.wait(timeout=TEST_TIMEOUT)
            if code:
                raise RuntimeError(f"Storage instrumentation failed with exit code {code}")
            count = inspect_results(results)
            print(f"Owned API 36 revision 7 emulator: {count} storage tests passed, zero skips")
        except BaseException:
            log.flush()
            print((owned / "emulator.log").read_text(errors="replace")[-4000:], file=sys.stderr)
            raise
        finally:
            try:
                stop_owned(gradle)
            finally:
                try:
                    stop_owned(emulator)
                finally:
                    if server_started:
                        subprocess.run([*adb_command, "kill-server"], env=env, check=False, timeout=15)


def main():
    temporary, sdk = hosted_paths(os.environ)
    # SIGTERM (including Actions cancellation) still reaches owned cleanup.
    def interrupted(number, _frame):
        raise SystemExit(128 + number)
    previous = signal.signal(signal.SIGTERM, interrupted)
    try:
        with tempfile.TemporaryDirectory(prefix="rogichat-storage-", dir=temporary) as directory:
            run_instrumentation(sdk, Path(directory))
    finally:
        signal.signal(signal.SIGTERM, previous)


if __name__ == "__main__":
    main()
