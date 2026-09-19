#!/usr/bin/env python3
"""Root-owned QA host helper. Deliver only runtime credentials into tmpfs."""
import json
import os
from pathlib import Path
import sys
import tempfile

import boto3

DIRECTORY = Path("/run/rogichat/secrets")
TARGET = DIRECTORY / "database.json"


def main():
    if os.geteuid() != 0:
        raise PermissionError("root required")
    value = boto3.client("secretsmanager", region_name="ap-northeast-2").get_secret_value(
        SecretId="rogichat/qa/database/runtime"
    )["SecretString"]
    data = json.loads(value)
    if (data.get("username") != "rogichat_app" or data.get("database") != "rogichatqa"
            or data.get("port") != 3306 or not isinstance(data.get("password"), str)
            or len(data["password"]) < 32
            or not data.get("host", "").endswith(".ap-northeast-2.rds.amazonaws.com")):
        raise ValueError("unexpected runtime credential")
    DIRECTORY.mkdir(mode=0o750, parents=True, exist_ok=True)
    os.chown(DIRECTORY, 0, 10001)
    os.chmod(DIRECTORY, 0o750)
    fd, path = tempfile.mkstemp(prefix=".database-", dir=DIRECTORY)
    try:
        with os.fdopen(fd, "w") as stream:
            os.fchmod(stream.fileno(), 0o440)
            os.fchown(stream.fileno(), 0, 10001)
            stream.write(json.dumps(data) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(path, TARGET)
    finally:
        if os.path.exists(path):
            os.unlink(path)
    print("QA runtime credential delivered to tmpfs.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Runtime credential delivery failed ({type(error).__name__}).", file=sys.stderr)
        sys.exit(1)
