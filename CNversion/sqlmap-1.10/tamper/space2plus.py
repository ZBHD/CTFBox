#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.compat import xrange
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOW

def dependencies():
    pass

def tamper(payload, **kwargs):
    "\n    将空格字符 (' ') 替换为加号 ('+')\n\n    Notes:\n        * 这个有用吗？ plus get 的 url 编码由 sqlmap 引擎随后使查询无效\n        * 该篡改脚本适用于所有数据库\n\n    >>> tamper('SELECT id FROM users')\n    'SELECT+id+FROM+users'\n    "

    retVal = payload

    if payload:
        retVal = ""
        quote, doublequote, firstspace = False, False, False

        for i in xrange(len(payload)):
            if not firstspace:
                if payload[i].isspace():
                    firstspace = True
                    retVal += "+"
                    continue

            elif payload[i] == '\'':
                quote = not quote

            elif payload[i] == '"':
                doublequote = not doublequote

            elif payload[i] == " " and not doublequote and not quote:
                retVal += "+"
                continue

            retVal += payload[i]

    return retVal
