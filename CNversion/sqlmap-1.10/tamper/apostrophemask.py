#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOWEST

def dependencies():
    pass

def tamper(payload, **kwargs):
    '\n    Replaces single quotes (\') with their UTF-8 full-width equivalents (e.g. \' -> %EF%BC%87)\n\n    References:\n        * http://www.utf8-chartable.de/unicode-utf8-table.pl?start=65280&number=128\n        * https://web.archive.org/web/20130614183121/http://lukasz.pilorz.net/testy/unicode_conversion/\n        * https://web.archive.org/web/20131121094431/sla.ckers.org/forum/read.php?13,11562,11850\n        * https://web.archive.org/web/20070624194958/http://lukasz.pilorz.net/testy/full_width_utf/index.phps\n\n    >>> tamper("1 AND \'1\'=\'1")\n    \'1 AND %EF%BC%871%EF%BC%87=%EF%BC%871\'\n    '

    return payload.replace('\'', "%EF%BC%87") if payload else payload
