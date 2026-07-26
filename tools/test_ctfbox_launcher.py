import unittest
from pathlib import Path

from ctfbox_launcher import ROOT, TOOLS, load_tool_registry, normalize_windows_path


class LauncherPathTests(unittest.TestCase):
    def test_removes_windows_extended_path_prefix(self):
        path = Path(r"\\?\D:\Projects\CTFBox\tools\ctfbox_launcher.py")
        self.assertEqual(
            str(normalize_windows_path(path)),
            r"D:\Projects\CTFBox\tools\ctfbox_launcher.py",
        )

    def test_loads_runnable_tools_from_the_shared_registry(self):
        loaded = load_tool_registry(ROOT / "tools" / "tool_registry.json")

        self.assertEqual(loaded["sqlmap"], ("sqlmap-1.10", "sqlmap.py"))
        self.assertEqual(loaded["sstimap"], ("SSTImap-master", "sstimap.py"))
        self.assertEqual(TOOLS, loaded)


if __name__ == "__main__":
    unittest.main()
