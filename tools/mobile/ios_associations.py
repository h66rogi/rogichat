"""Verify exact QA distribution identity and actual Apple/push/callback entitlements."""
import hashlib
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile

from prod_capabilities import TARGETS, check_config, validate as validate_capability_profile
from release_common import APP_ID, cli_environment

QA_PROFILE = TARGETS["qa"][1]
QA_DOMAINS = {"applinks:qa.rogi.chat", "webcredentials:qa.rogi.chat"}
DOMAIN_KEY = "com.apple.developer.associated-domains"


def require_qa_signing(cfg):
    check_config(cfg, "qa")
    ios = cfg.get("ios")
    if not isinstance(ios, dict):
        raise ValueError("QA signing configuration is missing")
    if (ios.get("provisioning_profile") != QA_PROFILE or not isinstance(ios.get("team_id"), str)
            or not re.fullmatch(r"[A-Z0-9]{10}", ios["team_id"])
            or not isinstance(ios.get("signing_certificate"), str)
            or not re.fullmatch(r"[0-9A-Fa-f]{40}", ios["signing_certificate"])):
        raise ValueError("QA release requires its exact v2 distribution profile, team and certificate")


def verify_binding(entitlements, profile, cfg, certificate, *, now=None):
    require_qa_signing(cfg)
    validate_capability_profile(profile, "qa", cfg, certificate, now=now)
    domains = entitlements.get(DOMAIN_KEY)
    if (not isinstance(domains, list) or len(domains) != 2
            or any(not isinstance(value, str) for value in domains) or set(domains) != QA_DOMAINS):
        raise ValueError("Signed QA app must contain only its exact HTTPS callback domains")
    team = cfg["ios"]["team_id"]
    if (entitlements.get("application-identifier") != team + "." + APP_ID
            or entitlements.get("com.apple.developer.team-identifier") != team
            or entitlements.get("get-task-allow") is not False
            or entitlements.get("com.apple.developer.applesignin") != ["Default"]
            or entitlements.get("aps-environment") != "production"):
        raise ValueError("Actual signed QA app must have distribution Apple and production push permissions")
    if hashlib.sha1(certificate).hexdigest().upper() != cfg["ios"]["signing_certificate"].upper():
        raise ValueError("Actual QA signing certificate differs from the pinned identity")


def _run(command, *, data=None, temporary_root=None):
    environment = cli_environment()
    if temporary_root is not None:
        environment["TMPDIR"] = str(temporary_root)
    try:
        result = subprocess.run(command, input=data, capture_output=True, env=environment, timeout=60)
    except subprocess.TimeoutExpired:
        raise ValueError("Signed capability inspection timed out") from None
    if result.returncode:
        raise ValueError("Cannot inspect signed native permissions")
    return result.stdout


def _plist(command, *, data=None, temporary_root=None):
    try:
        value = plistlib.loads(_run(command, data=data, temporary_root=temporary_root))
        if not isinstance(value, dict): raise ValueError()
        return value
    except (plistlib.InvalidFileException, ValueError, TypeError, OverflowError) as error:
        raise ValueError("Invalid signed native permissions") from error


def inspect_signed_callback(executable, profile_data, cfg, *, temporary_root=None):
    require_qa_signing(cfg)
    _run(["codesign", "--verify", "--strict", str(executable)], temporary_root=temporary_root)
    signed = _plist(["codesign", "-d", "--entitlements", ":-", str(executable)], temporary_root=temporary_root)
    profile = _plist(["security", "cms", "-D"], data=profile_data, temporary_root=temporary_root)
    with tempfile.TemporaryDirectory(prefix="rogichat-qa-certificate-", dir=temporary_root) as temporary:
        prefix = str(Path(temporary) / "signer")
        _run(["codesign", "-d", "--extract-certificates=" + prefix, str(executable)],
             temporary_root=temporary_root)
        certificate = Path(prefix + "0").read_bytes()
    verify_binding(signed, profile, cfg, certificate)
