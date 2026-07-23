#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import re

from lib.core.enums import PRIORITY

__priority__ = PRIORITY.HIGHEST

def dependencies():
    pass

def tamper(payload, **kwargs):
    "\n    将所有出现的等于运算符 ('=') 替换为 'RLIKE' 对应项\n\n    测试针对：\n        * MySQL 4、5.0 和 5.5\n\n    Notes:\n        * 可用于绕过薄弱且定制的 Web 应用程序防火墙\n          过滤相等字符（'='）\n\n    >>> tamper('SELECT * FROM users WHERE id=1')\n    'SELECT * FROM users WHERE id RLIKE 1'\n    "

    retVal = payload

    if payload:
        retVal = re.sub(r"\s*=\s*", " RLIKE ", retVal)

    return retVal
