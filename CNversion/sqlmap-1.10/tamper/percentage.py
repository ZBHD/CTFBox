#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os
import string

from lib.core.common import singleTimeWarnMessage
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOW

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 ASP Web 应用程序' % os.path.basename(__file__).split(".")[0])

def tamper(payload, **kwargs):
    "\n    Adds a percentage sign ('%') infront of each character (e.g. SELECT -> %S%E%L%E%C%T)\n\n    Requirement:\n        * ASP\n\n    测试针对：\n        * 微软 SQL Server 2000、2005\n        * MySQL 5.1.56, 5.5.11\n        * PostgreSQL 9.0\n\n    Notes:\n        * 可用于绕过薄弱且定制的 Web 应用程序防火墙\n\n    >>> tamper('SELECT FIELD FROM TABLE')\n    '%S%E%L%E%C%T %F%I%E%L%D %F%R%O%M %T%A%B%L%E'\n    "

    if payload:
        retVal = ""
        i = 0

        while i < len(payload):
            if payload[i] == '%' and (i < len(payload) - 2) and payload[i + 1:i + 2] in string.hexdigits and payload[i + 2:i + 3] in string.hexdigits:
                retVal += payload[i:i + 3]
                i += 3
            elif payload[i] != ' ':
                retVal += '%%%s' % payload[i]
                i += 1
            else:
                retVal += payload[i]
                i += 1

    return retVal
