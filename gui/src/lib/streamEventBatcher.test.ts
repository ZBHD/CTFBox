import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamEventBatcher } from "./streamEventBatcher";

interface Event {
  event: "output" | "analysis" | "exit";
  value: number;
}

afterEach(() => vi.useRealTimers());

describe("tool stream event batcher", () => {
  it("coalesces frequent output and analysis events into one timed flush", () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const batcher = new StreamEventBatcher<Event>(flush, 50);

    batcher.push({ event: "output", value: 1 });
    batcher.push({ event: "analysis", value: 2 });
    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith([
      { event: "output", value: 1 },
      { event: "analysis", value: 2 },
    ]);
  });

  it("flushes queued output immediately when an exit event arrives", () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const batcher = new StreamEventBatcher<Event>(flush, 50);

    batcher.push({ event: "output", value: 1 });
    batcher.push({ event: "exit", value: 2 });

    expect(flush).toHaveBeenCalledWith([
      { event: "output", value: 1 },
      { event: "exit", value: 2 },
    ]);
    vi.advanceTimersByTime(50);
    expect(flush).toHaveBeenCalledOnce();
  });
});
