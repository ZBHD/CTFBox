const MORSE_TO_CHAR: Record<string, string> = {
  ".-": "A", "-...": "B", "-.-.": "C", "-..": "D", ".": "E",
  "..-.": "F", "--.": "G", "....": "H", "..": "I", ".---": "J",
  "-.-": "K", ".-..": "L", "--": "M", "-.": "N", "---": "O",
  ".--.": "P", "--.-": "Q", ".-.": "R", "...": "S", "-": "T",
  "..-": "U", "...-": "V", ".--": "W", "-..-": "X", "-.--": "Y",
  "--..": "Z",
  "-----": "0", ".----": "1", "..---": "2", "...--": "3", "....-": "4",
  ".....": "5", "-....": "6", "--...": "7", "---..": "8", "----.": "9",
  "-.--.": "{", "-.--.-": "}", "..--.-": "_",
};

export function isMorse(input: string): boolean {
  const trimmed = input.replace(/\s+/g, "");
  if (!trimmed) return false;
  const symbols = new Set(trimmed);
  return symbols.size <= 3 && symbols.has(".") && symbols.has("-");
}

export function decodeMorse(input: string, separator = "/"): string {
  const symbols = input.trim().split(separator).map((s) => s.trim()).filter(Boolean);
  return symbols.map((s) => MORSE_TO_CHAR[s] ?? (s === "" ? " " : "?")).join("");
}

export interface MorseResult {
  detected: boolean;
  decoded?: string;
  confidence: "high" | "candidate";
}

export function detectMorse(input: string, _prefixes: readonly string[], _caseSensitive: boolean): MorseResult {
  const trimmed = input.trim();
  if (!trimmed || !isMorse(trimmed)) return { detected: false, confidence: "candidate" };

  for (const sep of ["/", " ", "  "]) {
    try {
      const decoded = decodeMorse(trimmed, sep);
      if (decoded.length >= 3 && !decoded.includes("?")) {
        return { detected: true, decoded, confidence: "high" };
      }
    } catch { /* try next separator */ }
  }

  const decoded = decodeMorse(trimmed, "/");
  return { detected: true, decoded, confidence: "candidate" };
}
