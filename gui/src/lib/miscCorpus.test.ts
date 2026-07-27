// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeStegoChannels } from "./stegoChannels";
import { analyzeStego, DEFAULT_STEGO_OPTIONS } from "./stegoAnalyzer";
import { analyzeImageDimensions } from "./stegoDimensions";
import { extractStegoMetadata } from "./stegoMetadata";

const corpus = "D:\\Projects\\MiscTest";
const corpusIt = existsSync(corpus) ? it : it.skip;

function bytes(name: string) {
  return new Uint8Array(readFileSync(join(corpus, name)));
}

function channelValues(name: string) {
  return analyzeStegoChannels(bytes(name), ["ctfshow"], false).candidates.map((candidate) => candidate.value);
}

function dimensions(name: string) {
  return analyzeImageDimensions(bytes(name)).repairs.map((candidate) => `${candidate.width}x${candidate.height}`);
}

describe("MiscTest real-corpus regression", () => {
  corpusIt.each([
    ["misc39.gif", "ctfshow{52812ff995fb7be268d963a9ebca0459}"],
    ["misc40.png", "ctfshow{95ca0297dff0f6b1bdaca394a6fcb95b}"],
    ["misc42.png", "ctfshow{078cbd0f9c8d3f2158e70529f8913c65}"],
    ["misc43.png", "ctfshow{6eb2589ffff5e390fe6b87504dbc0892}"],
    ["misc44.png", "ctfshow{cc1af32bf96308fc1263231be783f69e}"],
  ])("decodes the known structure-channel answer from %s", (name, flag) => {
    expect(channelValues(name)).toContain(flag);
  });

  corpusIt.each([
    ["misc24.bmp", "900x250"],
    ["misc25.png", "900x250"],
    ["misc26.png", "900x606"],
    ["misc30.bmp", "950x150"],
    ["misc31.bmp", "1082x150"],
    ["misc32.png", "1044x150"],
    ["misc33.png", "978x142"],
  ])("includes the verified repair dimension for %s", (name, expected) => {
    expect(dimensions(name)).toContain(expected);
  });

  corpusIt.each([
    ["misc27.jpg", "900x255"],
    ["misc28.gif", "900x255"],
    ["misc29.gif", "900x255"],
    ["misc34.png", "1123x150"],
    ["misc35.jpg", "996x600"],
    ["misc36.gif", "941x300"],
  ])("includes the verified second-stage repair dimension for %s", (name, expected) => {
    expect(dimensions(name)).toContain(expected);
  });

  corpusIt.each([
    ["misc46.gif", "gif-offset-scatter", "ctfshow{05906b3be8742a13a93898186bc5802f}"],
    ["misc47.png", "apng-offset-scatter", "ctfshow{6d51f85b45a0061754a2776a32cf26c4}"],
  ])("decodes the verified coordinate channel from %s", (name, visualId, flag) => {
    const result = analyzeStegoChannels(bytes(name), ["ctfshow"], false);
    expect(result.visuals).toContainEqual(expect.objectContaining({ id: visualId }));
    expect(result.candidates).toContainEqual(expect.objectContaining({
      source: "坐标点阵",
      value: flag,
      flags: [flag],
      confidence: "high",
    }));
  });

  corpusIt("decodes the verified hex-editor marker highlight from misc41", () => {
    const flag = "ctfshow{fcbd427caf4a52f1147ab44346cd1cdd}";
    expect(analyzeStegoChannels(bytes("misc41.jpg"), ["ctfshow"], false).candidates).toContainEqual(expect.objectContaining({
      source: "字节标记点阵",
      value: flag,
      flags: [flag],
      confidence: "high",
    }));
  });

  corpusIt.each([
    ["misc18.jpg", "ctfshow{3228ac17e5f05d60c208f72d4cf5a839}"],
    ["misc19.tif", "ctfshow{dfdcf08038cd446a5eb50782f8d3605d}"],
  ])("assembles the verified metadata answer from %s", (name, flag) => {
    const findings = extractStegoMetadata(bytes(name)).findings;
    expect(findings).toContainEqual(expect.objectContaining({
      title: "元数据组合发现 Flag",
      detail: flag,
    }));
    expect(findings.filter((finding) => finding.title === "元数据组合发现 Flag" && finding.severity === "high").map((finding) => finding.detail)).toEqual([flag]);
  });

  corpusIt.each([
    ["misc20.jpg", "ctfshow{c97964b1aecf06e1d79c21ddad593e42}"],
    ["misc21.jpg", "ctfshow{e8a221498d5c073b4084eb51b1a1686d}"],
    ["misc23.psd", "ctfshow{3425649ea0e31938808c0de51b70ce6a}"],
  ])("derives the verified metadata answer from %s", (name, flag) => {
    const metadata = extractStegoMetadata(bytes(name));
    expect(metadata.findings).toContainEqual(expect.objectContaining({
      detail: flag,
    }));
  });

  corpusIt.each([
    ["misc48.jpg", "JPEG FF 游程", "ctfshow{0cb07add909d0d60a92101a8b5c7223a}"],
    ["misc49.jpg", "JPEG APP 标记", "ctfshow{0c618671a153f5da3948fdb2a2238e44}"],
  ])("decodes the verified JPEG marker answer from %s", (name, source, flag) => {
    expect(analyzeStegoChannels(bytes(name), ["ctfshow"], false).candidates).toContainEqual(expect.objectContaining({
      source,
      value: flag,
    }));
  });

  corpusIt("recovers misc45 through lossless PNG-to-BMP pixel carving", async () => {
    const report = await analyzeStego({
      fileName: "misc45.png",
      bytes: bytes("misc45.png"),
      prefixes: ["ctfshow"],
    }, {
      ...DEFAULT_STEGO_OPTIONS,
      structure: false,
      channels: false,
      dimensions: false,
      metadata: false,
      strings: false,
      visuals: false,
      dct: false,
      frequency: false,
      trailing: false,
    }, { signal: new AbortController().signal });

    expect(report.findings).toContainEqual(expect.objectContaining({
      detail: "ctfshow{057a722a5587979c34966c2436283e70}",
    }));
    expect(report.repairs).toContainEqual(expect.objectContaining({
      id: "png-pixels-as-bmp",
      format: "BMP",
    }));
  });
});
