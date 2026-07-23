#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os
import re

from lib.core.common import singleTimeWarnMessage
from lib.core.convert import decodeHex
from lib.core.convert import getOrds
from lib.core.enums import DBMS
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.NORMAL

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s' % (os.path.basename(__file__).split(".")[0], DBMS.MYSQL))

def tamper(payload, **kwargs):
    "\n    Replaces each (MySQL) 0x<hex> encoded string with equivalent CONCAT(CHAR(),...) counterpart\n\n    Requirement:\n        * MySQL\n\n    测试针对：\n        * MySQL 4、5.0 和 5.5\n\n    Notes:\n        * 在 Web 应用程序进行大写的情况下很有用\n\n    >>> tamper('SELECT 0xdeadbeef')\n    'SELECT CONCAT(CHAR(222),CHAR(173),CHAR(190),CHAR(239))'\n    "

    retVal = payload

    if payload:
        for match in re.finditer(r"\b0x([0-9a-f]+)\b", retVal):
            if len(match.group(1)) > 2:
                result = "CONCAT(%s)" % ','.join("CHAR(%d)" % _ for _ in getOrds(decodeHex(match.group(1))))
            else:
                result = "CHAR(%d)" % ord(decodeHex(match.group(1)))
            retVal = retVal.replace(match.group(0), result)

    return retVal
