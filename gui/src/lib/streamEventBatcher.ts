export class StreamEventBatcher<T extends { event: string }> {
  private pending: T[] = [];
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly onFlush: (events: T[]) => void,
    private readonly delayMs = 50,
  ) {}

  push(event: T) {
    this.pending.push(event);
    if (event.event === "exit") {
      this.flush();
      return;
    }
    this.timer ??= setTimeout(() => this.flush(), this.delayMs);
  }

  flush() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.length === 0) return;
    const events = this.pending;
    this.pending = [];
    this.onFlush(events);
  }

  dispose() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = [];
  }
}
