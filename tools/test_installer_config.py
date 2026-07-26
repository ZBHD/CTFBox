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
    def test_release_version_is_0_1_3_and_consistent(self):
        expected = "0.1.3"
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

        import_step = workflow_step(workflow, "导入 Windows 代码签名证书")
        self.assertIn("WINDOWS_CERTIFICATE_BASE64", import_step)
        self.assertIn("WINDOWS_CERTIFICATE_PASSWORD", import_step)
        self.assertIn("Import-PfxCertificate", import_step)
        self.assertIn("Cert:\\CurrentUser\\My", import_step)
        self.assertIn("$signingCertificates.Count -ne 1", import_step)
        self.assertIn("$_.HasPrivateKey", import_step)

        build_step = workflow_step(workflow, "构建安装包")
        self.assertIn("certificateThumbprint", build_step)
        self.assertIn("digestAlgorithm", build_step)
        self.assertIn("timestampUrl", build_step)
        self.assertIn("tauri build --ci --config", build_step)

        verify_signature_step = workflow_step(workflow, "验证 Windows 代码签名")
        self.assertIn("Get-AuthenticodeSignature", verify_signature_step)
        self.assertIn("target/release/ctfbox.exe", verify_signature_step)
        self.assertIn("bundle/nsis", verify_signature_step)
        self.assertIn("SignerCertificate.Thumbprint", verify_signature_step)
        self.assertIn("TimeStamperCertificate", verify_signature_step)

        release_step = workflow_step(workflow, "发布到 GitHub Release")
        self.assertLess(workflow.index(import_step), workflow.index(build_step))
        self.assertLess(workflow.index(build_step), workflow.index(verify_signature_step))
        self.assertLess(workflow.index(verify_signature_step), workflow.index(release_step))
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
            "SHA256SUMS.txt",
            "TAURI_SIGNING_PRIVATE_KEY",
        ):
            self.assertNotIn(forbidden, workflow)
        self.assertNotIn(".sig", release_step)

        cleanup_step = workflow_step(workflow, "清理 Windows 代码签名证书")
        self.assertIn("if: always()", cleanup_step)
        self.assertIn("Remove-Item", cleanup_step)
        self.assertIn("Cert:\\CurrentUser\\My", cleanup_step)

    def test_release_runs_all_source_quality_gates_before_build(self):
        workflow = (ROOT / ".github" / "workflows" / "release.yml").read_text(
            encoding="utf-8"
        )

        rust_step = workflow_step(workflow, "Rust 质量检查")
        self.assertIn("cargo fmt", rust_step)
        self.assertIn("-- --check", rust_step)
        self.assertIn("cargo test", rust_step)

        python_step = workflow_step(workflow, "Python 与汉化质量检查")
        self.assertIn('python -m unittest discover -s tools -p "test_*.py"', python_step)
        self.assertIn("python tools/verify_localization.py", python_step)

        build_step = workflow_step(workflow, "构建安装包")
        for quality_step in (
            workflow_step(workflow, "前端质量检查"),
            rust_step,
            python_step,
        ):
            self.assertLess(workflow.index(quality_step), workflow.index(build_step))

    def test_nsis_defaults_to_program_files_and_creates_desktop_shortcut(self):
        config_path = ROOT / "gui" / "src-tauri" / "tauri.conf.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        self.assertEqual(config["bundle"]["targets"], ["nsis"])

        nsis = config["bundle"]["windows"]["nsis"]
        self.assertEqual(nsis["installMode"], "perMachine")
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

    def test_runner_assets_are_bundled_with_the_launcher(self):
        config = json.loads(
            (ROOT / "gui" / "src-tauri" / "tauri.conf.json").read_text(
                encoding="utf-8"
            )
        )
        resources = config["bundle"]["resources"]
        self.assertEqual(
            resources["../../tools/tool_registry.json"],
            "tools/tool_registry.json",
        )
        expected_runner_resources = {
            "../../tools/clients/webshell/webshell.py": (
                "tools/clients/webshell/webshell.py"
            ),
            "../../tools/clients/webshell/crypto": "tools/clients/webshell/crypto",
            "../../tools/clients/webshell/protocols": (
                "tools/clients/webshell/protocols"
            ),
            "../../tools/bin/windows": "tools/bin/windows",
        }
        for source, destination in expected_runner_resources.items():
            self.assertEqual(resources[source], destination)
        self.assertNotIn("../../tools/clients", resources)

    def test_windows_powershell_build_script_is_ascii_compatible(self):
        script = ROOT / "tools" / "prepare_python_runtime.ps1"
        content = script.read_bytes().decode("ascii")
        self.assertIn("Remove-PythonBytecodeCache", content)
        self.assertIn("& $python -B -c", content)
        self.assertIn('$runtimeSchemaVersion = "2"', content)
        self.assertIn("if ($null -eq $markerVersion)", content)
        self.assertIn('Original\\dirsearch\\requirements\\runtime.txt', content)
        self.assertIn('tool-packages\\dirsearch', content)

    def test_tauri_build_prepares_ignored_vendor_tools(self):
        config = json.loads(
            (ROOT / "gui" / "src-tauri" / "tauri.conf.json").read_text(
                encoding="utf-8"
            )
        )
        package = json.loads(
            (ROOT / "gui" / "package.json").read_text(encoding="utf-8")
        )

        self.assertIn("pnpm run prepare:vendor", config["build"]["beforeBuildCommand"])
        self.assertEqual(
            package["scripts"]["prepare:vendor"],
            "powershell -ExecutionPolicy Bypass -File ../tools/prepare_vendor_tools.ps1",
        )

    def test_vendor_tool_preparation_is_version_and_hash_pinned(self):
        script = ROOT / "tools" / "prepare_vendor_tools.ps1"
        content = script.read_bytes().decode("ascii")

        for version in (
            "467f66b107f5316f6da85ceb4bcfcddbea447ae4",
            "2.14.0",
            "3.11.0",
        ):
            self.assertIn(version, content)
        self.assertIn("Get-FileHash", content)
        self.assertIn("Hash mismatch", content)
        self.assertNotIn("/latest/", content)


if __name__ == "__main__":
    unittest.main()
