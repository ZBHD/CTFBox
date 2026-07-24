# CTFBox

CTFBox 是面向 CTF 场景的 Windows 桌面工具台，统一管理 Web、Crypto 与 Misc 工具。项目当前提供 SQLmap、SSTImap 的原版/汉化版入口，可视化参数编译，以及本地编码、哈希、异或和隐写分析工作区。

> 当前 GUI 处于开发阶段。SQLmap 与 SSTImap 已可在界面中编译命令，真实进程执行与实时回显适配器仍在接入中；命令行启动器可直接使用。

## 文档

- [完整使用说明](./使用说明.md)
- [SQLmap 原版说明](./Original/sqlmap-1.10/使用说明.md)
- [SQLmap 汉化版说明](./CNversion/sqlmap-1.10/使用说明.md)
- [SSTImap 原版说明](./Original/SSTImap-master/使用说明.md)
- [SSTImap 汉化版说明](./CNversion/SSTImap-master/使用说明.md)

## 当前功能

- SQLmap：原版/汉化版切换、参数搜索、分组配置、命令预览和运行历史折叠。
- SSTImap：目标、请求、爬虫、检测、载荷与常规参数配置。
- Crypto：Base64、Base32、Base58、Base85、Ascii85、Hex、URL、HTML 实体、Unicode 转义、二进制和八进制转换。
- 自动解码：并行尝试全部编码，最多递归三层，去重并优先显示 Flag 结果。
- 哈希与异或：SHA-1/256/384/512，以及循环 XOR。
- Misc：伪加密、LSB、图片隐写和音频隐写专用工作区。
- 全局 Flag 识别：支持自定义检测头、明文与 Base64 检测。
- 全局外观：亮色/暗色切换，并在本机保留主题选择。
- 可扩展工具注册表：为后续工具适配器预留统一入口。

## 快速开始

### 命令行工具

需要 Python 3，并建议从项目根目录运行：

```powershell
# SQLmap 原版
.\sqlmap.cmd -h

# SQLmap 汉化版
.\sqlmap.cmd -cn -h

# SSTImap 原版
.\sstimap.cmd -h

# SSTImap 汉化版
.\sstimap.cmd -cn -h
```

### GUI 开发模式

需要 Node.js、pnpm、Rust 和 Windows WebView2：

```powershell
cd gui
pnpm install
pnpm dev
```

仅启动浏览器渲染层：

```powershell
cd gui
pnpm dev:renderer
```

## 项目结构

```text
CTFBox/
├─ Original/          # 上游原版源码
├─ CNversion/         # 仅存放汉化版源码
├─ gui/               # React + TypeScript + Tauri 桌面界面
├─ tools/             # 启动器与必要维护工具
├─ sqlmap.cmd          # SQLmap 统一入口
├─ sstimap.cmd         # SSTImap 统一入口
└─ 使用说明.md         # CTFBox 详细使用手册
```

## 开发校验

```powershell
cd gui
pnpm test:unit
pnpm typecheck
pnpm build:renderer
cargo build --manifest-path src-tauri\Cargo.toml
```

项目内集成的第三方工具遵循各自目录中的许可证和上游声明。
