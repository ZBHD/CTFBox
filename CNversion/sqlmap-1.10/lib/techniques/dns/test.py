#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.common import Backend
from lib.core.common import randomInt
from lib.core.data import conf
from lib.core.data import kb
from lib.core.data import logger
from lib.core.dicts import FROM_DUMMY_TABLE
from lib.core.exception import SqlmapNotVulnerableException
from lib.techniques.dns.use import dnsUse

def dnsTest(payload):
    logger.info('通过 DNS 通道进行数据检索测试')

    randInt = randomInt()
    kb.dnsTest = dnsUse(payload, "SELECT %d%s" % (randInt, FROM_DUMMY_TABLE.get(Backend.getIdentifiedDbms(), ""))) == str(randInt)

    if not kb.dnsTest:
        errMsg = '通过 DNS 通道检索数据失败'
        if not conf.forceDns:
            conf.dnsDomain = None
            errMsg += '。关闭 DNS 渗透支持'
            logger.error(errMsg)
        else:
            raise SqlmapNotVulnerableException(errMsg)
    else:
        infoMsg = '通过DNS通道检索数据成功'
        logger.info(infoMsg)
