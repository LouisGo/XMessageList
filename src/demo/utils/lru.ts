export class LRUCache<TKey, TValue> {
  private readonly entries = new Map<TKey, TValue>()

  constructor(
    private readonly capacity: number,
    private readonly onEvict?: (key: TKey, value: TValue) => void,
  ) {}

  getOrSet(key: TKey, createValue: () => TValue): TValue {
    const existing = this.entries.get(key)

    if (existing) {
      this.entries.delete(key)
      this.entries.set(key, existing)
      return existing
    }

    const value = createValue()
    this.entries.set(key, value)
    this.evictIfNeeded()
    return value
  }

  peek(key: TKey): TValue | undefined {
    return this.entries.get(key)
  }

  has(key: TKey): boolean {
    return this.entries.has(key)
  }

  delete(key: TKey): boolean {
    return this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  forEach(callback: (value: TValue, key: TKey) => void): void {
    this.entries.forEach(callback)
  }

  getLruKeys(): TKey[] {
    return Array.from(this.entries.keys())
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.capacity) {
      const oldestKey = this.entries.keys().next().value as TKey | undefined

      if (oldestKey === undefined) {
        return
      }

      const oldestValue = this.entries.get(oldestKey)
      this.entries.delete(oldestKey)

      if (oldestValue !== undefined) {
        this.onEvict?.(oldestKey, oldestValue)
      }
    }
  }
}
