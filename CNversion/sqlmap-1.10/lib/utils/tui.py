#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import os
import subprocess
import sys
import tempfile

try:
    import curses
except ImportError:
    curses = None

from lib.core.common import getSafeExString
from lib.core.common import saveConfig
from lib.core.data import paths
from lib.core.defaults import defaults
from lib.core.enums import MKSTEMP_PREFIX
from lib.core.exception import SqlmapMissingDependence
from lib.core.exception import SqlmapSystemException
from lib.core.settings import IS_WIN
from thirdparty.six.moves import queue as _queue
from thirdparty.six.moves import configparser as _configparser

class NcursesUI:
    def __init__(self, stdscr, parser):
        self.stdscr = stdscr
        self.parser = parser
        self.current_tab = 0
        self.current_field = 0
        self.scroll_offset = 0
        self.tabs = []
        self.fields = {}
        self.running = False
        self.process = None
        self.queue = None

        # 初始化颜色
        curses.start_color()
        curses.init_pair(1, curses.COLOR_BLACK, curses.COLOR_CYAN)    # Header
        curses.init_pair(2, curses.COLOR_WHITE, curses.COLOR_BLUE)    # 活动选项卡
        curses.init_pair(3, curses.COLOR_BLACK, curses.COLOR_WHITE)   # 非活动选项卡
        curses.init_pair(4, curses.COLOR_YELLOW, curses.COLOR_BLACK)  # 所选字段
        curses.init_pair(5, curses.COLOR_GREEN, curses.COLOR_BLACK)   # 帮助文本
        curses.init_pair(6, curses.COLOR_RED, curses.COLOR_BLACK)     # 错误/重要
        curses.init_pair(7, curses.COLOR_CYAN, curses.COLOR_BLACK)    # Label

        # 设置诅咒
        curses.curs_set(1)
        self.stdscr.keypad(1)

        # 解析选项组
        self._parse_options()

    def _parse_options(self):
        """Parse command line options into tabs and fields"""
        for group in self.parser.option_groups:
            tab_data = {
                'title': group.title,
                'description': group.get_description() if hasattr(group, 'get_description') and group.get_description() else "",
                'options': []
            }

            for option in group.option_list:
                field_data = {
                    'dest': option.dest,
                    'label': self._format_option_strings(option),
                    'help': option.help if option.help else "",
                    'type': option.type if hasattr(option, 'type') and option.type else 'bool',
                    'value': '',
                    'default': defaults.get(option.dest) if defaults.get(option.dest) else None
                }
                tab_data['options'].append(field_data)
                self.fields[(group.title, option.dest)] = field_data

            self.tabs.append(tab_data)

    def _format_option_strings(self, option):
        """Format option strings for display"""
        parts = []
        if hasattr(option, '_short_opts') and option._short_opts:
            parts.extend(option._short_opts)
        if hasattr(option, '_long_opts') and option._long_opts:
            parts.extend(option._long_opts)
        return ', '.join(parts)

    def _draw_header(self):
        """Draw the header bar"""
        height, width = self.stdscr.getmaxyx()
        header = " sqlmap - ncurses TUI "
        self.stdscr.attron(curses.color_pair(1) | curses.A_BOLD)
        self.stdscr.addstr(0, 0, header.center(width))
        self.stdscr.attroff(curses.color_pair(1) | curses.A_BOLD)

    def _get_tab_bar_height(self):
        """Calculate how many rows the tab bar uses"""
        height, width = self.stdscr.getmaxyx()
        y = 1
        x = 0

        for i, tab in enumerate(self.tabs):
            tab_text = " %s " % tab['title']

            # 检查制表符是否超出宽度，换行到下一行
            if x + len(tab_text) >= width:
                y += 1
                x = 0
                # 如果我们使用了太多行就停止
                if y >= 3:
                    break

            x += len(tab_text) + 1

        return y

    def _draw_tabs(self):
        """Draw the tab bar"""
        height, width = self.stdscr.getmaxyx()
        y = 1
        x = 0

        for i, tab in enumerate(self.tabs):
            tab_text = " %s " % tab['title']

            # 检查制表符是否超出宽度，换行到下一行
            if x + len(tab_text) >= width:
                y += 1
                x = 0
                # 如果我们使用了太多行就停止
                if y >= 3:
                    break

            if i == self.current_tab:
                self.stdscr.attron(curses.color_pair(2) | curses.A_BOLD)
            else:
                self.stdscr.attron(curses.color_pair(3))

            try:
                self.stdscr.addstr(y, x, tab_text)
            except:
                pass

            if i == self.current_tab:
                self.stdscr.attroff(curses.color_pair(2) | curses.A_BOLD)
            else:
                self.stdscr.attroff(curses.color_pair(3))

            x += len(tab_text) + 1

    def _draw_footer(self):
        """Draw the footer with help text"""
        height, width = self.stdscr.getmaxyx()
        footer = " [Tab] Next | [Arrows] Navigate | [Enter] Edit | [F2] Run | [F3] Export | [F4] Import | [F10] Quit "

        try:
            self.stdscr.attron(curses.color_pair(1))
            self.stdscr.addstr(height - 1, 0, footer.ljust(width))
            self.stdscr.attroff(curses.color_pair(1))
        except:
            pass

    def _draw_current_tab(self):
        """Draw the current tab content"""
        height, width = self.stdscr.getmaxyx()
        tab = self.tabs[self.current_tab]

        # 计算标签栏高度
        tab_bar_height = self._get_tab_bar_height()
        start_y = tab_bar_height + 1

        # 清除内容区域
        for y in range(start_y, height - 1):
            try:
                self.stdscr.addstr(y, 0, " " * width)
            except:
                pass

        y = start_y

        # 如果存在则绘制描述
        if tab['description']:
            desc_lines = self._wrap_text(tab['description'], width - 4)
            for line in desc_lines[:2]:  # 限制为 2 行
                try:
                    self.stdscr.attron(curses.color_pair(5))
                    self.stdscr.addstr(y, 2, line)
                    self.stdscr.attroff(curses.color_pair(5))
                    y += 1
                except:
                    pass
            y += 1

        # 绘图选项
        visible_start = self.scroll_offset
        visible_end = visible_start + (height - y - 2)

        for i, option in enumerate(tab['options'][visible_start:visible_end], visible_start):
            if y >= height - 2:
                break

            is_selected = (i == self.current_field)

            # 绘制标签
            label = option['label'][:25].ljust(25)
            try:
                if is_selected:
                    self.stdscr.attron(curses.color_pair(4) | curses.A_BOLD)
                else:
                    self.stdscr.attron(curses.color_pair(7))

                self.stdscr.addstr(y, 2, label)

                if is_selected:
                    self.stdscr.attroff(curses.color_pair(4) | curses.A_BOLD)
                else:
                    self.stdscr.attroff(curses.color_pair(7))
            except:
                pass

            # 抽取值
            value_str = ""
            if option['type'] == 'bool':
                value = option['value'] if option['value'] is not None else option.get('default')
                value_str = "[X]" if value else "[ ]"
            else:
                value_str = str(option['value']) if option['value'] else ""
                if option['default'] and not option['value']:
                    value_str = "(%s)" % str(option['default'])

            value_str = value_str[:30]

            try:
                if is_selected:
                    self.stdscr.attron(curses.color_pair(4) | curses.A_BOLD)
                self.stdscr.addstr(y, 28, value_str)
                if is_selected:
                    self.stdscr.attroff(curses.color_pair(4) | curses.A_BOLD)
            except:
                pass

            # 绘制帮助文本
            if width > 65:
                help_text = option['help'][:width-62] if option['help'] else ""
                try:
                    self.stdscr.attron(curses.color_pair(5))
                    self.stdscr.addstr(y, 60, help_text)
                    self.stdscr.attroff(curses.color_pair(5))
                except:
                    pass

            y += 1

        # 绘制滚动指示器
        if len(tab['options']) > visible_end - visible_start:
            try:
                self.stdscr.attron(curses.color_pair(6))
                self.stdscr.addstr(height - 2, width - 10, "[More...]")
                self.stdscr.attroff(curses.color_pair(6))
            except:
                pass

    def _wrap_text(self, text, width):
        """Wrap text to fit within width"""
        words = text.split()
        lines = []
        current_line = ""

        for word in words:
            if len(current_line) + len(word) + 1 <= width:
                current_line += word + " "
            else:
                if current_line:
                    lines.append(current_line.strip())
                current_line = word + " "

        if current_line:
            lines.append(current_line.strip())

        return lines

    def _edit_field(self):
        """Edit the current field"""
        tab = self.tabs[self.current_tab]
        if self.current_field >= len(tab['options']):
            return

        option = tab['options'][self.current_field]

        if option['type'] == 'bool':
            # 切换布尔值
            option['value'] = not option['value']
        else:
            # 文字输入
            height, width = self.stdscr.getmaxyx()

            # Create input window
            input_win = curses.newwin(5, width - 20, height // 2 - 2, 10)
            input_win.box()
            input_win.attron(curses.color_pair(2))
            input_win.addstr(0, 2, " Edit %s " % option['label'][:20])
            input_win.attroff(curses.color_pair(2))
            input_win.addstr(2, 2, "Value:")
            input_win.refresh()

            # 获取输入
            curses.echo()
            curses.curs_set(1)

            # 预填充现有值
            current_value = str(option['value']) if option['value'] else ""
            input_win.addstr(2, 9, current_value)
            input_win.move(2, 9)

            try:
                new_value = input_win.getstr(2, 9, width - 32).decode('utf-8')

                # 根据类型进行验证和转换
                if option['type'] == 'int':
                    try:
                        option['value'] = int(new_value) if new_value else None
                    except ValueError:
                        option['value'] = None
                elif option['type'] == 'float':
                    try:
                        option['value'] = float(new_value) if new_value else None
                    except ValueError:
                        option['value'] = None
                else:
                    option['value'] = new_value if new_value else None
            except:
                pass

            curses.noecho()
            curses.curs_set(0)

            # 清除输入窗口
            input_win.clear()
            input_win.refresh()
            del input_win

    def _export_config(self):
        """Export current configuration to a file"""
        height, width = self.stdscr.getmaxyx()

        # Create input window
        input_win = curses.newwin(5, width - 20, height // 2 - 2, 10)
        input_win.box()
        input_win.attron(curses.color_pair(2))
        input_win.addstr(0, 2, " Export Configuration ")
        input_win.attroff(curses.color_pair(2))
        input_win.addstr(2, 2, "File:")
        input_win.refresh()

        # 获取输入
        curses.echo()
        curses.curs_set(1)

        try:
            filename = input_win.getstr(2, 8, width - 32).decode('utf-8').strip()

            if filename:
                # 收集所有字段值
                config = {}
                for tab in self.tabs:
                    for option in tab['options']:
                        dest = option['dest']
                        value = option['value'] if option['value'] is not None else option.get('default')

                        if option['type'] == 'bool':
                            config[dest] = bool(value)
                        elif option['type'] == 'int':
                            config[dest] = int(value) if value else None
                        elif option['type'] == 'float':
                            config[dest] = float(value) if value else None
                        else:
                            config[dest] = value

                # 为未设置的选项设置默认值
                for option in self.parser.option_list:
                    if option.dest not in config or config[option.dest] is None:
                        config[option.dest] = defaults.get(option.dest, None)

                # 保存配置
                try:
                    saveConfig(config, filename)

                    # 显示成功消息
                    input_win.clear()
                    input_win.box()
                    input_win.attron(curses.color_pair(5))
                    input_win.addstr(0, 2, " Export Successful ")
                    input_win.attroff(curses.color_pair(5))
                    input_win.addstr(2, 2, "Configuration exported to:")
                    input_win.addstr(3, 2, filename[:width - 26])
                    input_win.refresh()
                    curses.napms(2000)
                except Exception as ex:
                    # 显示错误信息
                    input_win.clear()
                    input_win.box()
                    input_win.attron(curses.color_pair(6))
                    input_win.addstr(0, 2, " Export Failed ")
                    input_win.attroff(curses.color_pair(6))
                    input_win.addstr(2, 2, str(getSafeExString(ex))[:width - 26])
                    input_win.refresh()
                    curses.napms(2000)
        except:
            pass

        curses.noecho()
        curses.curs_set(0)

        # 清除输入窗口
        input_win.clear()
        input_win.refresh()
        del input_win

    def _import_config(self):
        """Import configuration from a file"""
        height, width = self.stdscr.getmaxyx()

        # Create input window
        input_win = curses.newwin(5, width - 20, height // 2 - 2, 10)
        input_win.box()
        input_win.attron(curses.color_pair(2))
        input_win.addstr(0, 2, " Import Configuration ")
        input_win.attroff(curses.color_pair(2))
        input_win.addstr(2, 2, "File:")
        input_win.refresh()

        # 获取输入
        curses.echo()
        curses.curs_set(1)

        try:
            filename = input_win.getstr(2, 8, width - 32).decode('utf-8').strip()

            if filename and os.path.isfile(filename):
                try:
                    # 读取配置文件
                    config = _configparser.ConfigParser()
                    config.read(filename)

                    imported_count = 0

                    # 将值加载到字段中
                    for tab in self.tabs:
                        for option in tab['options']:
                            dest = option['dest']

                            # 在所有部分中搜索选项
                            for section in config.sections():
                                if config.has_option(section, dest):
                                    value = config.get(section, dest)

                                    # 根据类型转换
                                    if option['type'] == 'bool':
                                        option['value'] = value.lower() in ('true', '1', 'yes', 'on')
                                    elif option['type'] == 'int':
                                        try:
                                            option['value'] = int(value) if value else None
                                        except ValueError:
                                            option['value'] = None
                                    elif option['type'] == 'float':
                                        try:
                                            option['value'] = float(value) if value else None
                                        except ValueError:
                                            option['value'] = None
                                    else:
                                        option['value'] = value if value else None

                                    imported_count += 1
                                    break

                    # 显示成功消息
                    input_win.clear()
                    input_win.box()
                    input_win.attron(curses.color_pair(5))
                    input_win.addstr(0, 2, " Import Successful ")
                    input_win.attroff(curses.color_pair(5))
                    input_win.addstr(2, 2, "Imported %d options from:" % imported_count)
                    input_win.addstr(3, 2, filename[:width - 26])
                    input_win.refresh()
                    curses.napms(2000)

                except Exception as ex:
                    # 显示错误信息
                    input_win.clear()
                    input_win.box()
                    input_win.attron(curses.color_pair(6))
                    input_win.addstr(0, 2, " Import Failed ")
                    input_win.attroff(curses.color_pair(6))
                    input_win.addstr(2, 2, str(getSafeExString(ex))[:width - 26])
                    input_win.refresh()
                    curses.napms(2000)
            elif filename:
                # 找不到文件
                input_win.clear()
                input_win.box()
                input_win.attron(curses.color_pair(6))
                input_win.addstr(0, 2, " File Not Found ")
                input_win.attroff(curses.color_pair(6))
                input_win.addstr(2, 2, "File does not exist:")
                input_win.addstr(3, 2, filename[:width - 26])
                input_win.refresh()
                curses.napms(2000)
        except:
            pass

        curses.noecho()
        curses.curs_set(0)

        # 清除输入窗口
        input_win.clear()
        input_win.refresh()
        del input_win

    def _run_sqlmap(self):
        """Run sqlmap with current configuration"""
        config = {}

        # 收集所有字段值
        for tab in self.tabs:
            for option in tab['options']:
                dest = option['dest']
                value = option['value'] if option['value'] is not None else option.get('default')

                if option['type'] == 'bool':
                    config[dest] = bool(value)
                elif option['type'] == 'int':
                    config[dest] = int(value) if value else None
                elif option['type'] == 'float':
                    config[dest] = float(value) if value else None
                else:
                    config[dest] = value

        # 为未设置的选项设置默认值
        for option in self.parser.option_list:
            if option.dest not in config or config[option.dest] is None:
                config[option.dest] = defaults.get(option.dest, None)

        # Create temp config file
        handle, configFile = tempfile.mkstemp(prefix=MKSTEMP_PREFIX.CONFIG, text=True)
        os.close(handle)

        saveConfig(config, configFile)

        # 显示控制台
        self._show_console(configFile)

    def _show_console(self, configFile):
        """Show console output from sqlmap"""
        height, width = self.stdscr.getmaxyx()

        # Create console window
        console_win = curses.newwin(height - 4, width - 4, 2, 2)
        console_win.box()
        console_win.attron(curses.color_pair(2))
        console_win.addstr(0, 2, " sqlmap Console - Press Q to close ")
        console_win.attroff(curses.color_pair(2))
        console_win.refresh()

        # Create output area
        output_win = console_win.derwin(height - 8, width - 8, 2, 2)
        output_win.scrollok(True)
        output_win.idlok(True)

        # 启动sqlmap进程
        try:
            process = subprocess.Popen(
                [sys.executable or "python", os.path.join(paths.SQLMAP_ROOT_PATH, "sqlmap.py"), "-c", configFile],
                shell=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.PIPE,
                bufsize=1,
                close_fds=not IS_WIN
            )

            if not IS_WIN:
                # 使其非阻塞
                import fcntl
                flags = fcntl.fcntl(process.stdout, fcntl.F_GETFL)
                fcntl.fcntl(process.stdout, fcntl.F_SETFL, flags | os.O_NONBLOCK)

            output_win.nodelay(True)
            console_win.nodelay(True)

            lines = []
            current_line = ""

            while True:
                # 检查用户输入
                try:
                    key = console_win.getch()
                    if key in (ord('q'), ord('Q')):
                        # 杀死进程
                        process.terminate()
                        break
                    elif key == curses.KEY_ENTER or key == 10:
                        # 发送换行符进行处理
                        if process.poll() is None:
                            try:
                                process.stdin.write(b'\n')
                                process.stdin.flush()
                            except:
                                pass
                except:
                    pass

                # 读取输出
                try:
                    chunk = process.stdout.read(1024)
                    if chunk:
                        current_line += chunk.decode('utf-8', errors='ignore')

                        # 分成几行
                        while '\n' in current_line:
                            line, current_line = current_line.split('\n', 1)
                            lines.append(line)

                            # 仅保留最后 N 行
                            if len(lines) > 1000:
                                lines = lines[-1000:]

                            # 显示线
                            output_win.clear()
                            start_line = max(0, len(lines) - (height - 10))
                            for i, l in enumerate(lines[start_line:]):
                                try:
                                    output_win.addstr(i, 0, l[:width-10])
                                except:
                                    pass
                            output_win.refresh()
                            console_win.refresh()
                except:
                    pass

                # 检查进程是否结束
                if process.poll() is not None:
                    # 读取剩余输出
                    try:
                        remaining = process.stdout.read()
                        if remaining:
                            current_line += remaining.decode('utf-8', errors='ignore')
                            for line in current_line.split('\n'):
                                if line:
                                    lines.append(line)
                    except:
                        pass

                    # 显示最终输出
                    output_win.clear()
                    start_line = max(0, len(lines) - (height - 10))
                    for i, l in enumerate(lines[start_line:]):
                        try:
                            output_win.addstr(i, 0, l[:width-10])
                        except:
                            pass

                    output_win.addstr(height - 9, 0, "--- Process finished. Press Q to close ---")
                    output_win.refresh()
                    console_win.refresh()

                    # 等Q
                    console_win.nodelay(False)
                    while True:
                        key = console_win.getch()
                        if key in (ord('q'), ord('Q')):
                            break

                    break

                # 延迟小
                curses.napms(50)

        except Exception as ex:
            output_win.addstr(0, 0, "Error: %s" % getSafeExString(ex))
            output_win.refresh()
            console_win.nodelay(False)
            console_win.getch()

        finally:
            # 清理
            try:
                os.unlink(configFile)
            except:
                pass

            console_win.nodelay(False)
            output_win.nodelay(False)
            del output_win
            del console_win

    def run(self):
        """Main UI loop"""
        while True:
            self.stdscr.clear()

            # 绘制用户界面
            self._draw_header()
            self._draw_tabs()
            self._draw_current_tab()
            self._draw_footer()

            self.stdscr.refresh()

            # 获取输入
            key = self.stdscr.getch()

            tab = self.tabs[self.current_tab]

            # 处理输入
            if key == curses.KEY_F10 or key == 27:  # F10 或 ESC
                break
            elif key == ord('\t') or key == curses.KEY_RIGHT:  # Tab 或右箭头
                self.current_tab = (self.current_tab + 1) % len(self.tabs)
                self.current_field = 0
                self.scroll_offset = 0
            elif key == curses.KEY_LEFT:  # 向左箭头
                self.current_tab = (self.current_tab - 1) % len(self.tabs)
                self.current_field = 0
                self.scroll_offset = 0
            elif key == curses.KEY_UP:  # 向上箭头
                if self.current_field > 0:
                    self.current_field -= 1
                    # 如果需要调整滚动
                    if self.current_field < self.scroll_offset:
                        self.scroll_offset = self.current_field
            elif key == curses.KEY_DOWN:  # 向下箭头
                if self.current_field < len(tab['options']) - 1:
                    self.current_field += 1
                    # 如果需要调整滚动
                    height, width = self.stdscr.getmaxyx()
                    visible_lines = height - 8
                    if self.current_field >= self.scroll_offset + visible_lines:
                        self.scroll_offset = self.current_field - visible_lines + 1
            elif key == curses.KEY_ENTER or key == 10 or key == 13:  # Enter
                self._edit_field()
            elif key == curses.KEY_F2:  # F2 运行
                self._run_sqlmap()
            elif key == curses.KEY_F3:  # F3导出
                self._export_config()
            elif key == curses.KEY_F4:  # F4导入
                self._import_config()
            elif key == ord(' '):  # 布尔切换的空间
                option = tab['options'][self.current_field]
                if option['type'] == 'bool':
                    option['value'] = not option['value']

def runTui(parser):
    """Main entry point for ncurses TUI"""
    # 检查 ncurses 是否可用
    if curses is None:
        raise SqlmapMissingDependence('缺少“curses”模块（可选的 Python 模块）。使用包含curses/ncurses的Python构建，或安装平台提供的等效版本（例如，对于Windows：pip install windows-curses）')
    try:
        # 初始化并运行
        def main(stdscr):
            ui = NcursesUI(stdscr, parser)
            ui.run()

        curses.wrapper(main)

    except Exception as ex:
        errMsg = "无法创建 ncurses UI（'%s'）" % getSafeExString(ex)
        raise SqlmapSystemException(errMsg)
