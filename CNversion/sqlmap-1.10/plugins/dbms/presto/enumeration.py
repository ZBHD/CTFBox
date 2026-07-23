#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.data import logger
from plugins.generic.enumeration import Enumeration as GenericEnumeration

class Enumeration(GenericEnumeration):
    def getBanner(self):
        warnMsg = '在 Presto 上无法获取标识信息'
        logger.warning(warnMsg)

        return None

    def getCurrentDb(self):
        warnMsg = '在 Presto 上，无法获取当前数据库的名称（架构）'
        logger.warning(warnMsg)

    def isDba(self, user=None):
        warnMsg = '在 Presto 上，无法测试当前用户是否是 DBA'
        logger.warning(warnMsg)

    def getUsers(self):
        warnMsg = '在 Presto 上，无法枚举用户'
        logger.warning(warnMsg)

        return []

    def getPasswordHashes(self):
        warnMsg = '在 Presto 上，无法枚举用户密码哈希值'
        logger.warning(warnMsg)

        return {}

    def getPrivileges(self, *args, **kwargs):
        warnMsg = '在 Presto 上，无法枚举用户权限'
        logger.warning(warnMsg)

        return {}

    def getRoles(self, *args, **kwargs):
        warnMsg = '在 Presto 上，无法枚举用户角色'
        logger.warning(warnMsg)

        return {}

    def getHostname(self):
        warnMsg = '在 Presto 上，无法枚举主机名'
        logger.warning(warnMsg)

    def getStatements(self):
        warnMsg = '在 Presto 上，无法枚举 SQL 语句'
        logger.warning(warnMsg)

        return []
