#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import re

from lib.core.enums import PRIORITY

__priority__ = PRIORITY.NORMAL

def dependencies():
    pass

def tamper(payload, **kwargs):
    "\n    在括号之前添加（内联）注释（例如 ( -> /**/()\n\n    测试针对：\n        * 微软SQL服务器\n        * MySQL\n        * Oracle\n        * PostgreSQL\n\n    Notes:\n        * 可用于绕过阻止使用的 Web 应用程序防火墙\n          函数调用次数\n\n    >>> tamper('SELECT ABS(1)')\n    'SELECT ABS/**/(1)'\n    "

    retVal = payload

    if payload:
        retVal = re.sub(r"\b(\w+)\(", r"\g<1>/**/(", retVal)

    return retVal
