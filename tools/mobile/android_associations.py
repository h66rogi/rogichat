"""Verify the resolved callback filter in a packaged Android manifest."""
import re


def verify_callback_manifest(xmltree, environment):
    if environment not in ("qa", "prod"):
        raise ValueError("Unknown Android callback environment")
    # aapt2 xmltree is an indented tree, not XML. Preserve ownership so unrelated
    # metadata containing the same strings cannot satisfy the callback check.
    roots, stack = [], []
    for line in xmltree.splitlines():
        element = re.match(r"^(\s*)E: ([\w-]+)(?:\s|$)", line)
        if element:
            depth = len(element[1])
            while stack and stack[-1][0] >= depth:
                stack.pop()
            node = {"tag": element[2], "attributes": {}, "children": []}
            (stack[-1][1]["children"] if stack else roots).append(node)
            stack.append((depth, node))
            continue
        attribute = re.match(r'^\s*A: (?:http://schemas.android.com/apk/res/android:|android:)([\w-]+)(?:\([^)]*\))?=("[^"]*"|\S+)', line)
        if attribute and stack:
            name, value = attribute[1], attribute[2].strip('"')
            if name in stack[-1][1]["attributes"]:
                raise ValueError("Duplicate callback manifest attribute")
            stack[-1][1]["attributes"][name] = value
    filters = []

    def visit(node, parent=None, application=None):
        if node["tag"] == "application":
            application = node
        if node["tag"] == "intent-filter" and any(
                child["tag"] == "action" and child["attributes"].get("name") == "android.intent.action.VIEW"
                for child in node["children"]):
            filters.append((application, parent, node))
        for child in node["children"]:
            visit(child, node, application)

    for root in roots:
        visit(root)
    if len(filters) != 1:
        raise ValueError("Packaged app must have one verified native callback filter")
    application, activity, callback = filters[0]
    host = "qa.rogi.chat" if environment == "qa" else "rogi.chat"
    expected_children = sorted([
        ("action", {"name": "android.intent.action.VIEW"}),
        ("category", {"name": "android.intent.category.DEFAULT"}),
        ("category", {"name": "android.intent.category.BROWSABLE"}),
        ("data", {"scheme": "https", "host": host, "path": "/mobile/auth/complete"}),
    ], key=lambda item: (item[0], repr(sorted(item[1].items()))))
    children = [(child["tag"], child["attributes"]) for child in callback["children"]]
    children.sort(key=lambda item: (item[0], repr(sorted(item[1].items()))))
    if (not application or not activity or activity["tag"] != "activity"
            or activity["attributes"].get("name") not in (".MainActivity", "chat.rogi.rogichat.MainActivity")
            or activity["attributes"].get("exported") != "true"
            or any(node["attributes"].get("enabled", "true") != "true"
                   or node["attributes"].get("permission", "") for node in (application, activity))
            or callback["attributes"].get("autoVerify") != "true" or children != expected_children
            or any(child["children"] for child in callback["children"])):
        raise ValueError("Packaged native callback must be the exact environment HTTPS App Link")
