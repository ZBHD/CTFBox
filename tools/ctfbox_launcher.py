#!/usr/bin/env python3
"""CTFBox 工具版本分发器。"""

from __future__ import annotations

from pathlib import Path
import os
import runpy
import sys


def normalize_windows_path(path: Path) -> Path:
    value = str(path)
    if value.startswith("\\\\?\\UNC\\"):
        return Path("\\\\" + value[8:])
    if value.startswith("\\\\?\\"):
        return Path(value[4:])
    return path


ROOT = normalize_windows_path(Path(__file__).resolve()).parents[1]
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

    previous_argv = sys.argv[:]
    previous_cwd = Path.cwd()
    sys.argv = [str(script), *arguments]
    sys.path.insert(0, str(edition_root))
    os.chdir(edition_root)
    try:
        runpy.run_path(str(script), run_name="__main__")
    except SystemExit as exit_status:
        return exit_status.code if isinstance(exit_status.code, int) else (0 if exit_status.code is None else 1)
    finally:
        os.chdir(previous_cwd)
        sys.argv = previous_argv
        if sys.path and sys.path[0] == str(edition_root):
            sys.path.pop(0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
