#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'doc/COPYING' for copying permission
"""

from lib.core.compat import xrange
from lib.core.enums import PRIORITY
from lib.core.settings import REPLACEMENT_MARKER

__priority__ = PRIORITY.HIGHEST

def dependencies():
    pass

def tamper(payload, **kwargs):
    '\n    将“IF(A, B, C)”等实例替换为“CASE WHEN (A) THEN (B) ELSE (C) END”对应项\n\n    Requirement:\n        * MySQL\n        * SQLite（可能）\n        * SAP MaxDB（可能）\n\n    测试针对：\n        * MySQL 5.0 和 5.5\n\n    Notes:\n        * 可用于绕过非常薄弱的\u200b\u200b定制 Web 应用程序防火墙\n          过滤 IF() 函数\n\n    >>> tamper(\'IF(1, 2, 3)\')\n    \'情况当（1）则（2）否则（3）结束\'\n    >>> tamper(\'SELECT IF((1=1), (SELECT "foo"), NULL)\')\n    \'SELECT CASE WHEN (1=1) THEN (SELECT "foo") ELSE (NULL) END\'\n    '

    if payload and payload.find("IF") > -1:
        payload = payload.replace("()", REPLACEMENT_MARKER)
        while payload.find("IF(") > -1:
            index = payload.find("IF(")
            depth = 1
            commas, end = [], None

            for i in xrange(index + len("IF("), len(payload)):
                if depth == 1 and payload[i] == ',':
                    commas.append(i)

                elif depth == 1 and payload[i] == ')':
                    end = i
                    break

                elif payload[i] == '(':
                    depth += 1

                elif payload[i] == ')':
                    depth -= 1

            if len(commas) == 2 and end:
                a = payload[index + len("IF("):commas[0]].strip("()")
                b = payload[commas[0] + 1:commas[1]].lstrip().strip("()")
                c = payload[commas[1] + 1:end].lstrip().strip("()")
                newVal = "CASE WHEN (%s) THEN (%s) ELSE (%s) END" % (a, b, c)
                payload = payload[:index] + newVal + payload[end + 1:]
            else:
                break

        payload = payload.replace(REPLACEMENT_MARKER, "()")

    return payload
