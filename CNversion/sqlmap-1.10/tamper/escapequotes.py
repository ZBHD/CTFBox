#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.enums import PRIORITY

__priority__ = PRIORITY.NORMAL

def dependencies():
    pass

def tamper(payload, **kwargs):
    '\n    斜杠转义单引号和双引号（例如 \' -> \'）\n\n    >>> tamper(\'1" AND SLEEP(5)#\')\n    \'1\\\\" AND SLEEP(5)#\'\n    '

    return payload.replace("'", "\\'").replace('"', '\\"')
