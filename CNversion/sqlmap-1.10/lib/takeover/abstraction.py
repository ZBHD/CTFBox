#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from __future__ import print_function

import sys

from lib.core.common import Backend
from lib.core.common import dataToStdout
from lib.core.common import getSQLSnippet
from lib.core.common import isStackingAvailable
from lib.core.common import readInput
from lib.core.convert import getUnicode
from lib.core.data import conf
from lib.core.data import kb
from lib.core.data import logger
from lib.core.enums import AUTOCOMPLETE_TYPE
from lib.core.enums import DBMS
from lib.core.enums import OS
from lib.core.exception import SqlmapFilePathException
from lib.core.exception import SqlmapUnsupportedFeatureException
from lib.core.shell import autoCompletion
from lib.request import inject
from lib.takeover.udf import UDF
from lib.takeover.web import Web
from lib.takeover.xp_cmdshell import XP_cmdshell
from lib.utils.safe2bin import safechardecode
from thirdparty.six.moves import input as _input

class Abstraction(Web, UDF, XP_cmdshell):
    """
    This class defines an abstraction layer for OS takeover functionalities
    to UDF / XP_cmdshell objects
    """

    def __init__(self):
        self.envInitialized = False
        self.alwaysRetrieveCmdOutput = False

        UDF.__init__(self)
        Web.__init__(self)
        XP_cmdshell.__init__(self)

    def execCmd(self, cmd, silent=False):
        if Backend.isDbms(DBMS.PGSQL) and self.checkCopyExec():
            self.copyExecCmd(cmd)

        elif self.webBackdoorUrl and (not isStackingAvailable() or kb.udfFail):
            self.webBackdoorRunCmd(cmd)

        elif Backend.getIdentifiedDbms() in (DBMS.MYSQL, DBMS.PGSQL):
            self.udfExecCmd(cmd, silent=silent)

        elif Backend.isDbms(DBMS.MSSQL):
            self.xpCmdshellExecCmd(cmd, silent=silent)

        else:
            errMsg = '后端数据库管理系统 的功能尚未实现'
            raise SqlmapUnsupportedFeatureException(errMsg)

    def evalCmd(self, cmd, first=None, last=None):
        retVal = None

        if Backend.isDbms(DBMS.PGSQL) and self.checkCopyExec():
            retVal = self.copyExecCmd(cmd)

        elif self.webBackdoorUrl and (not isStackingAvailable() or kb.udfFail):
            retVal = self.webBackdoorRunCmd(cmd)

        elif Backend.getIdentifiedDbms() in (DBMS.MYSQL, DBMS.PGSQL):
            retVal = self.udfEvalCmd(cmd, first, last)

        elif Backend.isDbms(DBMS.MSSQL):
            retVal = self.xpCmdshellEvalCmd(cmd, first, last)

        else:
            errMsg = '后端数据库管理系统 的功能尚未实现'
            raise SqlmapUnsupportedFeatureException(errMsg)

        return safechardecode(retVal)

    def runCmd(self, cmd):
        choice = None

        if not self.alwaysRetrieveCmdOutput:
            message = '你想检索命令标准吗 '
            message += "output? [Y/n/a] "
            choice = readInput(message, default='Y').upper()

            if choice == 'A':
                self.alwaysRetrieveCmdOutput = True

        if choice == 'Y' or self.alwaysRetrieveCmdOutput:
            output = self.evalCmd(cmd)

            if output:
                conf.dumper.string("command standard output", output)
            else:
                dataToStdout('无输出\n')
        else:
            self.execCmd(cmd)

    def shell(self):
        if self.webBackdoorUrl and (not isStackingAvailable() or kb.udfFail):
            infoMsg = '调用操作系统外壳。要退出，请键入 '
            infoMsg += '“x”或“q”，然后按 ENTER'
            logger.info(infoMsg)

        else:
            if Backend.isDbms(DBMS.PGSQL) and self.checkCopyExec():
                infoMsg = '将使用“复制...从程序...” '
                infoMsg += '命令执行'
                logger.info(infoMsg)

            elif Backend.getIdentifiedDbms() in (DBMS.MYSQL, DBMS.PGSQL):
                infoMsg = '将使用注入的用户定义函数 '
                infoMsg += '操作系统的“sys_eval”和“sys_exec” '
                infoMsg += '命令执行'
                logger.info(infoMsg)

            elif Backend.isDbms(DBMS.MSSQL):
                infoMsg = '将使用扩展过程“xp_cmdshell” '
                infoMsg += '操作系统命令执行'
                logger.info(infoMsg)

            else:
                errMsg = '后端数据库管理系统 尚未实现此功能'
                raise SqlmapUnsupportedFeatureException(errMsg)

            infoMsg = '调用 %s 操作系统 shell。要退出，请键入 ' % (Backend.getOs() or "Windows")
            infoMsg += '“x”或“q”，然后按 ENTER'
            logger.info(infoMsg)

        autoCompletion(AUTOCOMPLETE_TYPE.OS, OS.WINDOWS if Backend.isOs(OS.WINDOWS) else OS.LINUX)

        while True:
            command = None

            try:
                command = _input("os-shell> ")
                command = getUnicode(command, encoding=sys.stdin.encoding)
            except UnicodeDecodeError:
                pass
            except KeyboardInterrupt:
                print()
                errMsg = '用户中止'
                logger.error(errMsg)
            except EOFError:
                print()
                errMsg = "exit"
                logger.error(errMsg)
                break

            if not command:
                continue

            if command.lower() in ("x", "q", "exit", "quit"):
                break

            self.runCmd(command)

    def _initRunAs(self):
        if not conf.dbmsCred:
            return

        if not conf.direct and not isStackingAvailable():
            errMsg = '不支持堆叠查询，因此 sqlmap 不能 '
            errMsg += '以另一个用户的身份执行语句。执行 '
            errMsg += '将继续并提供 DBMS 凭据 '
            errMsg += '会被简单地忽略'
            logger.error(errMsg)

            return

        if Backend.isDbms(DBMS.MSSQL):
            msg = '在 Microsoft SQL Server 2005 和 2008 上，OPENROWSET 函数 '
            msg += '默认情况下禁用。需要执行这个函数 '
            msg += '自从您提供以来，作为另一个 DBMS 用户的语句 '
            msg += '选项“--dbms-creds”。如果您是 DBA，则可以启用它。 '
            msg += '您想启用它吗？ [是/否] '

            if readInput(msg, default='Y', boolean=True):
                expression = getSQLSnippet(DBMS.MSSQL, "configure_openrowset", ENABLE="1")
                inject.goStacked(expression)

        # TODO：添加对 PostgreSQL 的支持
        # elif Backend.isDbms(DBMS.PGSQL):
        # 表达式 = getSQLSnippet(DBMS.PGSQL, "configure_dblink", ENABLE="1")
        # 注入.goStacked(表达式)

    def initEnv(self, mandatory=True, detailed=False, web=False, forceInit=False):
        self._initRunAs()

        if self.envInitialized and not forceInit:
            return

        if web:
            self.webInit()
        else:
            self.checkDbmsOs(detailed)

            if mandatory and not self.isDba():
                warnMsg = '请求的功能可能不起作用，因为 '
                warnMsg += '当前会话用户不是数据库管理员'

                if not conf.dbmsCred and Backend.getIdentifiedDbms() in (DBMS.MSSQL, DBMS.PGSQL):
                    warnMsg += '。您可以尝试使用选项“--dbms-cred” '
                    warnMsg += '以 DBA 用户身份执行语句，如果您 '
                    warnMsg += '能够提取并破解 DBA '
                    warnMsg += '无论如何密码'

                logger.warning(warnMsg)

            if any((conf.osCmd, conf.osShell)) and Backend.isDbms(DBMS.PGSQL) and self.checkCopyExec():
                success = True
            elif Backend.getIdentifiedDbms() in (DBMS.MYSQL, DBMS.PGSQL):
                success = self.udfInjectSys()

                if success is not True:
                    msg = '无法安装操作系统接管'
                    raise SqlmapFilePathException(msg)
            elif Backend.isDbms(DBMS.MSSQL):
                if mandatory:
                    self.xpCmdshellInit()
            else:
                errMsg = '后端数据库管理系统 尚未实现此功能'
                raise SqlmapUnsupportedFeatureException(errMsg)

        self.envInitialized = True
