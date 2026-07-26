import { decodeTiffPixels, type MagicImageFormat } from "./stegoMagic";

export async function decodeSpecialImagePixels(bytes: Uint8Array, format: MagicImageFormat) {
  if (format === "TIFF") return decodeTiffPixels(bytes);
  if (format === "BPG") {
    const { decodeBpgPixels } = await import("./stegoBpg");
    return decodeBpgPixels(bytes);
  }
  return undefined;
}
