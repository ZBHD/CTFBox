export interface FlagHit {
  text: string;
  source: "plain" | "base64";
  encoded?: string;
}

export const MAX_BASE64_TOKEN_CHARS = 4096;

export interface FlagCandidateAssessment {
  confidence: "high" | "suspicious";
  reason: string;
}

export function assessFlagCandidate(value: string): FlagCandidateAssessment {
  const opening = value.indexOf("{");
  const closing = value.lastIndexOf("}");
  const payload = opening >= 0 && closing > opening ? value.slice(opening + 1, closing).trim() : "";
  if (payload.length < 3) return { confidence: "suspicious", reason: "Flag 内容过短，可能只是题目编号或噪声" };
  const symbols = new Set(Array.from(payload.toLowerCase()).filter((character) => /[a-z0-9]/.test(character)));
  if (symbols.size < 3) return { confidence: "suspicious", reason: "Flag 内容字符多样性过低，可能是填充或误命中" };
  const frequencies = new Map<string, number>();
  for (const character of payload) frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  const maximumFrequency = Math.max(0, ...frequencies.values());
  if (payload.length >= 6 && maximumFrequency / payload.length >= 0.75) {
    return { confidence: "suspicious", reason: "Flag 内容高度重复，可能是填充数据" };
  }
  return { confidence: "high", reason: "Flag 边界完整且内容长度与多样性合理" };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findPlainFlags(text: string, prefixes: readonly string[], caseSensitive: boolean) {
  if (!text || prefixes.length === 0) return [];
  const pattern = new RegExp(
    `(?:${prefixes.map(escapeRegExp).join("|")})\\{[^}\\r\\n]{1,512}\\}`,
    caseSensitive ? "g" : "gi",
  );
  return text.match(pattern) ?? [];
}

function decodeBase64(token: string): string | null {
  try {
    const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function detectFlags(
  text: string,
  prefixes: readonly string[],
  caseSensitive: boolean,
): FlagHit[] {
  const cleanPrefixes = prefixes.map((prefix) => prefix.trim()).filter(Boolean);
  const hits: FlagHit[] = findPlainFlags(text, cleanPrefixes, caseSensitive).map((flag) => ({
    text: flag,
    source: "plain" as const,
  }));

  const base64Pattern = new RegExp(
    `(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{8,${MAX_BASE64_TOKEN_CHARS}}={0,2}(?![A-Za-z0-9+/_=-])`,
    "g",
  );
  const base64Tokens = text.match(base64Pattern) ?? [];
  for (const encoded of base64Tokens) {
    const decoded = decodeBase64(encoded);
    if (!decoded) continue;
    for (const flag of findPlainFlags(decoded, cleanPrefixes, caseSensitive)) {
      hits.push({ text: flag, source: "base64", encoded });
    }
  }

  return hits.filter((hit, index) =>
    hits.findIndex((candidate) => candidate.text === hit.text && candidate.source === hit.source && candidate.encoded === hit.encoded) === index,
  );
}

export function detectFlagLikeTokens(text: string): string[] {
  const pattern = /(?:^|[^A-Za-z0-9_-])([A-Za-z][A-Za-z0-9_-]{1,31}\{[^{}\r\n]{3,512}\})/g;
  const hits: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[1];
    if (value && !hits.includes(value)) hits.push(value);
  }
  return hits;
}
