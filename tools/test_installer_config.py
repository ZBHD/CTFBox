import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class InstallerConfigTests(unittest.TestCase):
    def test_nsis_supports_custom_directory_and_creates_desktop_shortcut(self):
        config_path = ROOT / "gui" / "src-tauri" / "tauri.conf.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        nsis = config["bundle"]["windows"]["nsis"]

        self.assertEqual(nsis["installMode"], "currentUser")
        self.assertEqual(nsis["installerHooks"], "nsis/installer-hooks.nsh")

        hook_path = config_path.parent / nsis["installerHooks"]
        hook = hook_path.read_text(encoding="utf-8")
        self.assertIn("!macro NSIS_HOOK_POSTINSTALL", hook)
        self.assertIn("Call CreateOrUpdateDesktopShortcut", hook)


if __name__ == "__main__":
    unittest.main()
