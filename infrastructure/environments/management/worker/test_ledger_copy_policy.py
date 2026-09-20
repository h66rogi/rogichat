"""Offline subset evaluator over REAL mock-rendered Terraform policy JSON.

Usage: terraform test -json -verbose > /private/path/mock.jsonl
       python3 test_ledger_copy_policy.py /private/path/mock.jsonl
Not an AWS authorization simulator; unknown condition operators fail closed.
"""
import fnmatch
import json
import sys
import unittest


def values(x):
    return x if isinstance(x, list) else [x]


def matches(statement, action, resource, context):
    if not any(fnmatch.fnmatchcase(action, a) for a in values(statement['Action'])):
        return False
    if not any(fnmatch.fnmatchcase(resource, r) for r in values(statement['Resource'])):
        return False
    for op, pairs in statement.get('Condition', {}).items():
        for key, expected in pairs.items():
            actual = context.get(key)
            if op in {'StringEquals', 'ArnEquals'}:
                result = actual in values(expected)
            elif op in {'StringNotEquals', 'ArnNotEquals'}:
                result = actual not in values(expected)
            elif op == 'StringLike':
                result = actual is not None and any(fnmatch.fnmatchcase(actual, v) for v in values(expected))
            elif op == 'Null':
                result = (actual is None) == (expected == 'true')
            elif op == 'Bool':
                result = actual == expected
            else:
                raise AssertionError('Unsupported condition: ' + op)
            if not result:
                return False
    return True


class PolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(INPUT, encoding='utf-8') as stream:
            events = [json.loads(line) for line in stream]
        state = next(e['test_state'] for e in events if e.get('type') == 'test_state' and e.get('@testrun') == 'ledger_environment_boundaries')
        cls.resources = {r['address']: r['values'] for r in state['root_module']['resources']}
        cls.bucket = cls.resources['aws_s3_bucket.artifacts']['arn']
        cls.bucket_policy = json.loads(cls.resources['aws_s3_bucket_policy.artifacts']['policy'])

    def allowed(self, role, action, resource, **context):
        context = {'aws:SecureTransport': 'true', 'aws:PrincipalArn': self.resources[f'aws_iam_role.ledger_copy["{role}"]']['arn'], **context}
        identity = json.loads(self.resources[f'aws_iam_role_policy.ledger_copy["{role}"]']['policy'])
        statements = identity['Statement'] + self.bucket_policy['Statement']
        hit = [s['Effect'] for s in statements if matches(s, action, resource, context)]
        return 'Allow' in hit and 'Deny' not in hit

    def test_conditional_and_unconditional_writes(self):
        for env in ['qa', 'production']:
            key = self.bucket + f'/deletion-ledger-copy/{env}/records/fixture.json'
            for header, expected in [(None, False), ('*', True), ('etag', False), ('', False)]:
                with self.subTest(env=env, header=header):
                    self.assertEqual(self.allowed(env+'-writer', 's3:PutObject', key, **{'s3:if-none-match': header}), expected)
            self.assertFalse(self.allowed(env+'-writer', 's3:PutObject', key, **{'s3:if-none-match': '*', 's3:x-amz-copy-source': 'fixture/source'}))
            self.assertFalse(self.allowed(env+'-writer', 's3:PutObject', key, **{'s3:if-match': 'etag'}))
            self.assertFalse(self.allowed(env+'-writer', 's3:PutObject', key, **{'s3:ObjectCreationOperation': 'false'}))

    def test_cross_environment_and_diagnostic_access_denied(self):
        for env, other in [('qa', 'production'), ('production', 'qa')]:
            for kind in ['writer', 'verifier']:
                for prefix in [f'deletion-ledger-copy/{other}/', 'canary/']:
                    for action in ['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject']:
                        self.assertFalse(self.allowed(f'{env}-{kind}', action, self.bucket+'/'+prefix+'record', **{'s3:if-none-match': '*'}))

    def test_verifier_inventory_bounded_and_read_only(self):
        for env in ['qa', 'production']:
            role = env+'-verifier'
            for action in ['s3:ListBucket', 's3:ListBucketVersions']:
                for prefix, expected in [(f'deletion-ledger-copy/{env}/', True), (f'deletion-ledger-copy/{env}/records/', True), ('', False), ('deletion-ledger-copy/', False), (f'deletion-ledger-copy/{env}-other/', False)]:
                    self.assertEqual(self.allowed(role, action, self.bucket, **{'s3:prefix': prefix}), expected)
            key = self.bucket+f'/deletion-ledger-copy/{env}/records/id'
            self.assertTrue(self.allowed(role, 's3:GetObjectVersion', key))
            self.assertFalse(self.allowed(role, 's3:PutObject', key, **{'s3:if-none-match': '*'}))
            self.assertFalse(self.allowed(env+'-writer', 's3:ListBucket', self.bucket, **{'s3:prefix': f'deletion-ledger-copy/{env}/'}))

    def test_delete_admin_and_non_tls_denied(self):
        for env in ['qa', 'production']:
            for kind in ['writer', 'verifier']:
                role = f'{env}-{kind}'
                for action in ['s3:DeleteObject', 's3:DeleteObjectVersion', 's3:PutObjectAcl', 's3:PutObjectTagging', 's3:PutBucketPolicy', 's3:PutLifecycleConfiguration', 'iam:PassRole', 'sts:AssumeRole']:
                    for resource in [self.bucket, self.bucket+f'/deletion-ledger-copy/{env}/record']:
                        self.assertFalse(self.allowed(role, action, resource))
                self.assertFalse(self.allowed(role, 's3:GetObject', self.bucket+f'/deletion-ledger-copy/{env}/record', **{'aws:SecureTransport': 'false'}))


if __name__ == '__main__':
    INPUT = sys.argv.pop(1)
    unittest.main()
