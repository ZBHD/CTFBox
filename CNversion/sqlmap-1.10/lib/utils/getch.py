#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

class _Getch(object):
    """
    Gets a single character from standard input.  Does not echo to
    the screen (reference: http://code.activestate.com/recipes/134892/)
    """
    def __init__(self):
        try:
            self.impl = _GetchWindows()
        except ImportError:
            try:
                self.impl = _GetchMacCarbon()
            except (AttributeError, ImportError):
                self.impl = _GetchUnix()

    def __call__(self):
        return self.impl()

class _GetchUnix(object):
    def __init__(self):
        __import__("tty")

    def __call__(self):
        import sys
        import termios
        import tty

        fd = sys.stdin.fileno()
        old_settings = termios.tcgetattr(fd)
        try:
            tty.setraw(sys.stdin.fileno())
            ch = sys.stdin.read(1)
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)
        return ch

class _GetchWindows(object):
    def __init__(self):
        __import__("msvcrt")

    def __call__(self):
        import msvcrt
        return msvcrt.getch()

class _GetchMacCarbon(object):
    """
    A function which returns the current ASCII key that is down;
    if no ASCII key is down, the null string is returned.  The
    page http://www.mactech.com/macintosh-c/chap02-1.html was
    very helpful in figuring out how to do this.
    """
    def __init__(self):
        import Carbon

        getattr(Carbon, "Evt")  # 看看它是否有这个（在 Unix 中没有）

    def __call__(self):
        import Carbon

        if Carbon.Evt.EventAvail(0x0008)[0] == 0:  # 0x0008 是 keyDownMask
            return ''
        else:
            #
            # 该事件包含以下信息：
            # (什么、味精、何时、何地、mod)=Carbon.Evt.GetNextEvent(0x0008)[1]
            #
            # 消息 (msg) 包含 ASCII 字符，即
            # 使用 0x000000FF charCodeMask 提取；这
            # 使用 chr() 将数字转换为 ASCII 字符，并且
            # returned
            #
            (what, msg, when, where, mod) = Carbon.Evt.GetNextEvent(0x0008)[1]
            return chr(msg & 0x000000FF)

getch = _Getch()
