#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import re

from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOW

def dependencies():
    pass

def tamper(payload, **kwargs):
    '\n    HTML 编码（使用代码点）所有非字母数字字符（例如“->”）\n\n    >>> tamper("1\' AND SLEEP(5)#")\n    \'1&#39;&#32;AND&#32;SLEEP&#40;5&#41;&#35;\'\n    >>> tamper("1&#39;&#32;AND&#32;SLEEP&#40;5&#41;&#35;")\n    \'1&#39;&#32;AND&#32;SLEEP&#40;5&#41;&#35;\'\n    '

    if payload:
        payload = re.sub(r"&#(\d+);", lambda match: chr(int(match.group(1))), payload)      # 注：https://github.com/sqlmapproject/sqlmap/issues/5203
        payload = re.sub(r"[^\w]", lambda match: "&#%d;" % ord(match.group(0)), payload)

    return payload
