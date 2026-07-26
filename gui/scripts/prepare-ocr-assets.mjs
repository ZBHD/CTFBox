import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

function packageDirectory(name, paths) {
  return dirname(require.resolve(`${name}/package.json`, paths ? { paths } : undefined));
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function prepareOcrAssets(outputDirectory = resolve("public/ocr")) {
  const tesseractDirectory = packageDirectory("tesseract.js");
  const coreDirectory = packageDirectory("tesseract.js-core", [tesseractDirectory]);
  const languageDirectory = join(packageDirectory("@tesseract.js-data/eng"), "4.0.0");
  const files = [
    [join(coreDirectory, "tesseract-core-lstm.wasm.js"), "core/tesseract-core-lstm.wasm.js"],
    [join(coreDirectory, "tesseract-core-relaxedsimd-lstm.wasm.js"), "core/tesseract-core-relaxedsimd-lstm.wasm.js"],
    [join(coreDirectory, "tesseract-core-simd-lstm.wasm.js"), "core/tesseract-core-simd-lstm.wasm.js"],
    [join(languageDirectory, "eng.traineddata.gz"), "lang/eng.traineddata.gz"],
    [join(tesseractDirectory, "dist", "worker.min.js"), "worker.min.js"],
  ];
  const manifest = { files: [] };
  for (const [source, destination] of files) {
    const bytes = readFileSync(source);
    const target = join(outputDirectory, destination);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    manifest.files.push({ path: destination, bytes: bytes.length, sha256: digest(bytes) });
  }
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const outputDirectory = resolve("public/ocr");
  const manifest = prepareOcrAssets(outputDirectory);
  const totalBytes = manifest.files.reduce((total, file) => total + file.bytes, 0);
  process.stdout.write(`OCR assets: ${relative(process.cwd(), outputDirectory)} (${manifest.files.length} files, ${totalBytes} bytes)\n`);
}
