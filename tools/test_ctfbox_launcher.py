import unittest
from pathlib import Path

from ctfbox_launcher import normalize_windows_path


class LauncherPathTests(unittest.TestCase):
    def test_removes_windows_extended_path_prefix(self):
        path = Path(r"\\?\D:\Projects\CTFBox\tools\ctfbox_launcher.py")
        self.assertEqual(
            str(normalize_windows_path(path)),
            r"D:\Projects\CTFBox\tools\ctfbox_launcher.py",
        )


if __name__ == "__main__":
    unittest.main()
