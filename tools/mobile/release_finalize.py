"""Explicit post-upload finalization. Never builds or uploads an application."""
import hashlib
import json
import re
import time
import urllib.parse

from release_common import AppStoreConnect, external, manifest, required
from release_android import verify_apk, verify_firebase_apk
from release_ios import inspect_archive, inspect_ipa
from release_journal import finalization_lock, private_text
from release_firebase import Firebase


class Pending(RuntimeError):
    """Remote state is not yet sufficient to claim tester availability."""


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def verified_manifest(path, platform):
    value = manifest(path, platform, uploading=True)
    if (value.get("source_dirty") is not False or not isinstance(value.get("commit"), str)
            or not re.fullmatch(r"[a-f0-9]{40}", value["commit"]) or type(value["build_number"]) is not int):
        raise ValueError("Finalization requires exact committed source provenance")
    return value


def approved_testers(path):
    emails = sorted(set(item.lower() for item in re.split(r"[\s,]+", private_text(path).strip()) if item))
    if not 1 <= len(emails) <= 999 or any(not re.fullmatch(r"[^\s@,]+@[^\s@,]+\.[^\s@,]+", item) for item in emails):
        raise ValueError("Provide 1..999 approved tester emails in the private tester file")
    return emails


def android(cfg, manifest_path, testers_file, *, client=None):
    value = verified_manifest(manifest_path, "android")
    required(cfg["firebase"], "app_id", "project_id")
    emails = approved_testers(testers_file)
    inputs = {"firebase_app_id": cfg["firebase"]["app_id"], "project_id": cfg["firebase"]["project_id"],
              "recipients_sha256": digest("\n".join(emails))}
    with finalization_lock(cfg, manifest_path, value, inputs) as journal:
        journal.record("verification", "checking")
        apk = external(value["artifacts"]["apk"]["path"])
        verify_apk(apk, value["build_number"], value["version"])
        verify_firebase_apk(apk, cfg)
        api = client or Firebase(cfg)
        matches = [item for item in api.collection(api.app + "/releases", "releases")
                   if item.get("buildVersion") == str(value["build_number"])
                   and item.get("displayVersion") == value["version"] + "-qa"]
        if len(matches) != 1 or not re.fullmatch(re.escape(api.app) + r"/releases/[^/]+", matches[0].get("name", "")):
            raise ValueError("Expected one exact uploaded QA Android version/build")
        release = matches[0]
        remote_hash = api.binary_sha256(release["binaryDownloadUri"], apk.stat().st_size)
        if remote_hash != value["artifacts"]["apk"]["sha256"]:
            raise ValueError("Remote APK checksum differs; distribution is blocked")
        journal.bind({"release": release["name"], "apk_sha256": remote_hash})
        state = journal.state("distribution")
        if state is None:
            journal.record("distribution", "attempted", recipient_count=len(emails))
            api.request(release["name"] + ":distribute", body={"testerEmails": emails})
            # Persist acknowledgement before a separate readback can fail.
            journal.record("distribution", "accepted", recipient_count=len(emails))
        elif state != "accepted":
            raise RuntimeError("Distribution outcome is uncertain; inspect Firebase manually. Never repeat this POST blindly")
        testers = api.collection(api.project + "/testers", "testers")
        registered = {urllib.parse.unquote(item.get("name", "").removeprefix(api.project + "/testers/")).lower()
                      for item in testers if item.get("name", "").startswith(api.project + "/testers/")}
        if not set(emails).issubset(registered):
            raise Pending("Distribution was acknowledged, but project tester registration readback is incomplete")
        journal.record("verification", "verified", remote_apk_sha256=remote_hash,
                       project_testers_registered=len(emails), distribution_acknowledged=True)
    print("Android: remote APK hash verified; distribution acknowledged; approved project testers registered. Receipt saved privately.")


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9-]+", value):
        raise ValueError("Invalid App Store Connect resource identifier")
    return value


def once(journal, step, ready, mutate):
    if ready():
        journal.record(step, "verified")
        return
    if journal.state(step) is None:
        journal.record(step, "attempted")
        mutate()
        journal.record(step, "accepted")
        if ready():
            journal.record(step, "verified")
            return
    raise Pending(f"TestFlight {step} readback is pending or changed; no repeated mutation was sent")


def ios_state(api, value, group_id):
    app = api.app()
    builds = [item for item in api.collection("builds", {"filter[app]": app, "filter[version]": str(value["build_number"]), "limit": "200"})
              if item.get("attributes", {}).get("version") == str(value["build_number"])]
    if not builds:
        raise Pending("Exact TestFlight build is not visible yet; no upload was attempted")
    if len(builds) != 1:
        raise ValueError("Ambiguous TestFlight build number")
    build = builds[0]
    build_id = identifier(build["id"])
    if api.request("builds/" + build_id + "/app")["data"]["id"] != app:
        raise ValueError("TestFlight build belongs to another application")
    version = api.request("builds/" + build_id + "/preReleaseVersion")["data"]["attributes"]
    if version.get("version") != value["version"] or version.get("platform") != "IOS":
        raise ValueError("TestFlight marketing version or platform differs from the local manifest")
    attributes = build["attributes"]
    if attributes.get("expired") is not False or attributes.get("processingState") in ("FAILED", "INVALID"):
        raise ValueError("TestFlight build expired or failed processing")
    if attributes.get("processingState") != "VALID":
        raise Pending("TestFlight processing is not VALID yet")
    group = api.request("betaGroups/" + group_id)["data"]
    if group.get("id") != group_id or group.get("attributes", {}).get("isInternalGroup") is not True:
        raise ValueError("Configured TestFlight group is not the exact internal group")
    if api.request("betaGroups/" + group_id + "/app")["data"]["id"] != app:
        raise ValueError("Configured TestFlight group belongs to another application")
    return app, build_id


def ios_verify(api, value, group_id, notes, journal):
    app, build_id = ios_state(api, value, group_id)
    journal.bind({"app": app, "build": build_id, "internal_group": group_id})
    testers = api.collection("betaGroups/" + group_id + "/betaTesters", {"limit": "200"})
    if not testers:
        raise ValueError("The approved internal group has no testers")

    def localization():
        matches = [item for item in api.collection("builds/" + build_id + "/betaBuildLocalizations", {"limit": "200"})
                   if item.get("attributes", {}).get("locale") == "ko"]
        if len(matches) > 1:
            raise ValueError("Ambiguous Korean TestFlight localization")
        return matches[0] if matches else None

    current = localization()

    def notes_ready():
        item = localization()
        return item is not None and item["attributes"].get("whatsNew") == notes

    def write_notes():
        if current:
            item_id = identifier(current["id"])
            api.request("betaBuildLocalizations/" + item_id, body={"data": {"type": "betaBuildLocalizations", "id": item_id,
                        "attributes": {"whatsNew": notes}}}, method="PATCH")
        else:
            api.request("betaBuildLocalizations", body={"data": {"type": "betaBuildLocalizations", "attributes": {"locale": "ko", "whatsNew": notes},
                        "relationships": {"build": {"data": {"type": "builds", "id": build_id}}}}}, method="POST")

    once(journal, "korean_notes", notes_ready, write_notes)

    def assigned():
        return any(item.get("id") == build_id for item in api.collection("betaGroups/" + group_id + "/builds", {"limit": "200"}))

    once(journal, "internal_group", assigned, lambda: api.request("betaGroups/" + group_id + "/relationships/builds",
         body={"data": [{"type": "builds", "id": build_id}]}, method="POST"))
    detail = api.request("builds/" + build_id + "/buildBetaDetail")["data"]["attributes"]
    if detail.get("internalBuildState") != "IN_BETA_TESTING":
        raise Pending("TestFlight internalBuildState is not IN_BETA_TESTING yet")
    journal.record("verification", "verified", processing_state="VALID", internal_build_state="IN_BETA_TESTING",
                   internal_group_tester_count=len(testers), korean_notes_sha256=digest(notes))


def ios(cfg, manifest_path, notes_file, wait_seconds=0, *, client=None, clock=time.monotonic, sleep=time.sleep):
    if type(wait_seconds) is not int or not 0 <= wait_seconds <= 600:
        raise ValueError("TestFlight wait must be 0..600 seconds")
    value = verified_manifest(manifest_path, "ios")
    required(cfg["ios"], "testflight_group_id")
    group_id = identifier(cfg["ios"]["testflight_group_id"])
    notes = private_text(notes_file).strip()
    if not notes or len(notes) > 4000:
        raise ValueError("Korean TestFlight notes must contain 1..4000 characters")
    if value.get("apple_validated") is not True or "ipa" not in value["artifacts"]:
        raise ValueError("Finalize only an Apple-validated IPA and archive")
    upload_record = private_text(external(manifest_path).parent / "testflight-upload-attempt.json")
    upload = json.loads(upload_record)
    if (not isinstance(upload, dict) or type(upload.get("build_number")) is not int
            or upload["build_number"] != value["build_number"] or upload.get("state") != "transport_completed"):
        raise ValueError("TestFlight finalization requires this build's completed local upload receipt; reconcile uncertain uploads without resending")
    # Older guarded uploads recorded only number/state. New receipts additionally
    # bind source/archive/IPA; never accept a partially present or mismatched binding.
    bindings = {"commit": value["commit"], "archive_sha256": value["archive_sha256"],
                "ipa_sha256": value["artifacts"]["ipa"]["sha256"]}
    if any(key in upload for key in bindings) and any(upload.get(key) != expected for key, expected in bindings.items()):
        raise ValueError("TestFlight upload receipt provenance differs from the verified artifact")
    inputs = {"internal_group": group_id, "locale": "ko", "notes_sha256": digest(notes),
              "upload_receipt_sha256": digest(upload_record)}
    with finalization_lock(cfg, manifest_path, value, inputs) as journal:
        journal.record("verification", "checking")
        inspect_archive(external(value["archive_path"]), value["build_number"], value["version"], cfg)
        inspect_ipa(external(value["artifacts"]["ipa"]["path"]), value["build_number"], value["version"], cfg)
        api = client or AppStoreConnect(cfg)
        deadline = clock() + wait_seconds
        while True:
            try:
                ios_verify(api, value, group_id, notes, journal)
                break
            except Pending:
                remaining = deadline - clock()
                if remaining <= 0:
                    raise
                sleep(min(15, remaining))
    print("iOS: exact QA build is VALID / IN_BETA_TESTING; Korean notes and internal group availability verified. Receipt saved privately.")
