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
        self.assertFalse(g.trend(points, 5400, 29*gib)['sustained'])

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


if __name__ == '__main__':
    unittest.main()
