import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('guard', Path(__file__).with_name('guard.py'))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


class PreservationTests(unittest.TestCase):
    def test_trend_requires_sustained_hour(self):
        gib = g.GIB
        self.assertFalse(g.trend([{'time': 0, 'free': 30*gib}], 0, 30*gib)['sustained'])
        points = [{'time': i*1800, 'free': (30-i)*gib} for i in range(3)]
        r = g.trend(points, 3600, 28*gib)
        self.assertEqual(r['bytes_per_hour'], 2*gib)
        self.assertEqual(r['estimated_20gib_epoch'], 18000)
        points.append({'time': 5400, 'free': 29*gib})
        mixed = g.trend(points, 5400, 29*gib)
        self.assertFalse(mixed['sustained'])
        self.assertAlmostEqual(mixed['observed_bytes_per_hour'], gib/1.5)

    def test_external_missing_mount_never_falls_back(self):
        with patch.object(Path, 'exists', return_value=True), patch.object(g.os.path, 'ismount', return_value=False), patch.object(g.shutil, 'disk_usage') as stat:
            self.assertFalse(g.disk('/Volumes/example')['mounted'])
            stat.assert_not_called()

    def test_unique_commit_and_untracked_are_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            def git(*args):
                return subprocess.check_output(['git', '-C', d, *args], stderr=subprocess.DEVNULL, text=True)
            git('init', '-b', 'task')
            git('config', 'user.email', 'test@example.invalid')
            git('config', 'user.name', 'Test')
            Path(d, 'tracked').write_text('base')
            git('add', 'tracked')
            git('commit', '-m', 'base')
            git('branch', 'preserved')
            Path(d, 'tracked').write_text('new')
            git('commit', '-am', 'unique')
            Path(d, 'draft').write_text('unsaved work')
            info = g.inspect_git(d)
            self.assertEqual(info['commits_not_in_other_refs'], 1)
            self.assertEqual(info['untracked_count'], 1)
            git('branch', 'saved-head')
            self.assertEqual(g.inspect_git(d)['commits_not_in_other_refs'], 0)
            self.assertEqual(Path(d, 'draft').read_text(), 'unsaved work')

    def test_symlink_artifact_never_traversed(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            Path(b, 'private.db').write_text('protected')
            Path(a, 'node_modules').symlink_to(b)
            rows, _ = g.artifacts(a)
            self.assertTrue(rows[0]['symlink'])
            self.assertEqual(rows[0]['bytes'], 0)
            self.assertEqual(Path(b, 'private.db').read_text(), 'protected')

    def test_rotates_only_own_log_bounded(self):
        with tempfile.TemporaryDirectory() as d:
            target = Path(d, 'capacity.jsonl')
            other = Path(d, 'conversation.jsonl')
            other.write_text('preserve')
            for i in range(8):
                target.write_text('x'*(1024*1024+1))
                g.append_log(target, {'i': i})
            self.assertLessEqual(len(list(Path(d).glob('capacity*'))), 4)
            self.assertEqual(other.read_text(), 'preserve')

    def test_inventory_failure_cannot_delete(self):
        with tempfile.TemporaryDirectory() as d, patch.object(g, 'orca', side_effect=RuntimeError('offline')):
            protected = Path(d, 'draft.txt')
            protected.write_text('retain')
            with self.assertRaises(RuntimeError):
                g.audit({}, Path(d))
            self.assertEqual(protected.read_text(), 'retain')

    def test_half_hour_tick_is_light_and_two_hour_review(self):
        with tempfile.TemporaryDirectory() as d:
            state = Path(d)
            g.atomic(state/'state.json', {'last_review': 10000})
            config = {'volumes': ['/'], 'notifications': False}
            with patch.object(g.time, 'time', return_value=11800), patch.object(g, 'run', return_value='swap'), patch.object(g, 'disk', return_value={'mounted': True, 'free': 30*g.GIB}), patch.object(g, 'audit') as audit:
                g.tick(config, state)
                audit.assert_not_called()
            with patch.object(g.time, 'time', return_value=17201), patch.object(g, 'run', return_value='swap'), patch.object(g, 'disk', return_value={'mounted': True, 'free': 30*g.GIB}), patch.object(g, 'audit', return_value={'worktrees': []}) as audit:
                g.tick(config, state)
                audit.assert_called_once()

    def test_boundary_match_not_sibling(self):
        self.assertTrue(g.within('/a/task/file', '/a/task'))
        self.assertFalse(g.within('/a/task-other/file', '/a/task'))


class CleanupTests(unittest.TestCase):
    @staticmethod
    def module():
        spec = importlib.util.spec_from_file_location('cleaner', Path(__file__).with_name('cleaner.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_completion_is_required_and_any_live_session_blocks(self):
        c = self.module()
        row = {'registered': True, 'git_registered': True, 'exists': True,
               'workspace_status': 'completed', 'runtime_status': 'inactive',
               'git': {'changes': [], 'commits_not_in_other_refs': 0}}
        self.assertTrue(c.eligible(row))
        for change in [{'workspace_status': 'in-progress'}, {'terminals': [{}]},
                       {'agent_states': ['done']}, {'processes': [['123']]},
                       {'git': {'changes': ['?? draft'], 'commits_not_in_other_refs': 0}},
                       {'git': {'changes': [], 'commits_not_in_other_refs': 1}},
                       {'registered': False}]:
            self.assertFalse(c.eligible(dict(row, **change)))

    def test_protected_content_blocks_even_inside_dependencies(self):
        c = self.module()
        with tempfile.TemporaryDirectory() as d:
            Path(d, '.env').write_text('protected')
            with self.assertRaises(RuntimeError):
                c.fingerprint(d)
            self.assertEqual(Path(d, '.env').read_text(), 'protected')

    def test_fingerprint_detects_mutation_and_preserves_links(self):
        c = self.module()
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'index.js').write_text('original')
            Path(d, 'link').symlink_to('index.js')
            before = c.fingerprint(d)
            self.assertEqual(before['link']['target'], 'index.js')
            Path(d, 'index.js').write_text('changed')
            self.assertNotEqual(before, c.fingerprint(d))

    def test_verified_copy_precedes_deletion_and_survives(self):
        self.run_cleanup_case(change_after_copy=False)

    def test_changed_state_after_copy_preserves_source(self):
        self.run_cleanup_case(change_after_copy=True)

    def test_final_state_change_restores_quarantined_directory(self):
        self.run_cleanup_case(change_after_copy=False, final_recheck=False)

    def test_unavailable_full_process_visibility_blocks(self):
        import types
        c = self.module()
        with tempfile.TemporaryDirectory() as d:
            path = Path(d).resolve()
            row = {'path': str(path), 'hostId': 'local', 'workspaceStatus': 'completed', 'status': 'inactive'}
            def query(config, *args):
                if args == ('worktree', 'ps'):
                    return {'worktrees': [row]}
                if args == ('terminal', 'list'):
                    return {'terminals': []}
                return {'worktree': row}
            api = types.SimpleNamespace(orca=query, git_worktrees=lambda p: [{'worktree': str(p)}],
                inspect_git=lambda p: {'changes': [], 'commits_not_in_other_refs': 0})
            with patch.object(c.subprocess, 'run', return_value=types.SimpleNamespace(returncode=1, stderr='authentication required')) as proc:
                with self.assertRaisesRegex(RuntimeError, 'visibility unavailable'):
                    c.fresh(api, {}, path)
                self.assertEqual(proc.call_args.args[0][:2], ['/usr/bin/sudo', '-n'])

    def test_unmounted_archive_is_rejected_before_any_write(self):
        c = self.module()
        with patch.object(Path, 'is_mount', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'not mounted'):
                c.mounted_archive({'archive_volume': '/Volumes/test', 'archive_dir': '/Volumes/test/recovery'})

    def run_cleanup_case(self, change_after_copy, final_recheck=True):
        import types
        c = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve()
            work = root/'work'
            target = work/'node_modules'
            target.mkdir(parents=True)
            (work/'package.json').write_text(json.dumps({'packageManager': 'pnpm@12.4.2'}))
            (work/'pnpm-lock.yaml').write_text('lockfileVersion: 9')
            (target/'.modules.yaml').write_text(json.dumps({'packageManager': 'pnpm@12.4.2', 'nodeLinker': 'isolated'}))
            (target/'index.js').write_text('original')
            snapshot = {'git': {'head': 'saved'}, 'instance': 'same'}
            api = types.SimpleNamespace(GIB=1, git=lambda *a: '', run=lambda *a: '12.4.2', atomic=g.atomic)
            archive = root/'archive'
            config = {'pnpm_command': ['pnpm'], 'archive_volume': str(root)}
            def fresh(*args):
                return dict(snapshot, instance='changed') if change_after_copy and archive.exists() else snapshot
            with patch.object(c, 'fresh', side_effect=fresh), patch.object(c, 'mounted_archive', return_value=archive), patch.object(c, 'fresh_after_rename', return_value=final_recheck), patch.object(c, 'separate_volume'):
                if change_after_copy or not final_recheck:
                    with self.assertRaises(RuntimeError):
                        c.clean_one(api, config, root, {'path': str(work), 'git': snapshot['git']})
                    self.assertEqual((target/'index.js').read_text(), 'original')
                else:
                    result = c.clean_one(api, config, root, {'path': str(work), 'git': snapshot['git']})
                    self.assertFalse(target.exists())
                    self.assertEqual((Path(result['backup'])/'index.js').read_text(), 'original')
                    self.assertTrue((Path(result['backup']).parent/'recovery.json').exists())

if __name__ == '__main__':
    unittest.main()
