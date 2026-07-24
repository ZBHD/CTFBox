export interface CryptoOptions {
  codec?: "base64" | "hex" | "url";
  direction?: "encode" | "decode";
  algorithm?: "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";
  key?: string;
  format?: "text" | "hex" | "base64";
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function base64ToBytes(value: string) {
  const normalized = value.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
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

export async function processCrypto(mode: string, input: string, options: CryptoOptions): Promise<string> {
  if (mode === "encoding") {
    const codec = options.codec ?? "base64";
    const direction = options.direction ?? "encode";
    if (codec === "url") return direction === "encode" ? encodeURIComponent(input) : decodeURIComponent(input);
    if (codec === "hex") return direction === "encode" ? bytesToHex(new TextEncoder().encode(input)) : new TextDecoder().decode(hexToBytes(input));
    return direction === "encode" ? bytesToBase64(new TextEncoder().encode(input)) : new TextDecoder().decode(base64ToBytes(input));
  }

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
