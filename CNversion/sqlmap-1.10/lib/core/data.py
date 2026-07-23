#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.datatype import AttribDict
from lib.core.log import LOGGER

# sqlmap路径
paths = AttribDict()

# 存储原始命令行选项的对象
cmdLineOptions = AttribDict()

# 存储合并选项的对象（命令行、配置文件和默认选项）
mergedOptions = AttribDict()

# 在函数和类命令中共享的对象
# 线路选项和设置
conf = AttribDict()

# 在函数和类中共享结果的对象
kb = AttribDict()

# 具有每个数据库管理系统特定查询的对象
queries = {}

# logger
logger = LOGGER
