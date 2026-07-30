export type PcapByteOrder = "little-endian" | "big-endian";
export type PcapTimestampResolution = "microseconds" | "nanoseconds";

export interface PcapFinding {
  severity: "high" | "suspicious" | "info";
  title: string;
  detail: string;
  offset?: number;
}

export interface PcapPacket {
  index: number;
  timestampSeconds: number;
  timestampFraction: number;
  capturedLength: number;
  originalLength: number;
  offset: number;
  bytes: Uint8Array;
  summary?: PcapPacketSummary;
}

export interface PcapPacketSummary {
  source: string;
  destination: string;
  protocol: "TCP" | "UDP" | "ICMP" | "IPv4";
}

export interface PcapReport {
  format: "pcap" | "pcapng" | "unknown";
  byteOrder?: PcapByteOrder;
  timestampResolution?: PcapTimestampResolution;
  linkType?: number;
  packets: PcapPacket[];
  findings: PcapFinding[];
}

interface PcapHeader {
  byteOrder: PcapByteOrder;
  timestampResolution: PcapTimestampResolution;
}

function readU32(bytes: Uint8Array, offset: number, byteOrder: PcapByteOrder) {
  if (byteOrder === "little-endian") {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function ipv4Address(bytes: Uint8Array, offset: number) {
  return Array.from(bytes.subarray(offset, offset + 4)).join(".");
}

function readU16Be(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function summarizeEthernetIpv4(bytes: Uint8Array): PcapPacketSummary | undefined {
  if (bytes.length < 34 || readU16Be(bytes, 12) !== 0x0800) return undefined;
  const ipOffset = 14;
  const version = bytes[ipOffset] >>> 4;
  const headerLength = (bytes[ipOffset] & 15) * 4;
  if (version !== 4 || headerLength < 20 || ipOffset + headerLength > bytes.length) return undefined;

  const source = ipv4Address(bytes, ipOffset + 12);
  const destination = ipv4Address(bytes, ipOffset + 16);
  const protocol = bytes[ipOffset + 9];
  if (protocol === 1) return { source, destination, protocol: "ICMP" };
  if (protocol !== 6 && protocol !== 17) return { source, destination, protocol: "IPv4" };

  const transportOffset = ipOffset + headerLength;
  if (transportOffset + 4 > bytes.length) return { source, destination, protocol: protocol === 6 ? "TCP" : "UDP" };
  return {
    source: `${source}:${readU16Be(bytes, transportOffset)}`,
    destination: `${destination}:${readU16Be(bytes, transportOffset + 2)}`,
    protocol: protocol === 6 ? "TCP" : "UDP",
  };
}

function parseHeader(bytes: Uint8Array): PcapHeader | undefined {
  if (bytes.length < 4) return undefined;
  const magic = Array.from(bytes.subarray(0, 4)).join(",");
  if (magic === "212,195,178,161") return { byteOrder: "little-endian", timestampResolution: "microseconds" };
  if (magic === "161,178,195,212") return { byteOrder: "big-endian", timestampResolution: "microseconds" };
  if (magic === "77,60,178,161") return { byteOrder: "little-endian", timestampResolution: "nanoseconds" };
  if (magic === "161,178,60,77") return { byteOrder: "big-endian", timestampResolution: "nanoseconds" };
  return undefined;
}

export function analyzePcap(bytes: Uint8Array): PcapReport {
  const findings: PcapFinding[] = [];
  if (bytes.length >= 4 && bytes[0] === 0x0a && bytes[1] === 0x0d && bytes[2] === 0x0d && bytes[3] === 0x0a) {
    return {
      format: "pcapng",
      packets: [],
      findings: [{ severity: "info", title: "PCAPNG 暂未解析", detail: "已识别 PCAPNG Section Header；当前版本仅支持经典 PCAP 记录解析", offset: 0 }],
    };
  }
  if (bytes.length < 24) {
    return {
      format: "unknown",
      packets: [],
      findings: [{ severity: "high", title: "PCAP 全局头被截断", detail: `至少需要 24 字节，实际只有 ${bytes.length} 字节`, offset: 0 }],
    };
  }

  const header = parseHeader(bytes);
  if (!header) {
    return {
      format: "unknown",
      packets: [],
      findings: [{ severity: "info", title: "不是经典 PCAP 文件", detail: "未匹配经典 PCAP 全局头；PCAPNG 将在后续解析器中支持", offset: 0 }],
    };
  }

  const packets: PcapPacket[] = [];
  const linkType = readU32(bytes, 20, header.byteOrder);
  let offset = 24;
  while (offset < bytes.length) {
    if (offset + 16 > bytes.length) {
      findings.push({ severity: "high", title: "PCAP 数据包头被截断", detail: `偏移 0x${offset.toString(16)} 的记录头不足 16 字节`, offset });
      break;
    }
    const capturedLength = readU32(bytes, offset + 8, header.byteOrder);
    const originalLength = readU32(bytes, offset + 12, header.byteOrder);
    const payloadOffset = offset + 16;
    if (capturedLength > bytes.length - payloadOffset) {
      findings.push({ severity: "high", title: "PCAP 数据包被截断", detail: `记录声明 ${capturedLength} 字节，但只剩 ${bytes.length - payloadOffset} 字节`, offset });
      break;
    }
    const payload = bytes.slice(payloadOffset, payloadOffset + capturedLength);
    packets.push({
      index: packets.length + 1,
      timestampSeconds: readU32(bytes, offset, header.byteOrder),
      timestampFraction: readU32(bytes, offset + 4, header.byteOrder),
      capturedLength,
      originalLength,
      offset,
      bytes: payload,
      summary: linkType === 1 ? summarizeEthernetIpv4(payload) : undefined,
    });
    offset = payloadOffset + capturedLength;
  }

  return {
    format: "pcap",
    byteOrder: header.byteOrder,
    timestampResolution: header.timestampResolution,
    linkType,
    packets,
    findings,
  };
}
