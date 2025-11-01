export class LruCache extends Map<string, string | null> {
  readonly #maxSize: number;
  #currentSize: number = 0;

  constructor(
    maxSize: number,
    entries: Iterable<[string, string | null]> = [],
  ) {
    super();
    this.#maxSize = maxSize;
    for (const [key, value] of entries) {
      this.set(key, value);
    }
  }

  override get(key: string): string | null | undefined {
    const res = super.get(key);
    if (res !== undefined) {
      // update order so key is most recent
      super.delete(key);
      super.set(key, res);
    }
    return res;
  }

  override set(key: string, value: string | null): this {
    const existing = super.get(key);
    if (existing === undefined) {
      this.#currentSize += key.length; // adding a new key
    } else if (existing !== null) {
      this.#currentSize -= existing.length; // removing old value
    }
    if (value !== null) {
      this.#currentSize += value.length;
    }

    // delete existing value
    super.delete(key);

    // evict down to desired size
    let entry: [string, string | null] | undefined;
    while (
      this.#currentSize > this.#maxSize &&
      (entry = this.entries().next().value)
    ) {
      const [oldestKey, oldestValue] = entry;
      super.delete(oldestKey);
      this.#currentSize -= oldestKey.length;
      if (oldestValue !== null) {
        this.#currentSize -= oldestValue.length;
      }
    }

    // finally insert new key and return
    super.set(key, value);
    return this;
  }

  override delete(key: string): boolean {
    const value = super.get(key);
    if (value === undefined) {
      return false;
    }
    super.delete(key);
    if (value !== null) {
      this.#currentSize -= value.length;
    }
    this.#currentSize -= key.length;
    return true;
  }

  override clear(): void {
    super.clear();
    this.#currentSize = 0;
  }
}
