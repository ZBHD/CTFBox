import { extractLsb } from "./lsbEngine";
import { scoreLsbPayload } from "./lsbFormats";
import type {
  LsbCandidate,
  LsbChannel,
  LsbExtractionParameters,
  LsbImageSource,
  LsbProgress,
  LsbScan,
  LsbSourceToken,
} from "./lsbTypes";

const PROBE_BYTES = 512;
const PROBE_POOL_SIZE = 128;
const VALIDATION_POOL_SIZE = 32;
const CHANNELS: LsbChannel[] = ["R", "G", "B", "A"];

export interface LsbSearchOptions {
  depth: "quick" | "deep";
  prefixes: readonly string[];
  caseSensitive: boolean;
  signal: AbortSignal;
  onProgress?: (progress: LsbProgress) => void;
}

interface ProbeCandidate extends LsbCandidate {
  parameterKey: string;
  complexity: number;
}

function abortError() {
  const error = new Error("分析已取消");
  error.name = "AbortError";
  return error;
}

function parameterKey(parameters: LsbExtractionParameters) {
  return JSON.stringify(parameters);
}

function hashBytes(bytes: Uint8Array) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function complexity(parameters: LsbExtractionParameters) {
  return parameters.sources.length
    + Number(parameters.scan.major === "column")
    + Number(parameters.scan.x === "right-to-left")
    + Number(parameters.scan.y === "bottom-to-top")
    + Number(parameters.scan.serpentine) * 2
    + Number(parameters.scan.reversePixels) * 2
    + Number(parameters.layout === "channel-block")
    + Number(parameters.packing === "lsb-first")
    + parameters.bitOffset
    + Number(parameters.invertBits) * 2
    + Number(parameters.reverseBytes) * 2;
}

function compareCandidates(left: ProbeCandidate, right: ProbeCandidate) {
  return right.score - left.score || left.complexity - right.complexity || left.parameterKey.localeCompare(right.parameterKey);
}

function orderedChannelSequences(maxLength = 4) {
  const common = ([
    ["R", "G", "B"],
    ["B", "G", "R"],
    ["A", "B", "G"],
    ["R"],
    ["G"],
    ["B"],
    ["A"],
    ["R", "G", "B", "A"],
    ["A", "R", "G", "B"],
    ["R", "G"],
    ["G", "R"],
  ] as LsbChannel[][]).filter((sequence) => sequence.length <= maxLength);
  const generated: LsbChannel[][] = [];
  const visit = (prefix: LsbChannel[]) => {
    if (prefix.length > 0) generated.push(prefix);
    if (prefix.length === maxLength) return;
    for (const channel of CHANNELS) {
      if (!prefix.includes(channel)) visit([...prefix, channel]);
    }
  };
  visit([]);

  const seen = new Set<string>();
  return [...common, ...generated].filter((sequence) => {
    const key = sequence.join("");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scanProfiles(): LsbScan[] {
  const base: LsbScan[] = [];
  for (const major of ["row", "column"] as const) {
    for (const y of ["top-to-bottom", "bottom-to-top"] as const) {
      for (const x of ["left-to-right", "right-to-left"] as const) {
        base.push({ major, x, y, serpentine: false, reversePixels: false });
      }
    }
  }
  const preferred = [
    base.find((scan) => scan.major === "row" && scan.x === "left-to-right" && scan.y === "top-to-bottom")!,
    base.find((scan) => scan.major === "column" && scan.x === "left-to-right" && scan.y === "top-to-bottom")!,
    base.find((scan) => scan.major === "column" && scan.x === "left-to-right" && scan.y === "bottom-to-top")!,
  ];
  const ordered = [...preferred, ...base.filter((scan) => !preferred.includes(scan))];
  return [...ordered, ...ordered.map((scan) => ({ ...scan, serpentine: true }))];
}

function baseParameters(sources: LsbSourceToken[], scan: LsbScan): LsbExtractionParameters {
  return {
    sourceKind: sources[0]?.channel === "I" ? "palette-index" : "rgba",
    sources,
    scan,
    layout: "pixel-interleaved",
    packing: "msb-first",
    bitOffset: 0,
    invertBits: false,
    reverseBytes: false,
    byteOffset: 0,
  };
}

function* presetParameters(source: LsbImageSource): Generator<LsbExtractionParameters> {
  const scans = scanProfiles();
  for (const channels of orderedChannelSequences()) {
    for (let bit = 0; bit < 8; bit += 1) {
      const sources = channels.map((channel) => ({ channel, bit: bit as LsbSourceToken["bit"] }));
      for (const scan of scans) {
        for (const packing of ["msb-first", "lsb-first"] as const) {
          for (const layout of ["pixel-interleaved", "channel-block"] as const) {
            yield { ...baseParameters(sources, scan), packing, layout };
          }
        }
      }
    }
  }
  if (source.paletteIndices) {
    for (let bit = 0; bit < 8; bit += 1) {
      for (const scan of scans) yield baseParameters([{ channel: "I", bit: bit as LsbSourceToken["bit"] }], scan);
    }
  }
}

function combinations(values: number[], length: number, start = 0, prefix: number[] = [], output: number[][] = []): number[][] {
  if (prefix.length === length) {
    output.push(prefix);
    return output;
  }
  for (let index = start; index <= values.length - (length - prefix.length); index += 1) {
    combinations(values, length, index + 1, [...prefix, values[index]], output);
  }
  return output;
}

function mixedBitOrders() {
  const values = Array.from({ length: 8 }, (_, index) => index);
  return [2, 3].flatMap((length) => combinations(values, length).flatMap((bits) => [bits, [...bits].reverse()]));
}

function* mixedParameters(): Generator<LsbExtractionParameters> {
  const scans = scanProfiles();
  for (const channels of orderedChannelSequences(3)) {
    for (const bits of mixedBitOrders()) {
      const sources = channels.flatMap((channel) => bits.map((bit) => ({ channel, bit: bit as LsbSourceToken["bit"] })));
      for (const scan of scans) yield baseParameters(sources, scan);
    }
  }
}

function* transformParameters(probes: ProbeCandidate[]): Generator<LsbExtractionParameters> {
  const seen = new Set<string>();
  for (const probe of probes.slice(0, VALIDATION_POOL_SIZE)) {
    for (const layout of ["pixel-interleaved", "channel-block"] as const) {
      for (const packing of ["msb-first", "lsb-first"] as const) {
        for (let bitOffset = 0; bitOffset < 8; bitOffset += 1) {
          for (const invertBits of [false, true]) {
            for (const reverseBytes of [false, true]) {
              const parameters: LsbExtractionParameters = {
                ...probe.parameters,
                sources: probe.parameters.sources.map((source) => ({ ...source })),
                scan: { ...probe.parameters.scan },
                layout,
                packing,
                bitOffset: bitOffset as LsbExtractionParameters["bitOffset"],
                invertBits,
                reverseBytes,
              };
              const key = parameterKey(parameters);
              if (!seen.has(key)) {
                seen.add(key);
                yield parameters;
              }
            }
          }
        }
      }
    }
  }
}

function probeCandidate(source: LsbImageSource, parameters: LsbExtractionParameters, options: LsbSearchOptions): ProbeCandidate {
  const bytes = extractLsb(source, { ...parameters, byteLimit: PROBE_BYTES });
  const scored = scoreLsbPayload(bytes, options.prefixes, options.caseSensitive);
  const key = parameterKey(parameters);
  return {
    id: `${hashBytes(new TextEncoder().encode(key))}-${hashBytes(bytes)}`,
    score: scored.score,
    parameters,
    preview: scored.preview,
    mediaType: scored.mediaType,
    evidence: scored.evidence,
    bytes,
    files: scored.files,
    parameterKey: key,
    complexity: complexity(parameters),
  };
}

function addProbe(pool: ProbeCandidate[], candidate: ProbeCandidate) {
  if (pool.length < PROBE_POOL_SIZE) {
    pool.push(candidate);
    return;
  }
  let worst = 0;
  for (let index = 1; index < pool.length; index += 1) {
    if (compareCandidates(pool[worst], pool[index]) < 0) worst = index;
  }
  if (compareCandidates(candidate, pool[worst]) < 0) pool[worst] = candidate;
}

function isDecisive(candidate: ProbeCandidate) {
  return candidate.evidence.some((item) => item.startsWith("发现 Flag：") || item.startsWith("归档内发现 Flag："));
}

async function yieldForCancellation(signal: AbortSignal) {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (signal.aborted) throw abortError();
}

function validateCandidates(source: LsbImageSource, probes: ProbeCandidate[], options: LsbSearchOptions) {
  const unique = new Map<string, ProbeCandidate>();
  for (const probe of probes.sort(compareCandidates).slice(0, VALIDATION_POOL_SIZE)) {
    const bytes = extractLsb(source, probe.parameters);
    const scored = scoreLsbPayload(bytes, options.prefixes, options.caseSensitive);
    const candidate: ProbeCandidate = {
      ...probe,
      id: `${hashBytes(new TextEncoder().encode(probe.parameterKey))}-${hashBytes(bytes)}`,
      score: scored.score,
      preview: scored.preview,
      mediaType: scored.mediaType,
      evidence: scored.evidence,
      bytes,
      files: scored.files,
    };
    const contentKey = `${bytes.length}:${hashBytes(bytes)}`;
    const current = unique.get(contentKey);
    if (!current || compareCandidates(candidate, current) < 0) unique.set(contentKey, candidate);
  }
  return [...unique.values()].sort(compareCandidates).map(({ parameterKey: _, complexity: __, ...candidate }) => candidate);
}

export async function autoSearchLsb(source: LsbImageSource, options: LsbSearchOptions): Promise<LsbCandidate[]> {
  if (options.signal.aborted) throw abortError();
  const started = Date.now();
  const pool: ProbeCandidate[] = [];
  let tested = 0;

  const runStage = async (stage: LsbProgress["stage"], parameters: Iterable<LsbExtractionParameters>) => {
    for (const item of parameters) {
      if (options.signal.aborted) throw abortError();
      const candidate = probeCandidate(source, item, options);
      addProbe(pool, candidate);
      tested += 1;
      if (tested % 128 === 0 || isDecisive(candidate)) {
        options.onProgress?.({ stage, tested, total: tested + 1, elapsedMs: Date.now() - started });
      }
      if (isDecisive(candidate)) return candidate;
      if (tested % 256 === 0) await yieldForCancellation(options.signal);
    }
    return undefined;
  };

  let decisive = await runStage("presets", presetParameters(source));
  if (!decisive && options.depth === "deep") decisive = await runStage("mixed", mixedParameters());
  if (!decisive) decisive = await runStage("transforms", transformParameters([...pool].sort(compareCandidates)));

  const validationPool = decisive ? [decisive] : pool;
  options.onProgress?.({ stage: "validate", tested, total: tested, elapsedMs: Date.now() - started });
  return validateCandidates(source, validationPool, options);
}
