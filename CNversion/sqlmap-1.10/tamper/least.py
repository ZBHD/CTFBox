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
    "\n    将大于运算符 ('>') 替换为 'LEAST' 对应项\n\n    测试针对：\n        * MySQL 4、5.0 和 5.5\n        * Oracle 10g\n        * PostgreSQL 8.3, 8.4, 9.0\n\n    Notes:\n        * 可用于绕过薄弱且定制的 Web 应用程序防火墙\n          过滤大于号字符\n        * LEAST 子句是一个广泛使用的 SQL 命令。因此，这个\n          篡改脚本应该适用于大多数数据库\n\n    >>> tamper('1 AND A > B')\n    '1 且最小(A,B+1)=B+1'\n    "

    retVal = payload

    if payload:
        match = re.search(r"(?i)(\b(AND|OR)\b\s+)([^>]+?)\s*>\s*(\w+|'[^']+')", payload)

        if match:
            _ = "%sLEAST(%s,%s+1)=%s+1" % (match.group(1), match.group(3), match.group(4), match.group(4))
            retVal = retVal.replace(match.group(0), _)

    return retVal
