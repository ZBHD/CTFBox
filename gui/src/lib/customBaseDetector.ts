// 自定义 Base 编码自动检测
export interface CustomBaseResult {
  detected: boolean;
  baseType?: "base32" | "base45" | "base58" | "base62" | "base64" | "base64url" | "base85" | "ascii85" | "custom";
  alphabet?: string;
  confidence: "high" | "candidate";
}

function hasMixedCase(s: string): boolean {
  return /[a-z]/.test(s) && /[A-Z]/.test(s);
}

function hasDigits(s: string): boolean {
  return /[0-9]/.test(s);
}

export function detectCustomBase(text: string): CustomBaseResult {
  const trimmed = text.replace(/\s/g, "");
  if (!trimmed) return { detected: false, confidence: "candidate" };

  // Check most specific encodings first, then general ones

  // Base32: only uppercase A-Z, digits 2-7, optional padding
  if (/^[A-Z2-7]+=*$/.test(trimmed) && trimmed.length >= 8) {
    return { detected: true, baseType: "base32", confidence: "high" };
  }

  // Base58 (Bitcoin): no 0, O, I, l
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed) && trimmed.length >= 8) {
    return { detected: true, baseType: "base58", confidence: "high" };
  }

  // Base64: mixed case or digits or padding required to avoid false positives on plain text
  if (/^[A-Za-z0-9+/]+=*$/.test(trimmed) && trimmed.length >= 4 && (trimmed.includes("=") || hasMixedCase(trimmed) || hasDigits(trimmed) || trimmed.includes("+") || trimmed.includes("/"))) {
    return { detected: true, baseType: "base64", confidence: "high" };
  }

  // Base64 URL-safe
  if (/^[A-Za-z0-9_-]+=*$/.test(trimmed) && trimmed.length >= 4 && (trimmed.includes("=") || hasMixedCase(trimmed) || hasDigits(trimmed) || trimmed.includes("-") || trimmed.includes("_"))) {
    return { detected: true, baseType: "base64url", confidence: "high" };
  }

  // Base85
  if (/^[0-9A-Za-z!#$%&()*+;<=>?@^_`{|}~-]+$/.test(trimmed) && /[!#$%&()*+;<=>?@^_`{|}~-]/.test(trimmed)) {
    return { detected: true, baseType: "base85", confidence: "high" };
  }

  // Ascii85
  if (/^<~.+~>$/.test(trimmed)) {
    return { detected: true, baseType: "ascii85", confidence: "high" };
  }

  // Heuristic: unique characters for custom base detection
  const unique = new Set(trimmed).size;
  if (unique >= 32 && unique <= 85 && trimmed.length >= 8) {
    return {
      detected: true,
      baseType: "custom",
      alphabet: [...new Set(trimmed)].sort().join(""),
      confidence: "candidate",
    };
  }

  return { detected: false, confidence: "candidate" };
}
