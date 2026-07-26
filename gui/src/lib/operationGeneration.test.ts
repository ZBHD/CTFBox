import { describe, expect, it } from "vitest";
import { OperationGeneration } from "./operationGeneration";

describe("asynchronous operation generation", () => {
  it("invalidates callbacks from an older load or analysis operation", () => {
    const generation = new OperationGeneration();
    const first = generation.begin();
    expect(generation.isCurrent(first)).toBe(true);

    generation.invalidate();
    expect(generation.isCurrent(first)).toBe(false);

    const second = generation.begin();
    expect(generation.isCurrent(second)).toBe(true);
  });
});
