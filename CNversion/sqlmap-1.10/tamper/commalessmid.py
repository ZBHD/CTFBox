#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os
import re

from lib.core.common import singleTimeWarnMessage
from lib.core.enums import DBMS
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.HIGH

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s' % (os.path.basename(__file__).split(".")[0], DBMS.MYSQL))

def tamper(payload, **kwargs):
    "\n    将 (MySQL) 实例替换为“MID(A FROM B FOR C)”对应项，例如“MID(A, B, C)”\n\n    Requirement:\n        * MySQL\n\n    测试针对：\n        * MySQL 5.0 和 5.5\n\n    >>> tamper('MID(VERSION(), 1, 1)')\n    '中（版本（）从1换1）'\n    "

    retVal = payload

    warnMsg = '您应该考虑使用开关“--no-cast”以及 '
    warnMsg += '篡改脚本“%s”' % os.path.basename(__file__).split(".")[0]
    singleTimeWarnMessage(warnMsg)

    match = re.search(r"(?i)MID\((.+?)\s*,\s*(\d+)\s*\,\s*(\d+)\s*\)", payload or "")
    if match:
        retVal = retVal.replace(match.group(0), "MID(%s FROM %s FOR %s)" % (match.group(1), match.group(2), match.group(3)))

    return retVal
