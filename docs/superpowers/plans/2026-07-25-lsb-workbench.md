# LSB 隐写工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 CTFBox 内实现无需外部程序的 LSB 自动分析与完整手动提取工作台，并通过四个原始比赛题目验收。

**Architecture:** 纯 TypeScript 引擎负责扫描、提取、评分、文件雕刻和 PNG 索引解析，`fflate` 只负责压缩流与 ZIP/GZIP 解包。计算密集搜索运行在模块 Worker 中，结果通过 `TaskState.localAnalysis` 按模块隔离，React 组件只负责文件解码、参数编辑、进度和结果展示。

**Tech Stack:** React 18、TypeScript 5.7、Vite 6 模块 Worker、Vitest、react-test-renderer、fflate 0.8.2、Lucide React。

---

## 文件结构

- `gui/src/lib/lsbTypes.ts`：参数、图片源、候选、文件、进度和本地任务状态的唯一类型定义。
- `gui/src/lib/lsbEngine.ts`：像素顺序、位读取、字节打包和手动提取。
- `gui/src/lib/lsbFormats.ts`：签名、边界、雕刻、文本/Hex 预览和可解释评分。
- `gui/src/lib/lsbArchive.ts`：ZIP/GZIP 解包、名称处理和资源限制。
- `gui/src/lib/pngPalette.ts`：PNG 块读取、IDAT 解压、反滤波和调色板索引展开。
- `gui/src/lib/lsbAutoSearch.ts`：分阶段候选生成、前缀筛选、完整验证和去重。
- `gui/src/workers/lsbWorker.ts`：Worker 消息循环、取消和批次进度。
- `gui/src/lib/lsbWorkerClient.ts`：可注入 Worker 工厂的主线程客户端。
- `gui/src/components/processing/LsbWorkbench.tsx`：工作台编排、文件载入与状态迁移。
- `gui/src/components/processing/lsb/LsbSourcePanel.tsx`：原图、通道和位平面预览。
- `gui/src/components/processing/lsb/LsbParameterPanel.tsx`：自动/手动参数控件和有序令牌编辑。
- `gui/src/components/processing/lsb/LsbResultsPanel.tsx`：候选、文本、Hex、文件树与导出。
- `gui/src/state/taskStore.ts`、`gui/src/App.tsx`、`gui/src/components/processing/MiscWorkbench.tsx`：接入按任务隔离的分析状态。
- `gui/src/index.css`：LSB 工作台明暗主题、稳定尺寸和窄窗口布局。

### 任务 1：依赖、领域类型和任务状态

**文件：**
- 修改：`gui/package.json`
- 修改：`gui/pnpm-lock.yaml`
- 新建：`gui/src/lib/lsbTypes.ts`
- 修改：`gui/src/state/taskStore.ts`
- 修改：`gui/src/state/taskStore.test.ts`

- [ ] **步骤 1：写任务状态清理的失败测试**

在 `taskStore.test.ts` 构造带 LSB 状态的任务，并断言 `clearTask` 清除它：

```ts
const populated = {
  ...createTask("misc"),
  localAnalysis: {
    kind: "lsb" as const,
    status: "completed" as const,
    candidates: [],
  },
};
expect(clearTask(populated)).toEqual(createTask("misc"));
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --dir gui test:unit -- src/state/taskStore.test.ts`

预期：TypeScript/Vitest 因 `TaskState` 尚无 `localAnalysis` 或清理结果不匹配而失败。

- [ ] **步骤 3：定义精确类型并接入状态**

`lsbTypes.ts` 至少导出以下稳定边界：

```ts
export type LsbChannel = "R" | "G" | "B" | "A" | "I";
export type LsbBit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface LsbSourceToken { channel: LsbChannel; bit: LsbBit }
export interface LsbScan { major: "row" | "column"; x: "left-to-right" | "right-to-left"; y: "top-to-bottom" | "bottom-to-top"; serpentine: boolean; reversePixels: boolean }
export interface LsbExtractionParameters { sourceKind: "rgba" | "palette-index"; sources: LsbSourceToken[]; scan: LsbScan; layout: "pixel-interleaved" | "channel-block"; packing: "msb-first" | "lsb-first"; bitOffset: LsbBit; invertBits: boolean; reverseBytes: boolean; byteOffset: number; byteLimit?: number; terminator?: string }
export interface LsbImageSource { width: number; height: number; rgba: Uint8Array; paletteIndices?: Uint8Array }
export interface LsbProgress { stage: "presets" | "mixed" | "transforms" | "validate"; tested: number; total: number; elapsedMs: number }
export interface LsbCandidate { id: string; score: number; parameters: LsbExtractionParameters; preview: string; mediaType: string; evidence: string[]; bytes: Uint8Array; files: LsbExtractedFile[] }
export interface LsbExtractedFile { name: string; mediaType: string; offset: number; bytes: Uint8Array; text?: string; children?: LsbExtractedFile[] }
export interface LsbLocalAnalysis { kind: "lsb"; status: "idle" | "loading" | "running" | "cancelled" | "completed" | "failed"; fileName?: string; fileSize?: number; dataUrl?: string; source?: LsbImageSource; mode: "auto" | "manual"; depth: "quick" | "deep"; parameters: LsbExtractionParameters; progress?: LsbProgress; candidates: LsbCandidate[]; selectedId?: string; error?: string }
export type LocalAnalysisState = LsbLocalAnalysis;
```

给 `TaskState` 增加 `localAnalysis?: LocalAnalysisState`，`createTask` 不设置该字段，现有 `clearTask` 因返回新任务自然清除它。执行 `pnpm --dir gui add fflate@0.8.2` 更新依赖和锁文件。

- [ ] **步骤 4：运行测试和类型检查**

运行：`pnpm --dir gui test:unit -- src/state/taskStore.test.ts && pnpm --dir gui typecheck`

预期：相关测试通过，严格类型检查通过。

- [ ] **步骤 5：提交**

```powershell
git add gui/package.json gui/pnpm-lock.yaml gui/src/lib/lsbTypes.ts gui/src/state/taskStore.ts gui/src/state/taskStore.test.ts
git commit -m "功能：建立 LSB 分析状态模型"
```

### 任务 2：扫描和位流提取引擎

**文件：**
- 新建：`gui/src/lib/lsbEngine.ts`
- 新建：`gui/src/lib/lsbEngine.test.ts`

- [ ] **步骤 1：写基础方向与混合位失败测试**

测试使用 2×2 RGBA 数组，断言逐行/逐列方向、像素反转、蛇形和混合位令牌：

```ts
expect(scanPixelIndexes(2, 2, { major: "column", x: "left-to-right", y: "bottom-to-top", serpentine: false, reversePixels: false })).toEqual([2, 0, 3, 1]);
expect(extractLsb(source, { ...DEFAULT_LSB_PARAMETERS, sources: [{ channel: "R", bit: 4 }, { channel: "R", bit: 2 }, { channel: "R", bit: 1 }, { channel: "G", bit: 4 }, { channel: "G", bit: 2 }, { channel: "G", bit: 1 }] })).toEqual(expectedBytes);
```

再用表驱动覆盖八种基础方向、两种布局、MSB/LSB 打包、位偏移、字节偏移、位反转、字节反转、结束标记和输出上限。

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --dir gui test:unit -- src/lib/lsbEngine.test.ts`

预期：模块不存在而失败。

- [ ] **步骤 3：实现纯函数引擎**

导出固定默认参数、验证器、扫描生成器和提取函数：

```ts
export const DEFAULT_LSB_PARAMETERS: LsbExtractionParameters = { sourceKind: "rgba", sources: [{ channel: "R", bit: 0 }, { channel: "G", bit: 0 }, { channel: "B", bit: 0 }], scan: { major: "row", x: "left-to-right", y: "top-to-bottom", serpentine: false, reversePixels: false }, layout: "pixel-interleaved", packing: "msb-first", bitOffset: 0, invertBits: false, reverseBytes: false, byteOffset: 0 };
export function validateLsbParameters(source: LsbImageSource, parameters: LsbExtractionParameters): string[];
export function scanPixelIndexes(width: number, height: number, scan: LsbScan): number[];
export function extractLsb(source: LsbImageSource, parameters: LsbExtractionParameters): Uint8Array;
```

通道偏移固定为 `R=0/G=1/B=2/A=3`；`I` 只允许 `palette-index`。尾部不足 8 位时丢弃，不用零填充制造伪字节。

- [ ] **步骤 4：运行引擎测试**

运行：`pnpm --dir gui test:unit -- src/lib/lsbEngine.test.ts`

预期：所有方向与变换测试通过。

- [ ] **步骤 5：提交**

```powershell
git add gui/src/lib/lsbEngine.ts gui/src/lib/lsbEngine.test.ts
git commit -m "功能：实现 LSB 位流提取引擎"
```

### 任务 3：文件签名、边界、雕刻和评分

**文件：**
- 新建：`gui/src/lib/lsbFormats.ts`
- 新建：`gui/src/lib/lsbFormats.test.ts`

- [ ] **步骤 1：写格式识别与评分失败测试**

构造含前置噪声的 PNG/JPEG/GIF/ZIP/GZIP/PDF/7z/RAR/BMP/WAV/ELF 字节，断言偏移和边界；ZIP 测试必须断言 EOCD 后噪声被截断。再断言 Flag 候选高于普通文本，普通文本高于全零和随机噪声：

```ts
expect(findEmbeddedFiles(withNoise(zipWithEocdAndTail))[0]).toMatchObject({ mediaType: "application/zip", offset: 3, bytes: exactZip });
expect(scoreLsbPayload(new TextEncoder().encode("ctfshow{ok}"), ["ctfshow"], false).score).toBeGreaterThan(scoreLsbPayload(new Uint8Array(64), ["ctfshow"], false).score);
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --dir gui test:unit -- src/lib/lsbFormats.test.ts`

预期：模块不存在而失败。

- [ ] **步骤 3：实现识别、预览和可解释评分**

导出：

```ts
export function bytesToHexPreview(bytes: Uint8Array, limit?: number): string;
export function decodeTextPreview(bytes: Uint8Array, limit?: number): { text: string; printableRatio: number };
export function findEmbeddedFiles(bytes: Uint8Array): LsbExtractedFile[];
export function scoreLsbPayload(bytes: Uint8Array, prefixes: readonly string[], caseSensitive: boolean): { score: number; evidence: string[]; preview: string; mediaType: string; files: LsbExtractedFile[] };
```

边界解析必须使用结构字段而非只搜索尾标记：PNG 逐块到 IEND；ZIP 校验 EOCD 注释长度；WAV 读取 RIFF 长度；BMP 读取文件长度。无法可靠确定结束的格式保留剩余字节并在证据中说明。

- [ ] **步骤 4：运行测试**

运行：`pnpm --dir gui test:unit -- src/lib/lsbFormats.test.ts`

预期：签名、边界、Flag 与噪声评分测试通过。

- [ ] **步骤 5：提交**

```powershell
git add gui/src/lib/lsbFormats.ts gui/src/lib/lsbFormats.test.ts
git commit -m "功能：增加隐写文件雕刻与候选评分"
```

### 任务 4：ZIP/GZIP 解包和资源限制

**文件：**
- 新建：`gui/src/lib/lsbArchive.ts`
- 新建：`gui/src/lib/lsbArchive.test.ts`
- 修改：`gui/src/lib/lsbFormats.ts`

- [ ] **步骤 1：写归档失败测试**

用 `fflate.zipSync`/`gzipSync` 在测试中生成夹具，覆盖 UTF-8 文件名 `旗子`、文本 Flag、二进制条目、路径穿越、512 条目、单文件/总大小和压缩比限制：

```ts
const archive = zipSync({ "旗子": strToU8("ctfshow{inside}") });
const files = unpackArchive(archive, "application/zip", DEFAULT_ARCHIVE_LIMITS);
expect(files[0]).toMatchObject({ name: "旗子", text: "ctfshow{inside}" });
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --dir gui test:unit -- src/lib/lsbArchive.test.ts`

预期：模块不存在而失败。

- [ ] **步骤 3：实现限制和嵌套发现**

```ts
export const DEFAULT_ARCHIVE_LIMITS = { maxEntries: 512, maxTotalBytes: 256 * 1024 * 1024, maxFileBytes: 128 * 1024 * 1024, maxCompressionRatio: 500 };
export function unpackArchive(bytes: Uint8Array, mediaType: "application/zip" | "application/gzip", limits = DEFAULT_ARCHIVE_LIMITS): LsbExtractedFile[];
```

标准化路径时拒绝 `/`、`\\` 开头、盘符和任何 `..` 段。`lsbFormats` 对识别出的 ZIP/GZIP 调用解包器，把子文件和内部 Flag 证据并入评分；限制异常返回带原因的文件节点，不丢失容器导出。

- [ ] **步骤 4：运行归档和格式测试**

运行：`pnpm --dir gui test:unit -- src/lib/lsbArchive.test.ts src/lib/lsbFormats.test.ts`

预期：解包、限制和递归证据测试通过。

- [ ] **步骤 5：提交**

```powershell
git add gui/src/lib/lsbArchive.ts gui/src/lib/lsbArchive.test.ts gui/src/lib/lsbFormats.ts
git commit -m "功能：支持隐写归档安全解包"
```

### 任务 5：PNG 调色板索引源

**文件：**
- 新建：`gui/src/lib/pngPalette.ts`
- 新建：`gui/src/lib/pngPalette.test.ts`

- [ ] **步骤 1：写 PNG 解析失败测试**

测试辅助函数生成色型 3、非隔行、位深 1/2/4/8 的 PNG，分别使用 None/Sub/Up/Average/Paeth 滤波；断言展开索引与原始数组相等。损坏签名、CRC、截断块、Adam7 和非调色板图返回结构化“不支持”结果。

```ts
expect(parsePaletteIndexes(makePalettePng({ bitDepth: 4, filter: 4, indexes: [1, 2, 3, 4] }))).toMatchObject({ width: 4, height: 1, indexes: Uint8Array.from([1, 2, 3, 4]) });
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --dir gui test:unit -- src/lib/pngPalette.test.ts`

预期：模块不存在而失败。

- [ ] **步骤 3：实现块解析、CRC、解压和反滤波**

```ts
export type PaletteParseResult = { supported: true; width: number; height: number; indexes: Uint8Array } | { supported: false; reason: string };
export function parsePaletteIndexes(bytes: Uint8Array): PaletteParseResult;
```

使用 `unzlibSync` 合并后的 IDAT，按 PNG 规范计算每行字节数和 `bpp=1`，先反滤波再按高位优先展开 1/2/4 位索引；读取所有块时验证 CRC 和长度，IEND 后停止。

- [ ] **步骤 4：运行测试**

运行：`pnpm --dir gui test:unit -- src/lib/pngPalette.test.ts`

预期：四个位深、五种滤波及错误路径全部通过。

- [ ] **步骤 5：提交**

```powershell
git add gui/src/lib/pngPalette.ts gui/src/lib/pngPalette.test.ts
git commit -m "功能：解析 PNG 调色板索引数据"
```

### 任务 6：分阶段自动搜索

**文件：**
- 新建：`gui/src/lib/lsbAutoSearch.ts`
- 新建：`gui/src/lib/lsbAutoSearch.test.ts`

- [ ] **步骤 1：写四类自动发现失败测试**

用编码辅助函数把文本/ZIP 写入像素，至少覆盖：`R0,G0,B0` 逐行、`A0,B0,G0` 逐列、`R0,G0,B0` 逐列反向和 `R4,R2,R1,G4,G2,G1` 混合位。断言快速档发现前三类，深度档必须发现混合位；再覆盖取消、进度单调、内容去重和固定排序。

```ts
const result = await autoSearchLsb(mixedBitSource, { depth: "deep", prefixes: ["ctfshow"], caseSensitive: false, signal: new AbortController().signal, onProgress: progress.push.bind(progress) });
expect(result.some((candidate) => candidate.preview.includes("ctfshow{mixed}"))).toBe(true);
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --dir gui test:unit -- src/lib/lsbAutoSearch.test.ts`

预期：模块不存在而失败。

- [ ] **步骤 3：实现确定性候选管线**

```ts
export interface LsbSearchOptions { depth: "quick" | "deep"; prefixes: readonly string[]; caseSensitive: boolean; signal: AbortSignal; onProgress?: (progress: LsbProgress) => void }
export async function autoSearchLsb(source: LsbImageSource, options: LsbSearchOptions): Promise<LsbCandidate[]>;
```

预设阶段完整提取常见组合；混合位阶段只提取 256 字节前缀并保留固定数量；变换阶段展开 offset 0..7、packing、invert、reverse 和 layout；验证阶段完整提取并评分。每 256 个候选检查 `signal.aborted`，并用 `await new Promise((resolve) => setTimeout(resolve, 0))` 让出 Worker 宏任务，使取消消息能被处理。ID 使用参数规范串和内容哈希生成，排序固定为分数、复杂度、规范串。

- [ ] **步骤 4：运行自动搜索测试**

运行：`pnpm --dir gui test:unit -- src/lib/lsbAutoSearch.test.ts`

预期：四类隐藏方式、取消、进度和去重测试通过。

- [ ] **步骤 5：提交**

```powershell
git add gui/src/lib/lsbAutoSearch.ts gui/src/lib/lsbAutoSearch.test.ts
git commit -m "功能：实现 LSB 分阶段自动分析"
```

### 任务 7：Worker 协议与取消

**文件：**
- 新建：`gui/src/workers/lsbWorker.ts`
- 新建：`gui/src/lib/lsbWorkerClient.ts`
- 新建：`gui/src/lib/lsbWorkerClient.test.ts`

- [ ] **步骤 1：写客户端失败测试**

用实现 `postMessage/addEventListener/removeEventListener/terminate` 的 FakeWorker，断言初始化传递源、自动任务转发进度、手动任务返回结果、取消发送消息、同一任务只结算一次、迟到消息被忽略和 `dispose` 终止 Worker。

```ts
const client = new LsbWorkerClient(() => fakeWorker);
const pending = client.auto(source, options, onProgress);
fakeWorker.emit({ type: "complete", jobId: fakeWorker.lastJobId, candidates: [] });
await expect(pending).resolves.toEqual([]);
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --dir gui test:unit -- src/lib/lsbWorkerClient.test.ts`

预期：模块不存在而失败。

- [ ] **步骤 3：实现判别联合消息协议**

客户端默认工厂使用：

```ts
() => new Worker(new URL("../workers/lsbWorker.ts", import.meta.url), { type: "module" })
```

请求包含 `init/auto/manual/cancel`，响应包含 `ready/progress/complete/manual-complete/cancelled/error`。每个运行使用递增 `jobId`，取消和文件替换都使旧 job 失效；Worker 捕获异常并只回传错误名称和消息。客户端向 Worker 转移 `source.rgba.slice().buffer` 和可选的 `paletteIndices.slice().buffer`，任务状态中的源数组不得被分离。

- [ ] **步骤 4：运行客户端测试和构建**

运行：`pnpm --dir gui test:unit -- src/lib/lsbWorkerClient.test.ts && pnpm --dir gui build:renderer`

预期：客户端测试通过，Vite 产物中包含 LSB Worker chunk。

- [ ] **步骤 5：提交**

```powershell
git add gui/src/workers/lsbWorker.ts gui/src/lib/lsbWorkerClient.ts gui/src/lib/lsbWorkerClient.test.ts
git commit -m "功能：增加 LSB 后台分析任务"
```

### 任务 8：LSB 文件载入、预览和手动控件

**文件：**
- 新建：`gui/src/components/processing/LsbWorkbench.tsx`
- 新建：`gui/src/components/processing/LsbWorkbench.test.tsx`
- 新建：`gui/src/components/processing/lsb/LsbSourcePanel.tsx`
- 新建：`gui/src/components/processing/lsb/LsbParameterPanel.tsx`
- 修改：`gui/src/components/processing/MiscWorkbench.tsx`
- 修改：`gui/src/components/processing/MiscWorkbench.test.tsx`

- [ ] **步骤 1：写渲染和参数交互失败测试**

静态渲染断言 LSB 模式由专用组件提供“自动分析/手动提取”“快速/深度”“数据源顺序”；react-test-renderer 交互测试断言添加 `R4`、移动/删除令牌、切换逐列/反向/蛇形、packing 和 offset 后只产生新的完整参数对象。

```ts
expect(renderLsb()).toContain("数据源顺序");
expect(renderLsb()).toContain("自动分析");
expect(renderMode("image")).not.toContain("数据源顺序");
```

- [ ] **步骤 2：运行组件测试确认失败**

运行：`pnpm --dir gui test:unit -- src/components/processing/LsbWorkbench.test.tsx src/components/processing/MiscWorkbench.test.tsx`

预期：专用工作台和新文案不存在而失败。

- [ ] **步骤 3：实现载入和手动参数界面**

`LsbWorkbench` props 固定为：

```ts
interface LsbWorkbenchProps { analysis?: LsbLocalAnalysis; flagPrefixes: readonly string[]; flagCaseSensitive: boolean; flagEnabled: boolean; onAnalysisChange: (analysis: LsbLocalAnalysis) => void; onClear: () => void }
```

载入顺序：先取消旧 job；校验 512 MiB；读 `arrayBuffer`；生成对象 URL；解码到 Canvas RGBA；尝试 `parsePaletteIndexes`；校验 10000×10000；写入 `loading` 再写入 `idle`。令牌编辑使用上移/下移图标按钮而非依赖拖放，确保键盘可操作；每个按钮带可访问名称。测试还要断言替换文件和卸载时释放对象 URL、取消当前任务并终止 Worker。

- [ ] **步骤 4：运行组件测试**

运行：`pnpm --dir gui test:unit -- src/components/processing/LsbWorkbench.test.tsx src/components/processing/MiscWorkbench.test.tsx`

预期：模式隔离、默认值和参数交互通过。

- [ ] **步骤 5：提交**

```powershell
git add gui/src/components/processing/LsbWorkbench.tsx gui/src/components/processing/LsbWorkbench.test.tsx gui/src/components/processing/lsb/LsbSourcePanel.tsx gui/src/components/processing/lsb/LsbParameterPanel.tsx gui/src/components/processing/MiscWorkbench.tsx gui/src/components/processing/MiscWorkbench.test.tsx
git commit -m "功能：构建 LSB 手动提取界面"
```

### 任务 9：自动结果、文件树和导出

**文件：**
- 新建：`gui/src/components/processing/lsb/LsbResultsPanel.tsx`
- 新建：`gui/src/components/processing/lsb/LsbResultsPanel.test.tsx`
- 修改：`gui/src/components/processing/LsbWorkbench.tsx`
- 修改：`gui/src/components/processing/LsbWorkbench.test.tsx`

- [ ] **步骤 1：写运行与结果交互失败测试**

注入 Fake LsbWorkerClient，覆盖运行、进度、取消、失败、部分候选保留、候选选择、“应用参数”、文本/Hex/文件标签、归档子项和导出按钮状态：

```ts
expect(resultMarkup).toContain("ctfshow{found}");
expect(resultMarkup).toContain("R0,G0,B0");
expect(resultMarkup).toContain("应用参数");
```

- [ ] **步骤 2：运行结果组件测试确认失败**

运行：`pnpm --dir gui test:unit -- src/components/processing/lsb/LsbResultsPanel.test.tsx src/components/processing/LsbWorkbench.test.tsx`

预期：结果组件不存在而失败。

- [ ] **步骤 3：实现候选和导出流程**

结果组件 props 使用 `candidate/selectedId/onSelect/onApply/onExport`，不直接操作 Worker。文本预览使用 `white-space: pre-wrap`，Hex 每行 16 字节，文件树递归渲染但默认只展开第一层。导出函数从所选 `Uint8Array` 创建 Blob 和对象 URL，使用临时 `<a download>` 触发并立即释放 URL；文件名基于输入名、候选排名和媒体类型生成。

自动运行将 progress 写回任务状态；取消保留当前候选并设为 `cancelled`；再次运行先清空候选；应用候选复制其完整参数、切换 manual 并请求 Worker 重新提取。

- [ ] **步骤 4：运行结果测试**

运行：`pnpm --dir gui test:unit -- src/components/processing/lsb/LsbResultsPanel.test.tsx src/components/processing/LsbWorkbench.test.tsx`

预期：状态、标签页、应用参数和导出测试通过。

- [ ] **步骤 5：提交**

```powershell
git add gui/src/components/processing/lsb/LsbResultsPanel.tsx gui/src/components/processing/lsb/LsbResultsPanel.test.tsx gui/src/components/processing/LsbWorkbench.tsx gui/src/components/processing/LsbWorkbench.test.tsx
git commit -m "功能：展示并导出 LSB 分析结果"
```

### 任务 10：App 任务隔离与全局 Flag 配置

**文件：**
- 修改：`gui/src/App.tsx`
- 新建：`gui/src/App.lsb.test.tsx`
- 修改：`gui/src/components/processing/MiscWorkbench.tsx`

- [ ] **步骤 1：写任务隔离失败测试**

测试 LSB 更新只写入 `misc:lsb` 的 `localAnalysis`，切到 `misc:image` 和 `crypto:encoding` 不泄漏结果，切回后仍恢复；清空只重置当前键。另断言全局 Flag 前缀、大小写和启用状态传到 LSB。

```ts
expect(tasks["misc:lsb"].localAnalysis?.kind).toBe("lsb");
expect(tasks["misc:image"].localAnalysis).toBeUndefined();
```

- [ ] **步骤 2：运行 App 测试确认失败**

运行：`pnpm --dir gui test:unit -- src/App.lsb.test.tsx`

预期：App 尚未传递分析状态和更新回调而失败。

- [ ] **步骤 3：接入现有任务存储**

新增 `updateLocalAnalysis(analysis: LocalAnalysisState)`，通过当前 `key` 更新 `TaskState.localAnalysis`。给 `MiscWorkbench` 增加 `analysis/flagPrefixes/flagCaseSensitive/flagEnabled/onAnalysisChange`，只在 `mode === "lsb"` 时传给 `LsbWorkbench`；其他 Misc 模式保留现有参数协议。

- [ ] **步骤 4：运行 App 与任务测试**

运行：`pnpm --dir gui test:unit -- src/App.lsb.test.tsx src/state/taskStore.test.ts`

预期：隔离、恢复、清空和 Flag 配置测试通过。

- [ ] **步骤 5：提交**

```powershell
git add gui/src/App.tsx gui/src/App.lsb.test.tsx gui/src/components/processing/MiscWorkbench.tsx
git commit -m "功能：持久化 LSB 独立任务结果"
```

### 任务 11：视觉、四题验收和完整验证

**文件：**
- 修改：`gui/src/index.css`
- 修改：`gui/src/indexCss.test.ts`
- 新建：`gui/src/lib/lsbAcceptance.test.ts`

- [ ] **步骤 1：写样式与回归失败测试**

`indexCss.test.ts` 断言明暗主题均定义 `.lsb-token.active`、`.lsb-candidate-selected` 和结果标签选中态，窄窗口存在单列布局。`lsbAcceptance.test.ts` 使用程序化 RGBA 夹具复现四种参数形态，验证自动搜索和“应用参数”所依赖的手动提取结果；原始 PNG 不在 Node 测试中替代浏览器解码，留到步骤 5 直接走 CTFBox UI。

```ts
const cases = [rowRgbFixture, columnAbgFixture, reverseColumnZipFixture, mixedBitFixture];
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --dir gui test:unit -- src/indexCss.test.ts src/lib/lsbAcceptance.test.ts`

预期：新选择器和验收适配器尚不存在而失败。

- [ ] **步骤 3：完成稳定响应式样式**

沿用现有 CSS 变量，卡片圆角不超过 4px。给图片预览固定 `aspect-ratio`/最大高度，令牌按钮固定最小宽高，候选表使用稳定网格列；`max-width: 820px` 时把 asset/inspector/results 改为单列，文本使用 `overflow-wrap:anywhere`。补齐浅色主题的选中背景、边框和文字颜色。

- [ ] **步骤 4：运行全部自动验证**

运行：

```powershell
pnpm --dir gui test:unit
pnpm --dir gui typecheck
pnpm --dir gui build:renderer
python -m unittest discover -s tools -p "test_*.py"
python tools/verify_localization.py
cargo fmt --manifest-path gui/src-tauri/Cargo.toml -- --check
cargo test --manifest-path gui/src-tauri/Cargo.toml
```

预期：全部退出码为 0；Vite 报告包含主页面和 Worker 产物。

- [ ] **步骤 5：在运行中的 CTFBox UI 验收四题**

启动 `pnpm --dir gui dev:renderer`，使用浏览器自动化依次选择四个文件。每题检查自动候选、应用参数后的手动结果、明暗主题和窄窗口；`misc55` 额外检查 215 字节 ZIP、条目 `旗子` 和内部 Flag。截图保存到忽略目录，不加入提交。

预期结果严格为：

```text
misc53 ctfshow{69830d5a3a3b5006f7b11193e9bc22a2}
misc54 ctfshow{b1f8ab24b8ca223d0affbf372ba0e4fa}
misc55 ctfshow{daf256838e19a19d9e7b0a69642ad5ee}
misc56 ctfshow{1b30c28a5fca6cec5886b1d2cc8b1263}
```

- [ ] **步骤 6：提交最终样式和验收测试**

```powershell
git add gui/src/index.css gui/src/indexCss.test.ts gui/src/lib/lsbAcceptance.test.ts
git commit -m "测试：完成 LSB 工作台四题验收"
```

- [ ] **步骤 7：核对提交与工作区边界**

运行：`git status --short && git log --oneline -12`

预期：原先存在的无关改动没有被任何 LSB 提交覆盖；计划内文件均已提交，无新的构建产物被跟踪。
