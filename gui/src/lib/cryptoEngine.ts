import { detectFlags } from "./flagDetector";

export type CryptoCodec =
  | "base64"
  | "hex"
  | "url"
  | "base32"
  | "base58"
  | "base85"
  | "ascii85"
  | "html"
  | "unicode"
  | "binary"
  | "octal";

export const CODEC_LABELS: Record<CryptoCodec, string> = {
  base64: "Base64",
  hex: "Hex",
  url: "URL",
  base32: "Base32",
  base58: "Base58",
  base85: "Base85",
  ascii85: "Ascii85",
  html: "HTML 实体",
  unicode: "Unicode 转义",
  binary: "二进制",
  octal: "八进制",
};

export interface CryptoCodecGroup {
  label: string;
  codecs: readonly CryptoCodec[];
}

export const CODEC_GROUPS: readonly CryptoCodecGroup[] = [
  { label: "Base 编码", codecs: ["base64", "base32", "base58", "base85", "ascii85"] },
  { label: "进制表示", codecs: ["hex", "binary", "octal"] },
  { label: "文本转义", codecs: ["url", "html", "unicode"] },
];

export const CODECS = CODEC_GROUPS.flatMap((group) => group.codecs);

export interface CryptoOptions {
  codec?: CryptoCodec;
  direction?: "encode" | "decode";
  algorithm?: "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";
  key?: string;
  format?: "text" | "hex" | "base64";
}

export interface DecodeCandidate {
  codec: CryptoCodec;
  value: string;
  path: string[];
  depth: number;
  flags: string[];
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function base64ToBytes(value: string) {
  const normalized = value.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    throw new Error("Base64 输入无效");
  }
  const binary = globalThis.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  const normalized = value.replace(/\s+/g, "");
  if (!/^[0-9a-f]*$/i.test(normalized) || normalized.length % 2 !== 0) throw new Error("十六进制输入长度或字符无效");
  return Uint8Array.from(normalized.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function bytesToBase32(bytes: Uint8Array) {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return output.padEnd(Math.ceil(output.length / 8) * 8, "=");
}

function base32ToBytes(value: string) {
  const normalized = value.replace(/\s+/g, "").replace(/=+$/, "").toUpperCase();
  if (!normalized || !/^[A-Z2-7]*$/.test(normalized)) throw new Error("Base32 输入无效");
  let buffer = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of normalized) {
    buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 255);
    }
  }
  return Uint8Array.from(output);
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function bytesToBase58(bytes: Uint8Array) {
  if (bytes.length === 0) return "";
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let output = "";
  while (value > 0n) {
    output = BASE58_ALPHABET[Number(value % 58n)] + output;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    output = `1${output}`;
  }
  return output;
}

function base58ToBytes(value: string) {
  if (!value) return new Uint8Array();
  let number = 0n;
  for (const character of value) {
    const index = BASE58_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Base58 输入无效");
    number = number * 58n + BigInt(index);
  }
  const output: number[] = [];
  while (number > 0n) {
    output.unshift(Number(number & 255n));
    number >>= 8n;
  }
  for (const character of value) {
    if (character !== "1") break;
    output.unshift(0);
  }
  return Uint8Array.from(output);
}

const BASE85_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";

function bytesToBase85(bytes: Uint8Array) {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const count = Math.min(4, bytes.length - offset);
    let value = 0;
    for (let index = 0; index < 4; index++) value = value * 256 + (index < count ? bytes[offset + index] : 0);
    const chars = Array.from({ length: 5 }, () => {
      const character = BASE85_ALPHABET[value % 85];
      value = Math.floor(value / 85);
      return character;
    }).reverse().join("");
    output += count < 4 ? chars.slice(0, count + 1) : chars;
  }
  return output;
}

function base85ToBytes(value: string) {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized) return new Uint8Array();
  const output: number[] = [];
  for (let offset = 0; offset < normalized.length; offset += 5) {
    const group = normalized.slice(offset, offset + 5);
    if (group.length === 1) throw new Error("Base85 输入长度无效");
    let number = 0;
    for (const character of group.padEnd(5, "~")) {
      const index = BASE85_ALPHABET.indexOf(character);
      if (index < 0) throw new Error("Base85 输入无效");
      number = number * 85 + index;
    }
    const bytes = [(number >>> 24) & 255, (number >>> 16) & 255, (number >>> 8) & 255, number & 255];
    output.push(...bytes.slice(0, group.length - 1));
  }
  return Uint8Array.from(output);
}

function bytesToAscii85(bytes: Uint8Array) {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const count = Math.min(4, bytes.length - offset);
    let value = 0;
    for (let index = 0; index < 4; index++) value = value * 256 + (index < count ? bytes[offset + index] : 0);
    if (count === 4 && value === 0) {
      output += "z";
      continue;
    }
    const chars = Array.from({ length: 5 }, () => {
      const character = String.fromCharCode(33 + (value % 85));
      value = Math.floor(value / 85);
      return character;
    }).reverse().join("");
    output += count < 4 ? chars.slice(0, count + 1) : chars;
  }
  return output;
}

function ascii85ToBytes(value: string) {
  const normalized = value.replace(/^<~|~>$/g, "").replace(/\s+/g, "");
  if (!normalized) return new Uint8Array();
  const expanded = normalized.replace(/z/g, "!!!!!");
  const output: number[] = [];
  for (let offset = 0; offset < expanded.length; offset += 5) {
    const raw = expanded.slice(offset, offset + 5);
    if (raw.length === 1) throw new Error("Ascii85 输入长度无效");
    let number = 0;
    for (const character of raw.padEnd(5, "u")) {
      const code = character.charCodeAt(0);
      if (code < 33 || code > 117) throw new Error("Ascii85 输入无效");
      number = number * 85 + code - 33;
    }
    output.push((number >>> 24) & 255, (number >>> 16) & 255, (number >>> 8) & 255, number & 255);
    if (raw.length < 5) output.splice(output.length - (5 - raw.length));
  }
  return Uint8Array.from(output);
}

const HTML_ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function encodeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => HTML_ENTITIES[character]);
}

function decodeHtml(value: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? match;
  });
}

function encodeUnicode(value: string) {
  return Array.from(value).map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0xffff ? `\\u${codePoint.toString(16).padStart(4, "0")}` : `\\u{${codePoint.toString(16)}}`;
  }).join("");
}

function decodeUnicode(value: string) {
  return value
    .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

function bytesToBinary(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(2).padStart(8, "0")).join(" ");
}

function binaryToBytes(value: string) {
  const groups = value.trim().split(/[\s,]+/).filter(Boolean);
  if (!groups.length || groups.some((group) => !/^[01]{8}$/.test(group))) throw new Error("二进制输入必须由 8 位字节组成");
  return Uint8Array.from(groups.map((group) => Number.parseInt(group, 2)));
}

function bytesToOctal(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(8).padStart(3, "0")).join(" ");
}

function octalToBytes(value: string) {
  const groups = value.trim().split(/[\s,]+/).filter(Boolean);
  if (!groups.length || groups.some((group) => !/^[0-7]{1,3}$/.test(group))) throw new Error("八进制输入无效");
  return Uint8Array.from(groups.map((group) => Number.parseInt(group, 8)));
}

function decodeText(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function transformEncoding(input: string, codec: CryptoCodec, direction: "encode" | "decode") {
  if (codec === "url") return direction === "encode" ? encodeURIComponent(input) : decodeURIComponent(input);
  if (codec === "html") return direction === "encode" ? encodeHtml(input) : decodeHtml(input);
  if (codec === "unicode") return direction === "encode" ? encodeUnicode(input) : decodeUnicode(input);
  const encoder = new TextEncoder();
  if (direction === "encode") {
    const bytes = encoder.encode(input);
    if (codec === "base64") return bytesToBase64(bytes);
    if (codec === "hex") return bytesToHex(bytes);
    if (codec === "base32") return bytesToBase32(bytes);
    if (codec === "base58") return bytesToBase58(bytes);
    if (codec === "base85") return bytesToBase85(bytes);
    if (codec === "ascii85") return bytesToAscii85(bytes);
    if (codec === "binary") return bytesToBinary(bytes);
    return bytesToOctal(bytes);
  }
  if (codec === "base64") return decodeText(base64ToBytes(input));
  if (codec === "hex") return decodeText(hexToBytes(input));
  if (codec === "base32") return decodeText(base32ToBytes(input));
  if (codec === "base58") return decodeText(base58ToBytes(input));
  if (codec === "base85") return decodeText(base85ToBytes(input));
  if (codec === "ascii85") return decodeText(ascii85ToBytes(input));
  if (codec === "binary") return decodeText(binaryToBytes(input));
  return decodeText(octalToBytes(input));
}

function isReadable(value: string) {
  if (!value || value.length > 4096) return false;
  const printable = Array.from(value).filter((character) => character === "\n" || character === "\r" || character === "\t" || character >= " ").length;
  return printable / value.length >= 0.82;
}

export function decodeCandidates(input: string, prefixes: readonly string[], caseSensitive: boolean, maxDepth = 3): DecodeCandidate[] {
  if (!input.trim()) return [];
  const queue: Array<{ value: string; path: string[] }> = [{ value: input, path: [] }];
  const seen = new Set([input]);
  const results: DecodeCandidate[] = [];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.path.length >= maxDepth) continue;
    for (const codec of CODECS) {
      let decoded: string;
      try {
        decoded = transformEncoding(current.value, codec, "decode");
      } catch {
        continue;
      }
      if (decoded === current.value || !isReadable(decoded) || seen.has(decoded)) continue;
      seen.add(decoded);
      const path = [...current.path, CODEC_LABELS[codec]];
      results.push({ codec, value: decoded, path, depth: path.length, flags: detectFlags(decoded, prefixes, caseSensitive).filter((hit) => hit.source === "plain").map((hit) => hit.text) });
      queue.push({ value: decoded, path });
    }
  }
  return results.sort((left, right) => Number(right.flags.length > 0) - Number(left.flags.length > 0) || left.depth - right.depth || left.path.join("/").localeCompare(right.path.join("/")));
}

export async function processCrypto(mode: string, input: string, options: CryptoOptions): Promise<string> {
  if (mode === "encoding") return transformEncoding(input, options.codec ?? "base64", options.direction ?? "encode");

  if (mode === "hash") {
    const digest = await globalThis.crypto.subtle.digest(options.algorithm ?? "SHA-256", new TextEncoder().encode(input));
    return bytesToHex(new Uint8Array(digest));
  }

  if (mode === "xor") {
    const key = new TextEncoder().encode(options.key ?? "");
    if (key.length === 0) throw new Error("请输入 XOR 密钥");
    const bytes = new TextEncoder().encode(input).map((byte, index) => byte ^ key[index % key.length]);
    if (options.format === "text") return new TextDecoder().decode(bytes);
    if (options.format === "base64") return bytesToBase64(bytes);
    return bytesToHex(bytes);
  }

  throw new Error("未知 Crypto 模块");
}
