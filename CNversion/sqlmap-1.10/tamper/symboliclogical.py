#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import re

from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOWEST

def dependencies():
    pass

def tamper(payload, **kwargs):
    '\n    将 AND 和 OR 逻辑运算符替换为其对应的符号运算符（&& 和 ||）\n\n    >>> tamper("1 AND \'1\'=\'1")\n    "1 %26%26 \'1\'=\'1"\n    '

    retVal = payload

    if payload:
        retVal = re.sub(r"(?i)\bAND\b", "%26%26", re.sub(r"(?i)\bOR\b", "%7C%7C", payload))

    return retVal
