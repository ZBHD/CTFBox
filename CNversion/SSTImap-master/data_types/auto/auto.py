from core.data_type import DataType, loaded_data_types
from urllib import parse
import json
import xml.etree.ElementTree as xml
from utils.loggers import log


class Auto(DataType):
    data_type_info = {
        "Description": '根据提供的部件猜测 POST 正文格式。',
        "Usage notes": '默认情况下，仅检测“json”和“form”，并使用“text”作为后备。\n 服务器通常需要适当的 Content-Type 请求头。\n 此数据类型还支持将选项传递给检测到的数据类型。',
        "Authors": [
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",
        ],
        "Options": [
            "special=False - also test for 'fromhex' and 'fromfile' data types",
            "['json' only] deep_update=True - recursively update dictionaries",
            "['xml' only] html=False - output data as HTML instead of XML",
            "['xml' only, html=False] declaration=True - add XML declaration",
            "['xml' only, html=False] short_empty=False - use <tag /> syntax",
            "['form' only] keep_blank_values=True - keep empty values (e.g. in a=&b=5, param 'a' will not be removed)",
        ],
    }

    _detected = None

    def injection_points(self, data, all_injectable=False):
        if not self._detected:
            self._detect(data)
        return self._detected.injection_points(data, all_injectable=all_injectable)

    def _detect(self, values):
        test_json = True
        for v in values:
            try:
                # 确保字典位于顶层
                json.loads(v.replace(self.tag, "")).keys()
            except Exception:
                test_json = False
                break
        if test_json:
            log.log(24, 'POST 数据类型检测为“JSON”')
            self._detected = loaded_data_types["json"](self.args, self.tag)
            return
        test_xml = True
        for v in values:
            try:
                # 确保标签存在
                xml.fromstring(v.replace(self.tag, "")).tag
            except Exception:
                test_xml = False
                break
        if test_xml:
            log.log(24, 'POST 数据类型检测为“XML”')
            self._detected = loaded_data_types["xml"](self.args, self.tag)
            return
        test_form = True
        try:
            # TODO：更严格的检测
            parse.parse_qs('&'.join(values), strict_parsing=True)
        except Exception:
            test_form = False
        if test_form:
            log.log(24, 'POST 数据类型检测为“Form”')
            self._detected = loaded_data_types["form"](self.args, self.tag)
            return
        if self.args.get("module_params", {}).get("special", False):
            test_hex = True
            for v in values:
                try:
                    bytes.fromhex(v.replace(self.tag, ""))
                except Exception:
                    test_hex = False
                    break
            if test_hex:
                log.log(24, 'POST 数据类型检测为“FromHex”')
                self._detected = loaded_data_types["fromhex"](self.args, self.tag)
                return
            test_file = True
            for v in values:
                try:
                    open(v, "rb").close()
                except Exception:
                    test_file = False
                    break
            if test_file:
                log.log(24, 'POST 数据类型检测为“FromFile”')
                self._detected = loaded_data_types["fromfile"](self.args, self.tag)
                return
        log.log(25, '未检测到 POST 数据类型，假设为“文本”')
        self._detected = loaded_data_types["text"](self.args, self.tag)
        return

    def get_params(self):
        if not self._detected:
            return {}
        return self._detected.get_params()

    def inject(self, injection, inj):
        if not self._detected:
            return {}
        return self._detected.inject(injection, inj)
