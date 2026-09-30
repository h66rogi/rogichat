"""Explicit service identity for trusted local distribution, never personal OAuth."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time

from release_common import cli_environment, external, required


def credentials(cfg):
    target = cfg["firebase"]
    required(target, "credentials_file", "project_id")
    path = external(target["credentials_file"])
    if not path.is_file():
        raise ValueError("Firebase service account file is missing; complete the one-time administrator setup")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
        raise ValueError("Firebase credentials must be an operator-owned private file (mode 600)")
    value = json.loads(path.read_text())
    if (value.get("type") != "service_account" or value.get("project_id") != target["project_id"]
            or not re.fullmatch(r"[^@\s]+@" + re.escape(target["project_id"]) + r"\.iam\.gserviceaccount\.com", value.get("client_email", ""))
            or value.get("token_uri") != "https://oauth2.googleapis.com/token"
            or not value.get("private_key")):
        raise ValueError("Configure a dedicated service account for the exact Firebase project; personal OAuth is not accepted")
    return path


@contextmanager
def environment(cfg, directory):
    credential = credentials(cfg)
    directory = external(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Firebase CLI prioritizes a cached user over ADC. An empty, per-command
    # config home makes that precedence harmless without deleting user sessions.
    with tempfile.TemporaryDirectory(prefix="firebase-auth-", dir=directory) as config_home:
        env = cli_environment()
        for name in ("FIREBASE_TOKEN", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_AUTH_TOKEN", "CLOUDSDK_AUTH_ACCESS_TOKEN", "GOOGLE_AUTH_LOGGING_ENABLED"):
            env.pop(name, None)
        env.update(GOOGLE_APPLICATION_CREDENTIALS=str(credential), XDG_CONFIG_HOME=config_home,
                   GOOGLE_CLOUD_PROJECT=cfg["firebase"]["project_id"], CI="true")
        yield env


class AccessToken:
    def __init__(self, cfg, directory):
        self.cfg, self.directory = cfg, directory
        self.value, self.expires = None, 0

    def get(self):
        if self.value and time.time() + 120 < self.expires:
            return self.value
        binary = shutil.which("firebase")
        if not binary or not shutil.which("node"):
            raise ValueError("Install Firebase CLI and Node.js before distribution")
        with environment(self.cfg, self.directory) as env:
            result = subprocess.run(["node", str(Path(__file__).with_name("firebase_session.cjs")), str(Path(binary).resolve())],
                                    cwd=self.directory, env=env, capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise RuntimeError("Firebase service account authentication failed; verify configured credentials and IAM permissions")
        try:
            value = json.loads(result.stdout)
            token, expires = value["access_token"], value["expiry_date"] / 1000
            if not isinstance(token, str) or not token or expires <= time.time() + 120:
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise RuntimeError("Firebase service account returned no usable short-lived access token") from None
        self.value, self.expires = token, expires
        return token
