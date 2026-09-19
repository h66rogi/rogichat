import copy
import hashlib
import hmac
import json
import unittest
from guard import Denied
from webhook import classify


class WebhookTests(unittest.TestCase):
    def setUp(self):
        self.secret = b'not-a-credential-unit-test-fixture'
        self.payload = {'installation': {'id': 123}, 'repository': {'full_name': 'h66rogi/rogichat-ops', 'private': True, 'fork': False},
                        'action': 'created', 'issue': {'number': 1, 'pull_request': {}},
                        'sender': {'login': 'operator', 'id': 5, 'type': 'User'},
                        'comment': {'body': 'rogichat status', 'user': {'id': 5}}}

    def check(self, payload, event='issue_comment', signature=None):
        body = json.dumps(payload).encode()
        signature = signature or 'sha256=' + hmac.new(self.secret, body, hashlib.sha256).hexdigest()
        return classify(body, signature, event, '12345678-1234-4234-8234-123456789abc', self.secret, 123)

    def test_only_exact_status_command_accepted(self):
        self.assertEqual(self.check(self.payload)[0], 'status')
        for command in ['atlantis plan', 'atlantis apply', 'rogichat status -- -target=x', 'rogichat status\natlantis apply']:
            value = copy.deepcopy(self.payload); value['comment']['body'] = command
            with self.subTest(command=command), self.assertRaises(Denied): self.check(value)

    def test_bad_hmac_installation_public_or_fork_rejected(self):
        with self.assertRaises(Denied): self.check(self.payload, signature='sha256=' + '0'*64)
        for section, key, value in [('repository','private',False), ('repository','fork',True),
                                    ('repository','full_name','h66rogi/rogichat'), ('installation','id',999),
                                    ('sender','id',6)]:
            payload=copy.deepcopy(self.payload);payload[section][key]=value
            with self.subTest(key=key), self.assertRaises(Denied): self.check(payload)

    def test_bot_and_normal_discussion_acknowledged_without_execution(self):
        payload=copy.deepcopy(self.payload);payload['sender']['type']='Bot'
        self.assertEqual(self.check(payload)[0],'ignore')
        payload=copy.deepcopy(self.payload);payload['comment']['body']='Review complete.'
        self.assertEqual(self.check(payload)[0],'ignore')

    def test_push_and_edited_comment_never_execute(self):
        self.assertEqual(self.check(self.payload, event='push')[0], 'ignore')
        payload=copy.deepcopy(self.payload);payload['action']='edited'
        self.assertEqual(self.check(payload)[0], 'ignore')

    def test_ping_does_not_execute_and_requires_signature(self):
        self.assertEqual(self.check({'hook': {'type': 'App'}},event='ping')[0], 'ignore')
        with self.assertRaises(Denied): self.check({'hook': {'type': 'Repository'}},event='ping')

if __name__ == '__main__': unittest.main()
