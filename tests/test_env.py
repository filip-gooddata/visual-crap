"""Check library-path restoration for external tools in frozen Linux builds."""
import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('visual_crap', Path(__file__).resolve().parents[1] / 'visual_crap.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ExternalEnvironmentTest(unittest.TestCase):
    def test_frozen_linux_restores_original(self):
        with patch.object(sys, 'platform', 'linux'), patch.object(sys, 'frozen', True, create=True), patch.dict(os.environ, {'LD_LIBRARY_PATH': '/bundle', 'LD_LIBRARY_PATH_ORIG': '/system'}, clear=True):
            self.assertEqual(module.external_environment()['LD_LIBRARY_PATH'], '/system')
            self.assertEqual(os.environ['LD_LIBRARY_PATH'], '/bundle')

    def test_frozen_linux_removes_injected_path_when_no_original(self):
        with patch.object(sys, 'platform', 'linux'), patch.object(sys, 'frozen', True, create=True), patch.dict(os.environ, {'LD_LIBRARY_PATH': '/bundle'}, clear=True):
            self.assertNotIn('LD_LIBRARY_PATH', module.external_environment())

    def test_source_run_preserves_path(self):
        with patch.object(sys, 'platform', 'linux'), patch.object(sys, 'frozen', False, create=True), patch.dict(os.environ, {'LD_LIBRARY_PATH': '/custom'}, clear=True):
            self.assertEqual(module.external_environment()['LD_LIBRARY_PATH'], '/custom')

if __name__ == '__main__':
    unittest.main()
