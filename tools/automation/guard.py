"""Server-owned authorization primitives. No repository code is executed here."""
from __future__ import annotations
import hashlib
import json
import re
import sqlite3
import time
import uuid
from pathlib import PurePosixPath

REPOSITORY = "h66rogi/rogichat-ops"
SOURCE = "h66rogi/rogichat"
ROOTS = {
    "aws_ec2": "infrastructure/environments/qa/aws-ec2",
    "cloudflare": "infrastructure/environments/qa/cloudflare",
}
SHA = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")


class Denied(ValueError):
    """Caller receives a fixed denial, never this exception's input data."""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def require(condition):
    if not condition:
        raise Denied("request rejected")


def valid_uuid(value):
    try:
        return str(uuid.UUID(value)) == value
    except (ValueError, TypeError, AttributeError):
        return False


def binding(request):
    """Bind approval to both repos, base/head, source, root, and operation."""
    fields = {"repository", "source_repository", "pr", "base_sha", "ops_sha",
              "source_sha", "project", "operation", "plan_sha256", "state_lineage",
              "state_serial", "provider_lock_sha256", "request_id"}
    require(type(request) is dict and set(request) == fields)
    require(request["repository"] == REPOSITORY and request["source_repository"] == SOURCE)
    require(type(request["pr"]) is int and request["pr"] > 0)
    require(all(type(request[k]) is str and SHA.fullmatch(request[k]) for k in ("base_sha", "ops_sha", "source_sha")))
    require(type(request["request_id"]) is str and valid_uuid(request["request_id"]))
    require(type(request["project"]) is str and type(request["operation"]) is str)
    require(request["project"] in ROOTS and request["operation"] in ("plan", "apply"))
    require(type(request["provider_lock_sha256"]) is str and DIGEST.fullmatch(request["provider_lock_sha256"]))
    require(type(request["state_serial"]) is int and request["state_serial"] >= 0)
    require(type(request["state_lineage"]) is str and valid_uuid(request["state_lineage"]))
    if request["operation"] == "apply":
        require(type(request["plan_sha256"]) is str and DIGEST.fullmatch(request["plan_sha256"]))
    else:
        require(request["plan_sha256"] is None)
    return hashlib.sha256(canonical(request)).hexdigest()


def validate_pr(pr, request, actor_permission):
    """Use fresh GitHub API responses, not webhook actor claims or mergeability."""
    require(actor_permission in ("admin", "maintain", "write"))
    require(pr["state"] == "open" and not pr["draft"])
    require(pr["base"]["repo"]["full_name"] == REPOSITORY)
    require(pr["head"]["repo"]["full_name"] == REPOSITORY and not pr["head"]["repo"]["fork"])
    require(pr["base"]["repo"]["private"] is True and pr["base"]["ref"] == "qa")
    require(pr["head"]["sha"] == request["ops_sha"] and pr["base"]["sha"] == request["base_sha"])
    require(pr["number"] == request["pr"])


def validate_source_manifest(manifest, source_sha):
    require(type(manifest) is dict and set(manifest) == {"repository", "commit", "roots", "runtime"})
    require(manifest.get("repository") == SOURCE and manifest.get("commit") == source_sha)
    require(manifest.get("roots") == ROOTS and manifest.get("runtime") == "infrastructure/runtime")


def safe_archive_members(members, limit=10000, bytes_limit=64 * 1024 * 1024):
    """Reject links/special files and path escapes before extracting any bytes."""
    require(len(members) <= limit)
    seen = {}
    total = 0
    for member in members:
        name = member.name
        path = PurePosixPath(name)
        require(name and "\\" not in name and "\x00" not in name and not path.is_absolute())
        require(path.parts and all(ord(c) >= 32 for c in name))
        require(all(p not in ("..", ".git") for p in path.parts))
        require(member.isfile() or member.isdir())
        require(not (member.mode & 0o6000))
        normalized = str(path)
        require(normalized not in seen)
        require(all(seen.get(str(parent)) != "file" for parent in path.parents))
        if member.isfile():
            require(not any(existing.startswith(normalized + "/") for existing in seen))
        seen[normalized] = "dir" if member.isdir() else "file"
        require(type(member.size) is int and member.size >= 0)
        total += member.size
    require(total <= bytes_limit)


class ApprovalStore:
    """Root-owned SQLite. Grant through authenticated operator SSH, never HTTP.

    Consumption is durable before worker launch; a crashed launch needs new approval.
    The job executor also holds a process-wide cloud operation lock.
    """
    def __init__(self, path, clock=time.time):
        self.clock = clock
        self.db = sqlite3.connect(path, timeout=10, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS approvals (digest TEXT PRIMARY KEY, expires INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, operator TEXT NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, received INTEGER NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS payloads (digest TEXT PRIMARY KEY, received INTEGER NOT NULL)")

    def grant(self, request, operator, ttl=600):
        require(type(ttl) is int and 0 < ttl <= 1800)
        require(type(operator) is str and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", operator))
        key = binding(request)
        # A consumed binding is never revived. A fresh server-generated request UUID
        # permits explicit reapproval after a failed launch even for an identical plan.
        self.db.execute("INSERT INTO approvals(digest,expires,operator) VALUES(?,?,?)",
                        (key, int(self.clock()) + ttl, operator))
        return key

    def consume(self, request):
        key = binding(request)
        self.db.execute("BEGIN IMMEDIATE")
        try:
            cursor = self.db.execute("UPDATE approvals SET consumed=1 WHERE digest=? AND consumed=0 AND expires>?", (key, int(self.clock())))
            require(cursor.rowcount == 1)
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        return key

    def accept_delivery(self, delivery, payload_digest):
        require(type(delivery) is str and valid_uuid(delivery))
        require(type(payload_digest) is str and DIGEST.fullmatch(payload_digest))
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute("INSERT INTO deliveries VALUES(?,?)", (delivery, int(self.clock())))
            self.db.execute("INSERT INTO payloads VALUES(?,?)", (payload_digest, int(self.clock())))
            self.db.execute("COMMIT")
        except sqlite3.IntegrityError as error:
            self.db.execute("ROLLBACK")
            raise Denied("replayed delivery") from error
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
