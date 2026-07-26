// 编码解码自动分析编排器
import { affineBruteforce, atbashTransform, caesarBruteforce, railFenceBruteforce } from "./classicalCipher";
import { identifyCipherType } from "./cipherIdentifier";
import { convertFullwidthToHalfwidth, detectFullwidth } from "./cjkCodec";
import { decodeCandidates } from "./cryptoEngine";
import { detectCustomBase } from "./customBaseDetector";
import { executeBrainfuck, identifyEsolang } from "./esolangEngine";
import { assessFlagCandidate, detectFlags } from "./flagDetector";
import { detectHomoglyphs, detectZeroWidth, extractZeroWidthPayload } from "./homoglyphDetector";
import { detectMorse } from "./morseCodec";
import type { CodecCandidate, CodecFinding, CodecOptions, CodecProgress, CodecReport } from "./codecTypes";
import { DEFAULT_CODEC_OPTIONS } from "./codecTypes";

function abortError() {
  const error = new Error("分析已取消");
  error.name = "AbortError";
  return error;
}

export async function analyzeCodec(
  input: string,
  prefixes: readonly string[],
  caseSensitive: boolean,
  options: CodecOptions = DEFAULT_CODEC_OPTIONS,
  signal: AbortSignal,
  onProgress?: (progress: CodecProgress) => void,
): Promise<CodecReport> {
  const stages: CodecProgress["stage"][] = [];
  if (options.cjk) stages.push("cjk");
  if (options.homoglyph) stages.push("homoglyph");
  if (options.morse) stages.push("morse");
  if (options.classical) stages.push("classical");
  if (options.esolang) stages.push("esolang");
  if (options.customBase) stages.push("customBase");
  if (options.recursiveDecode) stages.push("recursive");

  const findings: CodecFinding[] = [];
  const candidates: CodecCandidate[] = [];
  let completed = 0;

  const advance = (stage: CodecProgress["stage"]) => {
    if (signal.aborted) throw abortError();
    onProgress?.({ stage, completed, total: stages.length });
    completed += 1;
  };

  const addCandidate = (c: CodecCandidate) => { candidates.push(c); };
  const addFinding = (f: CodecFinding) => { findings.push(f); };

  // ── CJK ──
  if (options.cjk) {
    advance("cjk");
    const fw = detectFullwidth(input);
    if (fw.detected) {
      const converted = convertFullwidthToHalfwidth(input);
      const flags = detectFlags(converted, prefixes, caseSensitive).map((h) => h.text);
      addCandidate({
        id: `fw-${candidates.length}`, source: "CJK 全角", label: "全角转半角",
        value: converted, confidence: flags.length > 0 ? "high" : "candidate",
        detail: `检测到 ${fw.count} 个全角字符`,
        flags,
      });
    }
  }

  // ── Homoglyph + Zero-width ──
  if (options.homoglyph) {
    advance("homoglyph");
    const hg = detectHomoglyphs(input);
    if (hg.detected) {
      addFinding({ id: `hg-${findings.length}`, severity: "suspicious", source: "同形字", title: "检测到同形字混合", detail: hg.reason });
    }
    const zw = detectZeroWidth(input);
    if (zw.detected) {
      const payload = extractZeroWidthPayload(input);
      addFinding({ id: `zw-${findings.length}`, severity: "suspicious", source: "零宽字符", title: "检测到零宽字符隐写", detail: `提取 ${zw.count} 个零宽字符` });
      if (payload) {
        const flags = detectFlags(payload, prefixes, caseSensitive).map((h) => h.text);
        addCandidate({
          id: `zw-payload-${candidates.length}`, source: "零宽字符", label: "零宽 payload",
          value: payload, confidence: flags.length > 0 ? "high" : "candidate",
          detail: "从零宽字符二进制解码",
          flags,
        });
      }
    }
  }

  // ── Morse ──
  if (options.morse) {
    advance("morse");
    const morse = detectMorse(input, prefixes, caseSensitive);
    if (morse.detected && morse.decoded) {
      const flags = detectFlags(morse.decoded, prefixes, caseSensitive).map((h) => h.text);
      addCandidate({
        id: `morse-${candidates.length}`, source: "Morse", label: "Morse 解码",
        value: morse.decoded, confidence: morse.confidence,
        detail: "自动检测 Morse 电码并解码",
        flags,
      });
    }
  }

  // ── Classical ciphers ──
  if (options.classical) {
    advance("classical");
    const cipherTypes = identifyCipherType(input);
    if (cipherTypes.length > 0) {
      addFinding({ id: `cipher-id-${findings.length}`, severity: "info", source: "密码识别", title: `识别到 ${cipherTypes.length} 种候选密码类型`, detail: cipherTypes.slice(0, 5).map((c) => `${c.type}(${c.score}%)`).join(" · ") });
    }

    // Atbash
    const atbash = atbashTransform(input);
    if (atbash !== input) {
      const flags = detectFlags(atbash, prefixes, caseSensitive);
      if (flags.length > 0) {
        addCandidate({ id: `atbash-${candidates.length}`, source: "Atbash", label: "Atbash 变换", value: atbash, confidence: "high", detail: "Atbash 字母反转", flags: flags.map((h) => h.text) });
      }
    }

    // Caesar bruteforce
    for (const result of caesarBruteforce(input, prefixes, caseSensitive).slice(0, 5)) {
      const flags = detectFlags(result.text, prefixes, caseSensitive);
      if (flags.length > 0 || result.shift! < 5) {
        addCandidate({
          id: `caesar-${result.shift}-${candidates.length}`, source: "Caesar", label: `ROT${result.shift}`,
          value: result.text, confidence: flags.length > 0 ? "high" : "candidate",
          detail: `Caesar 密码，偏移 ${result.shift}`,
          flags: flags.map((h) => h.text),
        });
      }
    }

    // Rail fence bruteforce
    if (input.length <= 200) {
      for (const result of railFenceBruteforce(input, prefixes, caseSensitive).slice(0, 5)) {
        if (result.text === input) continue;
        const flags = detectFlags(result.text, prefixes, caseSensitive);
        addCandidate({
          id: `rail-${candidates.length}`, source: "栅栏密码", label: `${result.rails} 栏栅栏`,
          value: result.text, confidence: flags.length > 0 ? "high" : "candidate",
          detail: `${result.rails} 栏栅栏密码`,
          flags: flags.map((h) => h.text),
        });
      }
    }
  }

  // ── Esolang ──
  if (options.esolang) {
    advance("esolang");
    const esolangs = identifyEsolang(input);
    if (esolangs.length > 0) {
      addFinding({ id: `esolang-${findings.length}`, severity: "info", source: "Esolang", title: `识别到 ${esolangs[0].type} 代码`, detail: `置信度 ${esolangs[0].confidence}` });
      if (esolangs[0].type === "brainfuck") {
        try {
          const output = executeBrainfuck(input, "", 500_000);
          if (output) {
            const flags = detectFlags(output, prefixes, caseSensitive).map((h) => h.text);
            addCandidate({ id: `bf-output-${candidates.length}`, source: "Brainfuck", label: "Brainfuck 输出", value: output, confidence: flags.length > 0 ? "high" : "candidate", detail: "Brainfuck 解释器输出", flags });
          }
        } catch { /* execution failed */ }
      }
    }
  }

  // ── Custom base ──
  if (options.customBase) {
    advance("customBase");
    const base = detectCustomBase(input);
    if (base.detected) {
      addFinding({ id: `base-${findings.length}`, severity: "info", source: "Base 检测", title: `检测到 ${base.baseType} 编码`, detail: `置信度 ${base.confidence}` });
    }
  }

  // ── Recursive decode ──
  if (options.recursiveDecode) {
    advance("recursive");
    const decoded = decodeCandidates(input, prefixes, caseSensitive, options.maxRecursiveDepth);
    for (const dc of decoded) {
      const flags = dc.flags ?? [];
      addCandidate({
        id: `recursive-${candidates.length}`, source: "递归解码", label: dc.path.join(" → "),
        value: dc.value, confidence: flags.length > 0 ? "high" : "candidate",
        detail: `${dc.depth} 层解码`,
        flags,
      });
    }
  }

  // ── Flag findings from candidates ──
  for (const candidate of candidates) {
    for (const flag of candidate.flags) {
      if (findings.some((f) => f.detail === flag)) continue;
      const assessment = assessFlagCandidate(flag);
      findings.push({
        id: `flag-${findings.length}`,
        severity: assessment.confidence === "high" ? "high" : "suspicious",
        source: candidate.source,
        title: assessment.confidence === "high" ? "自动分析发现 Flag" : "自动分析疑似 Flag",
        detail: flag,
      });
    }
  }

  return { findings, candidates, decodedTexts: candidates.map((c) => c.value) };
}
