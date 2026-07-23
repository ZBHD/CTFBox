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
    "\n    使用空格（例如“testdb 9.e.users”）拆分模式标识符（例如“testdb.users”）\n\n    Requirement:\n        * MySQL\n\n    Notes:\n        * 参考号：https://media.blackhat.com/us-13/US-13-Salgado-SQLi-Optimization-and-Obfuscation-Techniques-Slides.pdf\n\n    >>> tamper('SELECT id FROM testdb.users')\n    'SELECT id FROM testdb 9.e.users'\n    "

    return re.sub(r"(?i)( FROM \w+)\.(\w+)", r"\g<1> 9.e.\g<2>", payload) if payload else payload
