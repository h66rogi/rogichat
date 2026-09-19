import copy
import io
import sqlite3
import tarfile
import tempfile
import unittest
from pathlib import Path
from guard import ApprovalStore, Denied, ROOTS, binding, safe_archive_members, validate_pr, validate_source_manifest


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.request = dict(repository="h66rogi/rogichat-ops", source_repository="h66rogi/rogichat", pr=7,
            base_sha="a"*40, ops_sha="b"*40, source_sha="c"*40, project="aws_ec2", operation="apply",
            plan_sha256="d"*64, state_lineage="12345678-1234-1234-1234-123456789abc", state_serial=4,
            provider_lock_sha256="e"*64, request_id="12345678-1234-4234-8234-123456789abc")
        self.tmp = tempfile.TemporaryDirectory()
        self.now = 100
        self.store = ApprovalStore(str(Path(self.tmp.name)/"approvals.db"), lambda:self.now)
        self.addCleanup(self.store.db.close)
        self.addCleanup(self.tmp.cleanup)

    def test_consumed_approval_is_not_reusable_even_after_restart(self):
        self.store.grant(self.request, "operator")
        self.store.consume(self.request)
        second = ApprovalStore(str(Path(self.tmp.name)/"approvals.db"), lambda:self.now)
        self.addCleanup(second.db.close)
        with self.assertRaises(Denied): second.consume(self.request)
        with self.assertRaises(sqlite3.IntegrityError): self.store.grant(self.request, "operator")

    def test_changed_head_base_plan_state_or_lock_invalidates_approval(self):
        self.store.grant(self.request, "operator")
        for field,value in [("ops_sha","f"*40),("base_sha","f"*40),("source_sha","f"*40),
                            ("plan_sha256","f"*64),("state_serial",5),("provider_lock_sha256","f"*64)]:
            changed={**self.request,field:value}
            with self.subTest(field=field), self.assertRaises(Denied): self.store.consume(changed)
        self.store.consume(self.request)

    def test_expired_approval_fails_closed(self):
        self.store.grant(self.request,"operator",ttl=2)
        self.now=102
        with self.assertRaises(Denied): self.store.consume(self.request)

    def test_unknown_fields_roots_and_repos_rejected(self):
        for changed in [{**self.request,"args":"-target=x"},{**self.request,"project":"prod"},
                        {**self.request,"repository":"h66rogi/rogichat"},{**self.request,"pr":True}]:
            with self.assertRaises(Denied): binding(changed)

    def test_manifest_cannot_select_arbitrary_root(self):
        valid=dict(repository="h66rogi/rogichat",commit="c"*40,roots=ROOTS,runtime="infrastructure/runtime")
        validate_source_manifest(valid,"c"*40)
        with self.assertRaises(Denied): validate_source_manifest({**valid,"roots":{"aws_ec2":"../../prod"}},"c"*40)

    def test_fork_private_visibility_and_actor_revocation(self):
        repo=dict(full_name="h66rogi/rogichat-ops",private=True,fork=False)
        pr=dict(number=7,state="open",draft=False,base=dict(repo=repo,ref="qa",sha="a"*40),head=dict(repo=repo,sha="b"*40))
        validate_pr(pr,self.request,"admin")
        for mutate in [lambda p:p['head'].update(repo={**repo,"full_name":"attacker/fork"}),
                       lambda p:p['base'].update(ref="main"),lambda p:p['base'].update(repo={**repo,"private":False})]:
            changed=copy.deepcopy(pr);mutate(changed)
            with self.assertRaises(Denied): validate_pr(changed,self.request,"admin")
        with self.assertRaises(Denied): validate_pr(pr,self.request,"read")

    def test_delivery_replay_is_durable(self):
        delivery="12345678-1234-1234-1234-123456789abc"
        self.store.accept_delivery(delivery, "a"*64)
        with self.assertRaises(Denied): self.store.accept_delivery(delivery, "a"*64)

    def test_replay_with_changed_unsigned_delivery_header_rejected(self):
        self.store.accept_delivery("12345678-1234-4234-8234-123456789abc", "a"*64)
        with self.assertRaises(Denied):
            self.store.accept_delivery("12345678-1234-4234-8234-123456789abd", "a"*64)
        self.store.accept_delivery("12345678-1234-4234-8234-123456789abd", "b"*64)

    def test_archive_rejects_symlinks_traversal_devices_and_duplicates(self):
        good=tarfile.TarInfo("source/main.tf");good.size=4
        safe_archive_members([good])
        for name,kind in [("../../escape",tarfile.REGTYPE),("/escape",tarfile.REGTYPE),("source/link",tarfile.SYMTYPE),
                          ("source/device",tarfile.CHRTYPE),("source/.git/config",tarfile.REGTYPE)]:
            bad=tarfile.TarInfo(name);bad.type=kind
            with self.subTest(name=name), self.assertRaises(Denied): safe_archive_members([bad])
        with self.assertRaises(Denied): safe_archive_members([good,good])
        with self.assertRaises(Denied): safe_archive_members([good],bytes_limit=3)

    def test_archive_aliases_and_parent_file_collisions_rejected(self):
        for names in [("a", "./a"), ("a", "a/b"), ("a/b", "a"), ("x//a", "x/a")]:
            with self.subTest(names=names), self.assertRaises(Denied):
                safe_archive_members([tarfile.TarInfo(n) for n in names])

    def test_fresh_request_needs_new_approval(self):
        self.store.grant(self.request, "operator")
        changed = {**self.request, "request_id": "12345678-1234-4234-8234-123456789abd"}
        with self.assertRaises(Denied): self.store.consume(changed)
        self.store.consume(self.request)
        self.store.grant(changed, "operator")
        self.store.consume(changed)

    def test_simultaneous_consumption_has_one_winner(self):
        from concurrent.futures import ThreadPoolExecutor
        self.store.grant(self.request, "operator")
        path = str(Path(self.tmp.name)/"approvals.db")
        def consume(_):
            store = ApprovalStore(path, lambda:100)
            try:
                store.consume(self.request)
                return True
            except Denied:
                return False
            finally:
                store.db.close()
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(sum(pool.map(consume, range(4))), 1)

if __name__ == "__main__": unittest.main()
