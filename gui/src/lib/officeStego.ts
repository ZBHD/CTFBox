// Office 文档隐写分析：docx/xlsx/pptx ZIP 解包 → XML 分析
import { decompressSync } from "fflate";
import { detectFlags } from "./flagDetector";

export interface OfficeResult {
  findings: OfficeFinding[];
  candidates: OfficeCandidate[];
}

export interface OfficeFinding {
  id: string;
  severity: "high" | "suspicious" | "info";
  source: string;
  title: string;
  detail: string;
}

export interface OfficeCandidate {
  id: string;
  source: string;
  value: string;
  flags: string[];
}

function parseZipLocal(bytes: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let pos = 0;
  while (pos + 30 <= bytes.length) {
    // Find local file header signature
    if (bytes[pos] !== 0x50 || bytes[pos + 1] !== 0x4b || bytes[pos + 2] !== 0x03 || bytes[pos + 3] !== 0x04) {
      pos += 1;
      continue;
    }
    const compression = bytes[pos + 8] | (bytes[pos + 9] << 8);
    const nameLen = bytes[pos + 26] | (bytes[pos + 27] << 8);
    const extraLen = bytes[pos + 28] | (bytes[pos + 29] << 8);
    const compSize = (bytes[pos + 18] | bytes[pos + 19] << 8 | bytes[pos + 20] << 16 | bytes[pos + 21] << 24) >>> 0;
    const uncompSize = (bytes[pos + 22] | bytes[pos + 23] << 8 | bytes[pos + 24] << 16 | bytes[pos + 25] << 24) >>> 0;

    const nameStart = pos + 30;
    if (nameStart + nameLen > bytes.length) { pos += 1; continue; }

    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > bytes.length) { pos += 1; continue; }

    try {
      let data: Uint8Array;
      if (compression === 0) {
        data = bytes.subarray(dataStart, dataEnd);
      } else if (compression === 8) {
        // ZIP uses raw deflate, not zlib-wrapped
        data = decompressSync(bytes.subarray(dataStart, dataEnd), new Uint8Array(uncompSize));
      } else {
        data = bytes.subarray(dataStart, dataEnd);
      }
      files.set(name, data);
    } catch { /* skip corrupted entry */ }

    pos = dataEnd;
  }
  return files;
}

export function analyzeOffice(bytes: Uint8Array, prefixes: readonly string[], caseSensitive: boolean): OfficeResult {
  const findings: OfficeFinding[] = [];
  const candidates: OfficeCandidate[] = [];

  // Check if it's a ZIP-based Office file
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    findings.push({ id: "office-not-zip", severity: "info", source: "Office", title: "非 ZIP 格式", detail: "文件不是 OOXML 格式" });
    return { findings, candidates };
  }

  let files: Map<string, Uint8Array>;
  try {
    files = parseZipLocal(bytes);
  } catch {
    findings.push({ id: "office-parse-fail", severity: "suspicious", source: "Office", title: "ZIP 解析失败", detail: "无法解析文档内部结构" });
    return { findings, candidates };
  }

  // Check for document.xml
  const docXml = files.get("word/document.xml") ?? files.get("xl/worksheets/sheet1.xml") ?? files.get("ppt/slides/slide1.xml");
  if (!docXml) {
    findings.push({ id: "office-no-xml", severity: "info", source: "Office", title: "未找到文档 XML", detail: `${files.size} 个内部文件，不含标准文档 XML` });
    return { findings, candidates };
  }

  const docText = new TextDecoder().decode(docXml);

  // Check for hidden text markers (OOXML)
  const hiddenChecks: Array<[RegExp, string]> = [
    [/<w:vanish\s*\/>/g, "隐藏文字 vanish"],
    [/<w:color w:val="FFFFFF"/gi, "白色字体 FFFFFF"],
    [/<w:color w:val="FFFFF[F0]"/gi, "白色字体 (近似)"],
    [/<w:sz w:val="[0-4]"/g, "极小字号 (≤4pt)"],
    [/<w:sz w:val="2"/g, "2pt 极小字号"],
    [/<w:hidden\s*\/>/g, "隐藏段落"],
    [/<w:webHidden\s*\/>/g, "Web 隐藏"],
  ];

  for (const [regex, desc] of hiddenChecks) {
    const matches = docText.match(regex);
    if (matches && matches.length > 0) {
      findings.push({ id: `office-${desc.replace(/\s/g, "-")}`, severity: "suspicious", source: "Office XML", title: desc, detail: `发现 ${matches.length} 处匹配` });
    }
  }

  // Extract all text from document
  const textContent = docText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const flags = detectFlags(textContent, prefixes, caseSensitive);
  if (flags.length > 0) {
    for (const hit of flags) {
      candidates.push({ id: `office-flag-${candidates.length}`, source: "Office 文档文本", value: hit.text, flags: [hit.text] });
    }
  }

  // Check for custom XML parts
  let customXmlCount = 0;
  for (const [name] of files) {
    if (name.startsWith("customXml/") || name.startsWith("docProps/custom")) {
      customXmlCount += 1;
      const data = files.get(name);
      if (data) {
        const text = new TextDecoder().decode(data);
        const cFlags = detectFlags(text, prefixes, caseSensitive);
        for (const hit of cFlags) {
          candidates.push({ id: `office-custom-${candidates.length}`, source: "Office 自定义属性", value: hit.text, flags: [hit.text] });
        }
      }
    }
  }

  findings.push({ id: "office-summary", severity: "info", source: "Office", title: `分析完成`, detail: `${files.size} 个内部文件，${findings.length - 1} 个发现，${candidates.length} 个 Flag 候选` });

  return { findings, candidates };
}
