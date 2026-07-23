#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.convert import encodeBase64
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOW

def dependencies():
    pass

def tamper(payload, **kwargs):
    '\n    Encodes the entire payload using Base64\n\n    >>> tamper("1\' AND SLEEP(5)#")\n    \'MScgQU5EIFNMRUVQKDUpIw==\'\n    '

    return encodeBase64(payload, binary=False) if payload else payload
