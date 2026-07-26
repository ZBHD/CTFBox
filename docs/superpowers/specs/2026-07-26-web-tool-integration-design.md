# 新增 Web 工具接入（多工具 · 按交互模型分型）— 设计

- 日期：2026-07-26
- 状态：待审阅（已扩展）
- 目标：把多个 Web 工具接入 CTFBox，**按每个工具真实的交互模型设计前端**，确保能实际完成工作
- 决策：Webshell = 内置原生 Python 客户端；runner 扩展支持原生二进制（subfinder 等 Go 工具）

## 0. 核心洞察：Web 工具不是一种，而是三种

现有架构（`run_tool` 恒定 `python ctfbox_launcher.py <tool>`，注册表 `entry` 强制 `.py`）
只适配「纯 Python + 一次性流式 CLI」这一种形态。但真实的 Web 工具至少分三型，
**每型需要不同的运行后端与不同的前端**：

| 交互型 | 代表工具 | 运行特征 | 前端形态 |
|---|---|---|---|
| **A. 扫描器**（一次性流式） | dirsearch, subfinder, nuclei, ffuf, httpx | 给目标+参数 → 流式输出行 → 收敛为结构化发现 | 参数表单 + 终端 + 发现列表（现有模型可复用） |
| **B. 交互会话**（有状态） | webshell 管理 | 建立连接后反复发命令/取响应/浏览文件 | 连接管理 + 虚拟终端 + 文件管理器（**全新定制**） |
| **C. 纯本地**（无进程） | crypto / misc（已存在） | 纯前端计算 | Workbench（已存在） |

本设计落地 **A 型三款（dirsearch / subfinder / nuclei）** + **B 型一款（webshell 管理）**，
并把「A 型可无限扩展」做成模板（ffuf/httpx 后续只增注册表+schema+解析器）。

## 1. 架构改造总览

| # | 位置 | 改动 | 服务于 |
|---|---|---|---|
| 1 | `tools/tool_registry.json` + `pluginRegistry.ts` schema | runner 增加 `kind` 与二进制/会话字段 | A(binary)/B |
| 2 | `gui/src-tauri/src/lib.rs` `run_tool` | 按 runner.kind 分派：python 启动器 / 直接 spawn 二进制 / 会话客户端 | A(binary)/B |
| 3 | `tools/bin/<platform>/`（vendored 二进制） | subfinder/nuclei 可执行文件 | A(binary) |
| 4 | `tools/clients/webshell/webshell.py`（**第一方** Python 客户端） | webshell 引擎 | B |
| 5 | `toolSchemas.ts` + 每工具解析器 `analysis/*.rs` | 扫描器参数与输出解析 | A |
| 6 | 前端 workbench 路由 `toolUi(toolId)` | 扫描器→通用工作台；webshell→定制工作台 | A/B |

**不变（注册表驱动的价值）**：`ToolRail` 自动列出 web 工具、扫描器通用参数面板/命令预览/终端
对 A 型零改动。B 型走独立组件树，不污染 A 型。

### 1.1 runner schema 演进（向后兼容）

```jsonc
// A. Python 扫描器（现状，kind 默认 "python"）
"runner": { "kind": "python", "launcher": "dirsearch.cmd",
            "sourceDirectory": "dirsearch", "entry": "dirsearch.py" }

// A. 原生二进制扫描器
"runner": { "kind": "binary", "program": "subfinder" }   // 解析到 tools/bin/<os>/subfinder[.exe]

// B. 交互会话（第一方 Python 客户端）
"runner": { "kind": "session", "sourceDirectory": "webshell", "entry": "webshell.py" }
```

- `pluginRegistry.ts` 的 zod schema 用 discriminated union（按 `kind`）替换现有单一 runner 对象；
  `entry` 的 `.py` 正则保留于 python/session 分支；binary 分支的 `program` 用严格白名单正则
  `/^[a-z0-9][a-z0-9-]*$/`（禁止路径分隔符，杜绝路径逃逸）。
- `PluginCategory` 增补是否需要——不需要，全部仍是 `"web"`；分型靠 `runner.kind` 与前端
  `toolUi()` 派生，**category 保持 web/crypto/misc 不动**。

### 1.2 Rust `run_tool` 分派（安全前提不降级）

`build_tool_arguments` 已按 `RUNNER_TOOLS` 白名单校验 tool_id/edition——保留。新增：
```
match runner.kind {
  Python | Session => 现有路径（python -B -u ctfbox_launcher.py <tool> ...）
  Binary => {
      let program = workspace_root/tools/bin/<os>/<program>[.exe];   // 只允许白名单名 + 固定目录
      验证 program.is_file()，否则报「找不到内置二进制」;
      Command::new(program).args(request.arguments) ...              // 不经 shell，避免注入
  }
}
```
- stdout/stderr/stdin 三管道、`forward_stream`、`monitor_process`、`send_tool_input`、`stop_tool`、
  `terminate_all` **全部复用**——二进制与会话都走同一套流式/生命周期机制。
- `analyzer_for` 扩展匹配 dirsearch/subfinder/nuclei；webshell 返回 None（它用会话协议，不走行解析器）。
- Windows `creation_flags(0x08000000)` 对二进制同样施加（隐藏控制台窗口）。

## 2. A 型 · 扫描器（dirsearch / subfinder / nuclei）

三款共享「参数表单 + 命令预览 + 应用内终端 + 结构化发现」通用工作台（现有 SQLmap/SSTImap 那套）。
差异只在：**注册表条目、参数 schema、输出解析器**。

### 2.1 dirsearch（Python，目录爆破）
- 注册表：`kind:"python"`, `sourceDirectory:"dirsearch"`, `entry:"dirsearch.py"`，`editions:["original"]`。
- 前置 vendoring：`Original/dirsearch/`（含字典 `db/`）+ 根 `dirsearch.cmd`；`ctfbox_launcher.py` 无需改。
- `DIRSEARCH_SCHEMA` 分组：target(`-u`/`--urls-file`)、wordlist(`-w`/`-e`/`-f`)、
  filter(`-i`/`-x`/`--exclude-sizes`)、request(`-m`/`-H`repeatable/`--cookie`/`--proxy`)、
  crawl(`-r`/`-R`/`--deep-recursive`)、performance(`-t`/`--delay`/`--timeout`)。
- `analysis/dirsearch.rs`：正则 `^\[\d{2}:\d{2}:\d{2}\]\s+(\d{3})\s+-\s+(\S+)\s+-\s+(\S+)`
  → `Finding{kind:"path", value:路径, detail:"200 · 1KB"}`；`->` 重定向追加 detail。

### 2.2 subfinder（Go 二进制，子域枚举）
- 注册表：`kind:"binary"`, `program:"subfinder"`；vendored 到 `tools/bin/windows/subfinder.exe`
  （及后续 linux/mac）。
- `SUBFINDER_SCHEMA` 分组：target(`-d` domain / `-dL` 域名列表文件)、sources(`-all`/`-s` 指定源/
  `-es` 排除源/`-recursive`)、output(`-oJ` JSON 行，**强制开**以稳定解析)、
  performance(`-t` 并发/`-timeout`/`-rl` 速率)、config(`-config`/`-pc` provider 配置)。
- `analysis/subfinder.rs`：优先解析 `-oJ` 的 NDJSON（`{"host":"a.example.com","source":"crtsh"}`）
  → `Finding{kind:"subdomain", value:host, detail:source}`；无 JSON 时按纯行（每行一个子域）兜底。
- provider key：subfinder 需 API key 才能全源枚举。首版把 `~/.config/subfinder/provider-config.yaml`
  路径暴露在参数区提示（不强制），无 key 时被动源仍可用。

### 2.3 nuclei（Go 二进制，模板化漏扫）
- 注册表：`kind:"binary"`, `program:"nuclei"`；vendored 到 `tools/bin/<os>/`。模板库 `nuclei-templates`
  体量大——**按需下载**（首次运行前提示 `-update-templates`，或指向用户已有模板目录 `-t`）。
- `NUCLEI_SCHEMA` 分组：target(`-u`/`-l`)、templates(`-t` 路径/`-tags`/`-severity`
  info/low/medium/high/critical 多选/`-etags`)、request(`-H`repeatable/`-proxy`/`-timeout`)、
  output(`-jsonl` **强制**/`-silent`)、performance(`-c` 并发/`-rl` 速率/`-bulk-size`)。
- `analysis/nuclei.rs`：解析 `-jsonl`（`{"template-id":..,"info":{"severity":"high","name":..},
  "matched-at":url}`）→ `Finding{kind:"vuln", value:template-id, detail:"high · matched-at"}`，
  severity 直接映射到前端 `high/suspicious/info` 色标。

### 2.4 A 型自动化与 Flag
- `App.tsx` 的 web 工具自动化：dirsearch/subfinder 首版走「隐藏自动化」（加 `supportsAutomation(toolId)`
  守卫，未实现不渲染 `AutomationControls`，避免空转）；nuclei 天然一次成型无需链式。
- Flag 检测：所有扫描器输出与命中的响应体照走现有 `flagDetector`，命中前缀高亮置顶。

### 2.5 A 型 UI（通用工作台，三款一致）
```
┌─ 参数 ──────────────┐ ┌─ 命令预览 ─────────────────────────────┐
│ ▸ target            │ │ subfinder -d example.com -all -oJ -t 30 │
│   -d example.com    │ └────────────────────────────────────────┘
│ ▸ sources  [x]-all  │ ┌─ 终端（流式）──────┐ ┌─ 结构化发现 ─────┐
│ ▸ output   [x]-oJ   │ │ [INF] enumerating… │ │ ● api.example.com│
│ ▸ performance -t 30 │ │ api.example.com     │ │ ● cdn.example.com│
│ [运行] [停止]        │ │ cdn.example.com     │ │ … 共 42 个子域    │
└─────────────────────┘ └────────────────────┘ └──────────────────┘
```

## 3. B 型 · Webshell 管理（内置原生 Python 客户端）

**这是与扫描器完全不同的形态**：建立连接后是持续的请求/响应会话。设计成一个第一方 Python
引擎作为**长驻进程**，前端用 `send_tool_input` 下发指令、读 stdout 结构化回包，配定制 UI。

### 3.1 后端引擎 `tools/clients/webshell/webshell.py`
- 以 `runner.kind:"session"` 启动（走 python 分派，长驻 REPL，不自动退出）。
- 协议 **NDJSON over stdin/stdout**（每行一个 JSON）：
  - 前端→引擎（经 `send_tool_input`）：
    `{"op":"connect", "url", "password":"cmd", "shellType":"php|jsp|asp|aspx", "encoder":"raw|base64", "headers":{}, "proxy"}`、
    `{"op":"exec","cmd":"id"}`、`{"op":"ls","path":"/var/www"}`、`{"op":"read","path":..}`、
    `{"op":"upload","path":..,"dataB64":..}`、`{"op":"delete","path":..}`、`{"op":"disconnect"}`
  - 引擎→前端（stdout NDJSON，被定制 client 解析，不进通用终端）：
    `{"ev":"connected","os","user","cwd","serverInfo"}`、`{"ev":"exec","cmd","output","exitHint"}`、
    `{"ev":"listing","path","entries":[{"name","type":"file|dir","size","mtime"}]}`、
    `{"ev":"file","path","dataB64"}`、`{"ev":"progress",...}`、`{"ev":"error","message"}`
- 引擎内含各 shell 类型的 payload 生成器：PHP `eval($_POST[pass])` 系、JSP/ASP 对应变体；
  编码器（raw/base64）；命令执行、目录列举、文件读写、删除的远端小脚本模板。
- 纯标准库（urllib）实现，**不新增 pip 依赖**；代理/自定义头/超时可配。
- 安全边界：仅连接用户显式填入的目标（授权 CTF/渗透场景）；引擎不写本地任意路径，
  下载数据经 base64 回传由前端另存。

### 3.2 前端 `WebshellWorkbench.tsx`（定制，独立组件树）
- 会话客户端 `webshellSessionClient.ts`：封装 `run_tool`（启动引擎）+ `send_tool_input`（发 op）
  + 监听 Channel 解析 `ev` → 更新状态；`stop_tool` 断开。仿 `stegoWorkerClient` 的请求/响应
  配对与生命周期，但通道是 Tauri 进程而非 Web Worker。
- 三区结构：
  - **连接管理**（左）：会话列表，新增/编辑/测试连接。字段：名称、URL、密码参数名、
    shell 类型、编码器、自定义头、代理。「测试连接」→ `connect` → 显示 `connected` 服务器信息。
  - **虚拟终端**（中·标签1）：输入命令 → `exec` → 回显 `output`；保留历史、上下键复用。
    与真终端观感一致，但每条命令是一次 webshell 请求。
  - **文件管理器**（中·标签2）：当前路径 + 条目表（名称/类型/大小/时间），双击目录进入、
    文件可下载（`read`→另存）、上传（选择本地文件→`upload`）、删除（二次确认）。
  - **服务器信息**（中·标签3）：os / 当前用户 / 工作目录 / 中间件版本等 `connected` 携带信息。
- Flag：命令输出与下载文件内容照走 `flagDetector`，命中高亮。

### 3.3 Webshell UI（定制）
```
┌─ 连接 ───────┐ ┌─ [终端] 文件 信息 ───────────────────────────┐
│ ● shell@t1   │ │ www-data@target:/var/www/html$ id             │
│   /shell.php │ │ uid=33(www-data) gid=33(www-data) groups=33   │
│ ○ shell@t2   │ │ www-data@target:/var/www/html$ cat /flag.txt  │
│ [+ 新建连接] │ │ flag{...}   ← 命中高亮                          │
│ [测试连接]   │ │ > _                                            │
└──────────────┘ └───────────────────────────────────────────────┘
（文件标签：路径 /var/www/html ▸ 表格 name|type|size|mtime ▸ [下载][上传][删除]）
```

**最终效果**：新建一个指向 `http://target/shell.php`、密码 `cmd`、类型 php、编码 base64 的连接 →
点「测试连接」显示 `www-data / Linux / /var/www/html` → 终端里 `id`/`ls -la` 实时回显 →
文件标签浏览目录、把 `/flag.txt` 下载到本地或直接在终端 `cat` 出并高亮 → 完成实战取证。

## 4. 前端工作台路由

`toolUi(toolId)` 决定选中某 web 工具时渲染哪种工作台：
```ts
type ToolUi = "scanner" | "webshell";
function toolUi(toolId: string): ToolUi {
  return toolId === "webshell" ? "webshell" : "scanner";
}
```
- `scanner` → 现有通用 web 工作台（schema 驱动），dirsearch/subfinder/nuclei/ffuf/httpx 共用。
- `webshell` → `WebshellWorkbench`。
- `ToolRail` 的「WEB 工具」区自动多出四项（图标沿用 index 映射；webshell 可给独立图标如 `TerminalSquare`）。

## 5. 测试（TDD）

**后端 Rust**
- `run_tool` 分派：新增 binary 分派单测——mock 一个 `tools/bin/<os>/echo-like` 占位，断言按
  `program` 解析路径、拒绝含分隔符的非法 program、拒绝不在白名单的 tool_id。
- `runner_tool_ids()` 期望更新为 `["dirsearch","nuclei","sqlmap","sstimap","subfinder","webshell"]`。
- `analysis/{dirsearch,subfinder,nuclei}.rs` 各自行解析单测：喂典型输出（含 NDJSON、ANSI、跨 chunk 截断），断言 Finding 字段。
- `analysis/mod.rs` `registry_returns_only_supported_analyzers` 增补三行；webshell 断言返回 None。

**Webshell 引擎（Python，pytest）**
- 起一个本地 `http.server` + 内存假 webshell 端点，断言 `connect/exec/ls/read/upload/delete`
  的 NDJSON 往返正确；base64 编码器路径；错误目标→`{"ev":"error"}` 不崩溃。

**前端（vitest）**
- `toolSchemas.test.ts`：dirsearch/subfinder/nuclei schema 完整性 + `commandBuilder` 拼参
  （repeatable header、boolean flag、强制 `-oJ/-jsonl`）。
- `webshellSessionClient.test.ts`（mock Tauri channel + invoke）：op 下发与 ev 解析配对、
  断线/重连、Flag 命中。
- `WebshellWorkbench` 三标签渲染测试；`App.test.tsx` 断言 webshell 走定制工作台、
  dirsearch 走通用工作台且不渲染 `AutomationControls`。

## 6. 边界与风险

- **二进制体量/平台**：subfinder/nuclei 需按 win/linux/mac 各带一份，显著增大安装包；
  首版可仅带 Windows，其余按需下载；nuclei 模板库不随包，首次引导下载或指向本地目录。
- **provider/模板依赖**：subfinder 全源需 API key、nuclei 需模板——参数区明确提示，缺失时降级可用。
- **Webshell 是攻击性工具**：仅用于授权 CTF/渗透（白帽场景，符合本项目安全研究定位）；
  引擎只连用户显式目标、不做批量、不内置任何真实目标；下载数据由用户另存，不自动落盘。
- **会话协议健壮性**：NDJSON 逐行解析要容忍半行/脏行（远端回显污染）；单条 op 超时不阻塞整会话；
  引擎对畸形远端响应返回 `error` 事件而非退出。
- **runner 安全**：binary 只允许白名单名 + 固定 `tools/bin/<os>/` 目录 + 不经 shell 直接 spawn，
  杜绝路径逃逸与命令注入；沿用现有 tool_id 白名单校验。
- **A 型可扩展**：ffuf/httpx 等后续接入只需第 2 节三件套（注册表+schema+解析器），框架零改动。
```

