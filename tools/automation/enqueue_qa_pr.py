#!/usr/bin/env python3
"""Enqueue a QA pull request without enabling repository-wide auto-merge."""

import argparse
import json
import re
import subprocess


QUERY = """query($number: Int!) {
  repository(owner: "h66rogi", name: "rogichat") {
    pullRequest(number: $number) {
      id
      url
      state
      isDraft
      baseRefName
      headRefOid
      mergeQueueEntry { id }
    }
  }
}"""

ENQUEUE = """mutation($id: ID!, $head: GitObjectID!) {
  enqueuePullRequest(input: {
    pullRequestId: $id,
    expectedHeadOid: $head,
    jump: false
  }) {
    mergeQueueEntry { id }
  }
}"""


def graphql(query, variables):
    command = ["gh", "api", "graphql", "-f", f"query={query}"]
    for key, value in variables.items():
        command.extend(["-F" if isinstance(value, int) else "-f", f"{key}={value}"])
    response = subprocess.run(command, capture_output=True, text=True, check=True)
    document = json.loads(response.stdout)
    if document.get("errors"):
        raise ValueError("GitHub rejected the merge queue request")
    return document["data"]


def enqueue_qa_pr(number, request=graphql):
    if number <= 0:
        raise ValueError("PR number must be positive")
    pull_request = request(QUERY, {"number": number})["repository"]["pullRequest"]
    if pull_request is None:
        raise ValueError(f"PR #{number} does not exist")
    if pull_request["baseRefName"] != "qa":
        raise ValueError("Only PRs targeting qa may enter this queue")
    if pull_request["state"] != "OPEN" or pull_request["isDraft"]:
        raise ValueError("PR must be open and ready for review")
    head = pull_request["headRefOid"]
    if not isinstance(head, str) or not re.fullmatch(r"[a-f0-9]{40}", head):
        raise ValueError("GitHub returned an invalid PR head")
    if pull_request["mergeQueueEntry"]:
        return pull_request["url"], pull_request["mergeQueueEntry"]["id"], False

    response = request(ENQUEUE, {"id": pull_request["id"], "head": head})
    entry = response["enqueuePullRequest"]["mergeQueueEntry"]
    if not entry or not entry.get("id"):
        raise ValueError("GitHub did not return a merge queue entry")
    return pull_request["url"], entry["id"], True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("number", type=int, help="QA pull request number")
    args = parser.parse_args()
    try:
        url, entry, added = enqueue_qa_pr(args.number)
    except subprocess.CalledProcessError as error:
        parser.exit(1, error.stderr or "GitHub request failed\n")
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        parser.exit(1, f"Cannot enqueue QA PR: {error}\n")
    print(f"{url}: {'enqueued' if added else 'already queued'} ({entry})")


if __name__ == "__main__":
    main()
