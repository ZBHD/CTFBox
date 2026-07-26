# 新增 Web 工具接入（示范：dirsearch）— 设计

- 日期：2026-07-26
- 状态：待审阅
- 目标：验证「注册表驱动」的扩展路径，把一个新 Web 工具从 0 接进 CTFBox 全链路
- 推荐示范工具：**dirsearch**（目录/文件爆破，CTF Web 高频、CLI 简单、输出易解析）

## 1. 为什么是 dirsearch

现有 Web 工具（SQLmap/SSTImap）都走 `tool_registry.json` → Python 启动器
（`ctfbox_launcher.py`）→ `runpy` 执行第三方脚本的模型。新增工具的最佳示范应满足：
纯 Python、单入口、可被现有启动器**零改动**拉起、输出行结构清晰易解析。dirsearch 全部满足，
且与 SQLmap/SSTImap 不重叠（前两者是注入，dirsearch 是资产发现）。

本设计既落地 dirsearch，也作为「**接入任意新 Web 工具的模板**」。

## 2. 接入全景（一个工具要动的 6 处）

注册表是 Rust / Python / 前端三方共享的单一事实源。接入一个 Web 工具的完整改动：

| # | 位置 | 改动 | 是否必需 |
|---|---|---|---|
| 1 | `tools/tool_registry.json` | 新增 `dirsearch` 条目（runner） | 必需 |
| 2 | 仓库根 `dirsearch.cmd` + `Original/dirsearch/`（vendored 源码） | 提供入口与源码 | 必需（前置） |
| 3 | `gui/src/lib/toolSchemas.ts` | 新增 `DIRSEARCH_SCHEMA` 与工具联合类型 | 必需 |
| 4 | `gui/src-tauri/src/analysis/dirsearch.rs` + `mod.rs` | 输出解析器（发现的路径→Finding） | 推荐 |
| 5 | `gui/src-tauri/src/lib.rs` 测试 | `runner_tool_ids` 期望值更新 | 必需（测试） |
| 6 | `gui/src/lib/automationEngine.ts` / `suggestionEngine.ts` | 自动化/建议（递归发现） | 可选 |

前端 `pluginRegistry.ts` 从注册表自动读取，`ToolRail` 自动列出 web 工具，
`commandBuilder` 按 schema 通用拼参，`ParameterPanel`/`CommandTerminal`/`ResultsPanel`
通用渲染——**这三处零改动**，这正是注册表驱动的价值。

## 3. 各处细节

### 3.1 注册表 `tool_registry.json`
```json
{
  "id": "dirsearch",
  "category": "web",
  "name": "dirsearch",
  "description": "目录与文件爆破",
  "editions": ["original"],
  "runner": { "launcher": "dirsearch.cmd", "sourceDirectory": "dirsearch", "entry": "dirsearch.py" }
}
```
首版 **original-only**（`editions: ["original"]`），汉化留待后续。`build_tool_arguments`
（`lib.rs:145`）已支持任意 editions 白名单；`launcher` 正则要求 `*.cmd`、`entry` 要求 `*.py`
（`pluginRegistry.ts:29`），命名满足。

### 3.2 Vendoring（前置步骤，非代码）
- 把 dirsearch 源码放入 `Original/dirsearch/`（含 `dirsearch.py` 与 `db/` 字典）。
- 仓库根加 `dirsearch.cmd`（仿现有 `sqlmap.cmd`/`sstimap.cmd`，转调统一启动器）。
- `ctfbox_launcher.py` **无需改动**，它按注册表定位 `Original/<sourceDirectory>/<entry>`。
- 依赖：dirsearch 需要少量 pip 包；打包运行时脚本 `tools/prepare_python_runtime.ps1`
  需纳入其 `requirements.txt`（本设计标注此步，具体清单实现时确认）。

> 说明：vendoring 是实现阶段的准备动作，需要获取 dirsearch 源码。若你更希望换一个已内置或
> 更轻的工具（如 arjun / whatweb），此设计的其余部分完全复用，仅换第 3.1/3.2。

### 3.3 参数 Schema `toolSchemas.ts`
把工具类型联合从 `"sqlmap" | "sstimap"` 扩为含 `"dirsearch"`，注册 `DIRSEARCH_SCHEMA`。
分组与关键字段（flag 对齐 dirsearch CLI）：

- **target**：`url -u`(quick)、`urlFile --urls-file`、`stdinTargets --stdin`
- **wordlist**：`wordlist -w`、`extensions -e`(quick)、`forceExtensions -f`、`overwriteExtensions -O`
- **filter**：`includeStatus -i`(quick)、`excludeStatus -x`、`excludeSizes --exclude-sizes`、
  `excludeText --exclude-text`、`excludeRegex --exclude-regex`
- **request**：`httpMethod -m`、`data -d`、`cookie --cookie`、`userAgent --user-agent`、
  `randomAgent --random-agent`、`header -H`(repeatable)、`followRedirects -F`、`proxy --proxy`
- **crawl**：`recursive -r`、`deepRecursive --deep-recursive`、`recursionDepth -R`、
  `recursionStatus --recursion-status`
- **performance**：`threads -t`(quick)、`delay --delay`、`timeout --timeout`、`maxRate --max-rate`
- **general**：`quiet -q`、`fullUrl --full-url`

通用 `buildCommand`（`commandBuilder.ts`）已支持 boolean/repeatable/valueArity，无需改。

### 3.4 输出解析器 `analysis/dirsearch.rs`
dirsearch 每条命中形如：
```
[12:20:31] 200 -    1KB - /admin/
[12:20:31] 301 -    0B  - /js  ->  /js/
```
解析器（实现 `ToolOutputAnalyzer`，复用 `LineBuffers` 逐行 + `strip_ansi`）用正则
`^\[\d{2}:\d{2}:\d{2}\]\s+(\d{3})\s+-\s+(\S+)\s+-\s+(\S+)` 抽出状态码/大小/路径，
产出 `Finding{ kind: "path", value: 路径, detail: "200 · 1KB" }`。重定向箭头 `->` 追加到 detail。
在 `analyzer_for`（`mod.rs:29`）注册 `"dirsearch" => DirsearchAnalyzer`。

### 3.5 后端测试同步
`lib.rs` 的 `runner_registry_matches_the_shared_tool_manifest` 断言从
`["sqlmap","sstimap"]` 更新为 `["dirsearch","sqlmap","sstimap"]`；`analysis/mod.rs` 的
`registry_returns_only_supported_analyzers` 增加 dirsearch 一行。

### 3.6 自动化（可选，建议做最小版）
`App.tsx` 的 `isWebTool` 为所有 `category:"web" + runner` 工具显示 `AutomationControls`。
两种处理：
- **最小自动化**：`buildAutomationJobs` 为 dirsearch 返回「基础扫描 → 对发现的目录（301/403）
  递归」的 job 链（仿 `buildSqlmapJobs` 用 findings 派生），保持与其他 web 工具体验一致。
- 或**隐藏自动化**：给 `App.tsx` 加 `supportsAutomation(toolId)`，dirsearch 未实现时不渲染
  `AutomationControls`（`App.tsx:596`），避免「开始」后瞬间 completed 的空转。

推荐先做**隐藏自动化**（改动小、无误导），把递归自动化列为后续增强。

## 4. UI 与最终实现效果

- 左侧 `ToolRail` 的「WEB 工具」区自动多出 `dirsearch` 一项（图标沿用 `ToolRail.tsx:129`
  的 index 映射，第 3 个工具得 `Code2`）。
- 选中后进入标准 Web 工作台：右侧参数面板按 `DIRSEARCH_SCHEMA` 自动生成分组表单，
  顶部命令预览实时更新（如 `dirsearch.cmd --url http://... -e php,html -t 20`）。
- 点「运行」在应用内终端流式回显；每发现一个路径，右侧「结构化结果」区新增一条
  `path` Finding；命中 Flag 检测头的响应会被标记。
- edition 选择器仅有「原版」（首版），CN 后续再加。

**最终效果示例**：填 `--url http://target/`、`-e php,txt`、`-t 30` → 运行后终端滚动出
`200 - /admin/`、`403 - /backup/` 等；结构化结果区聚合出可点路径列表，`/flag.txt`
若命中前缀会高亮，一眼定位。

## 5. 测试

- 后端：`analysis/dirsearch.rs` 单测——喂典型输出行，断言解析出正确的路径/状态/大小
  Finding；含 ANSI 色、重定向箭头、跨 chunk 截断的用例（复用 `LineBuffers` 语义）。
  `lib.rs`/`mod.rs` 既有注册表测试更新。
- 前端：`toolSchemas.test.ts` 增加 dirsearch schema 完整性断言；`commandBuilder.test.ts`
  增加 dirsearch 拼参用例（含 repeatable header、boolean flag）。
- 若做「隐藏自动化」：`App.test.tsx` 断言 dirsearch 不渲染 `AutomationControls`。

## 6. 边界与风险

- **Vendoring 体量**：dirsearch 带字典（`db/`）体积不小，且会增大安装包；实现前需确认
  是否纳入默认打包，或按需下载。
- **依赖冲突**：dirsearch 的 pip 依赖需与现有 SQLmap/SSTImap 运行时兼容，打包脚本要一并验证。
- **输出格式漂移**：不同 dirsearch 版本行格式略有差异，解析器正则要容错（宽松空白匹配），
  解析失败不影响原始回显（analyzer 只增补 Finding，不消费文本，见 `lib.rs` 既有测试语义）。
- **模板可迁移性**：本设计的第 2/3 节即通用接入模板，换任何 Python CLI 工具，仅第 3.1/3.2/3.3/3.4
  随之替换，其余框架不动。
