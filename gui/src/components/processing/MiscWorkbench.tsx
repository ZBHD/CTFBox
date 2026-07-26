import { Download, FileAudio, FileImage, FileUp, Play, RotateCcw, ScanSearch } from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import type { ToolParameters } from "../../lib/commandBuilder";
import type { LocalAnalysisState, LsbLocalAnalysis } from "../../lib/lsbTypes";
import type { StegoLocalAnalysis } from "../../lib/stegoTypes";
import type { ZipLocalAnalysis } from "../../lib/zipTypes";
import { FakeEncryptionWorkbench } from "./FakeEncryptionWorkbench";
import { LsbWorkbench } from "./LsbWorkbench";
import { StegoWorkbench } from "./StegoWorkbench";

interface MiscWorkbenchProps {
  mode: string;
  parameters: ToolParameters;
  onChange: (name: string, value: string | boolean) => void;
  onClear: () => void;
  analysis?: LocalAnalysisState;
  flagPrefixes?: readonly string[];
  flagCaseSensitive?: boolean;
  flagEnabled?: boolean;
  onAnalysisChange?: (analysis: LocalAnalysisState) => void;
}

const MODE_META: Record<string, { title: string; description: string; accept: string }> = {
  "fake-encryption": { title: "伪加密", description: "检查 ZIP 本地文件头和中央目录的加密标记", accept: ".zip" },
  lsb: { title: "LSB 隐写", description: "按颜色通道、位平面和像素顺序提取低位数据", accept: "image/*" },
  image: { title: "图片隐写", description: "检查元数据、颜色通道、附加数据和可打印字符串", accept: "image/*" },
  audio: { title: "音频隐写", description: "从波形、频谱和声道差异中定位隐藏数据", accept: "audio/*" },
};

function ToggleButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" className={active ? "analysis-option active" : "analysis-option"} onClick={onClick}>{children}</button>;
}

function FileDropZone({ mode, fileName, accept, onFile }: { mode: string; fileName: string; accept: string; onFile: (file: File) => void }) {
  return (
    <label className={`file-drop-zone ${fileName ? "file-drop-zone-loaded" : ""}`}>
      {mode === "audio" ? <FileAudio size={24} /> : mode === "fake-encryption" ? <FileUp size={24} /> : <FileImage size={24} />}
      <strong>{fileName || "拖入文件或点击选择"}</strong>
      <span>{fileName ? "点击可替换当前文件" : accept === ".zip" ? "支持 ZIP 归档" : accept === "audio/*" ? "支持常见音频格式" : "支持 PNG、BMP、JPEG 等图片"}</span>
      <input type="file" accept={accept} onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} />
    </label>
  );
}

function OptionRow({ title, description, active, onClick }: { title: string; description: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={active ? "inspection-row active" : "inspection-row"} onClick={onClick}><span className="inspection-check" /><span><strong>{title}</strong><small>{description}</small></span></button>;
}

export function MiscWorkbench({ mode, parameters, onChange, onClear, analysis, flagPrefixes = ["flag", "CTF"], flagCaseSensitive = false, flagEnabled = true, onAnalysisChange = () => undefined }: MiscWorkbenchProps) {
  if (mode === "lsb") return <LsbWorkbench analysis={analysis as LsbLocalAnalysis | undefined} flagPrefixes={flagPrefixes} flagCaseSensitive={flagCaseSensitive} flagEnabled={flagEnabled} onAnalysisChange={onAnalysisChange} onClear={onClear} />;
  if (mode === "image") return <StegoWorkbench analysis={analysis as StegoLocalAnalysis | undefined} flagPrefixes={flagPrefixes} flagCaseSensitive={flagCaseSensitive} flagEnabled={flagEnabled} onAnalysisChange={onAnalysisChange} onClear={onClear} />;
  if (mode === "fake-encryption") return <FakeEncryptionWorkbench analysis={analysis as ZipLocalAnalysis | undefined} flagPrefixes={flagPrefixes} flagCaseSensitive={flagCaseSensitive} flagEnabled={flagEnabled} onAnalysisChange={onAnalysisChange} onClear={onClear} />;
  const meta = MODE_META[mode] ?? MODE_META.image;
  const fileName = String(parameters.fileName ?? "");
  const dataUrl = String(parameters.dataUrl ?? "");

  const loadFile = (file: File) => {
    onChange("fileName", file.name);
    onChange("fileSize", String(file.size));
    onChange("fileType", file.type || "application/octet-stream");
    const reader = new FileReader();
    reader.addEventListener("load", () => onChange("dataUrl", String(reader.result ?? "")));
    reader.readAsDataURL(file);
  };

  const setSingle = (name: string) => (event: ChangeEvent<HTMLInputElement>) => onChange(name, event.target.value);
  const runLabel = mode === "fake-encryption" ? "检测并修复" : mode === "lsb" ? "提取数据" : "开始分析";

  return (
    <section className="local-workbench misc-workbench">
      <div className="local-tool-strip">
        <div><span>Misc / {meta.title}</span><strong>{meta.description}</strong></div>
        <div className="local-tool-actions">
          <button type="button" className="secondary-action" onClick={onClear}><RotateCcw size={14} />清空</button>
          <button type="button" className="run-action" disabled={!fileName} onClick={() => onChange("analysisRequested", true)}><Play size={14} />{runLabel}</button>
        </div>
      </div>

      <div className="misc-workspace-grid">
        <section className="asset-stage">
          <header className="local-section-header"><div><strong>输入文件</strong><span>{fileName ? `${parameters.fileType} · ${parameters.fileSize} 字节` : "尚未载入文件"}</span></div></header>
          <div className="asset-stage-content">
            <FileDropZone mode={mode} fileName={fileName} accept={meta.accept} onFile={loadFile} />
            {(mode === "lsb" || mode === "image") && dataUrl && <div className="image-preview"><img src={dataUrl} alt="待分析图片预览" /></div>}
            {mode === "audio" && <div className="audio-preview">
              <div className={parameters.view === "spectrum" ? "audio-visual spectrum" : "audio-visual waveform"} aria-label="音频可视化">
                {Array.from({ length: 48 }, (_, index) => <span key={index} style={{ height: `${18 + ((index * 17) % 68)}%` }} />)}
              </div>
              {dataUrl && <audio controls src={dataUrl} />}
            </div>}
          </div>
        </section>

        <section className="analysis-inspector">
          <header className="local-section-header"><div><strong>分析参数</strong><span>按当前模块调整</span></div></header>
          <div className="analysis-inspector-content">
            {mode === "fake-encryption" && <>
              <div className="inspector-group"><span className="inspector-label">ZIP 加密标记</span>
                <OptionRow title="本地文件头" description="检查 General Purpose Bit Flag 第 0 位" active={parameters.localHeader !== false} onClick={() => onChange("localHeader", parameters.localHeader === false)} />
                <OptionRow title="中央目录" description="同步检查 Central Directory 标记" active={parameters.centralDirectory !== false} onClick={() => onChange("centralDirectory", parameters.centralDirectory === false)} />
              </div>
              <div className="inspector-group"><span className="inspector-label">修复策略</span>
                <ToggleButton active={parameters.repairMode !== "report"} onClick={() => onChange("repairMode", "repair")}>清除错误标记</ToggleButton>
                <ToggleButton active={parameters.repairMode === "report"} onClick={() => onChange("repairMode", "report")}>仅生成报告</ToggleButton>
              </div>
            </>}

            {mode === "lsb" && <>
              <div className="inspector-group"><span className="inspector-label">颜色通道</span><div className="channel-options">{["R", "G", "B", "A"].map((channel) => <ToggleButton key={channel} active={String(parameters.channels ?? "RGB").includes(channel)} onClick={() => { const current = String(parameters.channels ?? "RGB"); onChange("channels", current.includes(channel) ? current.replace(channel, "") : `${current}${channel}`); }}>{channel}</ToggleButton>)}</div></div>
              <div className="inspector-group"><span className="inspector-label">位平面</span><div className="bit-plane-options">{Array.from({ length: 8 }, (_, bit) => <ToggleButton key={bit} active={String(parameters.bitPlane ?? "0") === String(bit)} onClick={() => onChange("bitPlane", String(bit))}>{bit}</ToggleButton>)}</div></div>
              <div className="inspector-group"><span className="inspector-label">提取顺序</span><div className="channel-options"><ToggleButton active={parameters.order !== "bgr"} onClick={() => onChange("order", "rgb")}>RGB</ToggleButton><ToggleButton active={parameters.order === "bgr"} onClick={() => onChange("order", "bgr")}>BGR</ToggleButton><ToggleButton active={parameters.scan === "column"} onClick={() => onChange("scan", "column")}>逐列</ToggleButton></div></div>
              <label className="inline-control stacked"><span>结束标记</span><input value={String(parameters.terminator ?? "")} placeholder="可选，例如 }" onChange={setSingle("terminator")} /></label>
            </>}

            {mode === "image" && <div className="inspector-group"><span className="inspector-label">检查项目</span>
              <OptionRow title="文件元数据" description="格式、尺寸、EXIF 与文本块" active={parameters.metadata !== false} onClick={() => onChange("metadata", parameters.metadata === false)} />
              <OptionRow title="颜色通道" description="拆分 RGB/A 通道并增强对比度" active={parameters.colorChannels !== false} onClick={() => onChange("colorChannels", parameters.colorChannels === false)} />
              <OptionRow title="附加数据" description="检查文件结束标记后的内容" active={parameters.appended !== false} onClick={() => onChange("appended", parameters.appended === false)} />
              <OptionRow title="可打印字符串" description="提取连续可见字符和编码文本" active={Boolean(parameters.strings)} onClick={() => onChange("strings", !parameters.strings)} />
            </div>}

            {mode === "audio" && <>
              <div className="inspector-group"><span className="inspector-label">视图</span><div className="channel-options"><ToggleButton active={parameters.view !== "spectrum"} onClick={() => onChange("view", "waveform")}>波形</ToggleButton><ToggleButton active={parameters.view === "spectrum"} onClick={() => onChange("view", "spectrum")}>频谱</ToggleButton></div></div>
              <div className="inspector-group"><span className="inspector-label">声道</span><div className="channel-options">{["双声道", "左声道", "右声道", "差分"].map((label, index) => <ToggleButton key={label} active={String(parameters.audioChannel ?? "0") === String(index)} onClick={() => onChange("audioChannel", String(index))}>{label}</ToggleButton>)}</div></div>
              <label className="inline-control stacked"><span>频率范围（Hz）</span><div className="range-pair"><input type="number" value={String(parameters.minFrequency ?? "0")} onChange={setSingle("minFrequency")} /><input type="number" value={String(parameters.maxFrequency ?? "22050")} onChange={setSingle("maxFrequency")} /></div></label>
            </>}
          </div>
        </section>

        <section className="extraction-results">
          <header className="local-section-header"><div><strong>提取结果</strong><span>{parameters.analysisRequested ? "等待分析适配器返回结果" : "运行后显示数据和文件"}</span></div><button type="button" className="icon-action" disabled title="导出结果"><Download size={14} /></button></header>
          <div className="extraction-empty"><ScanSearch size={24} /><span>{fileName ? "参数已就绪" : "载入文件后开始分析"}</span><small>识别到的文本、二进制片段和 Flag 会集中显示在这里</small></div>
        </section>
      </div>
    </section>
  );
}
