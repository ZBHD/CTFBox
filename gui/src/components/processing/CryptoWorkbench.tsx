import { ArrowLeftRight, Copy, FileUp, Play, RotateCcw, ScanSearch } from "lucide-react";
import { useMemo, useState } from "react";
import type { ToolParameters } from "../../lib/commandBuilder";
import { CODEC_GROUPS, CODEC_LABELS, decodeCandidates, processCrypto, type CryptoCodec, type CryptoOptions } from "../../lib/cryptoEngine";

interface CryptoWorkbenchProps {
  mode: string;
  parameters: ToolParameters;
  flagPrefixes?: readonly string[];
  flagCaseSensitive?: boolean;
  flagEnabled?: boolean;
  onChange: (name: string, value: string | boolean) => void;
  onClear: () => void;
}

const MODE_META: Record<string, { title: string; description: string }> = {
  encoding: { title: "编码转换", description: "支持 11 种常用编码，并自动识别最多三层嵌套内容" },
  hash: { title: "哈希计算", description: "生成 SHA 系列消息摘要" },
  xor: { title: "异或分析", description: "使用循环密钥处理文本并选择输出格式" },
};

function Segmented({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <div className="local-segmented">{options.map((option) => <button type="button" className={value === option.value ? "active" : ""} key={option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

function HighlightedValue({ value, flags }: { value: string; flags: string[] }) {
  if (!flags.length) return <>{value}</>;
  const pattern = new RegExp(`(${flags.map((flag) => flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return <>{value.split(pattern).map((part, index) => flags.includes(part) ? <mark key={`${part}-${index}`}>{part}</mark> : part)}</>;
}

export function CryptoWorkbench({ mode, parameters, flagPrefixes = ["flag", "CTF"], flagCaseSensitive = false, flagEnabled = true, onChange, onClear }: CryptoWorkbenchProps) {
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const input = String(parameters.input ?? "");
  const output = String(parameters.output ?? "");
  const codec = String(parameters.codec ?? "base64") as CryptoCodec;
  const direction = String(parameters.direction ?? "encode");
  const algorithm = String(parameters.algorithm ?? "SHA-256");
  const format = String(parameters.format ?? "hex");
  const meta = MODE_META[mode] ?? MODE_META.encoding;
  const candidates = useMemo(
    () => mode === "encoding" ? decodeCandidates(input, flagEnabled ? flagPrefixes : [], flagCaseSensitive, 3) : [],
    [flagCaseSensitive, flagEnabled, flagPrefixes, input, mode],
  );

  const run = async () => {
    setRunning(true);
    setError("");
    try {
      const result = await processCrypto(mode, input, {
        codec,
        direction,
        algorithm,
        key: String(parameters.key ?? ""),
        format,
      } as CryptoOptions);
      onChange("output", result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "处理失败");
    } finally {
      setRunning(false);
    }
  };

  const loadTextFile = async (file?: File) => {
    if (!file) return;
    onChange("input", await file.text());
    onChange("fileName", file.name);
  };

  return (
    <section className="local-workbench crypto-workbench">
      <div className="local-tool-strip">
        <div><span>Crypto / {meta.title}</span><strong>{meta.description}</strong></div>
        <div className="local-tool-actions">
          <button type="button" className="secondary-action" onClick={onClear}><RotateCcw size={14} />清空</button>
          <button type="button" className="run-action" disabled={!input || running} onClick={() => void run()}><Play size={14} />{running ? "处理中" : "处理"}</button>
        </div>
      </div>

      <div className="crypto-controls">
        {mode === "encoding" && <>
          <label className="codec-control"><span>编码</span><select value={codec} onChange={(event) => onChange("codec", event.target.value)}>
            {CODEC_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>
              {group.codecs.map((value) => <option key={value} value={value}>{CODEC_LABELS[value]}</option>)}
            </optgroup>)}
          </select></label>
          <div className="control-cluster"><span>方向</span><Segmented value={direction} options={[{ value: "encode", label: "编码" }, { value: "decode", label: "解码" }]} onChange={(value) => onChange("direction", value)} /></div>
        </>}
        {mode === "hash" && <div className="control-cluster"><span>算法</span><Segmented value={algorithm} options={["SHA-1", "SHA-256", "SHA-384", "SHA-512"].map((value) => ({ value, label: value }))} onChange={(value) => onChange("algorithm", value)} /></div>}
        {mode === "xor" && <>
          <label className="inline-control"><span>密钥</span><input value={String(parameters.key ?? "")} placeholder="循环密钥" onChange={(event) => onChange("key", event.target.value)} /></label>
          <div className="control-cluster"><span>输出</span><Segmented value={format} options={[{ value: "hex", label: "Hex" }, { value: "base64", label: "Base64" }, { value: "text", label: "文本" }]} onChange={(value) => onChange("format", value)} /></div>
        </>}
      </div>

      <div className="crypto-editors">
        <section className="editor-pane">
          <header><div><strong>输入</strong><span>{input.length} 字符</span></div><label className="icon-action" title="读取文本文件"><FileUp size={15} /><input type="file" onChange={(event) => void loadTextFile(event.target.files?.[0])} /></label></header>
          <textarea value={input} placeholder="在这里粘贴或输入内容" onChange={(event) => onChange("input", event.target.value)} />
        </section>
        <button className="editor-swap" type="button" disabled={!output || mode === "hash"} title="交换输入与输出" onClick={() => { onChange("input", output); onChange("output", input); }}><ArrowLeftRight size={16} /></button>
        <section className="editor-pane">
          <header><div><strong>输出</strong><span>{output.length} 字符</span></div><button className="icon-action" type="button" disabled={!output} title="复制输出" onClick={() => void navigator.clipboard.writeText(output)}><Copy size={15} /></button></header>
          <textarea value={output} placeholder="处理结果会显示在这里" readOnly />
        </section>
      </div>

      {mode === "encoding" && input && <section className="auto-decode-panel">
        <header><div><ScanSearch size={14} /><strong>自动解码</strong><span>{candidates.length} 个可读结果</span></div><small>最多递归 3 层</small></header>
        <div className="decode-results">
          {candidates.length ? candidates.map((candidate) => <article className={candidate.flags.length ? "decode-result decode-result-flag" : "decode-result"} key={`${candidate.path.join("-")}-${candidate.value}`}>
            <div><strong>{candidate.path.join(" → ")}</strong><span>{candidate.depth} 层</span>{candidate.flags.length > 0 && <mark>Flag</mark>}</div>
            <pre><HighlightedValue value={candidate.value} flags={candidate.flags} /></pre>
          </article>) : <div className="decode-empty">未识别到可读的编码结果</div>}
        </div>
      </section>}

      <footer className={error ? "local-status local-status-error" : "local-status"}>{error || (parameters.fileName ? `已载入 ${String(parameters.fileName)}` : "所有处理均在本地完成")}</footer>
    </section>
  );
}
