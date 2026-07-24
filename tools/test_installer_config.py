import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class InstallerConfigTests(unittest.TestCase):
    def test_signed_latest_release_updater_is_configured(self):
        config = json.loads(
            (ROOT / "gui" / "src-tauri" / "tauri.conf.json").read_text(
                encoding="utf-8"
            )
        )
        capability = json.loads(
            (ROOT / "gui" / "src-tauri" / "capabilities" / "main.json").read_text(
                encoding="utf-8"
            )
        )
        workflow = (ROOT / ".github" / "workflows" / "release.yml").read_text(
            encoding="utf-8"
        )

        self.assertIs(config["bundle"]["createUpdaterArtifacts"], True)

        updater = config["plugins"]["updater"]
        self.assertEqual(
            updater["endpoints"],
            ["https://github.com/ZBHD/CTFBox/releases/latest/download/latest.json"],
        )
        self.assertEqual(updater["windows"]["installMode"], "quiet")
        self.assertTrue(updater["pubkey"].strip())

        for permission in (
            "updater:default",
            "process:allow-restart",
            "opener:default",
        ):
            self.assertIn(permission, capability["permissions"])

        def workflow_step(name):
            match = re.search(
                rf"(?ms)^      - name: {re.escape(name)}\s*$.*?"
                r"(?=^      - name: |\Z)",
                workflow,
            )
            self.assertIsNotNone(match, f"workflow step not found: {name}")
            return match.group(0)

        build_step = workflow_step("构建安装包")
        self.assertRegex(
            build_step,
            re.compile(
                r"^[ \t]+env:[ \t]*\r?$.*?"
                r"^[ \t]+TAURI_SIGNING_PRIVATE_KEY:[ \t]*"
                r"\$\{\{[ \t]*secrets\.TAURI_SIGNING_PRIVATE_KEY[ \t]*\}\}"
                r"[ \t]*\r?$",
                re.MULTILINE | re.DOTALL,
            ),
        )

        release_step = workflow_step("发布到 GitHub Release")
        release_command_match = re.search(
            r"(?m)^\s*gh\s+release\s+create\b.*(?:`\s*\r?\n\s+.*)*$",
            release_step,
        )
        self.assertIsNotNone(release_command_match, "gh release create command missing")
        release_command = release_command_match.group(0)
        release_asset_arguments = re.split(
            r"\s--[A-Za-z]", release_command, maxsplit=1
        )[0]

        def assert_release_asset(path_pattern):
            if re.search(path_pattern, release_asset_arguments, re.IGNORECASE):
                return

            assignment = re.search(
                rf"(?im)^\s*(\$[A-Za-z_]\w*)\s*=\s*(?:(Get-Item)\s+)?"
                rf"['\"][^'\"]*{path_pattern}[^'\"]*['\"]\s*$",
                release_step,
            )
            self.assertIsNotNone(
                assignment,
                f"release asset is not assigned from path: {path_pattern}",
            )
            reference_suffix = (
                r"\.FullName\b" if assignment.group(2) else r"(?![\w.])"
            )
            asset_reference = re.compile(
                rf"{re.escape(assignment.group(1))}{reference_suffix}",
                re.IGNORECASE,
            )
            self.assertRegex(release_asset_arguments, asset_reference)

        assert_release_asset(r"\*\.nsis\.zip")
        assert_release_asset(r"latest\.json")

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
