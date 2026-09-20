"""Private, durable finalization intent and nonblocking per-build exclusion."""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import tempfile

from release_common import external, sha256


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def private_text(path):
    path = external(path)
    if not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("Finalization input must be an external private file (mode 600)")
    return path.read_text()


def atomic_json(path, value):
    """A crash preserves either the old receipt or the complete new receipt."""
    path = external(path)
    fd, temporary = tempfile.mkstemp(prefix=".finalization-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


class Journal:
    def __init__(self, path, intent):
        self.path = path
        self.value = {"schema": 1, "intent": intent, "steps": {}}
        if path.exists():
            previous = json.loads(private_text(path))
            if (not isinstance(previous, dict) or type(previous.get("schema")) is not int
                    or previous["schema"] != 1 or previous.get("intent") != intent
                    or not isinstance(previous.get("steps"), dict)):
                raise ValueError("Finalization intent changed; preserve the journal and inspect privately")
            for step in previous["steps"].values():
                if not isinstance(step, dict) or step.get("state") not in ("checking", "attempted", "accepted", "verified"):
                    raise ValueError("Malformed finalization step; preserve the private journal")
            if "target" in previous and not isinstance(previous["target"], dict):
                raise ValueError("Malformed finalization target; preserve the private journal")
            self.value = previous
        else:
            atomic_json(self.path, self.value)

    def bind(self, target):
        if not isinstance(target, dict) or not target or any(not isinstance(item, str) or not item for item in target.values()):
            raise ValueError("Finalization target must contain exact nonempty resource identifiers")
        previous = self.value.get("target")
        if previous is not None and previous != target:
            raise ValueError("Remote release identity changed since finalization began")
        self.value["target"] = target
        atomic_json(self.path, self.value)

    def state(self, step):
        return self.value["steps"].get(step, {}).get("state")

    def record(self, step, state, **evidence):
        self.value["steps"][step] = {"state": state, "at": timestamp(), **evidence}
        atomic_json(self.path, self.value)


@contextmanager
def finalization_lock(cfg, manifest_path, value, inputs):
    directory = external(cfg["artifact_root"]) / value["platform"] / str(value["build_number"])
    if external(manifest_path) != directory / "release.json":
        raise ValueError("Use the canonical release.json under configured artifact_root/platform/build")
    if not directory.is_dir() or directory.stat().st_mode & 0o077:
        raise ValueError("Release directory must be private (mode 700)")
    lock = os.open(directory / "finalization.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        if os.fstat(lock).st_mode & 0o077:
            raise ValueError("Finalization lock must be private")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("This build is already being finalized by another local operator") from None
        intent = {"manifest_sha256": sha256(manifest_path), "platform": value["platform"],
                  "app_id": value["app_id"], "build_number": value["build_number"],
                  "version": value["version"], "commit": value["commit"], "inputs": inputs}
        yield Journal(directory / "finalization.json", intent)
    finally:
        os.close(lock)
