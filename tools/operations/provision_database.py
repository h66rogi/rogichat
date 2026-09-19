#!/usr/bin/env python3
"""Operator-only QA bootstrap. JSON credentials arrive on stdin, never argv/logs.

Run on the QA host over an independently authenticated encrypted connection.
Requires distro python3-pymysql and the AWS RDS CA bundle at the path below.
Not an application migration tool. Never invoke from repository-triggered CI.
"""
import json
import ssl
import sys

import pymysql

DATABASE = "rogichatqa"
ACCOUNTS = {"runtime": "rogichat_app", "migration": "rogichat_migrator"}
CA = "/etc/rogichat/rds-global-bundle.pem"


def connect(data, account):
    return pymysql.connect(
        host=data["host"], port=3306, user=account["username"],
        password=account["password"], database=DATABASE,
        ssl=ssl.create_default_context(cafile=CA), connect_timeout=10,
        read_timeout=15, write_timeout=15, autocommit=True,
    )


def denied(cursor, statement):
    try:
        cursor.execute(statement)
    except pymysql.err.OperationalError as error:
        if error.args[0] not in (1044, 1142, 1227):
            raise
    else:
        raise RuntimeError("privilege boundary failed")


def main():
    if sys.argv[1:] != ["--apply-qa-only"]:
        raise ValueError("explicit QA bootstrap flag required")
    data = json.load(sys.stdin)
    if data.get("database") != DATABASE or data["admin"]["username"] != "rogichat_admin":
        raise ValueError("unexpected target")
    if not (data["host"].startswith("rogichat-qa.cluster-")
            and data["host"].endswith(".ap-northeast-2.rds.amazonaws.com")):
        raise ValueError("unexpected region or host")
    for role, name in ACCOUNTS.items():
        if data[role]["username"] != name or len(data[role]["password"]) < 32:
            raise ValueError("invalid account input")
    admin = connect(data, data["admin"])
    created_probe = False
    created_migration_probe = False
    try:
        with admin.cursor() as c:
            c.execute("SELECT @@read_only, @@require_secure_transport")
            if c.fetchone() != (0, 1):
                raise RuntimeError("writer and TLS enforcement required")
            c.execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
            if not c.fetchone()[1]:
                raise RuntimeError("TLS required")
            for role, name in ACCOUNTS.items():
                # Do not rotate or take ownership of a pre-existing account.
                c.execute("SELECT COUNT(*) FROM mysql.user WHERE User = %s", (name,))
                if c.fetchone()[0]:
                    raise RuntimeError("account exists; use a separately reviewed rotation procedure")
            for role, name in ACCOUNTS.items():
                c.execute("CREATE USER %s@'%%' IDENTIFIED BY %s REQUIRE SSL", (name, data[role]["password"]))
                privileges = "SELECT, INSERT, UPDATE, DELETE"
                if role == "migration":
                    privileges += ", CREATE, ALTER, DROP, INDEX, REFERENCES"
                c.execute(f"GRANT {privileges} ON `{DATABASE}`.* TO %s@'%%'", (name,))
            c.execute("CREATE TABLE __infra_access_probe (id INT PRIMARY KEY, value INT NOT NULL)")
            created_probe = True
        with connect(data, data["runtime"]) as runtime:
            with runtime.cursor() as c:
                c.execute("INSERT INTO __infra_access_probe VALUES (1, 7)")
                c.execute("UPDATE __infra_access_probe SET value = 8 WHERE id = 1")
                c.execute("SELECT value FROM __infra_access_probe WHERE id = 1")
                if c.fetchone() != (8,):
                    raise RuntimeError("runtime CRUD failed")
                c.execute("DELETE FROM __infra_access_probe WHERE id = 1")
                denied(c, "CREATE TABLE __infra_forbidden (id INT)")
                denied(c, "SELECT User FROM mysql.user")
        with connect(data, data["migration"]) as migration:
            with migration.cursor() as c:
                c.execute("CREATE TABLE __infra_migration_probe (id INT PRIMARY KEY)")
                created_migration_probe = True
                c.execute("ALTER TABLE __infra_migration_probe ADD COLUMN value INT")
                c.execute("DROP TABLE __infra_migration_probe")
                created_migration_probe = False
                denied(c, "CREATE DATABASE __infra_forbidden")
                denied(c, "SELECT User FROM mysql.user")
        print(json.dumps({"runtime_crud": True, "runtime_ddl_denied": True,
                          "migration_ddl": True, "cross_database_denied": True,
                          "tls_ca_hostname_verified": True}))
    finally:
        with admin.cursor() as c:
            if created_probe:
                c.execute("DROP TABLE __infra_access_probe")
            if created_migration_probe:
                c.execute("DROP TABLE __infra_migration_probe")
        admin.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # DB exception strings can include query parameters or connection details.
        print(f"QA database bootstrap failed ({type(error).__name__}); inspect privately.", file=sys.stderr)
        sys.exit(1)
