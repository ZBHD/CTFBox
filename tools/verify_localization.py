#!/usr/bin/env python3
"""验证 CTFBox 原版隔离、中文副本、启动入口和基础汉化覆盖。"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = ROOT / "Original"
CN = ROOT / "CNversion"
BASELINE = ROOT / "docs" / "localization" / "original-baseline.sha256"
ALLOWED_ORIGINAL_ADDITIONS = {
    "sqlmap-1.10/使用说明.md",
    "SSTImap-master/使用说明.md",
}
PLACEHOLDER_RE = re.compile(
    r"%(?:\([A-Za-z_][A-Za-z0-9_]*\))?[#0 +\-]?(?:\d+|\*)?(?:\.\d+)?[diouxXeEfFgGcrsa%]"
    r"|\{(?:[A-Za-z_][A-Za-z0-9_]*|\d+)(?:![rsa])?(?::[^{}]+)?\}"
)
TEXT_EXTENSIONS = {
    ".conf",
    ".html",
    ".json",
    ".md",
    ".md5",
    ".pl",
    ".py",
    ".sh",
    ".sql",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}
TEXT_FILENAMES = {".gitattributes", ".gitignore", "COMMITMENT", "LICENSE"}


class CheckResults:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def check(self, condition: bool, message: str) -> None:
        marker = "通过" if condition else "失败"
        print(f"[{marker}] {message}")
        if not condition:
            self.failures.append(message)


def sha256(path: Path) -> str:
    content = path.read_bytes()
    is_text = (
        b"\0" not in content
        and (path.suffix.lower() in TEXT_EXTENSIONS or path.name in TEXT_FILENAMES)
    )
    if is_text:
        content = content.replace(b"\r\n", b"\n")
    return hashlib.sha256(content).hexdigest()


def read_baseline() -> dict[str, str]:
    result: dict[str, str] = {}
    if not BASELINE.is_file():
        return result
    for line in BASELINE.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        digest, relative = line.split(None, 1)
        result[relative.strip()] = digest
    return result


def verify_original(results: CheckResults) -> None:
    baseline = read_baseline()
    results.check(bool(baseline), "原版哈希基线存在且非空")
    current = {
        path.relative_to(ORIGINAL).as_posix(): sha256(path)
        for path in ORIGINAL.rglob("*")
        if path.is_file()
    }
    changed = sorted(path for path, digest in baseline.items() if current.get(path) != digest)
    removed = sorted(set(baseline) - set(current))
    additions = set(current) - set(baseline)
    unexpected = sorted(additions - ALLOWED_ORIGINAL_ADDITIONS)
    results.check(not changed, f"原版基线文件未变化（变化 {len(changed)} 个）")
    results.check(not removed, f"原版基线文件未删除（删除 {len(removed)} 个）")
    results.check(not unexpected, f"原版仅新增获准说明文件（意外新增 {len(unexpected)} 个）")


def run(command: list[str], cwd: Path, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    return subprocess.run(
        command,
        cwd=cwd,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        check=False,
    )


def has_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def verify_launchers(results: CheckResults) -> None:
    launchers = [
        ROOT / "sqlmap.cmd",
        ROOT / "sstimap.cmd",
        CN / "sqlmap.cmd",
        CN / "sstimap.cmd",
    ]
    for launcher in launchers:
        results.check(launcher.is_file(), f"启动器存在：{launcher.relative_to(ROOT)}")

    cases = [
        ("原版 SQLmap", ["cmd", "/d", "/c", "sqlmap.cmd", "--help"], ROOT, False),
        ("汉化 SQLmap", ["cmd", "/d", "/c", "sqlmap.cmd", "-cn", "--help"], ROOT, True),
        ("直启汉化 SQLmap", ["cmd", "/d", "/c", "sqlmap.cmd", "--help"], CN, True),
        ("原版 SSTImap", ["cmd", "/d", "/c", "sstimap.cmd", "--help"], ROOT, False),
        ("汉化 SSTImap", ["cmd", "/d", "/c", "sstimap.cmd", "-cn", "--help"], ROOT, True),
        ("直启汉化 SSTImap", ["cmd", "/d", "/c", "sstimap.cmd", "--help"], CN, True),
    ]
    if not all(path.is_file() for path in launchers):
        return
    for name, command, cwd, chinese_expected in cases:
        try:
            completed = run(command, cwd)
        except (OSError, subprocess.TimeoutExpired) as exc:
            results.check(False, f"{name}帮助可执行：{exc}")
            continue
        results.check(completed.returncode == 0, f"{name}帮助退出码为 0")
        if chinese_expected:
            results.check(has_chinese(completed.stdout), f"{name}帮助包含中文")


def verify_copy_shape(results: CheckResults) -> None:
    pairs = [
        (ORIGINAL / "sqlmap-1.10", CN / "sqlmap-1.10"),
        (ORIGINAL / "SSTImap-master", CN / "SSTImap-master"),
    ]
    for source, localized in pairs:
        results.check(localized.is_dir(), f"中文副本目录存在：{localized.relative_to(ROOT)}")
        if not localized.is_dir():
            continue
        source_files = {
            path.relative_to(source).as_posix()
            for path in source.rglob("*")
            if path.is_file() and path.name != "使用说明.md" and "__pycache__" not in path.parts
        }
        localized_files = {
            path.relative_to(localized).as_posix()
            for path in localized.rglob("*")
            if path.is_file() and path.name != "使用说明.md" and "__pycache__" not in path.parts
        }
        missing = source_files - localized_files
        results.check(not missing, f"{localized.name}文件完整（缺少 {len(missing)} 个）")


def verify_python(results: CheckResults) -> None:
    for directory in (CN / "sqlmap-1.10", CN / "SSTImap-master"):
        if directory.is_dir():
            failures: list[str] = []
            for path in directory.rglob("*.py"):
                if "__pycache__" in path.parts:
                    continue
                try:
                    source = path.read_text(encoding="utf-8")
                    compile(source, str(path), "exec")
                except (OSError, UnicodeDecodeError, SyntaxError) as exc:
                    failures.append(f"{path}: {exc}")
            ok = not failures
            results.check(ok, f"{directory.name}全部 Python 文件可编译")


def placeholders(path: Path) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = path.read_text(encoding="latin-1")
    return sorted(PLACEHOLDER_RE.findall(text))


def verify_placeholders(results: CheckResults) -> None:
    mismatches: list[str] = []
    for source_root, cn_root in (
        (ORIGINAL / "sqlmap-1.10", CN / "sqlmap-1.10"),
        (ORIGINAL / "SSTImap-master", CN / "SSTImap-master"),
    ):
        if not cn_root.is_dir():
            continue
        for source in source_root.rglob("*.py"):
            if "thirdparty" in source.parts or "__pycache__" in source.parts:
                continue
            localized = cn_root / source.relative_to(source_root)
            if localized.is_file() and placeholders(source) != placeholders(localized):
                mismatches.append(source.relative_to(ORIGINAL).as_posix())
    results.check(not mismatches, f"Python 格式占位符保持一致（不一致 {len(mismatches)} 个）")


def verify_guides(results: CheckResults) -> None:
    guides = [
        ORIGINAL / "sqlmap-1.10" / "使用说明.md",
        ORIGINAL / "SSTImap-master" / "使用说明.md",
        CN / "sqlmap-1.10" / "使用说明.md",
        CN / "SSTImap-master" / "使用说明.md",
    ]
    required = ("安装", "启动", "参数", "示例", "输出", "故障排查")
    for guide in guides:
        exists = guide.is_file()
        results.check(exists, f"使用说明存在：{guide.relative_to(ROOT)}")
        if exists:
            content = guide.read_text(encoding="utf-8")
            results.check(all(word in content for word in required), f"使用说明章节完整：{guide.relative_to(ROOT)}")


def main() -> int:
    results = CheckResults()
    verify_original(results)
    verify_copy_shape(results)
    verify_launchers(results)
    verify_python(results)
    verify_placeholders(results)
    verify_guides(results)
    print()
    if results.failures:
        print(f"验收失败：{len(results.failures)} 项")
        return 1
    print("验收通过：所有检查均成功")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
