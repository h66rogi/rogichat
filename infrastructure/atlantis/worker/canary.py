#!/usr/bin/env python3
"""Trusted, fixed isolation probes. No checkout, Terraform, keys or input scripts."""
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import urllib.error
import urllib.request

REGION = "ap-northeast-2"
BASE = Path("/opt/rogichat-worker")
METADATA = "http://169.254.169.254/latest/"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

# Run in a separate transient unit, never as root. A successful TCP connection
# counts as exposed even if IMDS later returns an HTTP authentication error.
SANDBOX_PROBE = '''
import json, os, pathlib, socket
def blocked():
    try:
        with socket.create_connection(("169.254.169.254", 80), timeout=3):
            return False
    except OSError:
        return True
status = pathlib.Path("/proc/self/status").read_text().splitlines()
caps = next(line.split()[1] for line in status if line.startswith("CapEff:"))
print(json.dumps(dict(non_root=os.geteuid() != 0, metadata_blocked=blocked(),
    capabilities_empty=int(caps, 16) == 0,
    no_docker_socket=not pathlib.Path("/var/run/docker.sock").exists(),
    no_cloud_environment=not any(k in os.environ for k in
        ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
         "CLOUDFLARE_API_TOKEN", "GITHUB_TOKEN")))))
'''


def blocked_tcp(host, port):
    try:
        with socket.create_connection((host, port), timeout=3):
            return False
    except OSError:
        return True


def metadata_identity():
    token_request = urllib.request.Request(METADATA + "api/token", method="PUT",
        headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"})
    with OPENER.open(token_request, timeout=3) as response:
        token = response.read(4096).decode()
    request = urllib.request.Request(METADATA + "meta-data/instance-id",
        headers={"X-aws-ec2-metadata-token": token})
    with OPENER.open(request, timeout=3) as response:
        identity = response.read(128).decode()
    if not re.fullmatch(r"i-[a-f0-9]{17}", identity):
        raise RuntimeError("Invalid metadata identity")
    return identity


def aws(*args):
    return subprocess.run(["/usr/bin/aws", "--region", REGION,
        "--cli-connect-timeout", "5", "--cli-read-timeout", "10", *args],
        capture_output=True, timeout=30, env={
            "PATH": "/usr/bin:/bin", "HOME": "/root", "AWS_PAGER": "",
            "AWS_DEFAULT_REGION": REGION, "AWS_RETRY_MODE": "standard",
            "AWS_MAX_ATTEMPTS": "1", "AWS_EC2_METADATA_V1_DISABLED": "true"})


def is_access_denied(result):
    # A timeout, DNS failure or missing CLI is not proof of authorization denial.
    return result.returncode != 0 and b"(AccessDenied)" in result.stderr


def existing_artifact_read_denied(bucket, identity, empty):
    # A missing key can return AccessDenied when ListBucket is absent even if
    # GetObject is allowed. Prove the object exists before testing read denial.
    key = f"canary/{identity}.probe"
    created = aws("s3api", "put-object", "--bucket", bucket, "--key", key,
        "--body", str(empty), "--server-side-encryption", "AES256")
    if created.returncode:
        return False
    return is_access_denied(aws("s3api", "get-object", "--bucket", bucket,
        "--key", key, str(BASE / "denied-read")))


def sandbox_probe():
    properties = ["DynamicUser=yes", "NoNewPrivileges=yes", "PrivateDevices=yes",
        "PrivateTmp=yes", "ProtectSystem=strict", "ProtectHome=yes",
        "ProtectControlGroups=yes", "ProtectKernelTunables=yes",
        "ProtectKernelModules=yes", "RestrictNamespaces=yes", "RestrictSUIDSGID=yes",
        "CapabilityBoundingSet=", "IPAddressDeny=169.254.169.254/32",
        "IPAddressDeny=fd00:ec2::254/128", "MemoryMax=128M", "TasksMax=16",
        "RuntimeMaxSec=30s"]
    command = ["/usr/bin/systemd-run", "--unit=rogichat-worker-probe",
        "--quiet", "--wait", "--pipe", "--collect"]
    for prop in properties:
        command.extend(["--property", prop])
    result = subprocess.run(command + ["/usr/bin/python3", "-c", SANDBOX_PROBE],
        capture_output=True, timeout=40)
    expected = {"non_root", "metadata_blocked", "capabilities_empty",
                "no_docker_socket", "no_cloud_environment"}
    if result.returncode:
        raise RuntimeError("Sandbox probe failed")
    report = json.loads(result.stdout)
    if type(report) is not dict or set(report) != expected or any(type(v) is not bool for v in report.values()):
        raise RuntimeError("Invalid sandbox result")
    return report


def run():
    os.umask(0o077)
    config = json.loads((BASE / "config.json").read_text())
    identity = metadata_identity() # Root positive control for the IMDS probe.
    results = {"root_metadata_control": True}
    try:
        results.update(sandbox_probe())
        for label, host, port in [
            ("public_internet_blocked", "1.1.1.1", 443),
            ("management_network_blocked", config["management_private_ip"], 443),
            ("app_network_blocked", config["app_private_ip"], 443),
            ("management_ui_blocked", config["management_private_ip"], 4141),
        ]:
            results[label] = blocked_tcp(host, port)
        empty = BASE / "empty"
        empty.write_bytes(b"")
        results["outside_prefix_write_denied"] = is_access_denied(aws("s3api", "put-object",
            "--bucket", config["bucket"], "--key", f"denied/{identity}.json", "--body", str(empty)))
        results["artifact_read_denied"] = existing_artifact_read_denied(config["bucket"], identity, empty)
    except Exception:
        results["probe_execution"] = False
    # Fixed labels/booleans only. Root logs stay on the encrypted ephemeral disk.
    report = {"schema": 1, "checks": results, "passed": all(results.values())}
    path = BASE / "result.json"
    path.write_text(json.dumps(report, sort_keys=True) + "\n")
    uploaded = aws("s3api", "put-object", "--bucket", config["bucket"],
        "--key", f"canary/{identity}.json", "--body", str(path),
        "--server-side-encryption", "AES256", "--content-type", "application/json")
    if uploaded.returncode:
        raise RuntimeError("Diagnostic upload failed")


if __name__ == "__main__":
    try:
        run()
    except Exception:
        raise SystemExit("Isolation canary failed; private diagnostic unavailable.") from None
