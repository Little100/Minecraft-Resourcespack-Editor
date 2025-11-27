export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };
    
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;
  
  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

export function rafThrottle<T extends (...args: any[]) => any>(
  func: T
): (...args: Parameters<T>) => void {
  let rafId: number | null = null;
  
  return function executedFunction(...args: Parameters<T>) {
    if (rafId !== null) {
      return;
    }
    
    rafId = requestAnimationFrame(() => {
      func(...args);
      rafId = null;
    });
  };
}

export function idleCallback(
  callback: () => void,
  options?: IdleRequestOptions
): number {
  if ('requestIdleCallback' in window) {
    return window.requestIdleCallback(callback, options);
  } else {
    // 降级方案
    return (window as Window).setTimeout(callback, 1) as unknown as number;
  }
}

export function cancelIdleCallback(id: number): void {
  if ('cancelIdleCallback' in window) {
    window.cancelIdleCallback(id);
  } else {
    (window as Window).clearTimeout(id);
  }
}

export class PerformanceMonitor {
  private marks: Map<string, number> = new Map();
  private measures: Map<string, number> = new Map();
  
  mark(name: string): void {
    this.marks.set(name, performance.now());
    
    if (performance.mark) {
      performance.mark(name);
    }
  }
  
  measure(name: string, startMark: string, endMark?: string): number {
    const start = this.marks.get(startMark);
    if (!start) {
      console.warn(`Start mark "${startMark}" not found`);
      return 0;
    }
    
    const end = endMark ? this.marks.get(endMark) : performance.now();
    if (endMark && !end) {
      console.warn(`End mark "${endMark}" not found`);
      return 0;
    }
    
    const duration = (end || performance.now()) - start;
    this.measures.set(name, duration);
    
    if (performance.measure) {
      try {
        performance.measure(name, startMark, endMark);
      } catch (e) {
        // 忽略
      }
    }
    
    return duration;
  }
  
  getMeasure(name: string): number | undefined {
    return this.measures.get(name);
  }
  
  clear(): void {
    this.marks.clear();
    this.measures.clear();
    
    if (performance.clearMarks) {
      performance.clearMarks();
    }
    if (performance.clearMeasures) {
      performance.clearMeasures();
    }
  }
  
  report(): void {
    console.group('📊 性能报告');
    
    this.measures.forEach((duration, name) => {
      const color = duration < 100 ? '🟢' : duration < 500 ? '🟡' : '🔴';
      console.log(`${color} ${name}: ${duration.toFixed(2)}ms`);
    });
    
    console.groupEnd();
  }
}

export const perfMonitor = new PerformanceMonitor();

export function getMemoryUsage(): {
  used: number;
  total: number;
  percentage: number;
} | null {
  if ('memory' in performance) {
    const memory = (performance as any).memory;
    return {
      used: memory.usedJSHeapSize,
      total: memory.totalJSHeapSize,
      percentage: (memory.usedJSHeapSize / memory.totalJSHeapSize) * 100
    };
  }
  return null;
}

export class FPSMonitor {
  private frames: number[] = [];
  private lastTime: number = performance.now();
  private rafId: number | null = null;
  
  start(callback?: (fps: number) => void): void {
    const measure = () => {
      const now = performance.now();
      const delta = now - this.lastTime;
      this.lastTime = now;
      
      const fps = 1000 / delta;
      this.frames.push(fps);
      
      if (this.frames.length > 60) {
        this.frames.shift();
      }
      
      if (callback) {
        const avgFps = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
        callback(avgFps);
      }
      
      this.rafId = requestAnimationFrame(measure);
    };
    
    this.rafId = requestAnimationFrame(measure);
  }
  
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
  
  getAverageFPS(): number {
    if (this.frames.length === 0) return 0;
    return this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
  }
}

export function createLazyLoadObserver(
  callback: (entry: IntersectionObserverEntry) => void,
  options?: IntersectionObserverInit
): IntersectionObserver {
  const defaultOptions: IntersectionObserverInit = {
    root: null,
    rootMargin: '50px',
    threshold: 0.01,
    ...options
  };
  
  return new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        callback(entry);
      }
    });
  }, defaultOptions);
}

export function batchDOMUpdates(updates: Array<() => void>): void {
  requestAnimationFrame(() => {
    updates.forEach(update => update());
  });
}

export function addOptimizedEventListener(
  element: HTMLElement | Window,
  event: string,
  handler: EventListener,
  options?: AddEventListenerOptions
): () => void {
  const optimizedOptions: AddEventListenerOptions = {
    passive: true,
    ...options
  };
  
  element.addEventListener(event, handler, optimizedOptions);
  
  return () => {
    element.removeEventListener(event, handler, optimizedOptions);
  };
}