import base64
import binascii
import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def workflow_step(workflow: str, name: str) -> str:
    match = re.search(
        rf"(?ms)^      - name: {re.escape(name)}\r?\n.*?(?=^      - name: |\Z)",
        workflow,
    )
    if match is None:
        raise AssertionError(f"workflow step missing: {name}")
    return match.group(0)


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

        self.assertRegex(
            workflow,
            r"(?m)^concurrency:\r?\n"
            r"^  group: windows-release-\$\{\{ github\.ref \}\}\r?\n"
            r"^  cancel-in-progress: false$",
        )

        self.assertEqual(
            config["bundle"]["createUpdaterArtifacts"], "v1Compatible"
        )

        updater = config["plugins"]["updater"]
        self.assertEqual(
            updater["endpoints"],
            ["https://github.com/ZBHD/CTFBox/releases/latest/download/latest.json"],
        )
        self.assertEqual(updater["windows"]["installMode"], "quiet")
        try:
            public_key_file = base64.b64decode(
                updater["pubkey"], validate=True
            ).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError) as error:
            self.fail(f"updater pubkey is not an outer-base64 minisign public key: {error}")
        public_key_lines = public_key_file.splitlines()
        self.assertEqual(len(public_key_lines), 2)
        self.assertRegex(
            public_key_lines[0],
            r"^untrusted comment: minisign public key: [0-9A-Fa-f]{16}$",
        )
        try:
            public_key_payload = base64.b64decode(
                public_key_lines[1], validate=True
            )
        except binascii.Error as error:
            self.fail(f"minisign public key payload is not base64: {error}")
        self.assertEqual(len(public_key_payload), 42)
        self.assertIn(public_key_payload[:2], (b"Ed", b"ED"))

        for permission in (
            "updater:default",
            "process:allow-restart",
            "opener:default",
        ):
            self.assertIn(permission, capability["permissions"])

        build_step = workflow_step(workflow, "构建安装包")
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
        self.assertRegex(
            build_step,
            re.compile(
                r"^        env:\r?\n"
                r"(?:^          [A-Za-z_][A-Za-z0-9_]*:[^\r\n]*\r?\n)*?"
                r"^          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "
                r"\$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD \}\}\r?$",
                re.MULTILINE,
            ),
        )

        verification_step = workflow_step(workflow, "验证更新签名")
        self.assertLess(workflow.index(build_step), workflow.index(verification_step))
        self.assertNotIn("TAURI_SIGNING_PRIVATE_KEY", verification_step)
        self.assertNotIn("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", verification_step)
        self.assertRegex(
            verification_step,
            r'(?m)^          \$signatureFile\s*=\s*"\$\(\$updater\.FullName\)\.sig"$',
        )
        self.assertRegex(
            verification_step,
            r"(?m)^          \$signatureAsset\s*=\s*Get-Item "
            r"-LiteralPath \$signatureFile -ErrorAction Stop$",
        )
        for path_env in (
            "CTFBOX_UPDATER_ARCHIVE",
            "CTFBOX_UPDATER_SIGNATURE",
            "CTFBOX_UPDATER_PUBLIC_KEY",
        ):
            self.assertRegex(
                verification_step,
                rf"(?m)^          \$env:{path_env}\s*=\s*",
            )
        self.assertRegex(
            verification_step,
            r"(?m)^\s{10}cargo test --locked --manifest-path "
            r'"gui/src-tauri/Cargo\.toml" --test updater_signature -- '
            r"--ignored --exact signed_updater_archive_matches_embedded_public_key "
            r"\| Tee-Object -Variable verificationOutput$",
        )
        self.assertRegex(
            verification_step,
            r"\(\$verificationOutput -join \"`n\"\) -notmatch "
            r"'test result: ok\\\. 1 passed; 0 failed; 0 ignored;'",
        )

        release_step = workflow_step(workflow, "发布到 GitHub Release")
        self.assertLess(workflow.index(verification_step), workflow.index(release_step))
        self.assertRegex(
            release_step,
            r'(?m)^          \$signatureFile\s*=\s*"\$\(\$updater\.FullName\)\.sig"$',
        )
        self.assertRegex(
            release_step,
            r"(?m)^          \$signatureAsset\s*=\s*Get-Item "
            r"-LiteralPath \$signatureFile$",
        )
        self.assertRegex(
            release_step,
            r"(?m)^          \$signature\s*=\s*\(Get-Content "
            r"-LiteralPath \$signatureFile -Raw\)\.Trim\(\)$",
        )
        self.assertIn(
            '$downloadUrl = "$repositoryUrl/releases/download/$tag/$($updater.Name)"',
            release_step,
        )
        self.assertRegex(
            release_step,
            r'(?m)^\s{16}signature\s*=\s*\$signature$',
        )
        self.assertRegex(
            release_step,
            r'(?m)^\s{16}url\s*=\s*\$downloadUrl$',
        )

        self.assertRegex(
            release_step,
            re.compile(
                r"if \(\$queryExitCode -eq 0\) \{.*?gh release upload\b.*?"
                r"\} else \{.*?gh release create\b",
                re.DOTALL,
            ),
        )
        expected_commands = {
            "upload": (
                'gh release upload $tag $asset.FullName "SHA256SUMS.txt" '
                '$updater.FullName $signatureAsset.FullName "latest.json" '
                '--repo $env:GITHUB_REPOSITORY --clobber'
            ),
            "create": (
                'gh release create $tag $asset.FullName "SHA256SUMS.txt" '
                '$updater.FullName $signatureAsset.FullName "latest.json" '
                '--repo $env:GITHUB_REPOSITORY --draft --title "CTFBox $tag" '
                '--generate-notes --verify-tag'
            ),
        }
        for command_name, expected_command in expected_commands.items():
            command_match = re.search(
                rf"(?m)^\s{{10,}}gh release {command_name}\b[^\r\n]*$",
                release_step,
            )
            self.assertIsNotNone(
                command_match, f"gh release {command_name} command missing"
            )
            self.assertEqual(command_match.group(0).strip(), expected_command)

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
