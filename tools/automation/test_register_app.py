import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen
from urllib.parse import urlsplit


class RegistrationTests(unittest.TestCase):
    def test_complete_endpoint_cannot_claim_an_unregistered_app(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'credentials'
            process=subprocess.Popen([sys.executable,str(Path(__file__).with_name('register_app.py')),'--output-dir',str(target)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                url=process.stdout.readline().strip().removeprefix('Registration URL: ')
                self.assertTrue(url.startswith('http://127.0.0.1:'))
                parts=urlsplit(url)
                with self.assertRaises(HTTPError) as error:
                    urlopen(f'{parts.scheme}://{parts.netloc}/complete',timeout=3)
                self.assertEqual(error.exception.code,409)
                error.exception.close()
                self.assertIsNone(process.poll())
                self.assertEqual(list(target.iterdir()),[])
                self.assertEqual(target.stat().st_mode & 0o777,0o700)
            finally:
                process.terminate();process.communicate(timeout=5)

if __name__ == '__main__': unittest.main()
