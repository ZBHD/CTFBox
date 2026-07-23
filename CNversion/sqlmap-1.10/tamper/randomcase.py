#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import re

from lib.core.common import randomRange
from lib.core.compat import xrange
from lib.core.data import kb
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.NORMAL

def dependencies():
    pass

def tamper(payload, **kwargs):
    "\n    Replaces each keyword character with random case value (e.g. SELECT -> SEleCt)\n\n    测试针对：\n        * 微软 SQL Server 2005\n        * MySQL 4、5.0 和 5.5\n        * Oracle 10g\n        * PostgreSQL 8.3, 8.4, 9.0\n        * SQLite 3\n\n    Notes:\n        * 可用于绕过非常薄弱的\u200b\u200b定制 Web 应用程序防火墙\n          宽松的正则表达式写得不好\n        * 这个篡改脚本应该适用于所有（？）数据库\n\n    >>> import random\n    >>> random.seed(0)\n    >>> tamper('INSERT')\n    'InSeRt'\n    >>> tamper('f()')\n    'f()'\n    >>> tamper('function()')\n    'FuNcTiOn()'\n    >>> tamper('SELECT id FROM `user`')\n    '从‘用户’中选择 ID\n    "

    retVal = payload

    if payload:
        for match in re.finditer(r"\b[A-Za-z_]{2,}\b", retVal):
            word = match.group()

            if (word.upper() in kb.keywords and re.search(r"(?i)[`\"'\[]%s[`\"'\]]" % word, retVal) is None) or ("%s(" % word) in payload:
                while True:
                    _ = ""

                    for i in xrange(len(word)):
                        _ += word[i].upper() if randomRange(0, 1) else word[i].lower()

                    if len(_) > 1 and _ not in (_.lower(), _.upper()):
                        break

                retVal = retVal.replace(word, _)

    return retVal
