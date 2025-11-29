// 我也不知道为什么突然这个文件在我的前端怎么都读取不了...所以加了这一行注释重新读取
export function createGPUContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d', {
    alpha: true,
    desynchronized: true,
    willReadFrequently: false,
    powerPreference: 'high-performance'
  }) as CanvasRenderingContext2D | null;
  
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    
    // 检查是否支持GPU加速
    const attrs = ctx.getContextAttributes();
    console.log('[GPU加速] Canvas上下文属性:', attrs);
  }
  
  return ctx;
}

export class OffscreenRenderer {
  private offscreen: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private worker: Worker | null = null;
  
  constructor(width: number, height: number) {
    if (typeof OffscreenCanvas !== 'undefined') {
      this.offscreen = new OffscreenCanvas(width, height);
      this.ctx = this.offscreen.getContext('2d', {
        alpha: true,
        desynchronized: true,
        willReadFrequently: false
      }) as OffscreenCanvasRenderingContext2D | null;
      
      console.log('[GPU加速] OffscreenCanvas创建成功:', width, 'x', height);
    } else {
      console.warn('[GPU加速] OffscreenCanvas不支持,降级到普通Canvas');
    }
  }
  
  isSupported(): boolean {
    return this.offscreen !== null && this.ctx !== null;
  }
  
  getContext(): OffscreenCanvasRenderingContext2D | null {
    return this.ctx;
  }
  
  transferToCanvas(targetCanvas: HTMLCanvasElement): void {
    if (!this.offscreen) return;
    
    const ctx = targetCanvas.getContext('2d');
    if (ctx) {
      const bitmap = this.offscreen.transferToImageBitmap();
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    }
  }
  
  destroy(): void {
    this.offscreen = null;
    this.ctx = null;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

export class BatchDrawOptimizer {
  private operations: Array<() => void> = [];
  private rafId: number | null = null;
  private isProcessing: boolean = false;
  
  addOperation(op: () => void): void {
    this.operations.push(op);
    
    if (!this.rafId && !this.isProcessing) {
      this.rafId = requestAnimationFrame(() => this.flush());
    }
  }
  
  flush(): void {
    if (this.isProcessing || this.operations.length === 0) {
      this.rafId = null;
      return;
    }
    
    this.isProcessing = true;
    const startTime = performance.now();
    
    const ops = [...this.operations];
    this.operations = [];
    
    for (const op of ops) {
      op();
    }
    
    const duration = performance.now() - startTime;
    if (duration > 16) {
      console.log(`[GPU批量绘制] 处理${ops.length}个操作耗时: ${duration.toFixed(2)}ms`);
    }
    
    this.isProcessing = false;
    this.rafId = null;
    
    if (this.operations.length > 0) {
      this.rafId = requestAnimationFrame(() => this.flush());
    }
  }
  
  clear(): void {
    this.operations = [];
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.isProcessing = false;
  }
}

export function checkGPUSupport(): {
  canvas2d: boolean;
  offscreenCanvas: boolean;
  webgl: boolean;
  webgl2: boolean;
} {
  const canvas = document.createElement('canvas');
  
  return {
    canvas2d: !!canvas.getContext('2d'),
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    webgl: !!canvas.getContext('webgl'),
    webgl2: !!canvas.getContext('webgl2')
  };
}

export function getGPUInfo(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    
    if (!gl) {
      return 'WebGL不支持';
    }
    
    const webglContext = gl as WebGLRenderingContext;
    const debugInfo = webglContext.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const vendor = webglContext.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
      const renderer = webglContext.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      return `${vendor} - ${renderer}`;
    }
    
    return 'GPU信息不可用';
  } catch (e) {
    return '获取GPU信息失败';
  }
}

export function enableCanvasAcceleration(canvas: HTMLCanvasElement): void {
  // 强制GPU
  canvas.style.willChange = 'transform, contents';
  canvas.style.transform = 'translate3d(0, 0, 0)';
  canvas.style.backfaceVisibility = 'hidden';
  canvas.style.perspective = '1000px';
  canvas.style.isolation = 'isolate';
  
  // 验证
  const computedStyle = window.getComputedStyle(canvas);
  console.log('[GPU加速] Canvas硬件加速已启用');
  console.log('[GPU加速] willChange:', computedStyle.willChange);
  console.log('[GPU加速] transform:', computedStyle.transform);
  console.log('[GPU加速] isolation:', computedStyle.isolation);
}