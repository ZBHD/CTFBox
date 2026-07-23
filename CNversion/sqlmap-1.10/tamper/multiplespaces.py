#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import random
import re

from lib.core.data import kb
from lib.core.datatype import OrderedSet
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.NORMAL

def dependencies():
    pass

def tamper(payload, **kwargs):
    "\n    在 SQL 关键字周围添加多个空格 (' ')\n\n    Notes:\n        * 可用于绕过非常薄弱的\u200b\u200b定制 Web 应用程序防火墙\n          宽松的正则表达式写得不好\n\n    参考号：https://www.owasp.org/images/7/74/Advanced_SQL_Injection.ppt\n\n    >>> random.seed(0)\n    >>> tamper('1 UNION SELECT foobar')\n    '1     UNION     SELECT     foobar'\n    "

    retVal = payload

    if payload:
        words = OrderedSet()

        for match in re.finditer(r"\b[A-Za-z_]+\b", payload):
            word = match.group()

            if word.upper() in kb.keywords:
                words.add(word)

        for word in words:
            retVal = re.sub(r"(?<=\W)%s(?=[^A-Za-z_(]|\Z)" % word, "%s%s%s" % (' ' * random.randint(1, 4), word, ' ' * random.randint(1, 4)), retVal)
            retVal = re.sub(r"(?<=\W)%s(?=[(])" % word, "%s%s" % (' ' * random.randint(1, 4), word), retVal)

    return retVal
