import { describe, expect, it } from "vitest";
import { validateImageDimensions } from "./localFileLimits";

describe("local file resource limits", () => {
  it("rejects images whose decoded RGBA surface exceeds the pixel budget", () => {
    expect(() => validateImageDimensions(10_000, 10_000)).toThrow("2500 万");
    expect(() => validateImageDimensions(5_000, 5_000)).not.toThrow();
  });

  it("rejects invalid image dimensions", () => {
    expect(() => validateImageDimensions(0, 100)).toThrow("尺寸无效");
  });
});
