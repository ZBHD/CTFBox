"""可选 E2E：需要本地 php.exe 并设置环境变量 CTFBOX_PHP。

未设置或 php 不可执行时自动跳过；有 PHP 时会真起 `php -S` 打两个协议的 shell.php。
详细逻辑与被驱动的 shell 文件都在 `_e2e_php/` 下（见 run_e2e.py）。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).parent
E2E = HERE / "_e2e_php" / "run_e2e.py"


def _resolve_php() -> str | None:
    php = os.environ.get("CTFBOX_PHP")
    if php and Path(php).exists():
        return php
    found = shutil.which("php")
    return found


@pytest.mark.skipif(
    _resolve_php() is None,
    reason="未找到 php（未设置 CTFBOX_PHP 且 PATH 无 php）",
)
def test_php_e2e_both_protocols():
    php = _resolve_php()
    assert php, "内部错误：跳过条件应已生效"
    proc = subprocess.run(
        [sys.executable, str(E2E), php],
        cwd=str(HERE),
        capture_output=True,
        text=True,
        timeout=90,
    )
    combined = proc.stdout + "\n" + proc.stderr
    assert proc.returncode == 0, f"E2E 失败：\n{combined}"
    # 关键断言：三段头都要出现，且没有 FAIL 行
    assert "Behinder" in combined
    assert "AntSword (base64 encoder)" in combined
    assert "AntSword (raw encoder)" in combined
    assert "[FAIL]" not in combined, combined
