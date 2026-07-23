#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.compat import xrange
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOW

def tamper(payload, **kwargs):
    "\n    将空格字符 (' ') 替换为井号字符 ('#')，后跟换行符 ('\n')\n\n    Requirement:\n        * MSSQL\n        * MySQL\n\n    Notes:\n        * 可用于绕过多个 Web 应用程序防火墙\n\n    >>> tamper('1 AND 9227=9227')\n    '1%23%0AAND%23%0A9227=9227'\n    "

    retVal = ""

    if payload:
        for i in xrange(len(payload)):
            if payload[i].isspace():
                retVal += "%23%0A"
            elif payload[i] == '#' or payload[i:i + 3] == '-- ':
                retVal += payload[i:]
                break
            else:
                retVal += payload[i]

    return retVal
