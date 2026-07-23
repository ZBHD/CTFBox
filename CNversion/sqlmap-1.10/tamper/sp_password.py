#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.enums import PRIORITY

__priority__ = PRIORITY.HIGH

def tamper(payload, **kwargs):
    "\n    Appends (MsSQL) function 'sp_password' to the end of the payload for automatic obfuscation from DBMS logs\n\n    Requirement:\n        * MSSQL\n\n    Notes:\n        * 将 sp_password 附加到查询末尾会将其隐藏在 T-SQL 日志中作为安全措施\n        * 参考号：http://websec.ca/kb/sql_injection\n\n    >>> tamper('1 AND 9227=9227-- ')\n    '1 AND 9227=9227--sp_password'\n    "

    retVal = ""

    if payload:
        retVal = "%s%ssp_password" % (payload, "-- " if not any(_ if _ in payload else None for _ in ('#', "-- ")) else "")

    return retVal
