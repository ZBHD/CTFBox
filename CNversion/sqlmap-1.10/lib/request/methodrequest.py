#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.convert import getText
from thirdparty.six.moves import urllib as _urllib

class MethodRequest(_urllib.request.Request):
    """
    Used to create HEAD/PUT/DELETE/... requests with urllib
    """

    def set_method(self, method):
        self.method = getText(method.upper())  # Python3 的肮脏 hack（愿它在地狱里腐烂！）

    def get_method(self):
        return getattr(self, 'method', _urllib.request.Request.get_method(self))
