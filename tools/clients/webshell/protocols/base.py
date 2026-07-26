"""协议抽象层：把引擎的规范化操作编解码为各 webshell 协议的线格式。

引擎只认识 6 个规范操作（Operation），由具体协议负责：
  build_request(op, params) -> (body: bytes, headers: dict)   请求编码
  parse_response(op, raw)   -> dict                            响应解码为规范结果

规范结果契约（各协议须返回一致结构）：
  sysinfo -> {"os","user","cwd", ...}
  exec    -> {"output": str}
  list    -> {"entries": [{"name","type","size"}]}
  read    -> {"content": <base64 str>}
  write   -> {"written": int}
  delete  -> {"deleted": bool}
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class Operation:
    SYSINFO = "sysinfo"
    EXEC = "exec"
    LIST = "list"
    READ = "read"
    WRITE = "write"
    DELETE = "delete"

    ALL = (SYSINFO, EXEC, LIST, READ, WRITE, DELETE)


class ProtocolError(Exception):
    """协议编解码失败（区别于网络错误）。"""


class Protocol(ABC):
    """单个 webshell 协议的编解码器。无状态于单次请求，连接参数在构造时注入。"""

    name: str = "base"
    #: 该协议支持的载荷语言
    languages: tuple[str, ...] = ()
    #: 该协议可选的编码器（无则空）
    encoders: tuple[str, ...] = ()

    def __init__(
        self,
        *,
        target: str,
        password: str,
        payload_type: str = "php",
        encoder: str | None = None,
        **options: Any,
    ) -> None:
        if self.languages and payload_type not in self.languages:
            raise ProtocolError(f"{self.name} 不支持载荷语言：{payload_type}")
        if encoder is not None and self.encoders and encoder not in self.encoders:
            raise ProtocolError(f"{self.name} 不支持编码器：{encoder}")
        self.target = target
        self.password = password
        self.payload_type = payload_type
        self.encoder = encoder or (self.encoders[0] if self.encoders else None)
        self.options = options

    @abstractmethod
    def build_request(self, operation: str, params: dict) -> tuple[bytes, dict[str, str]]:
        """把操作 + 参数编码为 (HTTP body, 额外请求头)。"""

    @abstractmethod
    def parse_response(self, operation: str, raw: bytes) -> dict:
        """把 HTTP 响应体解码为规范结果字典。"""

    # -- 供子类复用的规范结果构造 ---------------------------------------
    @staticmethod
    def normalize_listing(text: str) -> dict:
        """把 `name\ttype\tsize` 或每行一个名字的目录文本规整为 entries。"""
        entries = []
        for line in text.splitlines():
            line = line.rstrip("\r")
            if not line:
                continue
            parts = line.split("\t")
            name = parts[0]
            kind = parts[1] if len(parts) > 1 else "file"
            size = 0
            if len(parts) > 2:
                try:
                    size = int(parts[2])
                except ValueError:
                    size = 0
            entries.append({"name": name, "type": kind, "size": size})
        return {"entries": entries}
