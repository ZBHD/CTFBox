"""蚁剑 AntSword 载荷模板：按语言分发。

各语言模块提供 render(operation, params, marker) -> str，返回目标侧待 eval 的源码。
蚁剑约定：核心操作代码在 eval($_POST[pass]) 中执行，输出用起止标记包裹
（默认 `->|` 起、`|<-` 止），客户端据标记切出结果。首行嵌入
`/*CTFBOX_AS|op|b64...*/` 机读标签，供无运行时测试解释器仿真。
"""

from __future__ import annotations

from . import asp, aspx, jsp, php

_LANGS = {"php": php, "jsp": jsp, "asp": asp, "aspx": aspx}


def render(language: str, operation: str, params: dict, marker: tuple[str, str]) -> str:
    module = _LANGS.get(language)
    if module is None:
        raise ValueError(f"蚁剑暂不支持载荷语言：{language}")
    return module.render(operation, params, marker)


def supported() -> tuple[str, ...]:
    return tuple(_LANGS.keys())
