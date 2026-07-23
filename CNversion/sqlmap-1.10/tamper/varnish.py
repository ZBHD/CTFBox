#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from lib.core.enums import PRIORITY

__priority__ = PRIORITY.NORMAL

def dependencies():
    pass

def tamper(payload, **kwargs):
    '\n    附加 HTTP 标头“X-originating-IP”以绕过 Varnish 防火墙\n\n    Reference:\n        * https://web.archive.org/web/20160815052159/http://community.hpe.com/t5/Protect-Your-Assets/Bypassing-web-application-firewalls-using-HTTP-headers/ba-p/6418366\n\n    Notes:\n        Examples:\n        >> X 转发：TARGET_CACHESERVER_IP (184.189.250.X)\n        >> X-远程-IP：TARGET_PROXY_IP (184.189.250.X)\n        >> X 原始 IP：TARGET_LOCAL_IP (127.0.0.1)\n        >> x-remote-addr: TARGET_INTERNALUSER_IP (192.168.1.X)\n        >> X-remote-IP: * or %00 or %0A\n    '

    headers = kwargs.get("headers", {})
    headers["X-originating-IP"] = "127.0.0.1"
    return payload
