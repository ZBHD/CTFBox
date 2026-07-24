import { ArrowLeftRight, Copy, FileUp, Play, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { ToolParameters } from "../../lib/commandBuilder";
import { processCrypto, type CryptoOptions } from "../../lib/cryptoEngine";

interface CryptoWorkbenchProps {
  mode: string;
  parameters: ToolParameters;
  onChange: (name: string, value: string | boolean) => void;
  onClear: () => void;
}

const MODE_META: Record<string, { title: string; description: string }> = {
  encoding: { title: "编码转换", description: "在文本、Base64、十六进制和 URL 编码之间转换" },
  hash: { title: "哈希计算", description: "生成 SHA 系列消息摘要" },
  xor: { title: "异或分析", description: "使用循环密钥处理文本并选择输出格式" },
};

function Segmented({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <div className="local-segmented">{options.map((option) => <button type="button" className={value === option.value ? "active" : ""} key={option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

export function CryptoWorkbench({ mode, parameters, onChange, onClear }: CryptoWorkbenchProps) {
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const input = String(parameters.input ?? "");
  const output = String(parameters.output ?? "");
  const codec = String(parameters.codec ?? "base64");
  const direction = String(parameters.direction ?? "encode");
  const algorithm = String(parameters.algorithm ?? "SHA-256");
  const format = String(parameters.format ?? "hex");
  const meta = MODE_META[mode] ?? MODE_META.encoding;

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
          <div className="control-cluster"><span>编码</span><Segmented value={codec} options={[{ value: "base64", label: "Base64" }, { value: "hex", label: "Hex" }, { value: "url", label: "URL" }]} onChange={(value) => onChange("codec", value)} /></div>
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
      <footer className={error ? "local-status local-status-error" : "local-status"}>{error || (parameters.fileName ? `已载入 ${String(parameters.fileName)}` : "所有处理均在本地完成")}</footer>
    </section>
  );
}
