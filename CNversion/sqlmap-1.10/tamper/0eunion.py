#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import re

from lib.core.enums import PRIORITY

__priority__ = PRIORITY.HIGHEST

def dependencies():
    pass

def tamper(payload, **kwargs):
    "\n    将一个整数后跟 UNION 替换为一个整数后跟 e0UNION\n\n    Requirement:\n        * MySQL\n        * MsSQL\n\n    Notes:\n        * 参考号：https://media.blackhat.com/us-13/US-13-Salgado-SQLi-Optimization-and-Obfuscation-Techniques-Slides.pdf\n\n    >>> tamper('1 UNION ALL SELECT')\n    '1e0UNION ALL SELECT'\n    "

    return re.sub(r"(?i)(\d+)\s+(UNION )", r"\g<1>e0\g<2>", payload) if payload else payload
