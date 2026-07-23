#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import string

from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOWEST

def dependencies():
    pass

def tamper(payload, **kwargs):
    "\n    URL-encodes all characters in a given payload (not processing already encoded) (e.g. SELECT -> %53%45%4C%45%43%54)\n\n    测试针对：\n        * 微软 SQL Server 2005\n        * MySQL 4、5.0 和 5.5\n        * Oracle 10g\n        * PostgreSQL 8.3, 8.4, 9.0\n\n    Notes:\n        * 可用于绕过非常薄弱的\u200b\u200b Web 应用程序防火墙，这些防火墙在通过规则集处理请求之前不会对请求进行 url 解码\n        * Web 服务器无论如何都会传递 url 解码版本，因此它应该适用于任何 DBMS\n\n    >>> tamper('SELECT FIELD FROM%20TABLE')\n    '%53%45%4C%45%43%54%20%46%49%45%4C%44%20%46%52%4F%4D%20%54%41%42%4C%45'\n    "

    retVal = payload

    if payload:
        retVal = ""
        i = 0

        while i < len(payload):
            if payload[i] == '%' and (i < len(payload) - 2) and payload[i + 1:i + 2] in string.hexdigits and payload[i + 2:i + 3] in string.hexdigits:
                retVal += payload[i:i + 3]
                i += 3
            else:
                retVal += '%%%.2X' % ord(payload[i])
                i += 1

    return retVal
