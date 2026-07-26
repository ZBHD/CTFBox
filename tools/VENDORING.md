# Web 工具依赖交付说明

CTFBox 的 Web 工具按“真实交互模型”分为三类，运行器由 `tool_registry.json` 的
`runner.kind` 区分。仓库内含全部**调用与解析代码**并有单元测试覆盖，但**第三方工具本体
（Go 二进制、Python 源码树）需按下述约定就位后才能真正联网执行**——它们不随源码仓库分发。

## kind = "python"（源码型扫描器 / 注入器）

- 例：`sqlmap`、`sstimap`、`dirsearch`
- 交付位置：`Original/<sourceDirectory>/<entry>`（汉化版放 `CNversion/<sourceDirectory>/<entry>`）
- 调用链：Rust `run_tool` → `python -B -u tools/ctfbox_launcher.py <tool> [-cn] <args>`
  → 启动器 `runpy` 执行入口脚本。
- dirsearch 需要将其源码树放到 `Original/dirsearch/`，入口 `dirsearch.py`。

## kind = "binary"（预编译 Go 工具）

- 例：`subfinder`、`nuclei`
- 交付位置：`tools/bin/<os>/<program>[.exe]`
  - `<os>` 取 Rust `std::env::consts::OS`：`windows` / `linux` / `macos`
  - Windows 下自动追加 `.exe`
  - 例：`tools/bin/windows/subfinder.exe`、`tools/bin/linux/nuclei`
- 调用链：Rust `run_tool` 校验白名单程序名（`^[a-z0-9][a-z0-9-]*$`）→ 确认文件存在
  → **不经 shell** 直接 `Command::new(executable).args(...)` spawn，规避命令注入。
- 请从官方 Release 下载对应平台二进制放入上述目录；仓库不内置以避免体积与许可问题。

## kind = "session"（第一方长驻引擎）

- 例：`webshell`
- 交付位置：`tools/clients/<sourceDirectory>/<entry>`（**已随仓库提供**，纯标准库实现）
- 调用链：与 python 型一致，经启动器执行，但路由到 `tools/clients/` 且无版本分支。
- webshell 引擎通过 stdin/stdout 的 NDJSON 协议与前端 `WebshellWorkbench` 交互，
  仅连接使用者显式指定的目标，不落盘、不自动扫描。

## 验证边界

单元测试覆盖：命令构造、`runner.kind` 分派、二进制名白名单与路径解析、
三个扫描器的输出解析器、webshell NDJSON 往返与前端会话客户端。
**联网执行**依赖上述本体就位，不在本仓库自动化测试范围内。
