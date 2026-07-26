import { assessFlagCandidate, detectFlags } from "./flagDetector";
import type { StegoFinding, StegoStringHit } from "./stegoTypes";

export interface StegoStringOptions {
  minimumLength: number;
  prefixes: readonly string[];
  caseSensitive: boolean;
  maxResults?: number;
}

export interface StegoStringResult {
  hits: StegoStringHit[];
  findings: StegoFinding[];
}

function probableFlags(value: string) {
  return Array.from(value.matchAll(/(?:^|[^A-Za-z0-9_-])([A-Za-z][A-Za-z0-9_-]{1,31}\{[^\x00-\x1f{}]{1,512}\})/g), (match) => match[1]);
}

function flagsIn(value: string, options: StegoStringOptions) {
  return [...new Set([
    ...detectFlags(value, options.prefixes, options.caseSensitive).map((hit) => hit.text),
    ...probableFlags(value),
  ])];
}

function isPrintableCharacter(character: string) {
  const code = character.codePointAt(0) ?? 0;
  return code === 9 || code === 10 || code === 13 || code >= 32;
}

function addHit(
  hits: StegoStringHit[],
  seen: Set<string>,
  options: StegoStringOptions,
  hit: Omit<StegoStringHit, "flags">,
) {
  const value = hit.text.replace(/\0+$/g, "").trim();
  if (Array.from(value).length < options.minimumLength) return;
  const key = `${hit.offset}:${value}:${hit.decodedFrom ?? "raw"}`;
  if (seen.has(key) || hits.length >= (options.maxResults ?? 2000)) return;
  seen.add(key);
  hits.push({ ...hit, text: value.slice(0, 4096), flags: flagsIn(value, options) });
}

function extractAscii(bytes: Uint8Array, options: StegoStringOptions, hits: StegoStringHit[], seen: Set<string>) {
  let start = -1;
  for (let offset = 0; offset <= bytes.length; offset += 1) {
    const byte = bytes[offset];
    const printable = byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126);
    if (printable && start < 0) start = offset;
    if (!printable && start >= 0) {
      addHit(hits, seen, options, { encoding: "ASCII", offset: start, text: new TextDecoder("ascii").decode(bytes.subarray(start, offset)) });
      start = -1;
    }
  }
}

function extractMultibyte(bytes: Uint8Array, encoding: "UTF-8" | "GB18030", options: StegoStringOptions, hits: StegoStringHit[], seen: Set<string>) {
  const decoderName = encoding === "UTF-8" ? "utf-8" : "gb18030";
  const decoder = new TextDecoder(decoderName, { fatal: true });
  let start = -1;
  for (let offset = 0; offset <= bytes.length; offset += 1) {
    const byte = bytes[offset];
    const candidate = byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte !== 0xfe && byte !== 0xff);
    if (candidate && start < 0) start = offset;
    if (!candidate && start >= 0) {
      const run = bytes.subarray(start, offset);
      if (run.some((value) => value >= 0x80)) {
        try {
          if (encoding === "GB18030") {
            try {
              new TextDecoder("utf-8", { fatal: true }).decode(run);
              start = -1;
              continue;
            } catch {
              // Invalid UTF-8 runs are candidates for the legacy Chinese decoder.
            }
          }
          const value = decoder.decode(run);
          if (Array.from(value).every(isPrintableCharacter)) addHit(hits, seen, options, { encoding, offset: start, text: value });
        } catch {
          // The same byte run may still be valid in another supported encoding.
        }
      }
      start = -1;
    }
  }
}

function extractUtf16(bytes: Uint8Array, encoding: "UTF-16LE" | "UTF-16BE", options: StegoStringOptions, hits: StegoStringHit[], seen: Set<string>) {
  const little = encoding === "UTF-16LE";
  for (let start = 0; start + options.minimumLength * 2 <= bytes.length; start += 1) {
    const firstLow = little ? bytes[start] : bytes[start + 1];
    const firstHigh = little ? bytes[start + 1] : bytes[start];
    if (firstHigh !== 0 || firstLow < 32 || firstLow > 126) continue;
    const characters: string[] = [];
    let cursor = start;
    while (cursor + 1 < bytes.length) {
      const low = little ? bytes[cursor] : bytes[cursor + 1];
      const high = little ? bytes[cursor + 1] : bytes[cursor];
      if (high !== 0 || low < 32 || low > 126) break;
      const code = low;
      const character = String.fromCharCode(code);
      if (code === 0 || !isPrintableCharacter(character) || (code >= 0xd800 && code <= 0xdfff)) break;
      characters.push(character);
      cursor += 2;
    }
    if (characters.length >= options.minimumLength) {
      addHit(hits, seen, options, { encoding, offset: start, text: characters.join("") });
      start = Math.max(start, cursor - 2);
    }
  }
}

function decodeBase64(value: string) {
  if (!/^[A-Za-z0-9+/]{8,}={0,2}$/.test(value) || value.length % 4 !== 0) return undefined;
  try {
    const decoded = atob(value);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function decodeHex(value: string) {
  if (!/^(?:[0-9a-fA-F]{2}){4,}$/.test(value)) return undefined;
  try {
    const bytes = Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function decodeUrl(value: string) {
  if (!/%[0-9a-fA-F]{2}/.test(value)) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function addDecoded(hits: StegoStringHit[], seen: Set<string>, options: StegoStringOptions) {
  const sourceHits = [...hits];
  for (const source of sourceHits) {
    const variants: Array<[StegoStringHit["decodedFrom"], string | undefined]> = [
      ["Base64", decodeBase64(source.text)],
      ["Hex", decodeHex(source.text)],
      ["URL", decodeUrl(source.text)],
    ];
    for (const [decodedFrom, value] of variants) {
      if (!value || !Array.from(value).every(isPrintableCharacter)) continue;
      addHit(hits, seen, options, { encoding: "UTF-8", offset: source.offset, text: value, decodedFrom });
    }
  }
}

export function extractStegoStrings(bytes: Uint8Array, options: StegoStringOptions): StegoStringResult {
  const normalized = { ...options, minimumLength: Math.max(2, Math.min(128, Math.floor(options.minimumLength))), maxResults: Math.max(1, Math.min(10_000, options.maxResults ?? 2000)) };
  const hits: StegoStringHit[] = [];
  const seen = new Set<string>();
  extractAscii(bytes, normalized, hits, seen);
  extractMultibyte(bytes, "UTF-8", normalized, hits, seen);
  extractMultibyte(bytes, "GB18030", normalized, hits, seen);
  extractUtf16(bytes, "UTF-16LE", normalized, hits, seen);
  extractUtf16(bytes, "UTF-16BE", normalized, hits, seen);
  addDecoded(hits, seen, normalized);
  hits.sort((left, right) => left.offset - right.offset || left.encoding.localeCompare(right.encoding) || left.text.localeCompare(right.text));

  const findings: StegoFinding[] = [];
  const reportedFlags = new Set<string>();
  for (const hit of hits) {
    for (const flag of hit.flags) {
      if (reportedFlags.has(flag)) continue;
      reportedFlags.add(flag);
      const assessment = assessFlagCandidate(flag);
      findings.push({
        id: `string-flag-${findings.length}-${hit.offset}`,
        severity: assessment.confidence === "high" ? "high" : "suspicious",
        source: hit.decodedFrom ? `${hit.decodedFrom} 解码` : hit.encoding,
        title: assessment.confidence === "high" ? "发现 Flag" : "疑似 Flag",
        detail: flag,
        offset: hit.offset,
      });
    }
  }
  return { hits, findings };
}
