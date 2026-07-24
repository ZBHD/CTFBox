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

        build_step_match = re.search(
            r"(?ms)^      - name: 构建安装包\r?\n.*?"
            r"(?=^      - name: |\Z)",
            workflow,
        )
        self.assertIsNotNone(build_step_match, "build workflow step missing")
        build_step = build_step_match.group(0)
        self.assertRegex(
            build_step,
            re.compile(
                r"^        env:\r?\n"
                r"(?:^          [A-Za-z_][A-Za-z0-9_]*:[^\r\n]*\r?\n)*?"
                r"^          TAURI_SIGNING_PRIVATE_KEY: "
                r"\$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}\r?$",
                re.MULTILINE,
            ),
        )

        release_step_match = re.search(
            r"(?ms)^      - name: 发布到 GitHub Release\r?\n.*?"
            r"(?=^      - name: |\Z)",
            workflow,
        )
        self.assertIsNotNone(release_step_match, "release workflow step missing")
        release_step = release_step_match.group(0)
        release_command_match = re.search(
            r"(?m)^          gh release create\b[^\r\n]*$",
            release_step,
        )
        self.assertIsNotNone(release_command_match, "gh release create command missing")
        release_command = release_command_match.group(0)
        release_asset_arguments = re.split(
            r"\s--[A-Za-z]", release_command, maxsplit=1
        )[0]

        assignment_scope = release_step[: release_command_match.start()]
        updater_archive_match = re.search(
            r'(?m)^          (\$[A-Za-z_]\w*)\s*=\s*Get-Item\s+'
            r'"[^"\r\n]*/\*\.nsis\.zip"\s*$',
            assignment_scope,
        )
        self.assertIsNotNone(
            updater_archive_match, "updater archive assignment missing"
        )
        self.assertRegex(
            release_asset_arguments,
            re.compile(
                rf"(?<!\S){re.escape(updater_archive_match.group(1))}"
                r"\.FullName(?=\s|$)",
                re.IGNORECASE,
            ),
        )
        self.assertRegex(
            release_asset_arguments,
            r'(?<!\S)"latest\.json"(?=\s|$)',
        )

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
