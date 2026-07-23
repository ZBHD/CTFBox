#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os

from lib.core.common import singleTimeWarnMessage
from lib.core.enums import DBMS
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOWEST

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s' % (os.path.basename(__file__).split(".")[0], DBMS.ACCESS))

def tamper(payload, **kwargs):
    "\n    Appends an (Access) NULL byte character (%00) at the end of payload\n\n    Requirement:\n        * 微软访问\n\n    Notes:\n        * 当后端访问时，有助于绕过薄弱的 Web 应用程序防火墙\n          数据库管理系统是 Microsoft Access - 进一步的用途是\n          也有可能\n\n    参考号：http://projects.webappsec.org/w/page/13246949/Null-Byte-Injection\n\n    >>> tamper('1 AND 1=1')\n    '1 AND 1=1%00'\n    "

    return "%s%%00" % payload if payload else payload
