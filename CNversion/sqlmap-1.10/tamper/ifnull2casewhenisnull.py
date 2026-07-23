#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'doc/COPYING' for copying permission
"""

from lib.core.compat import xrange
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.HIGHEST

def dependencies():
    pass

def tamper(payload, **kwargs):
    "\n    将“IFNULL(A, B)”等实例替换为“CASE WHEN ISNULL(A) THEN (B) ELSE (A) END”对应项\n\n    Requirement:\n        * MySQL\n        * SQLite（可能）\n        * SAP MaxDB（可能）\n\n    测试针对：\n        * MySQL 5.0 和 5.5\n\n    Notes:\n        * 可用于绕过非常薄弱的\u200b\u200b定制 Web 应用程序防火墙\n          过滤 IFNULL() 函数\n\n    >>> tamper('IFNULL(1, 2)')\n    'CASE WHEN ISNULL(1) THEN (2) ELSE (1) END'\n    "

    if payload and payload.find("IFNULL") > -1:
        while payload.find("IFNULL(") > -1:
            index = payload.find("IFNULL(")
            depth = 1
            comma, end = None, None

            for i in xrange(index + len("IFNULL("), len(payload)):
                if depth == 1 and payload[i] == ',':
                    comma = i

                elif depth == 1 and payload[i] == ')':
                    end = i
                    break

                elif payload[i] == '(':
                    depth += 1

                elif payload[i] == ')':
                    depth -= 1

            if comma and end:
                _ = payload[index + len("IFNULL("):comma]
                __ = payload[comma + 1:end].lstrip()
                newVal = "CASE WHEN ISNULL(%s) THEN (%s) ELSE (%s) END" % (_, __, _)
                payload = payload[:index] + newVal + payload[end + 1:]
            else:
                break

    return payload
