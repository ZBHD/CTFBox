import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from ctfbox_launcher import (
    ROOT,
    TOOLS,
    load_tool_registry,
    normalize_windows_path,
    runtime_import_paths,
)


class LauncherPathTests(unittest.TestCase):
    def test_removes_windows_extended_path_prefix(self):
        path = Path(r"\\?\D:\Projects\CTFBox\tools\ctfbox_launcher.py")
        self.assertEqual(
            str(normalize_windows_path(path)),
            r"D:\Projects\CTFBox\tools\ctfbox_launcher.py",
        )

    def test_loads_runnable_tools_from_the_shared_registry(self):
        loaded = load_tool_registry(ROOT / "tools" / "tool_registry.json")

        # kind 为 "python" 的工具走版本目录分发。
        self.assertEqual(loaded["sqlmap"], ("python", "sqlmap-1.10", "sqlmap.py"))
        self.assertEqual(loaded["sstimap"], ("python", "SSTImap-master", "sstimap.py"))
        # 会话型工具（webshell）位于 tools/clients，无版本分支。
        self.assertEqual(loaded["webshell"], ("session", "webshell", "webshell.py"))
        # 二进制工具（subfinder/nuclei）由 Rust 直接 spawn，不进入启动器映射。
        self.assertNotIn("subfinder", loaded)
        self.assertNotIn("nuclei", loaded)
        self.assertEqual(TOOLS, loaded)

    def test_adds_only_the_current_tools_isolated_dependencies(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            edition_root = root / "Original" / "dirsearch"
            dependency_root = root / "python" / "tool-packages" / "dirsearch"
            dependency_root.mkdir(parents=True)

            self.assertEqual(
                runtime_import_paths(root, "dirsearch", edition_root),
                [edition_root, dependency_root],
            )
            self.assertEqual(
                runtime_import_paths(root, "sqlmap", edition_root),
                [edition_root],
            )


if __name__ == "__main__":
    unittest.main()
