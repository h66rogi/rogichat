"""QA queue entry must never enqueue production or stale PR heads."""

import unittest

from enqueue_qa_pr import enqueue_qa_pr


HEAD = "a" * 40


def pull_request(**changes):
    value = {
        "id": "PR_fixture",
        "url": "https://github.com/h66rogi/rogichat/pull/42",
        "state": "OPEN",
        "isDraft": False,
        "baseRefName": "qa",
        "headRefOid": HEAD,
        "mergeQueueEntry": None,
    }
    value.update(changes)
    return value


class EnqueueQaPrTest(unittest.TestCase):
    def test_enqueues_exact_head_without_jumping(self):
        requests = []

        def request(query, variables):
            requests.append((query, variables))
            if len(requests) == 1:
                return {"repository": {"pullRequest": pull_request()}}
            return {"enqueuePullRequest": {"mergeQueueEntry": {"id": "MQE_fixture"}}}

        self.assertEqual(
            enqueue_qa_pr(42, request),
            ("https://github.com/h66rogi/rogichat/pull/42", "MQE_fixture", True),
        )
        self.assertEqual(requests[1][1], {"id": "PR_fixture", "head": HEAD})
        self.assertIn("expectedHeadOid: $head", requests[1][0])
        self.assertIn("jump: false", requests[1][0])

    def test_existing_entry_is_idempotent(self):
        requests = []

        def request(query, variables):
            requests.append((query, variables))
            return {"repository": {"pullRequest": pull_request(mergeQueueEntry={"id": "MQE_existing"})}}

        self.assertEqual(enqueue_qa_pr(42, request)[1:], ("MQE_existing", False))
        self.assertEqual(len(requests), 1)

    def test_main_and_draft_prs_are_refused_before_mutation(self):
        for disallowed in (pull_request(baseRefName="main"), pull_request(isDraft=True)):
            requests = []

            def request(query, variables):
                requests.append((query, variables))
                return {"repository": {"pullRequest": disallowed}}

            with self.assertRaises(ValueError):
                enqueue_qa_pr(42, request)
            self.assertEqual(len(requests), 1)


if __name__ == "__main__":
    unittest.main()
