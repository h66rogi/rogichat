"""Verify native HTTPS callback permissions in the signed QA app, not project text."""
from datetime import datetime, timezone
import plistlib
import subprocess

from release_common import APP_ID

QA_DOMAINS = {"applinks:qa.rogi.chat", "webcredentials:qa.rogi.chat"}
DOMAIN_KEY = "com.apple.developer.associated-domains"


def verify_binding(entitlements, profile, *, distribution, now=None):
    """A development archive may use a wildcard profile; exported IPA may not."""
    domains = entitlements.get(DOMAIN_KEY)
    if (not isinstance(domains, list) or len(domains) != 2
            or any(not isinstance(value, str) for value in domains) or set(domains) != QA_DOMAINS):
        raise ValueError("Signed QA app must contain only its exact HTTPS callback domains")
    teams = profile.get("TeamIdentifier")
    prefixes = profile.get("ApplicationIdentifierPrefix")
    if (not isinstance(teams, list) or len(teams) != 1 or not isinstance(teams[0], str)
            or not isinstance(prefixes, list) or len(prefixes) != 1 or not isinstance(prefixes[0], str)):
        raise ValueError("Callback profile has ambiguous app/team binding")
    app_id = prefixes[0] + "." + APP_ID
    allowed = profile.get("Entitlements", {})
    if (entitlements.get("application-identifier") != app_id
            or entitlements.get("com.apple.developer.team-identifier") != teams[0]
            or allowed.get("com.apple.developer.team-identifier") != teams[0]
            or allowed.get("application-identifier") not in
            ({app_id} if distribution else {app_id, prefixes[0] + ".*"})):
        raise ValueError("Signed QA app and callback profile identity do not match")
    permitted = allowed.get(DOMAIN_KEY)
    if permitted not in ("*", ["*"]):
        if not isinstance(permitted, list) or not QA_DOMAINS.issubset(permitted):
            raise ValueError("Provisioning profile does not permit both native callback domains")
    if distribution and (entitlements.get("get-task-allow") is not False
                         or allowed.get("get-task-allow") is not False
                         or profile.get("ProvisionedDevices") or profile.get("ProvisionsAllDevices")):
        raise ValueError("QA TestFlight export requires a distribution profile")
    expiry = profile.get("ExpirationDate")
    if not isinstance(expiry, datetime):
        raise ValueError("Callback profile has no valid expiration")
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry <= (now or datetime.now(timezone.utc)):
        raise ValueError("Callback profile has expired")


def _plist(command, *, data=None):
    result = subprocess.run(command, input=data, capture_output=True)
    if result.returncode:
        raise ValueError("Cannot inspect signed native callback permissions")
    try:
        value = plistlib.loads(result.stdout)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (plistlib.InvalidFileException, ValueError, TypeError, OverflowError) as error:
        raise ValueError("Invalid signed native callback permissions") from error


def inspect_signed_callback(executable, profile_data, *, distribution):
    signed = _plist(["codesign", "-d", "--entitlements", ":-", str(executable)])
    profile = _plist(["security", "cms", "-D"], data=profile_data)
    verify_binding(signed, profile, distribution=distribution)
