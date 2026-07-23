#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os
import string

from lib.core.common import singleTimeWarnMessage
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOWEST

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 ASP 或 ASP.NET Web 应用程序' % os.path.basename(__file__).split(".")[0])

def tamper(payload, **kwargs):
    "\n    Unicode-URL-encodes all characters in a given payload (not processing already encoded) (e.g. SELECT -> %u0053%u0045%u004C%u0045%u0043%u0054)\n\n    Requirement:\n        * ASP\n        * ASP.NET\n\n    测试针对：\n        * 微软 SQL Server 2000\n        * 微软 SQL Server 2005\n        * MySQL 5.1.56\n        * PostgreSQL 9.0.3\n\n    Notes:\n        * 可用于绕过弱 Web 应用程序防火墙，这些防火墙不会在通过其规则集处理请求之前对请求进行统一 URL 解码\n\n    >>> tamper('SELECT FIELD%20FROM TABLE')\n    '%u0053%u0045%u004C%u0045%u0043%u0054%u0020%u0046%u0049%u0045%u004C%u0044%u0020%u0046%u0052%u004F%u004D%u0020%u0054%u0041%u0042%u004C%u0045'\n    "

    retVal = payload

    if payload:
        retVal = ""
        i = 0

        while i < len(payload):
            if payload[i] == '%' and (i < len(payload) - 2) and payload[i + 1:i + 2] in string.hexdigits and payload[i + 2:i + 3] in string.hexdigits:
                retVal += "%%u00%s" % payload[i + 1:i + 3]
                i += 3
            else:
                retVal += '%%u%.4X' % ord(payload[i])
                i += 1

    return retVal
