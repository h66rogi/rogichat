#!/usr/bin/env python3
"""Operator QA restore drill; secret JSON on stdin, fixed synthetic table only."""
import datetime
import json
import ssl
import sys
import pymysql


def main():
    data = json.load(sys.stdin)
    mode = data["operation"]
    if mode not in ("write", "read", "cleanup") or data["database"] != "rogichatqa":
        raise ValueError("invalid QA drill operation")
    if len(data["marker"]) != 64 or any(c not in "0123456789abcdef" for c in data["marker"]):
        raise ValueError("invalid marker")
    expected_user = "rogichat_app" if mode == "read" else "rogichat_admin"
    if data["username"] != expected_user:
        raise ValueError("unexpected account")
    connection = pymysql.connect(host=data["host"], user=data["username"], password=data["password"],
        database="rogichatqa", ssl=ssl.create_default_context(cafile="/etc/rogichat/rds-global-bundle.pem"),
        connect_timeout=10, read_timeout=15, write_timeout=15, autocommit=True)
    with connection:
        with connection.cursor() as c:
            if mode == "write":
                c.execute("CREATE TABLE __infra_restore_probe (id INT PRIMARY KEY, marker CHAR(64) NOT NULL)")
                c.execute("INSERT INTO __infra_restore_probe VALUES (1, %s)", (data["marker"],))
                c.execute("SELECT UTC_TIMESTAMP(6)")
                committed = c.fetchone()[0].replace(tzinfo=datetime.timezone.utc).isoformat()
                print(json.dumps({"marker_written": True, "after_commit_utc": committed}))
            else:
                c.execute("SELECT id, marker FROM __infra_restore_probe")
                if c.fetchall() != ((1, data["marker"]),):
                    raise RuntimeError("unexpected probe contents; refusing cleanup")
                if mode == "cleanup":
                    c.execute("DROP TABLE __infra_restore_probe")
                print(json.dumps({"marker_matches": True, "cleaned": mode == "cleanup"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"QA restore probe failed ({type(error).__name__}).", file=sys.stderr)
        sys.exit(1)
