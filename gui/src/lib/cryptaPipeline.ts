// 密码分析自动编排器
import { atbashTransform, caesarBruteforce, railFenceBruteforce } from "./classicalCipher";
import { identifyCipherType } from "./cipherIdentifier";
import { identifyCryptoInput } from "./cryptaInputDetect";
import { detectEcb } from "./cryptaAes";
import { identifyHash, rainbowLookup } from "./cryptaHash";
import { recoverLcg } from "./cryptaPrng";
import { commonModulusAttack, fermatFactor, parseRsaPem, smallExponentAttack, wienerAttack } from "./cryptaRsa";
import type { CryptaFinding, CryptaOptions, CryptaProgress, CryptaReport } from "./cryptaTypes";
import { DEFAULT_CRYPTA_OPTIONS } from "./cryptaTypes";
export { DEFAULT_CRYPTA_OPTIONS };
import { detectFlags, assessFlagCandidate } from "./flagDetector";
import { detectMorse } from "./morseCodec";

function abortError() {
  const error = new Error("分析已取消");
  error.name = "AbortError";
  return error;
}

export async function analyzeCrypto(
  input: string,
  prefixes: readonly string[],
  caseSensitive: boolean,
  options: CryptaOptions = DEFAULT_CRYPTA_OPTIONS,
  signal: AbortSignal,
  onProgress?: (progress: CryptaProgress) => void,
): Promise<CryptaReport> {
  const stages: CryptaProgress["stage"][] = [];
  if (options.classical) stages.push("classical");
  if (options.rsa) stages.push("rsa");
  if (options.aes) stages.push("aes");
  if (options.hash) stages.push("hash");
  if (options.prng) stages.push("prng");

  const findings: CryptaFinding[] = [];
  const plaintextCandidates: string[] = [];
  const attackDetails: string[] = [];
  let completed = 0;

  const advance = (stage: CryptaProgress["stage"]) => {
    if (signal.aborted) throw abortError();
    onProgress?.({ stage, completed, total: stages.length });
    completed += 1;
  };

  const addFinding = (f: CryptaFinding) => { findings.push(f); };
  const addCandidate = (text: string) => { if (text && !plaintextCandidates.includes(text)) plaintextCandidates.push(text); };

  const inputType = identifyCryptoInput(input);
  const bytes = new TextEncoder().encode(input);

  // ── Classical ──
  if (options.classical) {
    advance("classical");
    const cipherTypes = identifyCipherType(input);
    if (cipherTypes.length > 0) {
      addFinding({ id: `ct-${findings.length}`, severity: "info", source: "密码识别", title: `识别到 ${cipherTypes.length} 种候选`, detail: cipherTypes.slice(0, 5).map((c) => `${c.type}(${c.score}%)`).join(" · ") });
    }
    for (const result of caesarBruteforce(input, prefixes, caseSensitive).slice(0, 5)) {
      if (result.text !== input) addCandidate(result.text);
    }
    // Atbash
    const atbashed = atbashTransform(input);
    if (atbashed !== input) addCandidate(atbashed);
    if (input.length <= 200) {
      for (const result of railFenceBruteforce(input, prefixes, caseSensitive).slice(0, 5)) {
        if (result.text !== input) addCandidate(result.text);
      }
    }
    // Morse
    const morse = detectMorse(input, prefixes, caseSensitive);
    if (morse.detected && morse.decoded) addCandidate(morse.decoded);
  }

  // ── RSA ──
  if (options.rsa && inputType === "rsa") {
    advance("rsa");
    const params = parseRsaPem(input);
    if (params) {
      addFinding({ id: `rsa-params-${findings.length}`, severity: "info", source: "RSA", title: "解析到 RSA 参数", detail: `n=${params.n.toString(16).slice(0, 32)}..., e=${params.e}` });

      // Wiener
      const wiener = wienerAttack(params.n, params.e);
      if (wiener.recovered) {
        addFinding({ id: `rsa-wiener-${findings.length}`, severity: "high", source: "RSA Wiener", title: "Wiener 攻击成功！", detail: wiener.detail });
        attackDetails.push(wiener.detail);
      }

      // Fermat
      const fermat = fermatFactor(params.n, 100_000);
      if (fermat.recovered) {
        addFinding({ id: `rsa-fermat-${findings.length}`, severity: "high", source: "RSA Fermat", title: "Fermat 分解成功！", detail: fermat.detail });
        attackDetails.push(fermat.detail);
      }
    }
  }

  // ── AES ──
  if (options.aes && bytes.length >= 32) {
    advance("aes");
    const ecb = detectEcb(bytes, 16);
    if (ecb.ecbDetected) {
      addFinding({ id: `aes-ecb-${findings.length}`, severity: "suspicious", source: "AES", title: "疑似 ECB 模式", detail: ecb.detail });
    }
    // Also try 8-byte blocks for DES
    if (!ecb.ecbDetected && bytes.length >= 16) {
      const ecb8 = detectEcb(bytes, 8);
      if (ecb8.ecbDetected) {
        addFinding({ id: `des-ecb-${findings.length}`, severity: "suspicious", source: "DES", title: "疑似 DES-ECB 模式", detail: ecb8.detail });
      }
    }
  }

  // ── Hash ──
  if (options.hash) {
    advance("hash");
    const hashTypes = identifyHash(input);
    if (hashTypes.length > 0) {
      addFinding({ id: `hash-id-${findings.length}`, severity: "info", source: "哈希", title: `识别到哈希：${hashTypes.join(", ")}`, detail: `${input.length} 字符` });
      // Rainbow lookup
      const found = rainbowLookup(input);
      if (found) {
        addFinding({ id: `hash-rainbow-${findings.length}`, severity: "high", source: "哈希", title: "彩虹表命中！", detail: `"${input}" → "${found}"` });
        addCandidate(found);
      }
    }
  }

  // ── PRNG ──
  if (options.prng) {
    advance("prng");
    const numbers = input.match(/\d+/g);
    if (numbers && numbers.length >= 3) {
      const values = numbers.map(Number).filter((n) => n > 0 && n < (1 << 31));
      if (values.length >= 3) {
        const lcg = recoverLcg(values.slice(0, 3));
        if (lcg.recovered) {
          addFinding({ id: `prng-lcg-${findings.length}`, severity: "suspicious", source: "PRNG", title: "LCG 参数恢复成功", detail: `a=${lcg.multiplier}, c=${lcg.increment}, m=${lcg.modulus}` });
        }
      }
    }
  }

  // ── Flag detection ──
  for (const candidate of plaintextCandidates) {
    for (const hit of detectFlags(candidate, prefixes, caseSensitive)) {
      if (findings.some((f) => f.detail === hit.text)) continue;
      const assessment = assessFlagCandidate(hit.text);
      addFinding({
        id: `crypta-flag-${findings.length}`,
        severity: assessment.confidence === "high" ? "high" : "suspicious",
        source: "密码分析",
        title: assessment.confidence === "high" ? "密码分析发现 Flag" : "密码分析疑似 Flag",
        detail: hit.text,
      });
    }
  }

  // Also scan raw input
  for (const hit of detectFlags(input, prefixes, caseSensitive)) {
    if (findings.some((f) => f.detail === hit.text)) continue;
    const assessment = assessFlagCandidate(hit.text);
    addFinding({
      id: `crypta-raw-${findings.length}`,
      severity: assessment.confidence === "high" ? "high" : "suspicious",
      source: "明文扫描",
      title: "密码分析发现 Flag",
      detail: hit.text,
    });
  }

  return { inputType, findings, plaintextCandidates, attackDetails };
}
