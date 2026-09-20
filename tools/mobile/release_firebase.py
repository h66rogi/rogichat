"""Narrow post-upload Firebase REST adapter using the operator's CLI login."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request

from release_common import APP_ID, NoRedirect, cli_environment, external, required
from release_android import firebase_json


def download_url(url):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443)
            or parsed.fragment or not parsed.hostname
            or not any(parsed.hostname.endswith("." + domain) for domain in ("googleapis.com", "googleusercontent.com"))):
        raise ValueError("Unexpected Firebase binary download URL")
    return url


class BinaryRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return super().redirect_request(request, fp, code, msg, headers, download_url(newurl))


class Firebase:
    def __init__(self, cfg):
        target = cfg["firebase"]
        required(target, "project_id", "app_id")
        match = re.fullmatch(r"1:([0-9]+):android:[a-fA-F0-9]+", target["app_id"])
        if not match:
            raise ValueError("Expected an Android Firebase app identifier")
        directory = external(cfg["artifact_root"])
        apps = firebase_json(["apps:list", "ANDROID", "--project", target["project_id"]], directory)
        if len([app for app in apps if app.get("appId") == target["app_id"] and app.get("packageName") == APP_ID]) != 1:
            raise ValueError("Firebase target is not the Rogichat QA Android app")
        self.project = "projects/" + match[1]
        self.app = self.project + "/apps/" + target["app_id"]
        binary = shutil.which("firebase")
        if not binary or not shutil.which("node"):
            raise ValueError("Install the Firebase CLI and Node.js before finalization")
        result = subprocess.run(["node", str(Path(__file__).with_name("firebase_session.cjs")), str(Path(binary).resolve())],
                                cwd=directory, env=cli_environment(), capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise RuntimeError("Firebase authentication unavailable; check the local CLI login")
        self.token = json.loads(result.stdout)["access_token"]
        if not isinstance(self.token, str) or not self.token:
            raise RuntimeError("Firebase authentication returned no access token")

    def request(self, resource, params=None, body=None):
        if not resource.startswith(self.project + "/") or "?" in resource or ".." in resource.split("/"):
            raise ValueError("Firebase resource is outside the configured project")
        url = "https://firebaseappdistribution.googleapis.com/v1/" + resource
        if params:
            url += "?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                         headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
                if body is not None and resource.endswith(":distribute"):
                    # The documented success body is empty. A 2xx acknowledgement
                    # must survive unrelated response parsing/readback failures.
                    return {}
                data = response.read()
                return json.loads(data) if data else {}
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"Firebase finalization request failed: HTTP {error.code}") from None
        except urllib.error.URLError:
            raise RuntimeError("Firebase finalization transport failed; inspect the private journal before retrying") from None

    def collection(self, resource, key):
        values, tokens, token = [], set(), None
        for _ in range(100):
            params = {"pageSize": "100"}
            if token:
                params["pageToken"] = token
            page = self.request(resource, params)
            if not isinstance(page.get(key, []), list):
                raise ValueError("Expected a Firebase collection")
            values.extend(page.get(key, []))
            token = page.get("nextPageToken")
            if not token:
                return values
            if token in tokens:
                raise ValueError("Repeated Firebase pagination token")
            tokens.add(token)
        raise ValueError("Firebase pagination limit exceeded")

    def binary_sha256(self, url, expected_size):
        digest, size = hashlib.sha256(), 0
        try:
            # Signed URL only: the API bearer must never accompany this request.
            with urllib.request.build_opener(BinaryRedirect()).open(download_url(url), timeout=60) as response:
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > expected_size:
                        raise ValueError("Remote APK size exceeds the verified local artifact")
                    digest.update(chunk)
        except urllib.error.URLError:
            raise RuntimeError("Remote APK download failed; no signed URL was logged") from None
        if size != expected_size:
            raise ValueError("Remote APK size differs from the verified local artifact")
        return digest.hexdigest()
