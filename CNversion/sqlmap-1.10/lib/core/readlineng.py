#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

_readline = None
try:
    from readline import *
    import readline as _readline
except:
    try:
        from pyreadline import *
        import pyreadline as _readline
    except:
        pass

from lib.core.data import logger
from lib.core.settings import IS_WIN
from lib.core.settings import PLATFORM

if IS_WIN and _readline:
    try:
        _outputfile = _readline.GetOutputFile()
    except AttributeError:
        debugMsg = '使用平台时获取输出文件失败 '
        debugMsg += '读行库'
        logger.debug(debugMsg)

        _readline = None

# 测试是否使用 libedit 而不是 GNU readline。
# 感谢 Boyd Waters 提供此补丁。
uses_libedit = False

if PLATFORM == "mac" and _readline:
    import commands

    (status, result) = commands.getstatusoutput("otool -L %s | grep libedit" % _readline.__file__)

    if status == 0 and len(result) > 0:
        # 我们必须使用 libedit - Leopard 中的新功能
        _readline.parse_and_bind("bind ^I rl_complete")

        debugMsg = '使用平台时检测到 Leopard libedit '
        debugMsg += '读行库'
        logger.debug(debugMsg)

        uses_libedit = True

# clear_history() 函数仅在 Python 2.4 中引入，并且是
# 实际上在 readline API 中是可选的，所以我们必须显式检查它的
# 存在。  一些已知的平台实际上没有它。  这个线程：
# http://mail.python.org/pipermail/python-dev/2003-August/037845.html
# 有原始讨论。
if _readline:
    if not hasattr(_readline, "clear_history"):
        def clear_history():
            pass

        _readline.clear_history = clear_history
