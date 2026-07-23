#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os

from lib.core.common import singleTimeWarnMessage
from lib.core.enums import DBMS
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.HIGHEST

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s' % (os.path.basename(__file__).split(".")[0], DBMS.MYSQL))

def tamper(payload, **kwargs):
    "\n    Replaces (MySQL) instances like 'CONCAT(A, B)' with 'CONCAT_WS(MID(CHAR(0), 0, 0), A, B)' counterpart\n\n    Requirement:\n        * MySQL\n\n    测试针对：\n        * MySQL 5.0\n\n    Notes:\n        * 可用于绕过非常薄弱的\u200b\u200b定制 Web 应用程序防火墙\n          过滤 CONCAT() 函数\n\n    >>> tamper('CONCAT(1,2)')\n    'CONCAT_WS(MID(CHAR(0),0,0),1,2)'\n    "

    if payload:
        payload = payload.replace("CONCAT(", "CONCAT_WS(MID(CHAR(0),0,0),")

    return payload
