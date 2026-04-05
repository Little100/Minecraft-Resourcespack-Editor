export interface DrawOperation {
  x: number;
  y: number;
  tool: 'brush' | 'pencil' | 'eraser';
  color?: { r: number; g: number; b: number; a: number };
  size?: number;
}

export interface ViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class OptimizedSelectionMask {
  private mask: Uint8Array;
  private width: number;
  private height: number;
  
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.mask = new Uint8Array(width * height);
  }
  
  set(x: number, y: number, value: boolean): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.mask[y * this.width + x] = value ? 1 : 0;
    }
  }
  
  get(x: number, y: number): boolean {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      return this.mask[y * this.width + x] === 1;
    }
    return false;
  }
  
  fastGet(x: number, y: number): number {
    return this.mask[y * this.width + x];
  }
  
  clear(): void {
    this.mask.fill(0);
  }
  
  fill(value: boolean): void {
    this.mask.fill(value ? 1 : 0);
  }
  
  static fromBooleanArray(arr: boolean[][]): OptimizedSelectionMask | null {
    if (!arr || arr.length === 0) return null;
    const height = arr.length;
    const width = arr[0].length;
    const mask = new OptimizedSelectionMask(width, height);
    for (let y = 0; y < height; y++) {
      const row = arr[y];
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        if (row[x]) mask.mask[rowOffset + x] = 1;
      }
    }
    return mask;
  }
  
  static fromUint8Array(data: Uint8Array, width: number, height: number): OptimizedSelectionMask {
    const mask = new OptimizedSelectionMask(width, height);
    mask.mask.set(data);
    return mask;
  }
  
  getWidth(): number { return this.width; }
  getHeight(): number { return this.height; }
  getRawData(): Uint8Array { return this.mask; }
}

export class BrushTextureCache {
  private brushCache: Map<string, ImageData> = new Map();
  private pencilCache: Map<string, ImageData> = new Map();
  private maxCacheSize: number = 500;
  
  private generateCacheKey(size: number, r: number, g: number, b: number, a: number): string {
    return `${size}_${r}_${g}_${b}_${a}`;
  }
  
  getBrushTexture(size: number, r: number, g: number, b: number, a: number): ImageData {
    const key = this.generateCacheKey(size, r, g, b, a);
    let texture = this.brushCache.get(key);
    if (texture) return texture;
    texture = this.createBrushTexture(size, r, g, b, a);
    if (this.brushCache.size >= this.maxCacheSize) {
      const firstKey = this.brushCache.keys().next().value;
      if (firstKey) this.brushCache.delete(firstKey);
    }
    this.brushCache.set(key, texture);
    return texture;
  }
  
  getPencilTexture(size: number, r: number, g: number, b: number, a: number): ImageData {
    const key = this.generateCacheKey(size, r, g, b, a);
    let texture = this.pencilCache.get(key);
    if (texture) return texture;
    texture = this.createPencilTexture(size, r, g, b, a);
    if (this.pencilCache.size >= this.maxCacheSize) {
      const firstKey = this.pencilCache.keys().next().value;
      if (firstKey) this.pencilCache.delete(firstKey);
    }
    this.pencilCache.set(key, texture);
    return texture;
  }
  
  private createBrushTexture(size: number, r: number, g: number, b: number, a: number): ImageData {
    const imageData = new ImageData(size, size);
    const data = imageData.data;
    const center = size / 2;
    const radius = size / 2;
    const alpha = a / 100;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - center + 0.5;
        const dy = y - center + 0.5;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const normalizedDist = distance / radius;
        if (normalizedDist <= 1) {
          const idx = (y * size + x) * 4;
          let pixelAlpha: number;
          if (normalizedDist <= 0.3) pixelAlpha = alpha;
          else if (normalizedDist <= 0.7) pixelAlpha = alpha * (1 - (normalizedDist - 0.3) / 0.4 * 0.5);
          else pixelAlpha = alpha * 0.5 * (1 - (normalizedDist - 0.7) / 0.3);
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = Math.round(pixelAlpha * 255);
        }
      }
    }
    return imageData;
  }
  
  private createPencilTexture(size: number, r: number, g: number, b: number, a: number): ImageData {
    const imageData = new ImageData(size, size);
    const data = imageData.data;
    const alpha = Math.round((a / 100) * 255);
    for (let i = 0; i < size * size; i++) {
      const idx = i * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = alpha;
    }
    return imageData;
  }
  
  clear(): void {
    this.brushCache.clear();
    this.pencilCache.clear();
  }
  
  getStats(): { brush: number; pencil: number } {
    return { brush: this.brushCache.size, pencil: this.pencilCache.size };
  }
}

export class LineInterpolator {
  private lastX: number = 0;
  private lastY: number = 0;
  private hasLastPoint: boolean = false;
  
  reset(): void {
    this.hasLastPoint = false;
  }
  
  interpolate(x: number, y: number, toolSize: number): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];
    if (!this.hasLastPoint) {
      this.lastX = x;
      this.lastY = y;
      this.hasLastPoint = true;
      points.push({ x, y });
      return points;
    }
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const spacing = Math.max(0.5, toolSize * 0.15);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      points.push({
        x: this.lastX + dx * t,
        y: this.lastY + dy * t
      });
    }
    this.lastX = x;
    this.lastY = y;
    return points;
  }
}

export class DrawingEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private backBuffer: ImageData | null = null;
  private dirtyRegion: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private selectionMask: OptimizedSelectionMask | null = null;
  private pendingOps: DrawOperation[] = [];
  private rafId: number | null = null;
  private viewport: ViewportBounds | null = null;
  private frameCount: number = 0;
  private totalDrawTime: number = 0;
  
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', {
      alpha: true,
      desynchronized: true,
      willReadFrequently: true
    })!;
    this.width = canvas.width;
    this.height = canvas.height;
    this.initBuffers();
  }
  
  private initBuffers(): void {
    if (this.width > 0 && this.height > 0) {
      this.backBuffer = this.ctx.getImageData(0, 0, this.width, this.height);
    }
  }
  
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.initBuffers();
    this.selectionMask = null;
  }
  
  setViewport(bounds: ViewportBounds): void {
    this.viewport = bounds;
  }
  
  setSelectionMask(mask: { data: Uint8Array; width: number; height: number } | boolean[][] | null): void {
    if (!mask) {
      this.selectionMask = null;
    } else if ('data' in mask && mask.data instanceof Uint8Array) {
      this.selectionMask = OptimizedSelectionMask.fromUint8Array(mask.data, mask.width, mask.height);
    } else {
      this.selectionMask = OptimizedSelectionMask.fromBooleanArray(mask as boolean[][]);
    }
  }
  
  private isInViewport(x: number, y: number, margin: number = 0): boolean {
    if (!this.viewport) return true;
    return x >= this.viewport.left - margin && x <= this.viewport.right + margin &&
           y >= this.viewport.top - margin && y <= this.viewport.bottom + margin;
  }
  
  private isInSelection(x: number, y: number): boolean {
    if (!this.selectionMask) return true;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.selectionMask.getWidth() || iy < 0 || iy >= this.selectionMask.getHeight()) return false;
    return this.selectionMask.fastGet(ix, iy) === 1;
  }
  
  private updateDirtyRegion(x: number, y: number, size: number): void {
    const halfSize = Math.ceil(size / 2);
    const minX = Math.max(0, Math.floor(x - halfSize));
    const minY = Math.max(0, Math.floor(y - halfSize));
    const maxX = Math.min(this.width - 1, Math.ceil(x + halfSize));
    const maxY = Math.min(this.height - 1, Math.ceil(y + halfSize));
    if (!this.dirtyRegion) {
      this.dirtyRegion = { minX, minY, maxX, maxY };
    } else {
      this.dirtyRegion.minX = Math.min(this.dirtyRegion.minX, minX);
      this.dirtyRegion.minY = Math.min(this.dirtyRegion.minY, minY);
      this.dirtyRegion.maxX = Math.max(this.dirtyRegion.maxX, maxX);
      this.dirtyRegion.maxY = Math.max(this.dirtyRegion.maxY, maxY);
    }
  }
  
  queueOperation(op: DrawOperation): void {
    const size = op.size || 5;
    if (!this.isInViewport(op.x, op.y, size)) return;
    this.pendingOps.push(op);
    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => this.processQueue());
    }
  }
  
  queueOperations(ops: DrawOperation[]): void {
    for (const op of ops) {
      const size = op.size || 5;
      if (this.isInViewport(op.x, op.y, size)) {
        this.pendingOps.push(op);
      }
    }
    if (this.pendingOps.length > 0 && !this.rafId) {
      this.rafId = requestAnimationFrame(() => this.processQueue());
    }
  }
  
  private processQueue(): void {
    this.rafId = null;
    if (this.pendingOps.length === 0 || !this.backBuffer) return;
    const startTime = performance.now();
    const ops = this.pendingOps;
    this.pendingOps = [];
    const data = this.backBuffer.data;
    for (const op of ops) {
      if (!this.isInSelection(op.x, op.y)) continue;
      const size = op.size || 5;
      const color = op.color || { r: 0, g: 0, b: 0, a: 100 };
      this.updateDirtyRegion(op.x, op.y, size);
      switch (op.tool) {
        case 'brush': this.drawBrushDirect(data, op.x, op.y, size, color); break;
        case 'pencil': this.drawPencilDirect(data, op.x, op.y, size, color); break;
        case 'eraser': this.eraseDirect(data, op.x, op.y, size); break;
      }
    }
    if (this.dirtyRegion) {
      const { minX, minY, maxX, maxY } = this.dirtyRegion;
      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      // U-PERF-01: 使用 putImageData 的 dirty rect 重载，避免 JS 层逐像素复制
      this.ctx.putImageData(this.backBuffer, 0, 0, minX, minY, width, height);
      this.dirtyRegion = null;
    }
    const drawTime = performance.now() - startTime;
    this.totalDrawTime += drawTime;
    this.frameCount++;
    if (this.pendingOps.length > 0) {
      this.rafId = requestAnimationFrame(() => this.processQueue());
    }
  }
  
  private drawBrushDirect(data: Uint8ClampedArray, cx: number, cy: number, size: number, color: { r: number; g: number; b: number; a: number }): void {
    const radius = size / 2;
    const radiusSq = radius * radius;
    const alpha = color.a / 100;
    const startX = Math.max(0, Math.floor(cx - radius));
    const startY = Math.max(0, Math.floor(cy - radius));
    const endX = Math.min(this.width - 1, Math.ceil(cx + radius));
    const endY = Math.min(this.height - 1, Math.ceil(cy + radius));
    // U-PERF-02: 预计算阈值的平方，使用 distance² 做快速裁剪
    const t03sq = (0.3 * radius) * (0.3 * radius);
    const t07sq = (0.7 * radius) * (0.7 * radius);
    const invRadius = 1 / radius;
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        if (this.selectionMask && !this.selectionMask.fastGet(x, y)) continue;
        const dx = x - cx + 0.5;
        const dy = y - cy + 0.5;
        const distSq = dx * dx + dy * dy;
        // 快速裁剪：超出半径的像素直接跳过
        if (distSq > radiusSq) continue;
        let pixelAlpha: number;
        if (distSq <= t03sq) {
          pixelAlpha = alpha;
        } else {
          // 仅在需要渐变时才计算 sqrt
          const normalizedDist = Math.sqrt(distSq) * invRadius;
          if (normalizedDist <= 0.7) pixelAlpha = alpha * (1 - (normalizedDist - 0.3) / 0.4 * 0.5);
          else pixelAlpha = alpha * 0.5 * (1 - (normalizedDist - 0.7) / 0.3);
        }
        const idx = (y * this.width + x) * 4;
        const srcAlpha = pixelAlpha;
        const dstAlpha = data[idx + 3] / 255;
        const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);
        if (outAlpha > 0) {
          data[idx] = (color.r * srcAlpha + data[idx] * dstAlpha * (1 - srcAlpha)) / outAlpha;
          data[idx + 1] = (color.g * srcAlpha + data[idx + 1] * dstAlpha * (1 - srcAlpha)) / outAlpha;
          data[idx + 2] = (color.b * srcAlpha + data[idx + 2] * dstAlpha * (1 - srcAlpha)) / outAlpha;
          data[idx + 3] = outAlpha * 255;
        }
      }
    }
  }
  
  private drawPencilDirect(data: Uint8ClampedArray, cx: number, cy: number, size: number, color: { r: number; g: number; b: number; a: number }): void {
    const halfSize = Math.floor(size / 2);
    const startX = Math.max(0, Math.floor(cx - halfSize));
    const startY = Math.max(0, Math.floor(cy - halfSize));
    const endX = Math.min(this.width - 1, startX + size - 1);
    const endY = Math.min(this.height - 1, startY + size - 1);
    const alpha = color.a / 100;
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        if (this.selectionMask && !this.selectionMask.fastGet(x, y)) continue;
        const idx = (y * this.width + x) * 4;
        const srcAlpha = alpha;
        const dstAlpha = data[idx + 3] / 255;
        const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);
        if (outAlpha > 0) {
          data[idx] = (color.r * srcAlpha + data[idx] * dstAlpha * (1 - srcAlpha)) / outAlpha;
          data[idx + 1] = (color.g * srcAlpha + data[idx + 1] * dstAlpha * (1 - srcAlpha)) / outAlpha;
          data[idx + 2] = (color.b * srcAlpha + data[idx + 2] * dstAlpha * (1 - srcAlpha)) / outAlpha;
          data[idx + 3] = outAlpha * 255;
        }
      }
    }
  }
  
  private eraseDirect(data: Uint8ClampedArray, cx: number, cy: number, size: number): void {
    const halfSize = Math.floor(size / 2);
    const startX = Math.max(0, Math.floor(cx - halfSize));
    const startY = Math.max(0, Math.floor(cy - halfSize));
    const endX = Math.min(this.width - 1, startX + size - 1);
    const endY = Math.min(this.height - 1, startY + size - 1);
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        if (this.selectionMask && !this.selectionMask.fastGet(x, y)) continue;
        const idx = (y * this.width + x) * 4;
        data[idx + 3] = 0;
      }
    }
  }
  
  syncFromCanvas(): void {
    if (this.width > 0 && this.height > 0) {
      this.backBuffer = this.ctx.getImageData(0, 0, this.width, this.height);
    }
  }
  
  getImageData(): ImageData | null {
    return this.backBuffer;
  }
  
  setImageData(imageData: ImageData): void {
    this.backBuffer = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
    this.ctx.putImageData(imageData, 0, 0);
  }
  
  clear(): void {
    if (this.backBuffer) {
      this.backBuffer.data.fill(0);
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
  }
  
  getStats(): { frameCount: number; avgDrawTime: number } {
    return {
      frameCount: this.frameCount,
      avgDrawTime: this.frameCount > 0 ? this.totalDrawTime / this.frameCount : 0,
    };
  }
  
  destroy(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingOps = [];
    this.backBuffer = null;
    this.selectionMask = null;
    this.dirtyRegion = null;
  }
}

const engineInstances = new Map<string, DrawingEngine>();

export function getDrawingEngine(id: string, canvas: HTMLCanvasElement): DrawingEngine {
  let engine = engineInstances.get(id);
  if (!engine || engine['canvas'] !== canvas) {
    if (engine) engine.destroy();
    engine = new DrawingEngine(canvas);
    engineInstances.set(id, engine);
  }
  return engine;
}

export function destroyDrawingEngine(id: string): void {
  const engine = engineInstances.get(id);
  if (engine) {
    engine.destroy();
    engineInstances.delete(id);
  }
}

export function destroyAllEngines(): void {
  engineInstances.forEach(engine => engine.destroy());
  engineInstances.clear();
}