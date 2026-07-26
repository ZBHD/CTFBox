import { gzipSync, strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ARCHIVE_LIMITS,
  unpackArchive,
  type ArchiveLimits,
} from "./lsbArchive";
import { scoreLsbPayload } from "./lsbFormats";

function limits(overrides: Partial<ArchiveLimits>): ArchiveLimits {
  return { ...DEFAULT_ARCHIVE_LIMITS, ...overrides };
}

function zipWithLegacyGbkName() {
  const archive = zipSync({ name: strToU8("ctfshow{gbk-name}") });
  const asciiName = strToU8("name");
  const gbkName = Uint8Array.of(0xc6, 0xec, 0xd7, 0xd3);
  for (let offset = 0; offset <= archive.length - asciiName.length; offset += 1) {
    if (asciiName.every((byte, index) => archive[offset + index] === byte)) archive.set(gbkName, offset);
  }
  return archive;
}

describe("LSB archive extraction", () => {
  it("extracts UTF-8 ZIP names and readable text", () => {
    const archive = zipSync({ "旗子": strToU8("ctfshow{inside}") });
    const files = unpackArchive(archive, "application/zip");

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      name: "旗子",
      mediaType: "text/plain",
      text: "ctfshow{inside}",
    });
  });

  it("decodes legacy GBK ZIP names from the central directory", () => {
    const files = unpackArchive(zipWithLegacyGbkName(), "application/zip");

    expect(files[0]).toMatchObject({ name: "旗子", text: "ctfshow{gbk-name}" });
  });

  it("extracts GZIP text", () => {
    const archive = gzipSync(strToU8("ctfshow{gzip}"));
    expect(unpackArchive(archive, "application/gzip")[0]).toMatchObject({
      name: "payload",
      text: "ctfshow{gzip}",
    });
  });

  it("extracts a GZIP member when unrelated carrier bytes follow its trailer", () => {
    const archive = gzipSync(strToU8("ctfshow{gzip-with-tail}"));
    const carrier = new Uint8Array(archive.length + 12);
    carrier.set(archive);
    carrier.set([1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xff, 0xff, 0x7f], archive.length);

    expect(unpackArchive(carrier, "application/gzip")[0]).toMatchObject({
      name: "payload",
      text: "ctfshow{gzip-with-tail}",
    });
  });

  it("rejects unsafe paths without dropping safe entries", () => {
    const archive = zipSync({
      "../escape.txt": strToU8("escape"),
      "C:/drive.txt": strToU8("drive"),
      "safe/flag.txt": strToU8("ctfshow{safe}"),
    });
    const files = unpackArchive(archive, "application/zip");

    expect(files.some((file) => file.name === "safe/flag.txt")).toBe(true);
    expect(files.some((file) => file.name.includes("escape.txt") && !file.warning)).toBe(false);
    expect(files.some((file) => file.warning?.includes("不安全路径"))).toBe(true);
  });

  it("enforces entry, file, total-size and compression-ratio limits before extraction", () => {
    const twoFiles = zipSync({ a: strToU8("a"), b: strToU8("b") });
    const largeFile = zipSync({ large: new Uint8Array(32) });
    const compressed = zipSync({ repeated: new Uint8Array(4096) });

    expect(unpackArchive(twoFiles, "application/zip", limits({ maxEntries: 1 }))[0].warning).toContain("条目数");
    expect(unpackArchive(largeFile, "application/zip", limits({ maxFileBytes: 16 }))[0].warning).toContain("单文件");
    expect(unpackArchive(largeFile, "application/zip", limits({ maxTotalBytes: 16 }))[0].warning).toContain("总解压");
    expect(unpackArchive(compressed, "application/zip", limits({ maxCompressionRatio: 2 }))[0].warning).toContain("压缩比");
  });

  it("adds unpacked flags to archive scoring evidence", () => {
    const archive = zipSync({ "旗子": strToU8("ctfshow{archive-flag}") });
    const scored = scoreLsbPayload(archive, ["ctfshow"], false);

    expect(scored.files[0].children?.[0]).toMatchObject({ name: "旗子", text: "ctfshow{archive-flag}" });
    expect(scored.evidence).toContain("归档内发现 Flag：ctfshow{archive-flag}");
  });
});
