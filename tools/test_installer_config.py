import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class InstallerConfigTests(unittest.TestCase):
    def test_nsis_supports_custom_directory_and_creates_desktop_shortcut(self):
        config_path = ROOT / "gui" / "src-tauri" / "tauri.conf.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        self.assertEqual(config["bundle"]["targets"], ["nsis"])

        nsis = config["bundle"]["windows"]["nsis"]
        self.assertEqual(nsis["installMode"], "currentUser")
        self.assertEqual(nsis["installerHooks"], "nsis/installer-hooks.nsh")

        hook_path = config_path.parent / nsis["installerHooks"]
        hook = hook_path.read_text(encoding="utf-8")
        self.assertIn("!macro NSIS_HOOK_POSTINSTALL", hook)
        self.assertIn("Call CreateOrUpdateDesktopShortcut", hook)

    def test_release_only_publishes_setup_installer(self):
        workflow = (ROOT / ".github" / "workflows" / "release.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("bundle/nsis/*-setup.exe", workflow)
        self.assertNotIn("bundle/portable", workflow)

    def test_windows_powershell_build_script_is_ascii_compatible(self):
        script = ROOT / "tools" / "prepare_python_runtime.ps1"
        content = script.read_bytes().decode("ascii")
        self.assertIn("Remove-PythonBytecodeCache", content)
        self.assertIn("& $python -B -c", content)


if __name__ == "__main__":
    unittest.main()
