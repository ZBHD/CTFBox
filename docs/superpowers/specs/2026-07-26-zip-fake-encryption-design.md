# ZIP 伪加密检测与修复 — 设计

- 日期：2026-07-26
- 状态：待审阅
- 归属模块：Misc / 伪加密（`fake-encryption`）
- 决策：Q1=C（报告+修复导出）、Q2=B（标记位 + CRC/inflate 验证）、Q3=A（提升为独立 Workbench）

## 1. 概述

现状：`fake-encryption` 模式在 `MiscWorkbench.tsx` 里只有内联 UI，「检测并修复」按钮仅
`onChange("analysisRequested", true)`，无任何 ZIP 解析逻辑，结果区永远显示占位文本。

目标：把它做成与 LSB / 图片隐写同构的**独立本地分析器**，能够：
1. 解析 ZIP 结构，逐条目判定是否为伪加密（区分真加密）；
2. 对**已确认伪加密**的条目做字节级修复，导出可正常解压的新 ZIP；
3. 顺带在验证解出的明文里扫描全局 Flag 前缀。

全流程离线、纯前端、跑在 Web Worker 中，不依赖 Python 后端。

## 2. 架构与文件布局（对齐 stego 分层）

| 文件 | 职责 |
|---|---|
| `gui/src/lib/zipTypes.ts` | `ZipReport` / `ZipEntryFinding` / `ZipOptions` / `ZipProgress` 类型 |
| `gui/src/lib/zipEncryption.ts` | 纯逻辑：解析 ZIP → 逐条 CRC 验证 → 生成报告 → 字节级修复。**无 DOM 依赖，可脱离 UI 单测** |
| `gui/src/workers/zipWorker.ts` | Worker 入口，跑解析 + inflate（CPU 密集） |
| `gui/src/lib/zipWorkerClient.ts` | 主线程封装（analyze/cancel/进度），仿 `stegoWorkerClient.ts` |
| `gui/src/components/processing/FakeEncryptionWorkbench.tsx` | 编排：载文件/运行/取消/导出，仿 `StegoWorkbench.tsx` |
| `gui/src/components/processing/fakeenc/FakeEncSourcePanel.tsx` | `.zip` 拖拽/选择区 |
| `gui/src/components/processing/fakeenc/FakeEncParameterPanel.tsx` | 检测开关（本地头 / 中央目录 / 修复策略） |
| `gui/src/components/processing/fakeenc/FakeEncResultsPanel.tsx` | 逐条目表格 + 修复导出按钮 |

接线：`MiscWorkbench.tsx:48` 增加
`if (mode === "fake-encryption") return <FakeEncryptionWorkbench .../>`，删除现有内联的
`fake-encryption` 分支 UI（约 `MiscWorkbench.tsx:94-103,128-130` 相关段落）。

依赖：复用已在 `package.json` 的 `fflate`（`inflateRaw`）；复用 `lib/localFileLimits.ts` 的
128 MiB 上限；复用 `lib/flagDetector.ts` 扫描 Flag。**不新增第三方依赖。**

## 3. 核心算法 `zipEncryption.ts`

### 3.1 解析
1. 从尾部向前定位 **EOCD**（签名 `0x06054b50`，末尾 22 字节起、含变长注释时回扫），
   读取中央目录起始偏移与条目数。
2. 顺序读取**中央目录条目**（签名 `0x02014b50`）。每条记录：
   - GP Flag（中央目录 `+8`，2 字节小端）→ 字节偏移记为 `centralGpOffset = entryStart + 8`
   - 压缩方法（`+10`）、CRC32（`+16`）、压缩大小（`+20`）、原始大小（`+24`）
   - 文件名/额外字段/注释长度（`+28/+30/+32`）、本地头偏移（`+42`）
3. 按本地头偏移回读**本地文件头**（签名 `0x04034b50`）：
   - GP Flag（本地头 `+6`）→ `localGpOffset = localHeaderStart + 6`
   - 压缩方法（`+8`）、压缩数据起点（`+30 + 文件名长 + 额外字段长`）

解析失败（签名不符/越界）→ 抛出结构性错误，UI 显示「无法解析为 ZIP 结构」。

### 3.2 逐条目判定（Q2 的 B 档）
对每个条目产出一个 `severity`：

- 记 `localBit0 = localFlag & 1`、`centralBit0 = centralFlag & 1`。
- **CRC 验证**：把该条目的压缩数据当作**未加密**处理：
  - method=0（stored）→ 数据即明文；
  - method=8（deflate）→ `fflate.inflateRaw(compressed)`；
  - 其他方法（含 AES 伪装的 99）→ 不可验证。
  计算解出字节的 CRC32，与存储 CRC 比对。
- 检测 **AES 扩展头**：额外字段中出现 header id `0x9901`，或 method=99。
- 分档：
  | 情况 | severity | verdict |
  |---|---|---|
  | 有任一 bit0=1，且 CRC 验证通过 | `high` | 「确认伪加密，可安全修复」 |
  | `localBit0 !== centralBit0`，但 CRC 无法验证 | `suspicious` | 「标记不一致，疑似伪加密（无法验证）」 |
  | bit0=1、CRC 验证失败、无 AES 头 | `suspicious` | 「疑似真加密（inflate 失败），仅报告」 |
  | 检出 AES 扩展头 / method=99 | `info` | 「真 AES 加密，不可伪修复」 |
  | 两处 bit0=0 | 不产出 finding | 正常条目 |

  原理：真 ZipCrypto 会在压缩数据前置 12 字节加密头，inflate 必失败或 CRC 不符；真 AES
  由扩展头明确识别。因此 CRC 通过是「数据确为明文」的铁证。

- 验证成功解出的明文 → 用 `flagDetector` 扫全局前缀，命中写入 `finding.flagHits` 并整体升序置顶。

### 3.3 修复（字节级补丁，不重打包）
```
patched = original.slice()                 // 克隆原始字节
for entry of report where severity === "high":
    patched[entry.localGpOffset]   &= 0xFE // 清本地头 GP Flag 低字节 bit0
    patched[entry.centralGpOffset] &= 0xFE // 清中央目录 GP Flag 低字节 bit0
导出 Blob(patched) 为 `<原名>-fixed.zip`
```
- 除标志位外**逐字节保真**，不引入 fflate 重压缩差异，最安全。
- `suspicious` / `info` 条目**不修改**，并在报告里注明「未修复及原因」。
- `checkLocalHeader` / `checkCentralDirectory` 开关关闭时，对应处不清位（默认两者都清）。

## 4. 数据类型 `zipTypes.ts`

```ts
export type ZipSeverity = "high" | "suspicious" | "info";

export interface ZipEntryFinding {
  name: string;
  method: "stored" | "deflate" | "aes" | "other";
  localBit0: boolean;
  centralBit0: boolean;
  severity: ZipSeverity;
  verdict: string;               // 中文结论
  crcVerified: boolean;          // CRC 是否验证为明文
  localGpOffset: number;         // 供修复用
  centralGpOffset: number;
  flagHits?: string[];
}

export interface ZipReport {
  entryCount: number;
  entries: ZipEntryFinding[];    // 仅含有异常/证据的条目
  repairable: number;            // severity === "high" 的计数
  flagHits: string[];            // 全局去重
}

export interface ZipOptions {
  checkLocalHeader: boolean;     // 默认 true
  checkCentralDirectory: boolean;// 默认 true
  repairMode: "repair" | "report"; // 默认 "repair"
}

export interface ZipProgress { stage: "parse" | "verify"; completed: number; total: number; }

export interface ZipLocalAnalysis {
  kind: "zip";
  status: "idle" | "loading" | "running" | "cancelled" | "completed" | "failed";
  fileName?: string; fileSize?: number;
  bytes?: Uint8Array;
  options: ZipOptions;
  progress?: ZipProgress;
  report?: ZipReport;
  error?: string;
}
```

## 5. UI 与最终实现效果

复用 stego 三栏骨架（`local-workbench misc-workbench`）：

- **输入文件区**：拖入 `.zip` → 读 `arrayBuffer` → Worker `analyze`（带进度/取消）。显示文件名与大小。
- **分析参数区**：三个开关——「检查本地文件头」「检查中央目录」（默认开）、修复策略
  「清除错误标记 / 仅生成报告」（对齐现有 UI 语义）。
- **提取结果区**：一张**逐条目表**。列：`文件名 | 方法 | L·C 标记 | 结论 | 严重度色标`。
  L·C 用两个小方块表示本地/中央 bit0 是否置位。命中 Flag 的行高亮并置顶。
  表头汇总「N 个条目异常，M 个可修复」。
- **导出按钮**：文案「导出修复后的 ZIP」，仅当 `report.repairable > 0 &&
  options.repairMode !== "report"` 可点；点击生成 `<原名>-fixed.zip` 下载。
- 文件 > 128 MiB → 直接失败提示；非 ZIP → 「无法解析为 ZIP 结构」。

**最终效果示例**：用户拖入一个被 010 Editor 置了伪加密位的 `secret.zip` →
表格显示 `flag.txt | deflate | ⬛/⬛ | 确认伪加密，可安全修复 | high`，顶部提示
「1 个条目异常，1 个可修复」，若明文含 `flag{...}` 则该行高亮显示命中；点「导出修复后的 ZIP」
得到 `secret-fixed.zip`，双击即可正常解压。

## 6. 测试（TDD，主战场 `zipEncryption.test.ts`）

用代码**合成最小 ZIP 字节**（手写 EOCD + 中央目录 + 本地头），覆盖：
1. 正常 ZIP（无置位）→ 无 finding；
2. 伪加密 deflate 条目（置 bit0、数据是明文）→ `high` 且 `crcVerified=true`；
3. 仅本地头置位（标记不一致、CRC 可验证）→ `high`；不可验证时 → `suspicious`；
4. 伪 ZipCrypto（bit0 + 12 字节前缀导致 inflate 失败）→ `suspicious`，修复**不碰**它；
5. AES 扩展头（`0x9901`）→ `info`；
6. 修复后字节：仅目标 bit0 被清、其余逐字节相等、`fflate` 能正常解压；
7. stored（method=0）明文含 `flag{demo}` → `flagHits` 命中；
8. 截断/坏签名 → 抛结构性错误。

另配 `zipWorkerClient.test.ts`（mock worker 收发）与三个面板的渲染测试，沿用现有 vitest 套路。

## 7. 边界与风险

- **Zip64**：EOCD64 定位与 8 字节大小字段。首版**不支持 Zip64**，检出 Zip64 定位记录时
  给出「暂不支持 Zip64」提示（CTF 伪加密题几乎都是普通 ZIP）。
- **数据描述符（bit3）**：CRC/大小在数据后。首版从中央目录取 CRC/大小（中央目录始终有完整值），
  不依赖本地头的占位 0，规避该问题。
- **多方法混合归档**：逐条目独立判定，天然支持部分真加密 + 部分伪加密。
- 修复只清 bit0，不动 bit6（strong encryption）等其他位，避免误伤。
