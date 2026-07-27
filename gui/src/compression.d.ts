declare module "seek-bzip" {
  interface OutputStream {
    writeByte(byte: number): void;
  }
  interface BunzipApi {
    decode(input: Uint8Array, output?: OutputStream, multistream?: boolean): Uint8Array | undefined;
  }
  const Bunzip: BunzipApi;
  export default Bunzip;
}

declare module "lzma/src/lzma-d.js" {
  interface LzmaDecoder {
    decompress(input: Uint8Array): string | number[];
  }
  interface LzmaModule {
    LZMA: LzmaDecoder;
    LZMA_WORKER: LzmaDecoder;
  }
  const lzma: LzmaModule;
  export default lzma;
}

declare module "upng-js" {
  interface UpngFrame {
    rect: { x: number; y: number; width: number; height: number };
    delay: number;
    dispose: number;
    blend: number;
  }
  interface UpngImage {
    width: number;
    height: number;
    depth: number;
    ctype: number;
    frames: UpngFrame[];
    data: ArrayBuffer | Uint8Array;
  }
  interface UpngApi {
    decode(buffer: ArrayBuffer): UpngImage;
    toRGBA8(image: UpngImage): ArrayBuffer[];
    encode(frames: ArrayBuffer[], width: number, height: number, colors: number, delays?: number[]): ArrayBuffer;
  }
  const UPNG: UpngApi;
  export default UPNG;
}

declare module "bpg-decoder/bpgdec.js" {
  interface LegacyBpgImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }

  interface LegacyBpgContext {
    createImageData(width: number, height: number): LegacyBpgImageData;
  }

  class BPGDecoder {
    constructor(context: LegacyBpgContext);
    imageData: LegacyBpgImageData | null;
    frames: Array<{ img: LegacyBpgImageData; duration: number }> | null;
    _onload(request: { response: ArrayBuffer }): void;
  }

  export default BPGDecoder;
}
