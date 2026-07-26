export class OperationGeneration {
  private value = 0;

  begin() {
    this.value += 1;
    return this.value;
  }

  invalidate() {
    this.value += 1;
  }

  isCurrent(value: number) {
    return this.value === value;
  }
}
