// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { tmpdir } from "node:os";
// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error The build helper is plain ESM so it can run before Vite starts.
import { prepareOcrAssets } from "../../scripts/prepare-ocr-assets.mjs";

const outputs: string[] = [];

afterEach(() => {
  for (const output of outputs.splice(0)) rmSync(output, { recursive: true, force: true });
});

describe("offline OCR assets", () => {
  it("copies every runtime asset and records its SHA-256 digest", () => {
    const output = mkdtempSync(join(tmpdir(), "ctfbox-ocr-"));
    outputs.push(output);

    prepareOcrAssets(output);

    const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8")) as { files: Array<{ path: string; bytes: number; sha256: string }> };
    expect(manifest.files.map((file) => file.path)).toEqual([
      "core/tesseract-core-lstm.wasm.js",
      "core/tesseract-core-relaxedsimd-lstm.wasm.js",
      "core/tesseract-core-simd-lstm.wasm.js",
      "lang/eng.traineddata.gz",
      "worker.min.js",
    ]);
    expect(manifest.files.every((file) => file.bytes > 1_000 && /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
  });
});
