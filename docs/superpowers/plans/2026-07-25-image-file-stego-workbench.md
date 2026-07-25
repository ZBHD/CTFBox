# 图片与文件隐写工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建完全内置的图片/文件隐写分析工作台，覆盖元数据、容器、尾随数据、编码字符串、JPEG DCT 和二维 FFT。

**Architecture:** 纯 TypeScript 解析器在专用 Web Worker 内组合运行；React 工作台只负责载入、参数、任务状态、画布展示和导出。各解析器返回可序列化的结构化结果，单项错误降级为 finding，不中断其他证据链。

**Tech Stack:** React 18、TypeScript strict、Vitest、Web Worker、Canvas ImageData、fflate、Tauri 2。

---

### Task 1: 状态模型与二进制基础设施

**Files:**
- Create: `gui/src/lib/stegoTypes.ts`
- Create: `gui/src/lib/stegoBinary.ts`
- Test: `gui/src/lib/stegoBinary.test.ts`
- Modify: `gui/src/lib/lsbTypes.ts`

- [ ] 写失败测试，覆盖大小端整数、边界读取、CRC32、熵和安全切片。
- [ ] 运行 `pnpm --dir gui test:unit -- src/lib/stegoBinary.test.ts`，确认模块缺失失败。
- [ ] 实现 `readU16/readU32/readAscii/crc32/shannonEntropy/hexPreview`，越界统一抛出带偏移的 `StegoParseError`。
- [ ] 定义 `StegoOptions`、`StegoFinding`、`StegoSection`、`StegoMetadataEntry`、`StegoStringHit`、`StegoVisual`、`JpegDctReport`、`StegoReport` 和 `StegoLocalAnalysis`，将其加入 `LocalAnalysisState` 联合。
- [ ] 运行测试并提交 `功能：建立文件隐写分析数据模型`。

### Task 2: 容器结构与尾随数据

**Files:**
- Create: `gui/src/lib/stegoStructure.ts`
- Test: `gui/src/lib/stegoStructure.test.ts`

- [ ] 写失败测试，程序生成 PNG/JPEG/GIF/BMP/RIFF 正常结束、截断、坏 CRC、尾随文本和尾随 ZIP。
- [ ] 运行定向测试，确认缺失 API 失败。
- [ ] 实现 `analyzeStructure(bytes)`：逐结构计算区段与规范结束偏移，PNG CRC 使用块类型加数据，JPEG 正确处理 stuffed byte 和 restart marker，RIFF 使用声明长度。
- [ ] 尾随区返回偏移、长度、熵、文本/Hex 预览，并调用 `findEmbeddedFiles` 识别可雕刻文件。
- [ ] 运行测试并提交 `功能：解析图片容器与尾随数据`。

### Task 3: EXIF、XMP 与文本元数据

**Files:**
- Create: `gui/src/lib/stegoMetadata.ts`
- Test: `gui/src/lib/stegoMetadata.test.ts`

- [ ] 写失败测试，覆盖 PNG `tEXt/zTXt/iTXt/eXIf`、JPEG Exif little/big endian、GPS、XMP、ICC、COM，以及非法 IFD 指针。
- [ ] 运行定向测试，确认失败原因是解析器尚未实现。
- [ ] 实现受深度、条目数和偏移边界限制的 TIFF IFD 读取器；标签映射至少包括 Make、Model、Software、DateTime、Artist、Copyright、ImageDescription、UserComment、XPComment、GPS 经纬度。
- [ ] 实现 PNG/JPEG/GIF/WebP 元数据适配器，压缩文本使用 `fflate.unzlibSync`，XMP 保留完整文本与命名空间字段。
- [ ] 运行测试并提交 `功能：提取 EXIF XMP 与图片文本块`。

### Task 4: 多编码字符串与 Flag 证据

**Files:**
- Create: `gui/src/lib/stegoStrings.ts`
- Test: `gui/src/lib/stegoStrings.test.ts`

- [ ] 写失败测试，覆盖带偏移 ASCII、UTF-8、UTF-16LE/BE、GB18030，以及 Base64、Hex、URL 二次解码和结果去重。
- [ ] 运行定向测试确认失败。
- [ ] 实现 `extractStegoStrings(bytes, options)`，限制最多 2000 项、每项 4096 字符，并对原始/解码文本调用全局 Flag 检测和通用花括号检测。
- [ ] 运行测试并提交 `功能：增加多编码字符串与 Flag 扫描`。

### Task 5: 像素视图与二维 FFT

**Files:**
- Create: `gui/src/lib/stegoFrequency.ts`
- Test: `gui/src/lib/stegoFrequency.test.ts`

- [ ] 写失败测试，覆盖常量图、横/竖正弦条纹、非方图缩放、R/G/B/A/灰度/反相/拉伸和 8 位平面。
- [ ] 运行定向测试确认失败。
- [ ] 实现 radix-2 一维 FFT、行列二维 FFT、象限中心化、`log1p` 幅度归一化、频带能量和排除 DC 邻域后的峰值坐标。
- [ ] 将输入按覆盖采样缩放到 128/256/512 方阵；输出固定尺寸 `Uint8ClampedArray`，避免 UI 布局漂移。
- [ ] 运行测试并提交 `功能：增加像素视图与二维频域分析`。

### Task 6: JPEG baseline DCT 系数分析

**Files:**
- Create: `gui/src/lib/jpegDct.ts`
- Test: `gui/src/lib/jpegDct.test.ts`

- [ ] 写失败测试，使用固定 baseline JPEG 夹具断言尺寸、分量、量化表、块数、DC/AC 系数和奇偶统计；另测 progressive、损坏 Huffman 表、restart interval 与截断流。
- [ ] 运行定向测试确认失败。
- [ ] 实现 marker/DQT/DHT/SOF0/DRI/SOS 解析、canonical Huffman 解码、byte stuffing、restart 和 MCU 采样；只保存受上限约束的聚合统计，不复制整幅系数矩阵。
- [ ] progressive/算术 JPEG 返回 `supported: false` 和准确原因，baseline 损坏返回部分报告与 warning。
- [ ] 运行测试并提交 `功能：分析 JPEG 量化 DCT 系数`。

### Task 7: 分析器与 Worker 协议

**Files:**
- Create: `gui/src/lib/stegoAnalyzer.ts`
- Test: `gui/src/lib/stegoAnalyzer.test.ts`
- Create: `gui/src/lib/stegoWorkerClient.ts`
- Test: `gui/src/lib/stegoWorkerClient.test.ts`
- Create: `gui/src/workers/stegoWorker.ts`

- [ ] 写失败测试，断言各选项只运行对应模块、阶段进度单调、模块异常隔离、findings 稳定排序、取消和迟到消息隔离。
- [ ] 运行定向测试确认失败。
- [ ] 实现 `analyzeStego(input, options, hooks)` 聚合器和 `analyze/progress/complete/cancelled/error` 判别联合协议。
- [ ] Worker 转移字节与像素副本；结果画布和 carved bytes 使用 transferable，主状态源数组不被分离。
- [ ] 运行测试及 `pnpm --dir gui build:renderer`，提交 `功能：增加文件隐写后台分析任务`。

### Task 8: 独立工作台与结果浏览器

**Files:**
- Create: `gui/src/components/processing/StegoWorkbench.tsx`
- Test: `gui/src/components/processing/StegoWorkbench.test.tsx`
- Create: `gui/src/components/processing/stego/StegoSourcePanel.tsx`
- Create: `gui/src/components/processing/stego/StegoParameterPanel.tsx`
- Create: `gui/src/components/processing/stego/StegoResultsPanel.tsx`
- Test: `gui/src/components/processing/stego/StegoResultsPanel.test.tsx`
- Modify: `gui/src/components/processing/MiscWorkbench.tsx`
- Modify: `gui/src/components/ToolRail.tsx`

- [ ] 写失败测试，覆盖任意文件载入、图片可选预览、参数切换、运行/取消、七个结果标签、画布绘制、雕刻导出和错误状态。
- [ ] 运行组件测试确认专用工作台尚不存在。
- [ ] 实现文件读取和可选 Canvas 解码；非图片继续字节分析，替换文件/卸载释放对象 URL 并取消 Worker。
- [ ] 实现总览、元数据、结构、字符串、可视化、DCT、雕刻文件标签；所有图标按钮提供 tooltip/可访问名称。
- [ ] 更新导航为“图片/文件隐写”，运行测试并提交 `功能：构建图片与文件隐写工作台`。

### Task 9: App 隔离、样式与端到端验收

**Files:**
- Modify: `gui/src/App.tsx`
- Modify: `gui/src/App.lsb.test.tsx`
- Modify: `gui/src/state/taskStore.test.ts`
- Modify: `gui/src/index.css`
- Modify: `gui/src/indexCss.test.ts`

- [ ] 写失败测试，断言 `misc:image` 状态不泄漏到 LSB/音频、明暗选中态、稳定画布网格和 820/600px 响应式布局。
- [ ] 运行定向测试确认失败。
- [ ] 接入 `StegoLocalAnalysis`，补齐桌面/窄窗口、明暗主题、滚动与固定画布尺寸样式。
- [ ] 运行 `pnpm --dir gui test:unit`、`pnpm --dir gui typecheck`、`pnpm --dir gui build:renderer`、Python、本地化、`cargo fmt --check` 和 `cargo test`。
- [ ] 在真实 CTFBox UI 中载入带 EXIF/XMP 的 JPEG、带私有/坏 CRC 块与尾随 ZIP 的 PNG、正弦条纹 PNG；核对证据偏移、DCT/FFT 非空、导出、取消、明暗主题和 800/480px 无横向溢出。
- [ ] 构建 Setup；无发布私钥时记录“产物已生成、更新器签名门禁非零”，并对 Setup 做自定义目录安装/启动/卸载烟雾测试。
- [ ] 提交 `测试：完成图片与文件隐写工作台验收`。

