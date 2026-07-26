import { deflateSync } from "fflate";
import { describe, expect, it } from "vitest";
import { analyzeZip, crc32, repairZip } from "./zipEncryption";
import { DEFAULT_ZIP_OPTIONS } from "./zipTypes";

interface EntrySpec {
  name: string;
  content: Uint8Array;
  method: number; // 0 stored, 8 deflate, 99 aes
  localBit0: boolean;
  centralBit0: boolean;
  corrupt?: boolean; // prepend garbage so inflate/crc fails (simulates real encryption)
  crcOverride?: number;
  aesExtra?: boolean;
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function pushU16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushU32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function compress(spec: EntrySpec): Uint8Array {
  const base = spec.method === 8 ? deflateSync(spec.content) : spec.content;
  if (!spec.corrupt) return base;
  const corrupted = new Uint8Array(base.length + 12);
  corrupted.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 0);
  corrupted.set(base, 12);
  return corrupted;
}

function buildZip(specs: EntrySpec[]): Uint8Array {
  const bytes: number[] = [];
  const meta = specs.map((spec) => {
    const compressed = compress(spec);
    const crc = spec.crcOverride ?? crc32(spec.content);
    const nameBytes = textBytes(spec.name);
    const aesExtra = spec.aesExtra ? [0x01, 0x99, 0x07, 0x00, 0x02, 0x00, 0x41, 0x45, 0x03, 0x00, 0x00] : [];
    return { spec, compressed, crc, nameBytes, aesExtra };
  });

  const offsets: number[] = [];
  for (const { spec, compressed, crc, nameBytes, aesExtra } of meta) {
    offsets.push(bytes.length);
    pushU32(bytes, 0x04034b50);
    pushU16(bytes, 20);
    pushU16(bytes, spec.localBit0 ? 1 : 0);
    pushU16(bytes, spec.method);
    pushU32(bytes, 0);
    pushU32(bytes, crc);
    pushU32(bytes, compressed.length);
    pushU32(bytes, spec.content.length);
    pushU16(bytes, nameBytes.length);
    pushU16(bytes, aesExtra.length);
    bytes.push(...nameBytes, ...aesExtra, ...compressed);
  }

  const centralStart = bytes.length;
  meta.forEach(({ spec, compressed, crc, nameBytes, aesExtra }, index) => {
    pushU32(bytes, 0x02014b50);
    pushU16(bytes, 20);
    pushU16(bytes, 20);
    pushU16(bytes, spec.centralBit0 ? 1 : 0);
    pushU16(bytes, spec.method);
    pushU32(bytes, 0);
    pushU32(bytes, crc);
    pushU32(bytes, compressed.length);
    pushU32(bytes, spec.content.length);
    pushU16(bytes, nameBytes.length);
    pushU16(bytes, aesExtra.length);
    pushU16(bytes, 0);
    pushU16(bytes, 0);
    pushU16(bytes, 0);
    pushU32(bytes, 0);
    pushU32(bytes, offsets[index]);
    bytes.push(...nameBytes, ...aesExtra);
  });
  const centralSize = bytes.length - centralStart;

  pushU32(bytes, 0x06054b50);
  pushU16(bytes, 0);
  pushU16(bytes, 0);
  pushU16(bytes, specs.length);
  pushU16(bytes, specs.length);
  pushU32(bytes, centralSize);
  pushU32(bytes, centralStart);
  pushU16(bytes, 0);

  return new Uint8Array(bytes);
}

function analyze(bytes: Uint8Array) {
  return analyzeZip({ bytes, options: DEFAULT_ZIP_OPTIONS, prefixes: ["flag"], caseSensitive: false });
}

describe("analyzeZip", () => {
  it("reports no findings for a normal archive", () => {
    const zip = buildZip([{ name: "a.txt", content: textBytes("hello world"), method: 8, localBit0: false, centralBit0: false }]);
    const report = analyze(zip);
    expect(report.entryCount).toBe(1);
    expect(report.entries).toHaveLength(0);
    expect(report.repairable).toBe(0);
  });

  it("confirms a pseudo-encrypted deflate entry whose plaintext CRC verifies", () => {
    const zip = buildZip([{ name: "secret.txt", content: textBytes("plain deflate data here"), method: 8, localBit0: true, centralBit0: true }]);
    const report = analyze(zip);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]).toMatchObject({ severity: "high", crcVerified: true });
    expect(report.repairable).toBe(1);
  });

  it("confirms a stored pseudo-encryption when only the local header bit is set", () => {
    const zip = buildZip([{ name: "s.txt", content: textBytes("stored plaintext"), method: 0, localBit0: true, centralBit0: false }]);
    const report = analyze(zip);
    expect(report.entries[0]).toMatchObject({ severity: "high", crcVerified: true, localBit0: true, centralBit0: false });
  });

  it("marks a mismatched but unverifiable entry as suspicious", () => {
    const zip = buildZip([{ name: "m.bin", content: textBytes("data"), method: 0, localBit0: true, centralBit0: false, crcOverride: 0x1234 }]);
    const report = analyze(zip);
    expect(report.entries[0]).toMatchObject({ severity: "suspicious", crcVerified: false });
    expect(report.repairable).toBe(0);
  });

  it("treats a real ZipCrypto-style entry (inflate fails) as suspicious and does not repair it", () => {
    const zip = buildZip([{ name: "enc.txt", content: textBytes("would be secret"), method: 8, localBit0: true, centralBit0: true, corrupt: true }]);
    const report = analyze(zip);
    expect(report.entries[0]).toMatchObject({ severity: "suspicious", crcVerified: false });
    const repaired = repairZip(zip, report, DEFAULT_ZIP_OPTIONS);
    expect(repaired).toEqual(zip);
  });

  it("classifies an AES extra-field entry as info", () => {
    const zip = buildZip([{ name: "aes.txt", content: textBytes("x"), method: 99, localBit0: true, centralBit0: true, aesExtra: true, corrupt: true }]);
    const report = analyze(zip);
    expect(report.entries[0]).toMatchObject({ severity: "info", method: "aes" });
  });

  it("captures flag hits found inside verified plaintext", () => {
    const zip = buildZip([{ name: "f.txt", content: textBytes("prefix flag{demo_zip} suffix"), method: 0, localBit0: true, centralBit0: true }]);
    const report = analyze(zip);
    expect(report.flagHits).toContain("flag{demo_zip}");
    expect(report.entries[0].flagHits).toContain("flag{demo_zip}");
  });

  it("repairs only high-severity entries byte-for-byte except the cleared flag bits", () => {
    const zip = buildZip([{ name: "r.txt", content: textBytes("repairable deflate body"), method: 8, localBit0: true, centralBit0: true }]);
    const report = analyze(zip);
    const repaired = repairZip(zip, report, DEFAULT_ZIP_OPTIONS);
    expect(repaired.length).toBe(zip.length);
    const diff = [...repaired].map((value, index) => (value === zip[index] ? -1 : index)).filter((index) => index >= 0);
    expect(diff).toEqual([report.entries[0].localGpOffset, report.entries[0].centralGpOffset]);
    // repaired archive parses clean
    expect(analyze(repaired).entries).toHaveLength(0);
  });

  it("throws on a truncated or non-ZIP buffer", () => {
    expect(() => analyze(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
