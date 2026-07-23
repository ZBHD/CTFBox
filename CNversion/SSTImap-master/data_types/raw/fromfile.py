from core.data_type import DataType
from copy import deepcopy
from utils.loggers import log


class FromFile(DataType):
    data_type_info = {
        "Description": '二进制 HTTP 正文，按路径作为文件提供给 SSTImap',
        "Usage notes": '提供包含二进制正文部分的文件的路径。\n 服务器通常需要适当的 Content-Type 请求头。',
        "Authors": [
            "Vladislav Korchagin @vladko312 https://github.com/vladko312",
        ]
    }

    def injection_points(self, data, all_injectable=False):
        injs = []
        self.params = []
        params_list = self._process_values(data)
        for idx, param in enumerate(params_list):
            self.params.append(param)
            if all_injectable or self.tag.encode() in param:
                injs.append({'field': 'Body', 'param': idx})
        return injs

    def _process_values(self, values):
        parts = []
        for p in values:
            try:
                f = open(p, "rb")
                v = f.read()
                f.close()
                parts.append(v)
            except OSError as e:
                log.log(22, f'无法访问 HTTP 正文部分文件 {p}: {repr(e)}')
        return parts

    def get_params(self):
        return b"".join([x.replace(self.tag.encode(), b"") for x in self.params])

    def inject(self, injection, inj):
        params = deepcopy(self.params)
        clear_params = [x.replace(self.tag.encode(), b"") for x in deepcopy(self.params)]
        if self.tag in params[inj.get('param')]:
            clear_params[inj.get('param')] = params[inj.get('param')].replace(self.tag.encode(), injection.encode())
        else:
            clear_params[inj.get('param')] = injection.encode()
        return b"".join(clear_params)
