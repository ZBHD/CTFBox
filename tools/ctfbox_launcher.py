#!/usr/bin/env python3
"""CTFBox 工具版本分发器。"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
TOOLS = {
    "sqlmap": ("sqlmap-1.10", "sqlmap.py"),
    "sstimap": ("SSTImap-master", "sstimap.py"),
}


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1].lower() not in TOOLS:
        print("用法：ctfbox_launcher.py <sqlmap|sstimap> [-cn] [工具参数...]", file=sys.stderr)
        return 2

    tool = sys.argv[1].lower()
    arguments = sys.argv[2:]
    use_chinese = bool(arguments and arguments[0].lower() == "-cn")
    if use_chinese:
        arguments = arguments[1:]

    directory, entry = TOOLS[tool]
    edition_root = ROOT / ("CNversion" if use_chinese else "Original") / directory
    script = edition_root / entry
    if not script.is_file():
        edition = "汉化版" if use_chinese else "原版"
        print(f"CTFBox：找不到 {edition}入口 {script}", file=sys.stderr)
        return 2

    completed = subprocess.run([sys.executable, str(script), *arguments], cwd=edition_root, check=False)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
