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

__priority__ = PRIORITY.HIGHEST

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s' % (os.path.basename(__file__).split(".")[0], DBMS.ORACLE))

def tamper(payload, **kwargs):
    "\n    将 <int> UNION 的实例替换为 <int>DUNION\n\n    Requirement:\n        * Oracle\n\n    Notes:\n        * 参考号：https://media.blackhat.com/us-13/US-13-Salgado-SQLi-Optimization-and-Obfuscation-Techniques-Slides.pdf\n\n    >>> tamper('1 UNION ALL SELECT')\n    '1DUNION ALL SELECT'\n    "

    return re.sub(r"(?i)(\d+)\s+(UNION )", r"\g<1>D\g<2>", payload) if payload else payload
