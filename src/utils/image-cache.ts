class ImageCacheManager {
  private cache: Map<string, string> = new Map();
  private maxSize: number = 10000;
  private accessOrder: string[] = [];

  get(key: string): string | undefined {
    const value = this.cache.get(key);
    if (value) {
      this.updateAccessOrder(key);
    }
    return value;
  }

  set(key: string, value: string): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.accessOrder.shift();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, value);
    this.updateAccessOrder(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  getSize(): number {
    return this.cache.size;
  }
}

export const imageCache = new ImageCacheManager();