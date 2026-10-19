import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('upstream_review', Path(__file__).with_name('upstream_review.py'))
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)

class UpstreamReviewTests(unittest.TestCase):
    def test_firebase_and_mixed_files_are_not_auto_adopted(self):
        self.assertIn('略過', review.category('firestore.rules'))
        self.assertIn('拆分', review.category('js/core/db.js'))
        self.assertIn('重建', review.category('js/app.min.js'))
        self.assertIn('不可自動採用', review.category('js/entities/enemy.js'))

    def test_invalid_paths_and_refs_fail(self):
        for name in ['../secret', '/secret', 'C:/secret', 'js\\secret']:
            with self.assertRaises(RuntimeError): review.safe_path(name)
        with self.assertRaises(ValueError): review.collect(Path('.'), Path('.'), '--help', 'a'*40)

    def test_offline_three_way_comparison_preserves_checkout(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            def git(*args): return review.git(repo, *args).strip()
            git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid')
            (repo/'js').mkdir();source=repo/'js/game.js';source.write_text('old\n',encoding='utf-8')
            git('add','.');git('commit','-m','fixture baseline');base=git('rev-parse','HEAD')
            source.write_text('new\n',encoding='utf-8');git('add','.');git('commit','-m','fixture update');head=git('rev-parse','HEAD')
            before=git('status','--porcelain');data=review.collect(repo,repo,base,head)
            self.assertEqual(data['files'][0]['comparison'],'與原作最新一致')
            self.assertEqual(len(data['commits']),1)
            source.write_text('old\n',encoding='utf-8');data=review.collect(repo,repo,base,head)
            self.assertEqual(data['files'][0]['comparison'],'目前仍與原作基準一致')
            source.write_text('fork\n',encoding='utf-8');status=git('status','--porcelain');data=review.collect(repo,repo,base,head)
            self.assertIn('三方',data['files'][0]['comparison'])
            self.assertEqual(git('status','--porcelain'),status);self.assertEqual(git('rev-parse','HEAD'),head)
            empty=review.collect(repo,repo,head,head)
            self.assertFalse(empty['commits']);self.assertIn('沒有新提交',review.render(empty))

    def test_markdown_table_escapes_delimiters(self):
        data={'base':'a'*40,'head':'b'*40,'localHead':'c'*40,'commits':[],
              'files':[{'path':'a|b','category':'c','comparison':'d'}]}
        self.assertIn('a\\|b',review.render(data))

if __name__ == '__main__': unittest.main()
