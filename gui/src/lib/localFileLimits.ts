export const MAX_LSB_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_STEGO_FILE_BYTES = 128 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 10_000;
export const MAX_IMAGE_PIXELS = 25_000_000;

export function validateImageDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("图片尺寸无效");
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new Error("图片尺寸超过 10000 x 10000 限制");
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new Error("图片解码像素超过 2500 万限制");
  }
}
