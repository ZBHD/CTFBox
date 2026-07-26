import { Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AudioLocalAnalysis, AudioPcm } from "../../lib/audioTypes";
import { DEFAULT_AUDIO_OPTIONS } from "../../lib/audioTypes";
import { AudioWorkerClient } from "../../lib/audioWorkerClient";
import { MAX_STEGO_FILE_BYTES } from "../../lib/localFileLimits";
import { OperationGeneration } from "../../lib/operationGeneration";
import { decodeWavSamples } from "../../lib/wavDecoder";
import { AudioParameterPanel } from "./audio/AudioParameterPanel";
import { AudioResultsPanel } from "./audio/AudioResultsPanel";
import { AudioSourcePanel } from "./audio/AudioSourcePanel";

interface AudioStegoWorkbenchProps {
  analysis?: AudioLocalAnalysis;
  flagPrefixes: readonly string[];
  flagCaseSensitive: boolean;
  flagEnabled: boolean;
  onAnalysisChange: (analysis: AudioLocalAnalysis) => void;
  onClear: () => void;
}

function initialAnalysis(): AudioLocalAnalysis {
  return { kind: "audio", status: "idle", options: { ...DEFAULT_AUDIO_OPTIONS }, selectedTab: "overview" };
}

function looksLikeWav(file: File, bytes: Uint8Array) {
  if (/\.wav$/i.test(file.name)) return true;
  return bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
}

// 有损/非 WAV 走 WebAudio 解码为 Float32，再量化到 16-bit 整数仅供可视化（LSB 无意义）。
async function decodeLossy(bytes: Uint8Array): Promise<AudioPcm> {
  const AudioContextCtor = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error("当前环境不支持音频解码");
  const context = new AudioContextCtor();
  try {
    const buffer = await context.decodeAudioData(bytes.slice().buffer);
    const channels: Int32Array[] = [];
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      const samples = new Int32Array(data.length);
      for (let i = 0; i < data.length; i += 1) samples[i] = Math.round(Math.max(-1, Math.min(1, data[i])) * 32767);
      channels.push(samples);
    }
    return { sampleRate: buffer.sampleRate, bitDepth: 16, lossy: true, channels };
  } finally {
    void context.close?.();
  }
}

async function decodeAudio(file: File, bytes: Uint8Array): Promise<AudioPcm> {
  if (looksLikeWav(file, bytes)) return { ...decodeWavSamples(bytes), lossy: false };
  return decodeLossy(bytes);
}

export function AudioStegoWorkbench({ analysis: provided, flagPrefixes, flagCaseSensitive, flagEnabled, onAnalysisChange, onClear }: AudioStegoWorkbenchProps) {
  const analysis = provided ?? initialAnalysis();
  const analysisRef = useRef(analysis);
  const clientRef = useRef<AudioWorkerClient>();
  const generationRef = useRef(new OperationGeneration());
  const previewUrlRef = useRef<string>();
  analysisRef.current = analysis;
  const revokePreview = () => {
    if (!previewUrlRef.current) return;
    URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = undefined;
  };
  useEffect(() => () => {
    generationRef.current.invalidate();
    clientRef.current?.dispose();
    revokePreview();
  }, []);
  const client = () => clientRef.current ??= new AudioWorkerClient();
  const update = (patch: Partial<AudioLocalAnalysis>) => {
    const next = { ...analysisRef.current, ...patch };
    analysisRef.current = next;
    onAnalysisChange(next);
  };
  const busy = analysis.status === "loading" || analysis.status === "running";

  const loadFile = async (file: File) => {
    const generation = generationRef.current.begin();
    clientRef.current?.cancel();
    revokePreview();
    if (file.size > MAX_STEGO_FILE_BYTES) {
      update({ status: "failed", fileName: file.name, fileSize: file.size, bytes: undefined, pcm: undefined, dataUrl: undefined, report: undefined, error: "文件超过 128 MiB 限制" });
      return;
    }
    update({ status: "loading", fileName: file.name, fileSize: file.size, fileType: file.type || "audio/wav", bytes: undefined, pcm: undefined, dataUrl: undefined, report: undefined, error: undefined });
    let previewUrl: string | undefined;
    try {
      previewUrl = URL.createObjectURL(file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!generationRef.current.isCurrent(generation)) { URL.revokeObjectURL(previewUrl); return; }
      let pcm: AudioPcm | undefined;
      let error: string | undefined;
      try {
        pcm = await decodeAudio(file, bytes);
      } catch (decodeFailure) {
        error = `音频解码失败：${decodeFailure instanceof Error ? decodeFailure.message : String(decodeFailure)}，仅可执行字符串/附加数据分析`;
        pcm = { sampleRate: 8000, bitDepth: 16, lossy: true, channels: [new Int32Array(0)] };
      }
      if (!generationRef.current.isCurrent(generation)) { URL.revokeObjectURL(previewUrl); return; }
      previewUrlRef.current = previewUrl;
      update({ status: "idle", bytes, pcm, dataUrl: previewUrl, report: undefined, selectedTab: "overview", error });
    } catch (error) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (!generationRef.current.isCurrent(generation)) return;
      update({ status: "failed", bytes: undefined, pcm: undefined, report: undefined, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const run = async () => {
    const current = analysisRef.current;
    if (!current.bytes || !current.pcm) return;
    if (current.status === "running") {
      generationRef.current.invalidate();
      client().cancel();
      update({ status: "cancelled", progress: undefined });
      return;
    }
    const generation = generationRef.current.begin();
    update({ status: "running", report: undefined, progress: undefined, error: undefined });
    try {
      const report = await client().analyze(
        { fileName: current.fileName ?? "sample.wav", bytes: current.bytes, pcm: current.pcm, options: current.options, prefixes: flagEnabled ? flagPrefixes : [], caseSensitive: flagCaseSensitive },
        (progress) => { if (generationRef.current.isCurrent(generation)) update({ progress }); },
      );
      if (!generationRef.current.isCurrent(generation)) return;
      update({ status: "completed", report, progress: undefined, selectedTab: "overview" });
    } catch (error) {
      if (!generationRef.current.isCurrent(generation)) return;
      if (error instanceof Error && error.name === "AbortError") update({ status: "cancelled", progress: undefined });
      else update({ status: "failed", progress: undefined, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const exportBytes = (bytes: Uint8Array, fileName: string, mediaType: string) => {
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mediaType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName.replace(/[<>:"/\\|?*]+/g, "-");
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <section className="local-workbench misc-workbench stego-workbench audio-workbench">
    <div className="local-tool-strip">
      <div><span>Misc / 音频隐写</span><strong>解码 PCM，联合波形、频谱、LSB 与声道差分定位隐藏数据</strong></div>
      <div className="local-tool-actions">
        <button type="button" className="secondary-action" onClick={() => { generationRef.current.invalidate(); clientRef.current?.cancel(); revokePreview(); onClear(); }}><RotateCcw size={14} />清空</button>
        <button type="button" className="run-action" disabled={!analysis.pcm || analysis.status === "loading"} onClick={() => void run()}>{analysis.status === "running" ? <Square size={13} /> : <Play size={14} />}{analysis.status === "running" ? "取消" : "开始分析"}</button>
      </div>
    </div>
    <div className="misc-workspace-grid stego-workspace-grid">
      <section className="asset-stage"><header className="local-section-header"><div><strong>输入音频</strong><span>{analysis.fileName ?? "尚未载入文件"}</span></div></header><AudioSourcePanel analysis={analysis} disabled={busy} onFile={(file) => void loadFile(file)} /></section>
      <section className="analysis-inspector"><header className="local-section-header"><div><strong>分析参数</strong><span>全部为 CTFBox 内置实现</span></div></header><AudioParameterPanel analysis={analysis} disabled={busy} onChange={onAnalysisChange} /></section>
      <section className="extraction-results"><header className="local-section-header"><div><strong>分析结果</strong><span>{analysis.progress ? `${analysis.progress.stage} · ${analysis.progress.completed}/${analysis.progress.total}` : analysis.report ? `${analysis.report.findings.length} 条证据` : "运行后显示结构化证据"}</span></div></header><AudioResultsPanel analysis={analysis} onTab={(selectedTab) => update({ selectedTab })} onExport={exportBytes} /></section>
    </div>
  </section>;
}
