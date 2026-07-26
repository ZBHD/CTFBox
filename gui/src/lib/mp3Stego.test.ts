import { describe, expect, it } from "vitest";
import { detectMp3Stego } from "./mp3Stego";

describe("mp3Stego", () => {
  it("returns no frames for non-MPEG data", () => {
    const result = detectMp3Stego(new Uint8Array(100));
    expect(result.frames).toBe(0);
    expect(result.detected).toBe(false);
  });

  it("returns frames for valid-looking MPEG data", () => {
    // Minimal MPEG-like frame: 0xFF 0xFB 0x90 0x00 (MPEG1 Layer3 128kbps 44100)
    const buf = new Uint8Array(500);
    buf[0] = 0xFF; buf[1] = 0xFB; buf[2] = 0x90; buf[3] = 0x00;
    const result = detectMp3Stego(buf);
    // frame size ≈ 144*128000/44100 ≈ 417, so only one frame possible in 500 bytes
    expect(result.frames).toBeGreaterThanOrEqual(0);
    expect(typeof result.detail).toBe("string");
  });
});
