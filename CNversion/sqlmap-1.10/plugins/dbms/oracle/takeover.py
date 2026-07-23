#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.exception import SqlmapUnsupportedFeatureException
from plugins.generic.takeover import Takeover as GenericTakeover

class Takeover(GenericTakeover):
    def osCmd(self):
        errMsg = '操作系统命令执行功能不 '
        errMsg += '尚未为 Oracle 实施'
        raise SqlmapUnsupportedFeatureException(errMsg)

    def osShell(self):
        errMsg = '操作系统 shell 功能尚未实现 '
        errMsg += '为 Oracle 实施'
        raise SqlmapUnsupportedFeatureException(errMsg)

    def osPwn(self):
        errMsg = '操作系统带外控制功能 '
        errMsg += '尚未针对 Oracle 实施'
        raise SqlmapUnsupportedFeatureException(errMsg)

    def osSmb(self):
        errMsg = '一键操作系统带外控制 '
        errMsg += 'Oracle 尚未实现的功能'
        raise SqlmapUnsupportedFeatureException(errMsg)
