// 密码分析输入类型识别
export type CryptoInputType = "ciphertext" | "rsa" | "hash" | "binary" | "numbers" | "unknown";

export function identifyCryptoInput(text: string): CryptoInputType {
  const trimmed = text.trim();
  if (!trimmed) return "unknown";

  // PEM format
  if (/^-----BEGIN.*?-----/.test(trimmed)) return "rsa";

  // Hex numbers suggestive of RSA params
  if (/^(n|e|d|p|q|N|E|D|P|Q)\s*[=:]\s*[0-9a-fA-Fx]+/m.test(trimmed)) return "rsa";

  // Number sequence (check before large-decimal to avoid misidentifying PRNG as RSA)
  const numbers = trimmed.match(/\d+/g);
  if (numbers && numbers.length >= 3 && trimmed.replace(/[\s,\d]+/g, "").length < trimmed.length * 0.2) return "numbers";

  // Large decimal number (potential n)
  if (/^\d{30,}$/.test(trimmed.replace(/\s/g, ""))) return "rsa";

  // Hash
  if (/^[0-9a-fA-F]{32,128}$/.test(trimmed)) return "hash";

  // Binary
  if (/^[01\s]{8,}$/.test(trimmed) && trimmed.replace(/\s/g, "").length % 8 === 0) return "binary";

  // Alphabetic or mixed → ciphertext
  if (/[A-Za-z]/.test(trimmed) && trimmed.length >= 4) return "ciphertext";

  return "unknown";
}
