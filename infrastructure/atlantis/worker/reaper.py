"""Terminate only expired canaries of the server-owned template. No event inputs."""
from datetime import datetime, timezone
import os

MAX_AGE_SECONDS = 20 * 60
TAGS = {"Project": "rogichat", "Environment": "management", "Component": "worker-canary"}


def expired(instance, template_id, now):
    tags = {item["Key"]: item["Value"] for item in instance.get("Tags", [])}
    if not all(tags.get(k) == v for k, v in TAGS.items()):
        return False
    # EC2 Instance responses have no LaunchTemplate object. AWS adds these
    # reserved, immutable tags when a launch template is used.
    if tags.get("aws:ec2launchtemplate:id") != template_id:
        return False
    launched = instance.get("LaunchTime")
    if not isinstance(launched, datetime) or launched.tzinfo is None:
        return False
    if instance.get("State", {}).get("Name") not in {"pending", "running", "stopping", "stopped"}:
        return False
    return (now - launched).total_seconds() >= MAX_AGE_SECONDS


def handler(_event, _context):
    import boto3 # Supplied by the pinned Lambda runtime; not needed for local tests.
    client = boto3.client("ec2", region_name="ap-northeast-2")
    template_id = os.environ["CANARY_LAUNCH_TEMPLATE_ID"]
    now = datetime.now(timezone.utc)
    count = 0
    filters = [{"Name": "tag:" + k, "Values": [v]} for k, v in TAGS.items()]
    filters.append({"Name": "instance-state-name", "Values": ["pending", "running", "stopping", "stopped"]})
    for page in client.get_paginator("describe_instances").paginate(Filters=filters):
        for reservation in page["Reservations"]:
            for instance in reservation["Instances"]:
                if expired(instance, template_id, now):
                    client.terminate_instances(InstanceIds=[instance["InstanceId"]])
                    count += 1
    # Fixed counters only. No event/request/instance details in the log or return.
    return {"terminated": count}
