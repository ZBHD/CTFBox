import { describe, expect, it } from "vitest";
// @ts-expect-error The build helper is a Node ESM script outside the renderer tsconfig.
import { transformBpgDecoderSource } from "../../scripts/prepare-bpg-assets.mjs";

describe("BPG browser vendor preparation", () => {
  it("keeps the decoder unminified and removes the eval-backed array cwrap", () => {
    const source = `module.exports = (function() {
      var Module = {};
      BPGDecoder.prototype = {
        malloc: Module["cwrap"]("malloc", "number", ["number"]),
        free: Module["cwrap"]("free", "void", ["number"]),
        bpg_decoder_decode: Module["cwrap"]("bpg_decoder_decode", "number", ["number", "array", "number"])
      };
      return BPGDecoder;
    })()`;

    const transformed = transformBpgDecoderSource(source);

    expect(transformed).toContain("globalThis.CTFBoxBPGDecoder = (function()");
    expect(transformed).toContain("Module._bpg_decoder_decode");
    expect(transformed).not.toContain("module.exports");
    expect(transformed).not.toContain("[\"number\", \"array\", \"number\"]");
  });
});
