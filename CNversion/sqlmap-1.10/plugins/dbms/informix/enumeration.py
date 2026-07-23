#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.data import logger
from plugins.generic.enumeration import Enumeration as GenericEnumeration

class Enumeration(GenericEnumeration):
    def searchDb(self):
        warnMsg = 'Informix 上的数据库搜索未实现'
        logger.warning(warnMsg)

        return []

    def searchTable(self):
        warnMsg = 'Informix 上的表搜索未实现'
        logger.warning(warnMsg)

        return []

    def searchColumn(self):
        warnMsg = 'Informix 上的列搜索未实现'
        logger.warning(warnMsg)

        return []

    def search(self):
        warnMsg = 'Informix 搜索选项不可用'
        logger.warning(warnMsg)

    def getStatements(self):
        warnMsg = '在 Informix 上，不可能枚举 SQL 语句'
        logger.warning(warnMsg)

        return []
