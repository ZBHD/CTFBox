"""Webshell 协议注册表。

引擎按名字取协议编解码器；每个协议把 6 个规范操作翻译成对应 webshell 的线格式。
"""

from __future__ import annotations

from .antsword import AntSwordProtocol
from .base import Operation, Protocol, ProtocolError
from .behinder import BehinderProtocol
from .ctfbox import CtfboxProtocol

_REGISTRY: dict[str, type[Protocol]] = {
    CtfboxProtocol.name: CtfboxProtocol,
    BehinderProtocol.name: BehinderProtocol,
    AntSwordProtocol.name: AntSwordProtocol,
}


def available() -> tuple[str, ...]:
    return tuple(_REGISTRY.keys())


def get_protocol(name: str, **kwargs) -> Protocol:
    """按名字构造协议实例；kwargs 透传给协议构造器（target/password/payload_type/encoder/...）。"""
    cls = _REGISTRY.get(name)
    if cls is None:
        raise ProtocolError(f"未知协议：{name}（可用：{', '.join(available())}）")
    return cls(**kwargs)


__all__ = [
    "Operation",
    "Protocol",
    "ProtocolError",
    "CtfboxProtocol",
    "BehinderProtocol",
    "AntSwordProtocol",
    "get_protocol",
    "available",
]
