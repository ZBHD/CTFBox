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
    "\n    在适用的情况下注入关键字二进制文件\n\n    Requirement:\n        * MySQL\n\n    >>> tamper('1 UNION ALL SELECT NULL, NULL, NULL')\n    '1 UNION ALL SELECT binary NULL, binary NULL, binary NULL'\n    >>> tamper('1 AND 2>1')\n    '1 AND 二进制 2>二进制 1'\n    >>> tamper('CASE WHEN (1=1) THEN 1 ELSE 0x28 END')\n    'CASE WHEN (二进制 1=二进制 1) THEN 二进制 1 ELSE 二进制 0x28 END'\n    "

    retVal = payload

    if payload:
        retVal = re.sub(r"\bNULL\b", "binary NULL", retVal)
        retVal = re.sub(r"\b(THEN\s+)(\d+|0x[0-9a-f]+)(\s+ELSE\s+)(\d+|0x[0-9a-f]+)", r"\g<1>binary \g<2>\g<3>binary \g<4>", retVal)
        retVal = re.sub(r"(\d+\s*[>=]\s*)(\d+)", r"binary \g<1>binary \g<2>", retVal)
        retVal = re.sub(r"\b((AND|OR)\s*)(\d+)", r"\g<1>binary \g<3>", retVal)
        retVal = re.sub(r"([>=]\s*)(\d+)", r"\g<1>binary \g<2>", retVal)
        retVal = re.sub(r"\b(0x[0-9a-f]+)", r"binary \g<1>", retVal)
        retVal = re.sub(r"(\s+binary)+", r"\g<1>", retVal)

    return retVal
