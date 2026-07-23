#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import glob
import os
import re
import shutil
import subprocess
import time
import zipfile

from lib.core.common import dataToStdout
from lib.core.common import extractRegexResult
from lib.core.common import getLatestRevision
from lib.core.common import getSafeExString
from lib.core.common import openFile
from lib.core.common import pollProcess
from lib.core.common import readInput
from lib.core.convert import getText
from lib.core.data import conf
from lib.core.data import logger
from lib.core.data import paths
from lib.core.revision import getRevisionNumber
from lib.core.settings import GIT_REPOSITORY
from lib.core.settings import IS_WIN
from lib.core.settings import VERSION
from lib.core.settings import TYPE
from lib.core.settings import ZIPBALL_PAGE
from thirdparty.six.moves import urllib as _urllib

def update():
    if not conf.updateAll:
        return

    success = False

    if TYPE == "pip":
        infoMsg = '将 sqlmap 更新到最新的稳定版本 '
        infoMsg += 'PyPI 存储库'
        logger.info(infoMsg)

        debugMsg = 'sqlmap 将尝试使用“pip”命令更新自身'
        logger.debug(debugMsg)

        dataToStdout('\r[%s] [INFO] 更新中' % time.strftime("%X"))

        output = ""
        try:
            process = subprocess.Popen("pip install -U sqlmap", shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=paths.SQLMAP_ROOT_PATH)
            pollProcess(process, True)
            output, _ = process.communicate()
            success = not process.returncode
        except Exception as ex:
            success = False
            output = getSafeExString(ex)
        finally:
            output = getText(output)

        if success:
            logger.info('%s 最新修订版“%s”' % ("already at" if "already up-to-date" in output else "updated to", extractRegexResult(r"\binstalled sqlmap-(?P<result>\d+\.\d+\.\d+)", output) or extractRegexResult(r"\((?P<result>\d+\.\d+\.\d+)\)", output)))
        else:
            logger.error("update could not be completed ('%s')" % re.sub(r"[^a-z0-9:/\\]+", " ", output).strip())

    elif not os.path.exists(os.path.join(paths.SQLMAP_ROOT_PATH, ".git")):
        warnMsg = '不是 git 存储库。建议克隆“sqlmapproject/sqlmap”存储库 '
        warnMsg += '来自 GitHub（例如“git clone --depth 1 %s sqlmap”）' % GIT_REPOSITORY
        logger.warning(warnMsg)

        if VERSION == getLatestRevision():
            logger.info('已经是最新版本“%s”' % (getRevisionNumber() or VERSION))
            return

        message = '您想尝试从存储库中获取最新的“zipball”并提取它（实验性的）吗？ [是/否]'
        if readInput(message, default='N', boolean=True):
            directory = os.path.abspath(paths.SQLMAP_ROOT_PATH)

            try:
                open(os.path.join(directory, "sqlmap.py"), "w+b")
            except Exception as ex:
                errMsg = '无法更新目录“%s”的内容（“%s”）' % (directory, getSafeExString(ex))
                logger.error(errMsg)
            else:
                attrs = os.stat(os.path.join(directory, "sqlmap.py")).st_mode
                for wildcard in ('*', ".*"):
                    for _ in glob.glob(os.path.join(directory, wildcard)):
                        try:
                            if os.path.isdir(_):
                                shutil.rmtree(_)
                            else:
                                os.remove(_)
                        except:
                            pass

                if glob.glob(os.path.join(directory, '*')):
                    errMsg = '无法清除目录“%s”的内容' % directory
                    logger.error(errMsg)
                else:
                    try:
                        archive = _urllib.request.urlretrieve(ZIPBALL_PAGE)[0]

                        with zipfile.ZipFile(archive) as f:
                            for info in f.infolist():
                                info.filename = re.sub(r"\Asqlmap[^/]+", "", info.filename)
                                if info.filename:
                                    f.extract(info, directory)

                        filepath = os.path.join(paths.SQLMAP_ROOT_PATH, "lib", "core", "settings.py")
                        if os.path.isfile(filepath):
                            with openFile(filepath, "r") as f:
                                version = re.search(r"(?m)^VERSION\s*=\s*['\"]([^'\"]+)", f.read()).group(1)
                                logger.info('更新到最新版本“%s#dev”' % version)
                                success = True
                    except Exception as ex:
                        logger.error("update could not be completed ('%s')" % getSafeExString(ex))
                    else:
                        if not success:
                            logger.error("update could not be completed")
                        else:
                            try:
                                os.chmod(os.path.join(directory, "sqlmap.py"), attrs)
                            except OSError:
                                logger.warning('无法设置“%s”的文件属性' % os.path.join(directory, "sqlmap.py"))

    else:
        infoMsg = '将 sqlmap 更新到最新的开发版本 '
        infoMsg += 'GitHub 存储库'
        logger.info(infoMsg)

        debugMsg = 'sqlmap 将尝试使用“git”命令更新自身'
        logger.debug(debugMsg)

        dataToStdout('\r[%s] [INFO] 更新中' % time.strftime("%X"))

        output = ""
        try:
            process = subprocess.Popen("git checkout . && git pull %s HEAD" % GIT_REPOSITORY, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=paths.SQLMAP_ROOT_PATH)
            pollProcess(process, True)
            output, _ = process.communicate()
            success = not process.returncode
        except Exception as ex:
            success = False
            output = getSafeExString(ex)
        finally:
            output = getText(output)

        if success:
            logger.info('%s 最新修订版“%s”' % ("already at" if "Already" in output else "updated to", getRevisionNumber()))
        else:
            if "Not a git repository" in output:
                errMsg = '不是有效的 git 存储库。请查看“sqlmapproject/sqlmap”存储库 '
                errMsg += '来自 GitHub（例如“git clone --depth 1 %s sqlmap”）' % GIT_REPOSITORY
                logger.error(errMsg)
            else:
                logger.error("update could not be completed ('%s')" % re.sub(r"\W+", " ", output).strip())

    if not success:
        if IS_WIN:
            infoMsg = '对于Windows平台，推荐 '
            infoMsg += '使用 GitHub for Windows 客户端进行更新 '
            infoMsg += '目的（https://desktop.github.com/) 或只是 '
            infoMsg += '从下载最新的快照 '
            infoMsg += "https://github.com/sqlmapproject/sqlmap/downloads"
        else:
            infoMsg = '对于Linux平台，推荐 '
            infoMsg += '安装标准的“git”包（例如：“apt install git”）'

        logger.info(infoMsg)
