#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os
import random

from lib.core.common import singleTimeWarnMessage
from lib.core.compat import xrange
from lib.core.enums import DBMS
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOW

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s' % (os.path.basename(__file__).split(".")[0], DBMS.MYSQL))

def tamper(payload, **kwargs):
    "\n    Replaces (MySQL) instances of space character (' ') with a random blank character from a valid set of alternate characters\n\n    Requirement:\n        * MySQL\n\n    测试针对：\n        * MySQL 5.1\n\n    Notes:\n        * 可用于绕过多个 Web 应用程序防火墙\n\n    >>> random.seed(0)\n    >>> tamper('SELECT id FROM users')\n    'SELECT%A0id%0CFROM%0Dusers'\n    "

    # ASCII 表：
    # TAB 09 水平制表符
    # LF 0A新线
    # FF 0C 新页
    # CR 0D 回车
    # VT 0B 垂直 TAB（仅限 MySQL 和 Microsoft SQL Server）
    # A0 不间断空格
    blanks = ('%09', '%0A', '%0C', '%0D', '%0B', '%A0')
    retVal = payload

    if payload:
        retVal = ""
        quote, doublequote, firstspace = False, False, False

        for i in xrange(len(payload)):
            if not firstspace:
                if payload[i].isspace():
                    firstspace = True
                    retVal += random.choice(blanks)
                    continue

            elif payload[i] == '\'':
                quote = not quote

            elif payload[i] == '"':
                doublequote = not doublequote

            elif payload[i] == " " and not doublequote and not quote:
                retVal += random.choice(blanks)
                continue

            retVal += payload[i]

    return retVal
