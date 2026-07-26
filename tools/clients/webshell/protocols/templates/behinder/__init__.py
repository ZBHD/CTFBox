"""冰蝎载荷模板：按语言分发。

各语言模块提供 render(operation, params, key) -> str，返回目标侧待 eval 的源码。
载荷会自行用共享密钥 AES 加密其输出（冰蝎 v3 约定，shell 仅作解密+eval 薄封装）。
每段载荷首行嵌入 `/*CTFBOX_BH|op|b64...*/` 机读标签：真实解释器忽略注释，
测试解释器据此在无语言运行时的情况下仿真载荷行为，从而验证线格式与参数编码。
"""

from __future__ import annotations

from . import aspx, jsp, php

_LANGS = {"php": php, "jsp": jsp, "aspx": aspx}


def render(language: str, operation: str, params: dict, key: str) -> str:
    module = _LANGS.get(language)
    if module is None:
        raise ValueError(f"冰蝎暂不支持载荷语言：{language}")
    return module.render(operation, params, key)


def supported() -> tuple[str, ...]:
    return tuple(_LANGS.keys())
