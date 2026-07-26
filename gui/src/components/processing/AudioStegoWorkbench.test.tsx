import { act, create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AudioStegoWorkbench } from "./AudioStegoWorkbench";
import { AudioParameterPanel } from "./audio/AudioParameterPanel";
import { DEFAULT_AUDIO_OPTIONS, type AudioLocalAnalysis } from "../../lib/audioTypes";

function analysis(): AudioLocalAnalysis {
  return { kind: "audio", status: "idle", options: { ...DEFAULT_AUDIO_OPTIONS }, selectedTab: "overview" };
}

describe("AudioStegoWorkbench", () => {
  it("renders file, parameter and result surfaces", () => {
    const html = renderToStaticMarkup(<AudioStegoWorkbench analysis={analysis()} flagPrefixes={["flag"]} flagCaseSensitive={false} flagEnabled onAnalysisChange={() => undefined} onClear={() => undefined} />);
    expect(html).toContain("音频隐写");
    expect(html).toContain("波形");
    expect(html).toContain("频谱图");
    expect(html).toContain("开始分析");
  });

  it("toggles a module without mutating previous state", () => {
    const onChange = vi.fn();
    const current = analysis();
    const renderer = create(<AudioParameterPanel analysis={current} disabled={false} onChange={onChange} />);
    const waveform = renderer.root.findByProps({ "aria-label": "渲染波形" });
    act(() => waveform.props.onChange({ target: { checked: false } }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ waveform: false }) }));
    expect(current.options.waveform).toBe(true);
  });

  it("rejects an oversized audio file before reading it into memory", () => {
    const onChange = vi.fn();
    const arrayBuffer = vi.fn();
    const renderer = create(<AudioStegoWorkbench analysis={analysis()} flagPrefixes={["flag"]} flagCaseSensitive={false} flagEnabled onAnalysisChange={onChange} onClear={() => undefined} />);
    act(() => renderer.root.findByProps({ "aria-label": "选择音频分析文件" }).props.onChange({
      target: { files: [{ name: "huge.wav", size: 129 * 1024 * 1024, type: "audio/wav", arrayBuffer }] },
    }));
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: expect.stringContaining("128 MiB") }));
  });
});
