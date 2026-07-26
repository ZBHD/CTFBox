"""CTFBox webshell 引擎自带的零依赖加密原语。

仅实现协议对接所需的最小集合（冰蝎需要的 AES-128 ECB/CBC）。
纯标准库实现，保证打包进桌面端时无需额外安装依赖；正确性由测试
与 pycryptodome 交叉验证。
"""

from .aes import AES, aes_cbc_decrypt, aes_cbc_encrypt, aes_ecb_decrypt, aes_ecb_encrypt

__all__ = [
    "AES",
    "aes_ecb_encrypt",
    "aes_ecb_decrypt",
    "aes_cbc_encrypt",
    "aes_cbc_decrypt",
]
