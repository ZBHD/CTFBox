import { describe, expect, it } from "vitest";
import { analyzePcap } from "./pcapAnalyzer";

function littleEndianPcap(packet: readonly number[]) {
  return Uint8Array.of(
    0xd4, 0xc3, 0xb2, 0xa1,
    0x02, 0x00, 0x04, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0xff, 0xff, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00,
    0x02, 0x00, 0x00, 0x00,
    packet.length, 0x00, 0x00, 0x00,
    packet.length, 0x00, 0x00, 0x00,
    ...packet,
  );
}

function bigEndianPcap(packet: readonly number[]) {
  return Uint8Array.of(
    0xa1, 0xb2, 0xc3, 0xd4,
    0x00, 0x02, 0x00, 0x04,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0xff, 0xff,
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x02,
    0x00, 0x00, 0x00, 0x03,
    0x00, 0x00, 0x00, packet.length,
    0x00, 0x00, 0x00, packet.length,
    ...packet,
  );
}

describe("pcapAnalyzer", () => {
  it("parses a classic little-endian pcap packet without losing raw bytes", () => {
    const report = analyzePcap(littleEndianPcap([0xaa, 0xbb]));

    expect(report).toMatchObject({
      format: "pcap",
      byteOrder: "little-endian",
      timestampResolution: "microseconds",
      linkType: 1,
      packets: [{ index: 1, timestampSeconds: 1, capturedLength: 2, originalLength: 2, bytes: Uint8Array.of(0xaa, 0xbb) }],
    });
    expect(report.findings).toEqual([]);
  });

  it("reports a truncated packet record instead of reading beyond the capture", () => {
    const bytes = littleEndianPcap([0xaa, 0xbb]).slice(0, -1);
    const report = analyzePcap(bytes);

    expect(report.packets).toEqual([]);
    expect(report.findings).toContainEqual(expect.objectContaining({
      severity: "high",
      title: "PCAP 数据包被截断",
      offset: 24,
    }));
  });

  it("summarizes Ethernet IPv4 UDP endpoints without decoding the payload", () => {
    const packet = [
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb,
      0x08, 0x00,
      0x45, 0x00, 0x00, 0x1c, 0x00, 0x00, 0x00, 0x00, 0x40, 0x11, 0x00, 0x00,
      0xc0, 0xa8, 0x01, 0x0a, 0x08, 0x08, 0x08, 0x08,
      0x30, 0x39, 0x00, 0x35, 0x00, 0x08, 0x00, 0x00,
    ];

    const report = analyzePcap(littleEndianPcap(packet));

    expect(report.packets[0].summary).toEqual({
      source: "192.168.1.10:12345",
      destination: "8.8.8.8:53",
      protocol: "UDP",
    });
  });

  it("parses big-endian headers and packet records", () => {
    const report = analyzePcap(bigEndianPcap([0xaa, 0xbb, 0xcc]));

    expect(report).toMatchObject({
      format: "pcap",
      byteOrder: "big-endian",
      timestampResolution: "microseconds",
      linkType: 1,
      packets: [{ timestampSeconds: 2, timestampFraction: 3, capturedLength: 3, bytes: Uint8Array.of(0xaa, 0xbb, 0xcc) }],
    });
  });

  it("does not fabricate transport ports from an incomplete IPv4 payload", () => {
    const packet = [
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb,
      0x08, 0x00,
      0x45, 0x00, 0x00, 0x1c, 0x00, 0x00, 0x00, 0x00, 0x40, 0x06, 0x00, 0x00,
      0xc0, 0xa8, 0x01, 0x0a, 0x08, 0x08, 0x08, 0x08,
    ];

    const report = analyzePcap(littleEndianPcap(packet));

    expect(report.packets[0].summary).toEqual({
      source: "192.168.1.10",
      destination: "8.8.8.8",
      protocol: "TCP",
    });
  });

  it("identifies PCAPNG instead of treating it as an unrecognized capture", () => {
    const report = analyzePcap(Uint8Array.of(0x0a, 0x0d, 0x0d, 0x0a, ...Array(20).fill(0)));

    expect(report.format).toBe("pcapng");
    expect(report.findings).toContainEqual(expect.objectContaining({
      severity: "info",
      title: "PCAPNG 暂未解析",
    }));
  });
});
