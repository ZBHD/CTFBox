#!/usr/bin/env python

# 版权所有 (c) 2006-2026 sqlmap 开发人员 (https://sqlmap.org)
# 请参阅文件“LICENSE”以获取复制权限

# 删除单词列表中的重复条目（如文件）

from __future__ import print_function

import sys

if __name__ == "__main__":
    if len(sys.argv) > 1:
        items = list()

        with open(sys.argv[1], 'r') as f:
            for item in f:
                item = item.strip()
                try:
                    str.encode(item)
                    if item in items:
                        if item:
                            print(item)
                    else:
                        items.append(item)
                except:
                    pass

        with open(sys.argv[1], 'w+') as f:
            f.writelines("\n".join(items))
