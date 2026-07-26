# Webshell 多协议引擎

引擎（`webshell.py`）提供 6 个规范操作：`sysinfo / exec / list / read / write / delete`；
每个协议把这些操作翻译成对应 webshell 家族的线格式，从而对接已有的海量存活马。

## 已支持协议

| 协议 | 名称 | 载荷语言 | 编码器 | 说明 |
|------|------|---------|--------|------|
| `ctfbox` | 第一方 | PHP / JSP / ASP / ASPX | `raw` / `base64` | 需目标侧实现 `ctfbox_dispatch` 分发函数 |
| `behinder` | 冰蝎 v3 | PHP / JSP / ASPX | AES-128（固定） | 密钥 = md5(密码)[:16]；请求/响应均 base64+AES-ECB |
| `antsword` | 蚁剑 | PHP / JSP / ASP / ASPX | `raw` / `base64` | `->|` / `|<-` 标记切结果；base64 编码器包一层 `eval(base64_decode(...))` |

## 线格式

- **CTFBox**：POST 表单 `password=loader&ctfbox_args=<JSON|base64>`；shell 回显 `<<<CTFBOX>>>{...}<<</CTFBOX>>>`。
- **冰蝎**：POST 原始字节 `body = base64(AES-128-ECB-PKCS7(载荷源码))`。载荷自行 `openssl_encrypt($o, "aes-128-ecb", $k)`，响应体即 `base64(AES(输出))`。
- **蚁剑**：POST 表单 `pass=<代码>`，`raw` 直传，`base64` 时代码被包成 `eval(base64_decode("..."));`；响应内切 `->|` / `|<-` 之间的内容。

## 载荷标签与仿真验证

每段载荷首行嵌入机读注释标签，供无运行时的测试解释器解析：

```
/*CTFBOX_BH|<op>|<b64_param1>|<b64_param2>|...*/   # 冰蝎载荷
/*CTFBOX_AS|<op>|<b64_param1>|<b64_param2>|...*/   # 蚁剑载荷
```

真实 PHP/JSP/ASPX 解释器把它当普通注释忽略；`test_protocols.py` 中的解释器把它当作
「载荷本应干什么」的元数据，在内存假文件系统上仿真，再按各协议线格式回包
喂给 `parse_response`。**验证范围**：请求编解码、AES 与 PKCS7、参数嵌入/转义、
客户端结果解析。**未验证范围**：目标侧 PHP/JSP/ASPX 语句本身的正确性（需真实解释器/靶机）。

## 真机 E2E 联调（PHP）

`_e2e_php/` 提供最小的真实 PHP shell 与驱动器：

- `shell_behinder.php`：冰蝎 v3 兼容 shell（`openssl_decrypt` + `eval`，默认密码 `rebeyond`）
- `shell_antsword.php`：蚁剑兼容 shell（`eval($_POST['pass'])`）
- `run_e2e.py`：启动 `php -S 127.0.0.1:<free>` 后，用真实 `BehinderProtocol` /
  `AntSwordProtocol` 依次跑 sysinfo/exec/list/write/read/delete 全套

跑法：

```powershell
$env:CTFBOX_PHP = "path\to\php.exe"    # 或让 PATH 上就有 php
python -m pytest tools/clients/webshell/test_e2e_php.py -v
```

未设置且 PATH 无 `php` 时自动跳过；有 PHP 时会真起服务、真做 HTTP、真过一遍解密与 eval，
验证 Python 侧编解码与真实 PHP 8.4.x `openssl_encrypt/openssl_decrypt` 完全互通。

## 扩展协议

新增一种 webshell 协议：

1. 在 `protocols/` 下新增 `<name>.py`，继承 `protocols.base.Protocol`，实现
   `build_request(op, params) -> (body, headers)` 与 `parse_response(op, raw) -> dict`。
2. 若需要按语言分发载荷，在 `protocols/templates/<name>/{__init__.py,<lang>.py}`
   下按 `render(operation, params, key_or_marker) -> str` 生成源码。
3. 在 `protocols/__init__.py` 的 `_REGISTRY` 注册。
4. 载荷首行加机读标签（`/*CTFBOX_<XX>|...*/`），并在 `test_protocols.py` 的
   `interpret()` 里补齐相应分支。

## 添加语言支持

- 冰蝎 / 蚁剑：新增 `protocols/templates/<protocol>/<lang>.py`，实现 `render(operation, params, key)`；
  在同目录 `__init__.py` 的 `_LANGS` 注册。前端 `WebshellWorkbench.tsx` 的
  `PROTOCOLS` 能力矩阵也要同步添加。
- 语言差异（Windows 命令、字节 I/O 等）由载荷模板承担，客户端与协议层不变。

## 已知限制

- 冰蝎 JSP / ASPX 的真实马采用预编译字节码 / 程序集加载；本引擎首阶段以源码字符串表达同等语义，
  用于验证请求编解码与线格式。要对接真实 shell 需换用预编译资源，标签形式保持一致。
- 冰蝎不支持 Classic ASP（历史原因）。蚁剑 Classic ASP 载荷使用 JScript + ADODB/XMLDOM。
- 蚁剑 `raw` 编码不改写代码；`base64` 会把整段载荷包一层 `eval(base64_decode("..."));`。
- 引擎与真实马交互时只连接用户显式指定的目标，不落盘、不扫描。
