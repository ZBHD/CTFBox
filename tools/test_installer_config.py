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
    def test_release_version_is_0_1_2_and_consistent(self):
        expected = "0.1.2"
        tauri_config = json.loads(
            (ROOT / "gui" / "src-tauri" / "tauri.conf.json").read_text(
                encoding="utf-8"
            )
        )
        package = json.loads(
            (ROOT / "gui" / "package.json").read_text(encoding="utf-8")
        )
        cargo_manifest = (
            ROOT / "gui" / "src-tauri" / "Cargo.toml"
        ).read_text(encoding="utf-8")
        readme = (ROOT / "README.md").read_text(encoding="utf-8")

        cargo_version = re.search(
            r'(?m)^version = "(?P<version>\d+\.\d+\.\d+)"$',
            cargo_manifest,
        )
        self.assertIsNotNone(cargo_version)
        self.assertEqual(tauri_config["version"], expected)
        self.assertEqual(package["version"], expected)
        self.assertEqual(cargo_version.group("version"), expected)
        self.assertIn(f"当前版本为 `{expected}`。", readme)

    def test_setup_only_release_updater_is_configured(self):
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

        self.assertFalse(config["bundle"]["createUpdaterArtifacts"])
        self.assertNotIn("updater", config.get("plugins", {}))

        for permission in ("process:allow-restart", "opener:default"):
            self.assertIn(permission, capability["permissions"])
        self.assertNotIn("updater:default", capability["permissions"])

        build_step = workflow_step(workflow, "构建安装包")
        self.assertNotIn("TAURI_SIGNING_PRIVATE_KEY", build_step)
        self.assertNotIn("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", build_step)

        release_step = workflow_step(workflow, "发布到 GitHub Release")
        self.assertLess(workflow.index(build_step), workflow.index(release_step))
        self.assertIn("CTFBox-$version-windows-x64-setup.exe", release_step)
        self.assertIn("$release.assets.Count -ne 1", release_step)
        self.assertIn("$release.assets[0].digest", release_step)
        self.assertIn('$expectedDigest = "sha256:$localHash"', release_step)
        self.assertIn("gh release download $tag", release_step)
        self.assertIn("Get-FileHash -LiteralPath $downloadedAsset.FullName", release_step)
        self.assertLess(
            release_step.index("gh release download $tag"),
            release_step.index("gh release edit $tag"),
        )
        for forbidden in (
            "latest.json",
            ".nsis.zip",
            ".sig",
            "SHA256SUMS.txt",
            "TAURI_SIGNING_PRIVATE_KEY",
        ):
            self.assertNotIn(forbidden, workflow)

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
        self.assertIn("bundle/nsis", workflow)
        self.assertIn('-Filter "*-setup.exe"', workflow)
        self.assertNotIn("bundle/portable", workflow)

    def test_windows_powershell_build_script_is_ascii_compatible(self):
        script = ROOT / "tools" / "prepare_python_runtime.ps1"
        content = script.read_bytes().decode("ascii")
        self.assertIn("Remove-PythonBytecodeCache", content)
        self.assertIn("& $python -B -c", content)


if __name__ == "__main__":
    unittest.main()
