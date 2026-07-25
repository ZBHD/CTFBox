# 图片与文件隐写工作台设计

## 目标

把现有 `Misc / 图片隐写` 占位页替换为可离线使用的结构化分析工作台。分析只依赖随 CTFBox 打包的前端代码和现有运行时，不调用系统命令，也不要求用户安装 ExifTool、binwalk、StegSolve 或 Python 包。

工作台覆盖六条互补证据链：元数据与 XMP、容器结构、文件尾附加数据、字符串与常见编码、JPEG 量化 DCT 系数、像素域与二维 FFT。LSB 保持为单独工具，图片隐写工作台可以把可疑低位证据引导到 LSB，但不复制 LSB 的自动搜索参数面板。

## 架构

### 状态与执行边界

新增 `StegoLocalAnalysis`，并把 `LocalAnalysisState` 扩展为 `LsbLocalAnalysis | StegoLocalAnalysis`。`App` 仍按 `misc:<mode>` 保存独立状态，切换工具不会丢失结果。

`StegoWorkbench` 负责文件读取、浏览器图片解码、任务状态和导出。`StegoWorkerClient` 复制并转移原始字节与 RGBA 像素给 `stegoWorker`；Worker 依次执行结构、元数据、字符串、DCT、像素统计和 FFT，并在阶段间检查取消信号。512 MiB 文件和 10000 x 10000 图片沿用 LSB 的资源上限；FFT 输入额外缩放到用户选择的 128、256 或 512 方阵。

### 分析模块

- `stegoStructure.ts`：识别 PNG、JPEG、GIF、BMP、RIFF/WebP/WAV、PDF、ZIP、GZIP、7z 与 RAR；对 PNG/JPEG/GIF/BMP/RIFF 计算规范结束位置，报告尾随区偏移、长度、熵、十六进制预览，并复用现有签名雕刻器识别其中的嵌套文件。
- `stegoMetadata.ts`：逐块验证 PNG CRC，解析 `tEXt`、`zTXt`、`iTXt`、`eXIf`、`iCCP` 和未知私有块；逐标记解析 JPEG APP/COM，读取 Exif TIFF IFD、GPS、XMP、ICC 与 Photoshop APP13 文本；同时列出 GIF、RIFF/WebP 与 BMP 的结构字段。
- `stegoStrings.ts`：提取 ASCII、UTF-8、UTF-16LE/BE 和 GB18030 可打印字符串，去重并保留偏移；识别并解码 Base64、十六进制和 URL 编码片段，对原文与解码结果应用全局 Flag 前缀和通用花括号 Flag 检测。
- `jpegDct.ts`：解析 baseline sequential JPEG 的 DQT、DHT、SOF0、DRI 和 SOS，按 MCU/采样因子解码量化系数；统计 DC 差分、AC 零值率、每个 zig-zag 位置的奇偶比例和异常偏差。progressive、算术编码或损坏流返回明确的“不支持/不完整”结果，不伪造系数结论。
- `stegoFrequency.ts`：从 RGBA 生成 R/G/B/A、灰度、反相、自动拉伸和 8 个位平面；用 radix-2 二维 FFT 计算中心化对数幅度图、频带能量和峰值坐标。所有画布结果保存为固定尺寸灰度/RGBA 数组，便于 Worker 传输和 UI 渲染。
- `stegoAnalyzer.ts`：组合各模块，生成按严重度排序的 `finding`、结构条目、元数据、字符串、可视化、DCT 统计和可导出 carved 文件，不让单个解析器异常中断其他分析。

## 界面

工作台维持当前三段布局：左侧输入与原图，右侧参数，底部结果。参数使用复选框、分段控件和数值输入，默认开启结构、元数据、尾随数据、字符串、像素视图和 FFT；DCT 只在 JPEG 中执行。运行按钮在分析中变为取消。

结果区使用固定标签：`总览`、`元数据`、`结构`、`字符串`、`可视化`、`DCT`、`雕刻文件`。总览按“高可信/可疑/信息”列出证据和精确偏移；结构表显示块或标记的名称、范围、长度和校验状态；可视化标签使用稳定网格展示通道、位平面和 FFT 画布；雕刻文件支持逐项导出。窄窗口下输入、参数、结果纵向排列，结果内部标签可横向滚动，画布尺寸不会推动页面横向溢出。

## 错误与资源限制

- 不支持的图片仍执行字节级结构、字符串、尾随和文件雕刻。
- 截断块、坏 CRC、非法 IFD 偏移和 JPEG 熵流错误转为 findings，保留已成功的其他结果。
- ZIP/GZIP 解包继续使用现有条目数、总大小、单文件大小、压缩比和路径穿越限制。
- 字符串扫描限制结果数量和单项长度；预览有明确字节上限，完整原始文件不复制进每个结果项。
- Worker 取消、替换文件和组件卸载都终止旧任务，迟到消息不得覆盖当前任务。

## 验证

单元测试使用程序生成的 PNG 块/CRC、Exif TIFF、尾随 ZIP、各种字符串编码、FFT 正弦条纹和 baseline JPEG 夹具，覆盖成功、损坏、截断、不支持与取消。组件测试覆盖文件替换、参数、标签、导出、任务隔离和失败状态。最终运行全部前端、TypeScript、Vite、Python、本地化、Rust 与格式检查，并在真实 CTFBox UI 中验证明暗主题、桌面/窄窗口、PNG 元数据/尾随、JPEG DCT 和 FFT 画布。

