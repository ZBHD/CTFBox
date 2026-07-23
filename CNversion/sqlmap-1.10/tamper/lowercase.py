#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import re

from lib.core.data import kb
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.NORMAL

def dependencies():
    pass

def tamper(payload, **kwargs):
    "\n    Replaces each keyword character with lower case value (e.g. SELECT -> select)\n\n    测试针对：\n        * 微软 SQL Server 2005\n        * MySQL 4、5.0 和 5.5\n        * Oracle 10g\n        * PostgreSQL 8.3, 8.4, 9.0\n\n    Notes:\n        * 可用于绕过非常薄弱的\u200b\u200b定制 Web 应用程序防火墙\n          宽松的正则表达式写得不好\n\n    >>> tamper('INSERT')\n    'insert'\n    "

    retVal = payload

    if payload:
        for match in re.finditer(r"\b[A-Za-z_]+\b", retVal):
            word = match.group()

            if word.upper() in kb.keywords:
                retVal = retVal.replace(word, word.lower())

    return retVal
