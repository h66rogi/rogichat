"""Private Android Firebase input and packaged-resource guards; no live authentication."""
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import re
import stat
import xml.etree.ElementTree as ET

from release_common import cli_environment, external

PACKAGES = {"qa": "chat.rogi.rogichat.qa", "prod": "chat.rogi.rogichat"}
FIELDS = {"environment", "packageName", "applicationId", "apiKey", "projectId", "gcmSenderId"}
RESOURCES = {"rogi_firebase_application_id": "applicationId", "rogi_firebase_api_key": "apiKey",
             "rogi_firebase_project_id": "projectId", "rogi_firebase_sender_id": "gcmSenderId"}
APP_PATTERN = r"1:([0-9]+):android:[a-f0-9]+"
PROJECT_PATTERN = r"[a-z][a-z0-9-]{4,61}[a-z0-9]"


@dataclass(frozen=True, repr=False)
class FirebaseInput:
    path: Path
    values: dict = field(repr=False)


def _object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate Firebase configuration field")
        value[key] = item
    return value


def validate(value, environment, target):
    if (not isinstance(value, dict) or set(value) != FIELDS
            or any(not isinstance(item, str) or not item for item in value.values())):
        raise ValueError("Firebase configuration requires its exact string fields")
    app = re.fullmatch(APP_PATTERN, value["applicationId"])
    if (value["environment"] != environment or value["packageName"] != PACKAGES[environment]
            or app is None or app[1] != value["gcmSenderId"]
            or not re.fullmatch(PROJECT_PATTERN, value["projectId"])
            or not re.fullmatch(r"[A-Za-z0-9_-]{20,256}", value["apiKey"])):
        raise ValueError("Firebase configuration identity or format is invalid")
    if value["applicationId"] != target["app_id"] or value["projectId"] != target["project_id"]:
        raise ValueError("Firebase configuration differs from the approved release target")


def _path(value):
    if not isinstance(value, str) or not value:
        raise ValueError("Firebase configuration file is missing")
    path = Path(value)
    if not path.is_absolute() or str(path.resolve()) != value:
        raise ValueError("Firebase configuration requires a canonical absolute file")
    return external(path)


def load(cfg, environment, *, environ=None):
    if environment not in PACKAGES or cfg.get("environment", environment) != environment or cfg.get("app_id", PACKAGES[environment]) != PACKAGES[environment]:
        raise ValueError("Firebase release environment is invalid")
    target = cfg.get("firebase", {})
    if not isinstance(target, dict):
        raise ValueError("Invalid Firebase release target configuration")
    env = os.environ if environ is None else environ
    name = "ROGICHAT_" + environment.upper() + "_FIREBASE_CONFIG_FILE"
    # Only complete absence means push is unavailable. A present empty path or
    # malformed file is an operator error, never an implicit fallback.
    if name not in env and "config_file" not in target:
        return None
    if (not isinstance(target, dict) or not isinstance(target.get("app_id"), str)
            or not re.fullmatch(APP_PATTERN, target["app_id"])
            or not isinstance(target.get("project_id"), str)
            or not re.fullmatch(PROJECT_PATTERN, target["project_id"])):
        raise ValueError("Configure the approved Firebase app_id and project_id in the private release configuration")
    paths = [_path(value) for value in ([env[name]] if name in env else [])
             + ([target["config_file"]] if "config_file" in target else [])]
    if not paths or any(path != paths[0] for path in paths):
        raise ValueError("Firebase configuration file is missing or ambiguous")
    try:
        descriptor = os.open(paths[0], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600
                    or info.st_nlink != 1 or not 1 <= info.st_size <= 16384):
                raise ValueError("Firebase configuration must be a bounded regular mode 600 file")
            raw = stream.read(16385)
        if not 1 <= len(raw) <= 16384:
            raise ValueError("Invalid Firebase configuration size")
        text = raw.decode("utf-8", errors="strict")
        if "\\" in text:
            raise ValueError("Firebase configuration requires unescaped UTF-8 identifier strings")
        value = json.loads(text, object_pairs_hook=_object)
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise ValueError("Cannot read valid private Firebase configuration") from None
    validate(value, environment, target)
    return FirebaseInput(paths[0], value)


def build_environment():
    return {key: value for key, value in cli_environment().items()
            if key not in {"JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"}
            and not key.startswith(("ROGICHAT_QA_", "ROGICHAT_PROD_"))}


def state(settings):
    return "configured" if settings is not None else "unavailable"


def _values(settings, environment):
    environment = environment or (settings.values["environment"] if settings is not None else None)
    if environment not in PACKAGES:
        raise ValueError("Exact resource environment is required")
    if settings is None:
        return {"packageName": PACKAGES[environment], **{key: "" for key in RESOURCES.values()}}
    if settings.values["environment"] != environment or settings.values["packageName"] != PACKAGES[environment]:
        raise ValueError("Firebase resource environment mismatch")
    return settings.values


def verify_aab_dump(output, settings, name, *, environment=None):
    # Pinned bundletool 1.18.3 DumpManagerUtils/XmlProtoPrintUtils: one package,
    # one string entry, exactly its unqualified STR value. Never print output.
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    values = _values(settings, environment)
    if (len(lines) != 3 or lines[0] != "Package '" + values["packageName"] + "':"
            or re.fullmatch(r"0x[0-9a-f]{8} - string/" + re.escape(name), lines[1]) is None
            or lines[2] != '(default) - [STR] "' + values[RESOURCES[name]] + '"'):
        raise ValueError("AAB Firebase resource differs from the approved private configuration")


def verify_apk_dump(output, settings, *, environment=None):
    values = _values(settings, environment)
    observed = {}; package = None; resource = None
    for line in output.splitlines():
        header = re.fullmatch(r"\s*Package name=(\S+) id=\S+.*", line)
        entry = re.fullmatch(r"\s*resource 0x[0-9a-fA-F]+ string/([^\s]+).*", line)
        if header:
            package = header[1]; resource = None
        elif entry:
            resource = entry[1] if entry[1] in RESOURCES else None
            if resource:
                if package != values["packageName"] or resource in observed:
                    raise ValueError("Ambiguous APK Firebase resource")
                observed[resource] = []
        elif re.match(r"\s*(?:resource |type )", line):
            resource = None
        elif resource and line.strip():
            observed[resource].append(line.strip())
    if set(observed) != set(RESOURCES) or any(
            observed[name] != ['() "' + values[key] + '"'] for name, key in RESOURCES.items()):
        raise ValueError("APK Firebase resources differ from the approved private configuration")


def _verify_initialization(applications):
    if len(applications) != 1:
        raise ValueError("Firebase initialization requires one application")
    metadata = {}
    for child in applications[0]["children"]:
        attrs = child["attrs"]
        if child["tag"] == "provider" and attrs.get("name") == "com.google.firebase.provider.FirebaseInitProvider":
            raise ValueError("Firebase automatic provider initialization is forbidden")
        if child["tag"] == "meta-data":
            name = attrs.get("name")
            if name in metadata:
                raise ValueError("Duplicate application initialization metadata")
            metadata[name] = attrs.get("value")
    if any(metadata.get(name) != "false" for name in
           ("firebase_messaging_auto_init_enabled", "firebase_analytics_collection_enabled")):
        raise ValueError("Firebase messaging and analytics must default to disabled")


def verify_apk_initialization(tree):
    # Preserve application ownership, using the same aapt2 node grammar as the
    # callback guard. Metadata under a service/activity cannot satisfy this gate.
    stack = []; applications = []
    for line in tree.splitlines():
        element = re.match(r"^(\s*)E: ([\w-]+)(?:\s|$)", line)
        if element:
            depth = len(element[1])
            while stack and stack[-1][0] >= depth: stack.pop()
            node = {"tag": element[2], "attrs": {}, "children": []}
            if stack: stack[-1][1]["children"].append(node)
            if node["tag"] == "application": applications.append(node)
            stack.append((depth, node)); continue
        attribute = re.match(r'^\s*A: (?:http://schemas.android.com/apk/res/android:|android:)([\w-]+)(?:\([^)]*\))?=("[^"]*"|\S+)', line)
        if attribute and stack:
            if attribute[1] in stack[-1][1]["attrs"]: raise ValueError("Duplicate initialization attribute")
            stack[-1][1]["attrs"][attribute[1]] = attribute[2].strip('"')
    _verify_initialization(applications)


def verify_aab_initialization(xml):
    try: root = ET.fromstring(xml)
    except ET.ParseError: raise ValueError("Invalid Android initialization manifest") from None
    def node(element):
        return {"tag": element.tag,
                "attrs": {key.removeprefix("{http://schemas.android.com/apk/res/android}"): value
                          for key, value in element.attrib.items() if key.startswith("{http://schemas.android.com/apk/res/android}")},
                "children": [node(child) for child in element]}
    if root.tag != "manifest": raise ValueError("Invalid Android manifest")
    _verify_initialization([node(app) for app in root.findall("application")])


def inspect_apk(path, settings, aapt2, capture, *, environment=None):
    verify_apk_dump(capture([aapt2, "dump", "resources", str(path)]), settings, environment=environment)
    verify_apk_initialization(capture([aapt2, "dump", "xmltree", str(path), "--file", "AndroidManifest.xml"]))


def inspect_aab(path, settings, bundletool, capture, *, environment=None):
    for name in RESOURCES:
        verify_aab_dump(capture([*bundletool, "dump", "resources", "--bundle=" + str(path),
                                "--resource=string/" + name, "--values"]), settings, name, environment=environment)
    verify_aab_initialization(capture([*bundletool, "dump", "manifest", "--bundle=" + str(path)]))
