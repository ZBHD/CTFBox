#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.compat import xrange
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOW

def dependencies():
    pass

def tamper(payload, **kwargs):
    "\n    将 (MySQL) 空格字符 (' ') 实例替换为注释 '/**_**/'\n\n    测试针对：\n        * MySQL 5.0 和 5.5\n\n    Notes:\n        * 可用于绕过薄弱且定制的 Web 应用程序防火墙\n\n    >>> tamper('SELECT id FROM users')\n    'SELECT/**_**/id/**_**/FROM/**_**/users'\n    "

    retVal = payload

    if payload:
        retVal = ""
        quote, doublequote, firstspace = False, False, False

        for i in xrange(len(payload)):
            if not firstspace:
                if payload[i].isspace():
                    firstspace = True
                    retVal += "/**_**/"
                    continue

            elif payload[i] == '\'':
                quote = not quote

            elif payload[i] == '"':
                doublequote = not doublequote

            elif payload[i] == " " and not doublequote and not quote:
                retVal += "/**_**/"
                continue

            retVal += payload[i]

    return retVal
