import { FolderOpen, Play, Plug, PlugZap, RotateCcw, Terminal, Trash2, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import {
  WebshellSession,
  type WebshellConnectConfig,
  type WebshellEntry,
  type WebshellEvent,
  type WebshellServerInfo,
  type WebshellTransport,
} from "../../lib/webshellSession";
import { createTauriTransport } from "../../lib/webshellTauriTransport";

interface WebshellWorkbenchProps {
  transport?: WebshellTransport;
  runId?: string;
}

type Status = "idle" | "connecting" | "connected" | "error";
type Tab = "terminal" | "files";

interface TerminalLine {
  cmd: string;
  output: string;
}

const PAYLOAD_TYPES: WebshellConnectConfig["payloadType"][] = ["php", "jsp", "asp", "aspx"];
const ENCODERS: WebshellConnectConfig["encoder"][] = ["raw", "base64"];

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): string {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return value;
  }
}

export function WebshellWorkbench({ transport, runId }: WebshellWorkbenchProps) {
  const sessionRef = useRef<WebshellSession | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [config, setConfig] = useState<WebshellConnectConfig>({
    target: "",
    password: "pass",
    payloadType: "php",
    encoder: "base64",
  });
  const [serverInfo, setServerInfo] = useState<WebshellServerInfo | null>(null);
  const [tab, setTab] = useState<Tab>("terminal");
  const [terminal, setTerminal] = useState<TerminalLine[]>([]);
  const [command, setCommand] = useState("");
  const [path, setPath] = useState(".");
  const [entries, setEntries] = useState<WebshellEntry[]>([]);
  const [fileView, setFileView] = useState<{ path: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const ensureSession = useCallback(() => {
    if (!sessionRef.current) {
      const id = runId ?? `webshell-${crypto.randomUUID()}`;
      const session = new WebshellSession(transport ?? createTauriTransport(), id);
      session.onLog = (text) => setMessage(text.trim());
      session.onExit = () => {
        setStatus("idle");
        setServerInfo(null);
        sessionRef.current = null;
      };
      sessionRef.current = session;
    }
    return sessionRef.current;
  }, [runId, transport]);

  const failFrom = (event: WebshellEvent): boolean => {
    if (event.ev === "error") {
      setMessage(event.message);
      return true;
    }
    return false;
  };

  const connect = async () => {
    if (!config.target) {
      setMessage("请填写目标地址");
      return;
    }
    setStatus("connecting");
    setMessage("");
    try {
      const result = await ensureSession().connect(config);
      if (failFrom(result)) {
        setStatus("error");
        return;
      }
      if (result.ev === "connected") {
        setServerInfo(result.info);
        setStatus("connected");
      }
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "连接失败");
    }
  };

  const disconnect = async () => {
    await sessionRef.current?.disconnect().catch(() => undefined);
    sessionRef.current = null;
    setStatus("idle");
    setServerInfo(null);
    setTerminal([]);
    setEntries([]);
    setFileView(null);
  };

  const runCommand = async () => {
    const session = sessionRef.current;
    if (!session || !command.trim()) return;
    const current = command;
    setCommand("");
    setBusy(true);
    try {
      const result = await session.exec(current);
      if (result.ev === "exec") setTerminal((lines) => [...lines, { cmd: current, output: result.output }]);
      else if (result.ev === "error") setTerminal((lines) => [...lines, { cmd: current, output: `错误：${result.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const listPath = async (target: string) => {
    const session = sessionRef.current;
    if (!session) return;
    setBusy(true);
    setFileView(null);
    try {
      const result = await session.list(target);
      if (result.ev === "listing") {
        setPath(target);
        setEntries(result.entries);
      } else if (failFrom(result)) {
        setEntries([]);
      }
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (name: string) => {
    const session = sessionRef.current;
    if (!session) return;
    const full = path.endsWith("/") ? `${path}${name}` : `${path}/${name}`;
    setBusy(true);
    try {
      const result = await session.read(full);
      if (result.ev === "file") setFileView({ path: full, text: fromBase64(result.content) });
      else failFrom(result);
    } finally {
      setBusy(false);
    }
  };

  const deleteFile = async (name: string) => {
    const session = sessionRef.current;
    if (!session) return;
    const full = path.endsWith("/") ? `${path}${name}` : `${path}/${name}`;
    setBusy(true);
    try {
      const result = await session.remove(full);
      if (result.ev === "progress") await listPath(path);
      else failFrom(result);
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (file?: File) => {
    const session = sessionRef.current;
    if (!session || !file) return;
    const target = path.endsWith("/") ? `${path}${file.name}` : `${path}/${file.name}`;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await session.upload(target, toBase64(bytes));
      if (result.ev === "progress") await listPath(path);
      else failFrom(result);
    } finally {
      setBusy(false);
    }
  };

  const connected = status === "connected";

  return (
    <section className="local-workbench webshell-workbench">
      <div className="local-tool-strip">
        <div><span>Web / Webshell 管理</span><strong>第一方 NDJSON 引擎，仅连接你指定的目标</strong></div>
        <div className="local-tool-actions">
          {connected
            ? <button type="button" className="secondary-action" onClick={() => void disconnect()}><PlugZap size={14} />断开</button>
            : <button type="button" className="run-action" disabled={status === "connecting"} onClick={() => void connect()}><Plug size={14} />{status === "connecting" ? "连接中" : "连接"}</button>}
        </div>
      </div>

      <div className="webshell-connect">
        <label className="inline-control webshell-target"><span>目标</span><input value={config.target} placeholder="http://host/shell.php" disabled={connected} onChange={(event) => setConfig((prev) => ({ ...prev, target: event.target.value }))} /></label>
        <label className="inline-control"><span>密钥</span><input value={config.password} disabled={connected} onChange={(event) => setConfig((prev) => ({ ...prev, password: event.target.value }))} /></label>
        <label className="inline-control"><span>类型</span><select value={config.payloadType} disabled={connected} onChange={(event) => setConfig((prev) => ({ ...prev, payloadType: event.target.value as WebshellConnectConfig["payloadType"] }))}>{PAYLOAD_TYPES.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
        <label className="inline-control"><span>编码</span><select value={config.encoder} disabled={connected} onChange={(event) => setConfig((prev) => ({ ...prev, encoder: event.target.value as WebshellConnectConfig["encoder"] }))}>{ENCODERS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>

      {serverInfo && <div className="webshell-serverinfo">
        <span>用户 <strong>{serverInfo.user ?? "?"}</strong></span>
        <span>系统 <strong>{serverInfo.os ?? "?"}</strong></span>
        <span>目录 <strong>{serverInfo.cwd ?? "?"}</strong></span>
      </div>}

      {connected && <>
        <div className="webshell-tabs">
          <button type="button" className={tab === "terminal" ? "active" : ""} onClick={() => setTab("terminal")}><Terminal size={14} />终端</button>
          <button type="button" className={tab === "files" ? "active" : ""} onClick={() => { setTab("files"); if (!entries.length) void listPath(serverInfo?.cwd ?? "."); }}><FolderOpen size={14} />文件</button>
        </div>

        {tab === "terminal" ? <div className="webshell-terminal">
          <div className="webshell-terminal-log">
            {terminal.length === 0 ? <div className="webshell-empty">尚无命令输出</div> : terminal.map((line, index) => <article key={index}>
              <header>$ {line.cmd}</header>
              <pre>{line.output}</pre>
            </article>)}
          </div>
          <form className="webshell-terminal-input" onSubmit={(event) => { event.preventDefault(); void runCommand(); }}>
            <input value={command} placeholder="输入命令后回车执行" disabled={busy} onChange={(event) => setCommand(event.target.value)} />
            <button type="submit" className="run-action" disabled={busy || !command.trim()}><Play size={14} />执行</button>
          </form>
        </div> : <div className="webshell-files">
          <div className="webshell-files-bar">
            <input value={path} onChange={(event) => setPath(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void listPath(path); }} />
            <button type="button" className="secondary-action" disabled={busy} onClick={() => void listPath(path)}><RotateCcw size={14} />列目录</button>
            <label className="icon-action" title="上传文件"><Upload size={15} /><input type="file" disabled={busy} onChange={(event) => void uploadFile(event.target.files?.[0])} /></label>
          </div>
          <ul className="webshell-entry-list">
            {entries.length === 0 ? <li className="webshell-empty">目录为空或尚未列出</li> : entries.map((entry) => <li key={entry.name}>
              <button type="button" className="webshell-entry-name" onClick={() => void openFile(entry.name)}>{entry.name}</button>
              <span>{entry.type} · {entry.size}B</span>
              <button type="button" className="icon-action" title="删除" onClick={() => void deleteFile(entry.name)}><Trash2 size={14} /></button>
            </li>)}
          </ul>
          {fileView && <section className="webshell-file-view">
            <header><strong>{fileView.path}</strong></header>
            <pre>{fileView.text}</pre>
          </section>}
        </div>}
      </>}

      <footer className={status === "error" || message ? "local-status local-status-error" : "local-status"}>{message || (connected ? "已连接，操作仅作用于目标主机" : "所有请求仅发往你显式指定的目标")}</footer>
    </section>
  );
}
