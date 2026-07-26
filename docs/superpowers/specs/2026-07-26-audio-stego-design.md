# 音频隐写真分析 — 设计

- 日期：2026-07-26
- 状态：待审阅
- 归属模块：Misc / 音频隐写（`audio`）
- 推荐方案：独立 `AudioStegoWorkbench`（对齐 stego 分层），替换现有假可视化

## 1. 概述

现状：`audio` 模式在 `MiscWorkbench.tsx` 里是**纯 UI 壳**——波形/频谱是写死的假柱状图
（`MiscWorkbench.tsx:84`，`Array.from({length:48})` 按固定公式生成高度，与文件无关），
没有任何 PCM 解码或频域分析。

目标：做成与图片隐写同构的独立分析器，对音频做**真实**分析：
1. 解码出各声道 PCM；
2. 渲染真实波形与频谱图（STFT）；
3. 从 PCM 低位提取 LSB 数据、做声道差分、扫描字符串与 Flag、雕取内嵌文件；
4. 读取容器元数据（WAV chunk / ID3）与 `data` 块后的附加数据。

全流程离线、纯前端、跑在 Web Worker。

## 2. 架构与文件布局

| 文件 | 职责 |
|---|---|
| `gui/src/lib/audioTypes.ts` | `AudioReport` / `AudioFinding` / `AudioOptions` / `AudioProgress` / `AudioLocalAnalysis` |
| `gui/src/lib/fft.ts` | 通用 radix-2 Cooley-Tukey 实数 FFT（新增共享工具，先仅音频使用） |
| `gui/src/lib/wavDecoder.ts` | 直接解析 RIFF/WAVE：`fmt `/`data`/`LIST` chunk，输出样本精确的整数 PCM |
| `gui/src/lib/audioStego.ts` | 纯逻辑编排：解码 → 波形 → 频谱 → LSB → 声道差分 → strings → 元数据 |
| `gui/src/workers/audioWorker.ts` | Worker 入口（FFT/LSB 密集计算） |
| `gui/src/lib/audioWorkerClient.ts` | 主线程封装，仿 `stegoWorkerClient.ts` |
| `gui/src/components/processing/AudioStegoWorkbench.tsx` | 编排组件，仿 `StegoWorkbench.tsx` |
| `gui/src/components/processing/audio/AudioSourcePanel.tsx` | 文件区 + `<audio>` 播放器 |
| `gui/src/components/processing/audio/AudioParameterPanel.tsx` | 分析开关与参数 |
| `gui/src/components/processing/audio/AudioResultsPanel.tsx` | 频谱图/波形 canvas + 证据/字符串/文件标签页 |

接线：`MiscWorkbench.tsx:49` 之后增加
`if (mode === "audio") return <AudioStegoWorkbench .../>`，删除现有 `audio` 内联假可视化。

复用：`lib/stegoStrings.ts`（字符串/Flag 扫描）、`lib/lsbArchive.ts`+`lib/lsbFormats.ts`（雕取内嵌文件）、
`lib/localFileLimits.ts`（大小上限）、`lib/flagDetector.ts`。**不新增第三方依赖。**

## 3. 解码策略（双路）

- **WAV（首选，样本精确）**：`wavDecoder.ts` 直接解析容器，支持 PCM 8/16/24/32-bit 整数、
  单/多声道，输出每声道 `Int32Array` 原始样本。LSB 隐写依赖精确整数样本，**只有直接解析才可靠**。
- **有损/其他（mp3/ogg/flac/m4a）**：用 WebAudio `OfflineAudioContext.decodeAudioData` 得到
  Float32 PCM，仅用于波形/频谱/声道差分；LSB 对有损压缩无意义，UI 明确禁用并提示
  「有损格式无样本级 LSB」。

在 Worker 中无 `AudioContext`：`decodeAudioData` 必须在主线程做。因此**主线程负责解码到 PCM**，
把 PCM（可转移的 TypedArray）传入 Worker 做后续 FFT/LSB。这与 stego 主线程解像素、Worker
算分析的分工一致（见 `StegoWorkbench.decodePixels`）。

## 4. 分析模块（`AudioOptions` 各开关）

| 模块 | 开关 | 逻辑 | 产出 |
|---|---|---|---|
| 波形 | `waveform` | 每声道按窗口取 min/max 包络 | `AudioVisual`（折线，canvas 渲染） |
| 频谱图 | `spectrogram` | STFT：分帧 + 汉宁窗 + `fft.ts` → 幅度谱 → 对数着色。检测强单音/异常带 → finding | `AudioVisual`（热力图像素）+ finding |
| LSB 提取 | `lsb`（仅 WAV） | 按 `bitDepth/channelMask/bitPlanes/order` 从整数样本抽低位 → 字节流 → strings + Flag + 文件雕取 | `AudioFinding` + `strings` + `carvedFiles` |
| 声道差分 | `channelDiff`（≥2 声道） | 逐样本 L−R → 新波形 + 对差分再跑 LSB/strings（常见立体声藏数据） | `AudioVisual` + finding |
| 元数据 | `metadata` | WAV `LIST/INFO` chunk、ID3v1/v2、`data` 块后的附加字节（trailing carve） | `metadata[]` + trailing finding |
| 字符串 | `strings` | 对原始文件字节跑 `extractStegoStrings`（复用），命中 Flag 升序 | `strings[]` |

进度阶段：`decode → waveform → spectrogram → lsb → strings`，与 stego 一致地用
`onProgress` 汇报 `completed/total`。取消/代际控制复用 `OperationGeneration` 与 worker 的
`cancel` 协议。

## 5. 数据类型 `audioTypes.ts`

```ts
export type AudioSeverity = "high" | "suspicious" | "info";

export interface AudioFinding {
  id: string; severity: AudioSeverity; source: string;
  title: string; detail: string; offset?: number;
}
export interface AudioVisual {
  id: string; label: string; kind: "waveform" | "spectrogram";
  width: number; height: number; pixels: Uint8ClampedArray; detail?: string;
}
export interface AudioTrackInfo {
  format: string; sampleRate: number; channels: number;
  bitDepth?: number; durationSeconds: number; lossy: boolean;
}
export interface AudioReport {
  track: AudioTrackInfo;
  findings: AudioFinding[];
  visuals: AudioVisual[];           // 波形 + 频谱图
  strings: StegoStringHit[];        // 复用 stego 的字符串类型
  metadata: StegoMetadataEntry[];
  carvedFiles: LsbExtractedFile[];  // 复用 lsb 类型
}
export interface AudioOptions {
  waveform: boolean; spectrogram: boolean; lsb: boolean;
  channelDiff: boolean; metadata: boolean; strings: boolean;
  bitPlanes: number;               // 抽多少低位，默认 1
  channelMask: string;             // 例 "LR"
  order: "interleaved" | "perChannel";
  fftSize: 256 | 512 | 1024;       // 频谱窗口
  minimumStringLength: number;     // 默认 4
}
export interface AudioProgress { stage: "decode"|"waveform"|"spectrogram"|"lsb"|"strings"; completed: number; total: number; }
export interface AudioLocalAnalysis {
  kind: "audio";
  status: "idle"|"loading"|"running"|"cancelled"|"completed"|"failed";
  fileName?: string; fileSize?: number; fileType?: string; dataUrl?: string;
  bytes?: Uint8Array; pcm?: AudioPcm; options: AudioOptions;
  progress?: AudioProgress; report?: AudioReport;
  selectedTab: "overview"|"spectrogram"|"waveform"|"strings"|"files";
  error?: string;
}
```

## 6. UI 与最终实现效果

三栏骨架同 stego：

- **输入区**：拖入音频 → 主线程解码 PCM → 显示 `<audio controls>` 可试听，展示采样率/声道/位深/时长。
- **参数区**：分析开关（波形/频谱/LSB/声道差分/元数据/字符串）；LSB 位平面、声道掩码、
  提取顺序；FFT 窗口大小。有损格式时 LSB 相关控件禁用并提示。
- **结果区**：标签页 `概览 | 频谱图 | 波形 | 字符串 | 文件`。
  - 频谱图/波形是 canvas 真渲染（替换掉现在的假柱）；
  - 概览列出结构化证据（强单音、声道差分异常、trailing 数据、LSB 命中）；
  - 字符串页列 ASCII/UTF-16/GB18030 命中，Flag 高亮；
  - 文件页列雕取出的内嵌文件，可导出。

**最终效果示例**：拖入一个把 flag 藏在 16-bit WAV 最低位的 `challenge.wav` →
频谱图正常显示、LSB 页从低位重建出字节流并识别出 `flag{...}` 置顶高亮；若是立体声差分藏了
摩尔斯/文本，声道差分波形与其字符串命中会给出提示；若 `data` 块后追加了一个 PNG，
文件页把它雕出来供下载。

## 7. 测试（TDD）

- `wavDecoder.test.ts`：合成 8/16/24-bit、单/双声道 WAV 头 + 样本，校验解析出的 PCM 精确等于写入值；坏 chunk 抛错。
- `fft.ts` 测试：对已知正弦输入验证峰值落在正确频点（幅度谱），逆变换往返误差在阈值内。
- `audioStego.test.ts`：
  - 在 WAV 最低位嵌入 `flag{demo}` → LSB 提取命中；
  - `data` 块后追加 PNG 魔数 → carvedFiles 雕出；
  - 立体声差分嵌字符串 → channelDiff 命中；
  - 有损格式路径 → LSB 模块被跳过并给提示。
- `audioWorkerClient.test.ts`（mock worker）+ 三面板渲染测试。

## 8. 边界与风险

- **主线程解码**：`decodeAudioData` 依赖浏览器/WebView 的编解码器，个别格式可能不支持 →
  捕获后降级为「仅按原始字节做 strings/trailing 分析」，不崩溃。
- **大文件/长音频**：128 MiB 上限；频谱图对超长音频按时间下采样到固定宽度，避免像素爆炸。
- **FFT 复杂度**：radix-2 要求窗口为 2 的幂（已限定 256/512/1024），非幂长度补零。
- **单测环境无 AudioContext**：`audioStego.ts` 的可测逻辑以「已解码 PCM」为输入，解码步骤
  隔离在主线程组件里、不进单测；jsdom 下面板测试对 canvas 用最小 stub。
