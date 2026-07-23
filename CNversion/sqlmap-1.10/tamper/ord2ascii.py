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
    '\n    用等效的 ASCII() 调用替换 ORD() 出现\n    Requirement:\n        * MySQL\n    >>> tamper("ORD(\'42\')")\n    "ASCII(\'42\')"\n    '

    retVal = payload

    if payload:
        retVal = re.sub(r"(?i)\bORD\(", "ASCII(", payload)

    return retVal
