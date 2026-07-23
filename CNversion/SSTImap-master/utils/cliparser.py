import argparse
from sstimap import version


ARGPARSE_TRANSLATIONS = {
    "usage: ": "用法：",
    "options": "选项",
    "show this help message and exit": "显示帮助信息并退出",
    "show program's version number and exit": "显示程序版本号并退出",
}
argparse._ = lambda message: ARGPARSE_TRANSLATIONS.get(message, message)


def banner():
    msg = """\033[93m
    ╔══════╦══════╦═══════╗ ▀█▀
    ║ ╔════╣ ╔════╩══╗ ╔══╝═╗\033[41m▀\033[49m╔═
    ║ ╚════╣ ╚════╗  ║ ║    ║\033[41m{\033[49m║ \033[94m _ __ ___   __ _ _ __\033[93m
    ╚════╗ ╠════╗ ║  ║ ║    ║\033[41m*\033[49m║ \033[94m| '_ ` _ \\ / _` | '_ \\\033[93m
    ╔════╝ ╠════╝ ║  ║ ║    ║\033[41m}\033[49m║ \033[94m| | | | | | (_| | |_) |\033[93m
    ╚══════╩══════╝  ╚═╝    ╚╦╝\033[94m |_| |_| |_|\\__,_| .__/\033[93m
                             │                  \033[94m| |
                                                |_|\033[0m"""
    msg += f"\n\033[94m[*]\033[0m 版本：{version}" \
           f"\n\033[94m[*]\033[0m 作者：\033]8;;https://github.com/vladko312\007@vladko312\033]8;;\007" \
           f"\n\033[34m[*]\033[0m 基于 \033]8;;https://github.com/epinna/tplmap\007Tplmap\033]8;;\007" \
           f"\n\033[91m[!] 使用声明\033[0m：请仅在获得许可的目标或本地测试环境中使用 SSTImap。" \
           f"\n最终用户应遵守适用的法律法规。开发者不对误用或由本程序造成的损害负责。"
    return msg


parser = argparse.ArgumentParser(description='SSTImap 是一种自动 SSTI 检测和利用工具，具有预设模式和交互模式。')
parser.add_argument('-V', '--version', action='version', version=f'SSTImap version {version}')
parser.add_argument("--module", dest="module", help='提供有关模块的信息（“列表”以显示所有模块）')
parser.add_argument("--config", dest="config", help='使用自定义配置文件或目录')
parser.add_argument("--no-color", action="store_const", const=False, dest="colour", help='禁用输出中的颜色')


target = parser.add_argument_group(title='目标',
                                   description='必须提供至少其中一个选项来定义目标')
target.add_argument("-u", "--url", dest="url",
                    help='目标网址（例如“https://example.com/?name=test”）')
target.add_argument("-i", "--interactive", action="store_const", const=True, dest="interactive",
                    help='以交互模式运行 SSTImap')
target.add_argument("--load-urls", dest="load_urls", help='要从中加载 URL 的文件或目录（使用“-”表示 STDIN）')
target.add_argument("--load-forms", dest="load_forms", help='要从中加载表单的文件或目录（使用“-”表示 STDIN）')

request = parser.add_argument_group(title='请求', description='这些选项可以指定如何连接到目标 URL 并添加可能的攻击向量')
request.add_argument("-M", "--marker", dest="marker",
                     help='使用字符串作为注入标记（默认“*”）')
request.add_argument("-P", "--injection-points", dest="injection_points",
                     help='无需标记即可测试的注入点：Q(uery) B(ody) H(eaders) C(ookies)。默认值：QBHC')
request.add_argument("-d", "--data", action="append", dest="data",
                     help='请求发送正文数据参数（例如“param=value”）[Stackable]', default=[])
request.add_argument("--data-type", dest="data_type",
                     help='请求正文数据类型（默认“auto”）')
request.add_argument("--data-params", action="append", dest="module_params", metavar="KEY=VALUE",
                     help='插件的模块参数和请求正文数据类型', default=[])
request.add_argument("-H", "--header", action="append", dest="headers", metavar="HEADER",
                     help='要发送的请求头（例如“请求头：值”）[可堆叠]', default=[])
request.add_argument("-C", "--cookie", action="append", dest="cookies", metavar="COOKIE",
                     help='要发送的 Cookie（例如“Field=Value”）[Stackable]', default=[])
request.add_argument("-m", "--method", dest="method",
                     help='要使用的 HTTP 方法（默认“GET”）')
request.add_argument("-a", "--user-agent", dest="user_agent",
                     help='要使用的 User-Agent 请求头值')
request.add_argument("-A", "--random-user-agent", action="store_const", const=True, dest="random_agent",
                     help='每个请求的桌面浏览器列表中的随机 User-Agent 请求头值')
request.add_argument("--delay", dest="delay", type=float, help='请求之间的延迟（默认/0：无延迟）')
request.add_argument("-p", "--proxy", dest="proxy",
                     help='使用代理连接到目标 URL')
request.add_argument("--verify-ssl", action="store_const", const=True, dest="verify_ssl",
                     help='验证 SSL 证书（默认情况下不验证）')
request.add_argument("--log-response", action="store_const", const=True, dest="log_response",
                     help='将 HTTP 响应包含到 ~/.sstimap/sstimap.log 中')

crawler = parser.add_argument_group(title='爬虫', description='这些选项可以指定如何检测目标网站上的 URL 和表单。')
crawler.add_argument("-c", "--crawl", dest="crawl_depth", type=int,
                     help='抓取深度（默认/0：不抓取）')
crawler.add_argument("-f", "--forms", action="store_const", const=True, dest="forms",
                     help='扫描页面中的表单')
crawler.add_argument("--empty-forms", action="store_const", const=True, dest="empty_forms",
                     help='将没有参数的页面视为 GET 表单')
crawler.add_argument("--crawl-exclude", dest="crawl_exclude", help='不抓取 URL 中的正则表达式')
crawler.add_argument("--crawl-domains", dest="crawl_domains",
                     help='抓取其他域：Y(es) / S(ubdomains) / N(o)。默认值：S')
crawler.add_argument("--save-urls", dest="save_urls", help='用于保存爬取 URL 的文件或目录')
crawler.add_argument("--save-forms", dest="save_forms", help='用于保存爬取表单的文件或目录')

detection = parser.add_argument_group(title='检测',
                                      description='这些选项可用于自定义检测阶段。')
detection.add_argument("-l", "--level", dest="level", type=int,
                       help='要执行的转义级别（1-5，默认值：1）')
detection.add_argument("-L", "--force-level", dest="force_level", metavar=("LEVEL", "CLEVEL",),
                       help='强制 LEVEL 和 CLEVEL 进行测试', nargs=2, type=int)
detection.add_argument("-e", "--engine", dest="engine",
                       help='要测试的以逗号分隔的模板引擎列表：[语言：[变体：]][类别/]引擎，...对于所有内容，请使用“*”')
detection.add_argument("-r", "--technique", dest="technique",
                       help='技术：R（渲染）E（基于报错）B（布尔报错型盲注）T（基于时间的盲法）。默认值：REBT')
detection.add_argument("--bool-ok", dest="boolean_regex_ok",
                       help='当基于布尔错误的盲载荷正确评估时进行匹配的正则表达式')
detection.add_argument("--bool-err", dest="boolean_regex_err",
                       help='当基于布尔错误的盲负载导致错误时匹配正则表达式')
detection.add_argument("--bool-match", dest="boolean_match",
                       help='以逗号分隔的匹配参数列表或“全部”。默认值：代码、header_count、cookie_count、byte_len、body_len、body_words、body_lines、编码、重定向、时间、url、content_type、服务器')
detection.add_argument("--bool-match-min", dest="boolean_match_min", type=int,
                       help='用于匹配的最小可用参数数量。默认值：7')
detection.add_argument("--bool-fuzzy", dest="boolean_fuzzy", nargs=2, type=float, metavar=("STABLE", "ERROR",),
                       help='允许一些匹配参数存在小偏差。默认值：0.05 0.1')
detection.add_argument("--bool-samples", dest="boolean_samples", nargs=3, type=int, metavar=("COUNT", "MIN", "MAX",),
                       help='用于分析页面和载荷大小的测试数量。默认值：10 1 7')
detection.add_argument("--blind-delay", dest="time_based_blind_delay", type=int,
                       help='延迟检测基于时间的盲注入（默认值：4 秒）')
detection.add_argument("--verify-blind-delay", dest="time_based_verify_blind_delay", type=int,
                       help='延迟验证和利用基于时间的盲注入（默认值：30 秒）')
detection.add_argument("--legacy", dest="legacy", action="store_const", const=True,
                       help='包括不再适用于新版本引擎的旧载荷')
detection.add_argument("--generic", dest="generic", action="store_const", const=False,
                       help='尝试通用引擎的专用载荷，检测更多上下文。')
detection.add_argument("--run", dest="run", action="store_const", const=True,
                       help='在 SSTImap 开始时以交互模式运行检测。')

payload = parser.add_argument_group(title='载荷',
                                    description='这些选项可用于在攻击后访问模板引擎、文件系统或操作系统 shell。')
payload.add_argument("-t", "--tpl-shell", dest="tpl_shell", action="store_const", const=True,
                     help='提示模板引擎上的交互式 shell')
payload.add_argument("-T", "--tpl-code", dest="tpl_code",
                     help='在模板引擎中注入代码')
payload.add_argument("-x", "--eval-shell", dest="eval_shell", action="store_const", const=True,
                     help='提示使用模板引擎基本语言的交互式 shell')
payload.add_argument("-X", "--eval-code", dest="eval_code",
                     help='评估模板引擎基本语言中的代码')
payload.add_argument("-s", "--os-shell", dest="os_shell", action="store_const", const=True,
                     help='提示输入交互式操作系统 shell')
payload.add_argument("-S", "--os-cmd", dest="os_cmd",
                     help='执行操作系统命令')
payload.add_argument("-B", "--bind-shell", dest="bind_shell", nargs=1, type=int, metavar="PORT",
                     help='在目标的 TCP 端口上生成系统 shell 并连接到它')
payload.add_argument("-R", "--reverse-shell", dest="reverse_shell", nargs=2, metavar=("HOST", "PORT",),
                     help='运行系统 shell 并反向连接到本地主机端口')
payload.add_argument("--remote-shell", dest="remote_shell",
                     help='目标上预期的系统 shell（默认“/bin/sh”）')
payload.add_argument("-F", "--force-overwrite", dest="force_overwrite", action="store_const", const=True,
                     help='上传时强制覆盖文件')
payload.add_argument("-U", "--upload", dest="upload", metavar=("LOCAL", "REMOTE",),
                     help='将本地文件上传到远程文件', nargs=2)
payload.add_argument("-D", "--download", dest="download", metavar=("REMOTE", "LOCAL",),
                     help='下载远程文件到本地文件', nargs=2)

options = parser.parse_args()
