#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import re

from lib.core.enums import PRIORITY

__priority__ = PRIORITY.NORMAL

def tamper(payload, **kwargs):
    "\n    将内联注释 (/**/) 添加到所有 (MySQL)“information_schema”标识符出现的末尾\n\n    >>> tamper('SELECT table_name FROM INFORMATION_SCHEMA.TABLES')\n    'SELECT table_name FROM INFORMATION_SCHEMA/**/.TABLES'\n    "

    retVal = payload

    if payload:
        retVal = re.sub(r"(?i)(information_schema)\.", r"\g<1>/**/.", payload)

    return retVal
