function utf8Hex(value: string) {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function stableIdPart(value: string) {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (/^[a-z0-9_.-]+$/.test(lower)) return lower;
  const readable = lower
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${readable || "utf8"}-${utf8Hex(trimmed)}`;
}
