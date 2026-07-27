import { describe, expect, it } from "vitest";
import { extractStegoStrings } from "./stegoStrings";

function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

const encoder = new TextEncoder();

describe("stego string extraction", () => {
  it("extracts ASCII, UTF-8, UTF-16 and GB18030 with byte offsets", () => {
    const utf16le = Uint8Array.of(0x46, 0, 0x4c, 0, 0x41, 0, 0x47, 0);
    const utf16be = Uint8Array.of(0, 0x54, 0, 0x45, 0, 0x53, 0, 0x54);
    const bytes = concat(
      Uint8Array.of(0, 1), encoder.encode("ascii-text"), Uint8Array.of(0),
      encoder.encode("中文内容"), Uint8Array.of(0),
      utf16le, Uint8Array.of(0xff), utf16be, Uint8Array.of(0xff),
      Uint8Array.of(0xc6, 0xec, 0xd7, 0xd3, 0xc4, 0xda, 0xc8, 0xdd), Uint8Array.of(0),
    );
    const result = extractStegoStrings(bytes, { minimumLength: 4, prefixes: ["ctfshow"], caseSensitive: false });

    expect(result.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ encoding: "ASCII", offset: 2, text: "ascii-text" }),
      expect.objectContaining({ encoding: "UTF-8", text: "中文内容" }),
      expect.objectContaining({ encoding: "UTF-16LE", text: "FLAG" }),
      expect.objectContaining({ encoding: "UTF-16BE", text: "TEST" }),
      expect.objectContaining({ encoding: "GB18030", text: "旗子内容" }),
    ]));
  });

  it("decodes Base64, hexadecimal and URL encoded strings", () => {
    const bytes = encoder.encode([
      "Y3Rmc2hvd3tiYXNlNjR9",
      "63746673686f777b6865787d",
      "ctfshow%7Burl%7D",
    ].join("\0"));
    const result = extractStegoStrings(bytes, { minimumLength: 4, prefixes: ["ctfshow"], caseSensitive: false });

    expect(result.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ decodedFrom: "Base64", text: "ctfshow{base64}" }),
      expect.objectContaining({ decodedFrom: "Hex", text: "ctfshow{hex}" }),
      expect.objectContaining({ decodedFrom: "URL", text: "ctfshow{url}" }),
    ]));
    expect(result.findings.filter((finding) => finding.severity === "high")).toHaveLength(3);
  });

  it("deduplicates overlapping decoders and enforces result limits", () => {
    const bytes = encoder.encode(Array.from({ length: 20 }, (_, index) => `value-${index}`).join("\0"));
    const result = extractStegoStrings(bytes, { minimumLength: 4, prefixes: [], caseSensitive: false, maxResults: 5 });
    expect(result.hits).toHaveLength(5);
    expect(new Set(result.hits.map((hit) => `${hit.offset}:${hit.text}`)).size).toBe(5);
  });

  it("does not promote a short regex match to a high-confidence flag", () => {
    const result = extractStegoStrings(encoder.encode("marker ctfshow{32} end"), {
      minimumLength: 4,
      prefixes: ["ctfshow"],
      caseSensitive: false,
    });

    expect(result.findings).toContainEqual(expect.objectContaining({
      severity: "suspicious",
      title: "疑似 Flag",
      detail: "ctfshow{32}",
    }));
    expect(result.findings.some((finding) => finding.severity === "high")).toBe(false);
  });

  it("prefers a configured Flag suffix over a noisy longer prefix", () => {
    const expected = "ctfshow{fbe7bb657397e6e0a6adea3e40265425}";
    const result = extractStegoStrings(encoder.encode(`noise\tectfshow{fbe7bb657397e6e0a6adea3e40265425}`), {
      minimumLength: 4,
      prefixes: ["ctfshow"],
      caseSensitive: false,
    });

    expect(result.findings.map((finding) => finding.detail)).toEqual([expected]);
    expect(result.hits.flatMap((hit) => hit.flags)).not.toContain(`e${expected}`);
  });
});
