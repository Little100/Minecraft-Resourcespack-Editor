import { logger } from './logger';

interface CacheEntry {
  data: string;
  size: number;
  lastAccess: number;
  accessCount: number;
}

class ImageCacheManager {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number = 50000;
  private maxMemory: number = 500 * 1024 * 1024;
  private currentMemory: number = 0;
  private accessOrder: string[] = [];
  private preloadQueue: Set<string> = new Set();
  private isPreloading: boolean = false;

  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  get(key: string): string | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastAccess = Date.now();
      entry.accessCount++;
      this.updateAccessOrder(key);
      this.stats.hits++;
      return entry.data;
    }
    this.stats.misses++;
    return undefined;
  }

  set(key: string, value: string): void {
    const size = value.length * 2;

    if (this.currentMemory + size > this.maxMemory) {
      this.evictByMemory(size);
    }

    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictByCount();
    }

    const existing = this.cache.get(key);
    if (existing) {
      this.currentMemory -= existing.size;
    }

    this.cache.set(key, {
      data: value,
      size,
      lastAccess: Date.now(),
      accessCount: 1,
    });
    this.currentMemory += size;
    this.updateAccessOrder(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.currentMemory = 0;
    this.preloadQueue.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  private evictByMemory(requiredSpace: number): void {
    const targetMemory = this.maxMemory * 0.7;
    
    while (this.currentMemory + requiredSpace > targetMemory && this.accessOrder.length > 0) {
      const oldestKey = this.accessOrder.shift();
      if (oldestKey) {
        const entry = this.cache.get(oldestKey);
        if (entry) {
          this.currentMemory -= entry.size;
          this.cache.delete(oldestKey);
          this.stats.evictions++;
        }
      }
    }
  }

  private evictByCount(): void {
    const targetSize = Math.floor(this.maxSize * 0.8);
    
    while (this.cache.size > targetSize && this.accessOrder.length > 0) {
      const oldestKey = this.accessOrder.shift();
      if (oldestKey) {
        const entry = this.cache.get(oldestKey);
        if (entry) {
          this.currentMemory -= entry.size;
          this.cache.delete(oldestKey);
          this.stats.evictions++;
        }
      }
    }
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

  getMemoryUsage(): number {
    return this.currentMemory;
  }

  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100
      : 0;
    
    return {
      ...this.stats,
      hitRate: hitRate.toFixed(2) + '%',
      cacheSize: this.cache.size,
      memoryUsage: (this.currentMemory / 1024 / 1024).toFixed(2) + 'MB',
    };
  }

  // 预加载功能 
  private loadFn: ((key: string) => Promise<string>) | null = null;

  setLoadFunction(fn: (key: string) => Promise<string>): void {
    this.loadFn = fn;
  }

  addToPreloadQueue(keys: string[]): void {
    keys.forEach(key => {
      if (!this.cache.has(key)) {
        this.preloadQueue.add(key);
      }
    });
    
    if (!this.isPreloading) {
      this.processPreloadQueue();
    }
  }

  private async processPreloadQueue(): Promise<void> {
    if (this.isPreloading || this.preloadQueue.size === 0) {
      return;
    }

    this.isPreloading = true;
    
    const batch = Array.from(this.preloadQueue).slice(0, 10);
    this.preloadQueue = new Set(Array.from(this.preloadQueue).slice(10));

    if (this.loadFn) {
      for (const key of batch) {
        if (this.cache.has(key)) continue;
        try {
          const data = await this.loadFn(key);
          this.set(key, data);
        } catch {}
      }
    }

    this.isPreloading = false;
    
    if (this.preloadQueue.size > 0) {
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(() => this.processPreloadQueue());
      } else {
        setTimeout(() => this.processPreloadQueue(), 100);
      }
    }
  }

  prefetchNearby(currentPath: string, allPaths: string[], radius: number = 5): void {
    const currentIndex = allPaths.indexOf(currentPath);
    if (currentIndex === -1) return;

    const start = Math.max(0, currentIndex - radius);
    const end = Math.min(allPaths.length, currentIndex + radius + 1);
    
    const nearbyPaths = allPaths.slice(start, end).filter(path => !this.cache.has(path));
    this.addToPreloadQueue(nearbyPaths);
  }

  optimize(): void {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    const toRemove: string[] = [];
    
    this.cache.forEach((entry, key) => {
      if (now - entry.lastAccess > oneHour && entry.accessCount < 3) {
        toRemove.push(key);
      }
    });

    toRemove.forEach(key => {
      const entry = this.cache.get(key);
      if (entry) {
        this.currentMemory -= entry.size;
        this.cache.delete(key);
        const index = this.accessOrder.indexOf(key);
        if (index > -1) {
          this.accessOrder.splice(index, 1);
        }
      }
    });

    if (toRemove.length > 0) {
      logger.debug(`[缓存优化] 清理了 ${toRemove.length} 个低价值条目`);
    }
  }
}

export const imageCache = new ImageCacheManager();
let optimizeIntervalId: ReturnType<typeof setInterval> | null = null;

if (typeof window !== 'undefined') {
  optimizeIntervalId = setInterval(() => {
    imageCache.optimize();
  }, 5 * 60 * 1000);
}

export function stopCacheOptimizer(): void {
  if (optimizeIntervalId !== null) {
    clearInterval(optimizeIntervalId);
    optimizeIntervalId = null;
  }
}