import { Play, RotateCcw, ScanSearch } from "lucide-react";
import { useState } from "react";
import type { ToolParameters } from "../../lib/commandBuilder";
import { analyzeCrypto, DEFAULT_CRYPTA_OPTIONS } from "../../lib/cryptaPipeline";
import type { CryptaReport } from "../../lib/cryptaTypes";

interface CryptaWorkbenchProps {
  parameters: ToolParameters;
  flagPrefixes?: readonly string[];
  flagCaseSensitive?: boolean;
  flagEnabled?: boolean;
  onChange: (name: string, value: string | boolean) => void;
  onClear: () => void;
}

export function CryptaWorkbench({ parameters, flagPrefixes = ["flag", "CTF"], flagCaseSensitive = false, flagEnabled = true, onChange, onClear }: CryptaWorkbenchProps) {
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<CryptaReport | null>(null);
  const input = String(parameters.input ?? "");

  const run = async () => {
    setRunning(true);
    setError("");
    setReport(null);
    try {
      const result = await analyzeCrypto(input, flagEnabled ? flagPrefixes : [], flagCaseSensitive, DEFAULT_CRYPTA_OPTIONS, new AbortController().signal);
      setReport(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分析失败");
    } finally {
      setRunning(false);
    }
  };

  const loadFile = async (file?: File) => {
    if (!file) return;
    onChange("input", await file.text());
    onChange("fileName", file.name);
  };

  return <section className="local-workbench crypto-workbench">
    <div className="local-tool-strip">
      <div><span>Misc / 密码分析</span><strong>自动识别密码类型并执行破解（RSA/AES/哈希/PRNG 等）</strong></div>
      <div className="local-tool-actions">
        <button type="button" className="secondary-action" onClick={onClear}><RotateCcw size={14} />清空</button>
        <button type="button" className="run-action" disabled={!input || running} onClick={() => void run()}><Play size={14} />{running ? "分析中" : "开始分析"}</button>
      </div>
    </div>

    <div className="crypto-editors">
      <section className="editor-pane" style={{ maxWidth: "100%" }}>
        <header><div><strong>输入</strong><span>{input.length} 字符</span></div><label className="icon-action" title="读取文件"><input type="file" onChange={(event) => void loadFile(event.target.files?.[0])} /></label></header>
        <textarea value={input} placeholder="粘贴密文、PEM 密钥、哈希值或数字序列" onChange={(event) => onChange("input", event.target.value)} />
      </section>
    </div>

    {report && <section className="auto-decode-panel">
      <header><div><ScanSearch size={14} /><strong>分析结果</strong><span>{report.findings.length} 个发现，{report.plaintextCandidates.length} 个候选明文</span></div></header>
      <div className="decode-results">
        {report.findings.map((f) => <article className={f.severity === "high" ? "decode-result decode-result-flag" : "decode-result"} key={f.id}>
          <div><strong>{f.title}</strong><span>{f.source}</span>{f.severity === "high" && <mark>!</mark>}</div>
          <pre>{f.detail}</pre>
        </article>)}
        {report.plaintextCandidates.length > 0 && report.plaintextCandidates.slice(0, 20).map((c, i) => <article className="decode-result" key={`pt-${i}`}>
          <div><strong>候选明文</strong></div>
          <pre>{c}</pre>
        </article>)}
        {report.findings.length === 0 && report.plaintextCandidates.length === 0 && <div className="decode-empty">未发现可疑内容</div>}
      </div>
    </section>}

    <footer className={error ? "local-status local-status-error" : "local-status"}>{error || (parameters.fileName ? `已载入 ${String(parameters.fileName)}` : "所有分析均在本地完成")}</footer>
  </section>;
}
