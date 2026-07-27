import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export function transformBpgDecoderSource(source) {
  const globalized = source.replace(
    /module\.exports\s*=\s*(\(function\s*\(\)\s*\{)/,
    "globalThis.CTFBoxBPGDecoder = $1",
  );
  if (globalized === source) throw new Error("BPG 解码器缺少预期的 CommonJS 外壳");

  const transformed = globalized.replace(
    /bpg_decoder_decode:\s*Module\["cwrap"\]\("bpg_decoder_decode",\s*"number",\s*\["number",\s*"array",\s*"number"\]\)/,
    `bpg_decoder_decode: (function(img, array, length) {
            var pointer = Module._malloc(length);
            if (!pointer) return -1;
            try {
                Module.HEAPU8.set(array.subarray(0, length), pointer);
                return Module._bpg_decoder_decode(img, pointer, length)
            } finally {
                Module._free(pointer)
            }
        })`,
  );
  if (transformed === globalized) throw new Error("BPG 解码器缺少预期的数组 cwrap");
  return transformed;
}

export function prepareBpgAsset(outputFile = resolve("public/vendor/bpgdec.js")) {
  const source = require.resolve("bpg-decoder/bpgdec.js");
  const transformed = transformBpgDecoderSource(readFileSync(source, "utf8"));
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, `/* Generated from bpg-decoder; keep this asm.js file unminified. */\n${transformed}\n`);
  return { source, outputFile, bytes: readFileSync(outputFile).length };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = prepareBpgAsset();
  process.stdout.write(`BPG asset: ${relative(process.cwd(), result.outputFile)} (${result.bytes} bytes)\n`);
}
